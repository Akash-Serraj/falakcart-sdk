/**
 * The one HTTP client. Every API call in the SDK goes through `request()`.
 *
 * Centralising it buys three things that are painful to retrofit:
 *
 *  1. Ambient context. Locale, currency, store identity and credentials are
 *     attached once here instead of at ~40 call sites.
 *
 *  2. A server -> client command channel. Any response may carry an `events`
 *     object; it is dispatched onto the bus automatically, so the backend can
 *     say "also refresh the cart" without the caller knowing that is possible.
 *
 *  3. One notification policy, with a ref-counted way to opt out.
 */
export default class ApiClient {
    /** Deadline for a single request when the caller passes no signal. */
    static REQUEST_TIMEOUT_MS = 20000;

    timeoutMessage() {
        const locale = this.config?.get?.('locale', 'ar');
        return locale === 'ar'
            ? 'انتهت مهلة الطلب. يرجى المحاولة مرة أخرى.'
            : 'The request timed out. Please try again.';
    }

    constructor({ config, event, logger, notify, helpers }) {
        this.config = config;
        this.event = event;
        this.logger = logger;
        this.notify = notify;
        this.helpers = helpers;

        /**
         * Ref-counted rather than a boolean: nested silent calls must not let
         * the inner one re-enable notifications for the outer one.
         */
        this.silenceDepth = 0;
    }

    get isSilenced() {
        return this.silenceDepth > 0;
    }

    /** falak.api.withoutNotifier(() => falak.product.fetch()) — probe quietly. */
    async withoutNotifier(callback) {
        this.silenceDepth++;

        try {
            return await callback();
        } finally {
            this.silenceDepth = Math.max(0, this.silenceDepth - 1);
        }
    }

    headers(extra = {}) {
        const headers = {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-Falak-Source': 'sdk',
            'Accept-Language': this.config.get('locale', 'ar'),
            ...extra,
        };

        const storeId = this.config.get('store.id');
        if (storeId) headers['X-Store-Id'] = String(storeId);

        const currency = this.config.get('currency.code');
        if (currency) headers['X-Currency'] = currency;

        const token = this.config.get('token');
        if (token) headers['Authorization'] = `Bearer ${token}`;

        /*
         * Laravel's session guard needs the XSRF token for writes. It lives in
         * a cookie the platform already sets, so reading it here keeps every
         * mutating endpoint working without the caller thinking about it.
         */
        const csrf = readCookie('XSRF-TOKEN');
        if (csrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(csrf);

        return headers;
    }

    /**
     * @param {string} path    resolved endpoint, relative to the API base
     * @param {object} options { method, params, body, headers, signal }
     */
    /**
     * Collapses identical GETs that are in flight AT THE SAME MOMENT.
     *
     * A page has many independent components and no way for them to know what
     * the others are asking for. A product page was issuing `GET /products`
     * three times (two lists and a slider), `GET /products/288` twice (two
     * cards for the same product each resolving their variants) and
     * `GET /special-offers` once per card — every one of them the same URL,
     * every one of them started before the first had answered.
     *
     * This is a COALESCER, not a cache: the entry is dropped the moment the
     * promise settles, so a later call always goes to the network and nothing
     * stale is ever served. Two rules keep it safe:
     *
     *   - GET only. A duplicate POST is a second cart line, not a wasted read.
     *   - Never when the caller passed its own `signal`. Sharing a promise
     *     would let one caller's abort() cancel another's request.
     */
    async request(path, options = {}) {
        const method = (options.method || 'get').toUpperCase();
        const url = new URL(this.helpers.url.api(path), window.location.origin);

        Object.entries(options.params || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            Array.isArray(value)
                ? value.forEach(item => url.searchParams.append(`${key}[]`, item))
                : url.searchParams.set(key, value);
        });

        if (method !== 'GET' || options.signal) {
            return this.performRequest(path, options, method, url);
        }

        this._inflight ??= new Map();

        const key = url.toString();
        const running = this._inflight.get(key);

        if (running) return running;

        const promise = this.performRequest(path, options, method, url)
            .finally(() => this._inflight.delete(key));

        this._inflight.set(key, promise);

        return promise;
    }

    /** The actual round trip. Callers go through request(). */
    async performRequest(path, options, method, url) {

        /*
         * Every request has a deadline. A request that never returns (a
         * wedged single-worker dev server, a dropped mobile connection)
         * otherwise leaves whatever waited on it stuck — an add-to-cart
         * button that stays "pending" and ignores every further click. A
         * timeout turns that into an error the caller can show and recover
         * from. A caller's own signal still wins.
         */
        const canAbort = typeof AbortController !== 'undefined';
        const controller = options.signal || !canAbort ? null : new AbortController();
        const timer = controller
            ? setTimeout(() => controller.abort(), options.timeout ?? ApiClient.REQUEST_TIMEOUT_MS)
            : null;

        const init = {
            method,
            headers: this.headers(options.headers),
            credentials: 'same-origin',
            signal: options.signal ?? controller?.signal,
        };

        if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
            if (options.body instanceof FormData) {
                init.body = options.body;   // let the browser set the boundary
            } else {
                init.headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(options.body);
            }
        }

