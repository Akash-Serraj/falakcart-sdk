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
    async request(path, options = {}) {
        const method = (options.method || 'get').toUpperCase();
        const url = new URL(this.helpers.url.api(path), window.location.origin);

        Object.entries(options.params || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            Array.isArray(value)
                ? value.forEach(item => url.searchParams.append(`${key}[]`, item))
                : url.searchParams.set(key, value);
        });

        const init = {
            method,
            headers: this.headers(options.headers),
            credentials: 'same-origin',
            signal: options.signal,
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
            payload = await this.parse(response);
        } catch (error) {
            // Network failure or an aborted request — never reached the server.
            this.event.dispatch('request::failed', { path, method, error });
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
