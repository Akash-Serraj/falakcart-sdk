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
    money(amount, currency = null) {
        const value = Number(amount);

        if (!Number.isFinite(value)) return '';

        const code = currency || this.config.get('currency.code', 'SAR');
        const locale = this.config.get('currency.locale') || this.localeTag();

        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: code,
                minimumFractionDigits: this.config.get('currency.decimals', 2),
            }).format(value);
        } catch (e) {
            // Unknown currency code, or an Intl-less environment.
            return `${this.number(value)} ${code}`;
        }
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