        this.logger.log(`${method} ${url.pathname}${url.search}`);

        let response;
        let payload;

        try {
            response = await fetch(url.toString(), init);
            /*
             * `responseType: 'blob'` is for files — an invoice PDF, a digital
             * download. A 2xx is handed back as the Blob itself; an error
             * still comes as JSON so the usual message handling applies.
             */
            payload = options.responseType === 'blob' && response.ok
                ? await response.blob()
                : await this.parse(response);
            if (timer) clearTimeout(timer);
        } catch (error) {
            // Network failure or an aborted request — never reached the server.
            this.event.dispatch('request::failed', { path, method, error });
            if (timer) clearTimeout(timer);
            if (error?.name === 'AbortError' && controller) error = Object.assign(new Error(this.timeoutMessage()), { falak: { timeout: true } });
            throw this.fail(error, { path, method });
        }

        if (!response.ok) {
            throw this.handleError(payload, response, { path, method });
        }

        this.handleSuccess(payload);

        return payload;
    }

    async parse(response) {
        const type = response.headers.get('content-type') || '';

        if (!type.includes('application/json')) {
            const text = await response.text();
            return text === '' ? null : text;
        }

        try {
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    /** Runs on every 2xx: server events first, then any message worth showing. */
    handleSuccess(payload) {
        this.fireServerEvents(payload);

        // Same localised-pair handling as the error path: `message-lang` is a
        // { en, ar } array and is preferred over the English-only `message`.
        const message = payload && typeof payload === 'object'
            ? (this.localised(payload['message-lang']) ?? this.localised(payload.message))
            : null;

        if (message && !this.isSilenced) this.notify.success(message);
    }

    handleError(payload, response, context) {
        this.fireServerEvents(payload);

        const message = this.errorMessage(payload, response);

        if (!this.isSilenced) this.notify.error(message);

        this.event.dispatch('request::failed', { ...context, status: response.status, payload });

        return this.fail(new Error(message), { ...context, status: response.status, payload });
    }

    /**
     * The storefront controllers are not uniform — some return `error`, some
     * `message`, some a Laravel validation bag. Reading all three here means
     * callers never have to.
     */
    errorMessage(payload, response) {
        if (!payload || typeof payload !== 'object') {
            return `Request failed (${response.status})`;
        }

        if (payload.errors && typeof payload.errors === 'object') {
            const first = Object.values(payload.errors).flat()[0];
            if (first) return this.localised(first);
        }

        /*
         * `-lang` keys come from MessageHelper::message(), which returns an
         * ARRAY — `{ en: "...", ar: "..." }` — not a string. They are read
         * first because they are the translated pair; the plain `error` and
         * `message` keys beside them are English-only fallbacks.
         */
        const candidates = [
            payload['error-lang'],
            payload['message-lang'],
            payload.error,
            payload.message,
        ];

        for (const candidate of candidates) {
            const text = this.localised(candidate);
            if (text) return text;
        }

        return `Request failed (${response.status})`;
    }

    /**
     * Resolves a value that may be a plain string or a `{ en, ar }` pair.
     *
     * Without this a localised pair reached `new Error(object)` and surfaced to
     * the shopper as "[object Object]" — and always in English when it did
     * resolve, because nothing picked the locale.
     */
    localised(value) {
        if (typeof value === 'string') return value.trim() || null;
        if (!value || typeof value !== 'object') return null;

        // A validation bag can nest one level: { field: [{ en, ar }] }.
        if (Array.isArray(value)) return this.localised(value[0]);

        const locale = this.config.get('locale', 'ar');

        const text = value[locale]
            ?? value.ar
            ?? value.en
            ?? Object.values(value).find(entry => typeof entry === 'string');

        return typeof text === 'string' && text.trim() ? text.trim() : null;
    }

    /** `{ events: { 'product::viewed': {...} } }` anywhere in the body. */
    fireServerEvents(payload) {
        if (!payload || typeof payload !== 'object') return;

        let events = payload.events || (payload.data && payload.data.events);

        if (typeof events === 'string') {
            try { events = JSON.parse(events); } catch (e) { return; }
        }

        if (events && typeof events === 'object') this.event.dispatchEvents(events);
    }

    /** Attaches context to the thrown error so callers can branch on status. */
    fail(error, context) {
        return Object.assign(error, { falak: context });
    }
}

function readCookie(name) {
    const match = document.cookie.match(new RegExp('(^|;\s*)' + name + '=([^;]*)'));
    return match ? match[2] : null;
}
