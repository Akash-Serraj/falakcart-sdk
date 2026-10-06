/**
 * Formatting and small utilities.
 *
 * `money` and `number` are here rather than in a component because a storefront
 * must format identically everywhere — a price rendered by Twig and the same
 * price re-rendered by a component after a variant change have to match, or the
 * shopper sees the number flicker into a different shape.
 */
export default class Helpers {
    constructor(config) {
        this.config = config;
        this.url = new UrlHelpers(config);
    }

    /**
     * Amounts arrive from the API in the store's currency as a decimal string
     * (`price_cents` is a decimal:2 cast, despite the column name), so this
     * formats a plain number and never divides by 100.
     */
    money(amount, currency = null, options = {}) {
        let value = Number(amount);

        if (!Number.isFinite(value)) return '';

        const base = String(this.config.get('currency.code', 'SAR')).toUpperCase();
        let code = String(currency || base).toUpperCase();
        // `{ convert: false }` prints a base amount AS base — for a figure
        // frozen on an order (what was charged), which must not be re-converted.
        const convert = options?.convert !== false;

        /*
         * `currency` is the currency the amount is IN — null or the base code
         * means a catalog amount, and those are shown in the shopper's display
         * currency at the rate the server resolved for this page. Anything
         * else (a gateway's USD charge) is printed as given. This is the same
         * branch CurrencyFormatter::format() takes, with the same rate, so the
         * two print one number. No rate is ever derived here.
         */
        const display = String(this.config.get('currency.display', base)).toUpperCase();

        if (convert && code === base && display !== base) {
            value = this.roundMoney(value * (Number(this.config.get('currency.rate', 1)) || 1));
            code = display;
        }

        const decimals = this.decimals();

        /*
         * Mirrors the platform's CurrencyFormatter exactly — `1,234.50 SAR`,
         * Arabic-Indic digits only when the merchant enabled them. A price a
         * component re-renders must be byte-identical to the one Twig printed,
         * so Intl's currency style (which places symbols per locale) is out.
         */
        let formatted = value.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        });

        if (this.config.get('store.settings.arabic_numbers_enabled', false)) {
            formatted = formatted.replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
        }

        /*
         * Display labels come from the server at init, keyed by code, so Twig
         * and this function read the same table and cannot disagree. A code
         * the locale does not localize prints as itself.
         */
        const label = (this.config.get('currency.labels', {}) || {})[code] || code;

        return `${formatted} ${label}`;
    }

    /**
     * A base-currency amount in another currency, at the server's rates.
     *
     * For the checkout's "you'll be charged 12.50 USD" line, where the gateway
     * settles in something other than what the shopper is reading. The rates
     * are the base → code table the page was rendered with (buffer included),
     * so this agrees with what StorefrontCurrency::gatewayCharge() will send.
     */
    convert(amount, to, from = null) {
        const value = Number(amount);

        if (!Number.isFinite(value)) return 0;

        const base = String(this.config.get('currency.code', 'SAR')).toUpperCase();
        const target = String(to || base).toUpperCase();
        const source = String(from || base).toUpperCase();

        if (source === target) return this.roundMoney(value);

        const rates = this.config.get('currency.rates', {}) || {};
        const toRate = source === base ? Number(rates[target]) : Number(rates[target]) / Number(rates[source]);

        if (!Number.isFinite(toRate) || toRate <= 0) return this.roundMoney(value);

        return this.roundMoney(value * toRate);
    }

    /** Half-up to the platform's decimals — the arithmetic StorefrontCurrency::round() runs. */
    roundMoney(value) {
        const factor = 10 ** this.decimals();

        return Math.floor(value * factor + 0.5 + 1e-9) / factor;
    }

    decimals() {
        const decimals = Number(this.config.get('currency.decimals', 2));

        return Number.isInteger(decimals) && decimals >= 0 ? decimals : 2;
    }

    number(value) {
        const parsed = Number(value);

        if (!Number.isFinite(parsed)) return '';

        try {
            return new Intl.NumberFormat(this.localeTag()).format(parsed);
        } catch (e) {
            return String(parsed);
        }
    }

    /** ar-SA gives Arabic-Indic digits; the merchant can opt out per store. */
    localeTag() {
        const locale = this.config.get('locale', 'ar');

        return locale === 'ar' && !this.config.get('store.settings.arabic_numbers_enabled', false)
            ? 'ar-SA-u-nu-latn'
            : locale;
    }

    debounce(fn, wait = 300) {
        let timer;

        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    /** Escapes text destined for innerHTML. Components render API data, so this is not optional. */
    escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ESCAPES[character]);
    }

    /** Reads a JSON attribute without letting a malformed one break a render. */
    parseJson(raw, fallback = null) {
        if (raw === null || raw === undefined || raw === '') return fallback;
        if (typeof raw === 'object') return raw;

        try {
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }
}

class UrlHelpers {
    constructor(config) {
        this.config = config;
    }

    /** Storefront path on the current host — the tenant is resolved from it. */
    get(path = '') {
        return '/' + String(path).replace(/^\/+/, '');
    }

    /**
     * API base is same-origin, so session cookies and tenant resolution just work.
     *
     * A path starting with `/` is taken as already rooted and returned as-is.
     * Not every endpoint lives under the storefront prefix — customer auth sits
     * at /api/customer — and a domain API that knows its own full path should
     * not have to fight the default base.
     */
    api(path = '') {
        const value = String(path);

        if (value.startsWith('/')) return value;

        const base = this.config.get('store.api', '/api/storefront').replace(/\/+$/, '');

        return base + '/' + value.replace(/^\/+/, '');
    }

    asset(path = '') {
        const base = this.config.get('theme.assets', '').replace(/\/+$/, '');
        return base ? base + '/' + String(path).replace(/^\/+/, '') : this.get(path);
    }

    product(id, slug = null) {
        return this.get(`product/${id}` + (slug ? `/${slug}` : ''));
    }

    /**
     * A category's page — the listing narrowed to it.
     *
     * There is no /category/{id} route. A category is the listing with that
     * category selected, which is also precisely what <falak-filters> writes
     * when the shopper ticks the box, so landing on a category and filtering
     * to one produce the same URL instead of two addresses for one page.
     *
     * Built with URLSearchParams rather than interpolated, so the brackets are
     * encoded the same way the filter component encodes them.
     */
    category(id) {
        const params = new URLSearchParams();
        params.append('category_id[]', String(id));

        return `${this.get('products')}?${params}`;
    }

    search(query = '') {
        return this.get('search') + (query ? `?q=${encodeURIComponent(query)}` : '');
    }

    /** True on the named storefront page, using the slug the platform rendered. */
    isPage(slug) {
        return this.config.get('page.slug') === slug;
    }

    withParam(key, value, url = window.location.href) {
        const parsed = new URL(url, window.location.origin);
        parsed.searchParams.set(key, value);
        return parsed.toString();
    }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
