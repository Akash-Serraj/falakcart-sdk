import BaseApi from './base.js';

/**
 * Language and currency.
 *
 * Neither is a server round trip on this platform: the storefront reads `?lang`
 * and `?currency` per request and remembers each in a cookie, and the
 * merchant's currencies come down in config. So the API surface here is small
 * on purpose — it reads what the platform already sent and, to switch, it
 * navigates.
 *
 * Currency, specifically, is decided server-side. The page arrives with the
 * display currency and the rate already applied to every price Twig printed,
 * and with the same rate in config for falak.money(). Switching therefore has
 * to be a navigation: converting in place would leave the server-rendered
 * prices in the old currency next to the re-rendered ones.
 */
export default class LocalizationApi extends BaseApi {
    constructor(client, event, config, storage) {
        super(client);
        this.event = event;
        this.config = config;
        this.storage = storage;

        this.endpoints = { rates: 'exchange-rates' };
        this.methods = { rates: 'get' };
    }

    /* ------------------------------------------------------------ languages */

    get locale() {
        return this.config.get('locale', 'ar');
    }

    /**
     * The platform ships Arabic and English; a theme may narrow that, so the
     * config value wins where present.
     */
    languages() {
        const configured = this.config.get('languages');

        if (Array.isArray(configured) && configured.length) return configured;

        return [
            { code: 'ar', name: 'العربية', native: 'العربية', is_rtl: true },
            { code: 'en', name: 'English', native: 'English', is_rtl: false },
        ];
    }

    /**
     * Switching language is a navigation, not a request: the storefront reads
     * `?lang` on the way in. Returning the URL rather than assigning it keeps
     * this testable and lets a caller decide when to leave the page.
     */
    languageUrl(code) {
        const url = new URL(window.location.href);
        url.searchParams.set('lang', code);
        return url.toString();
    }

    switchLanguage(code) {
        if (code === this.locale) return null;

        this.storage.set('locale', code);
        this.event.languageChanged({ code });

        window.location.href = this.languageUrl(code);

        return code;
    }

    /* ----------------------------------------------------------- currencies */

    /** What the shopper is reading prices in — the server's answer, never a local override. */
    get currency() {
        return String(this.config.get('currency.display', this.config.get('currency.code', 'SAR'))).toUpperCase();
    }

    /** The store's own currency, which every amount the API returns is in. */
    get baseCurrency() {
        return String(this.config.get('currency.code', 'SAR')).toUpperCase();
    }

    /**
     * The currencies the merchant lets shoppers switch to, as
     * `[{ code, name, label }]` with the store's own first. One entry means
     * there is nothing to switch — <falak-currency> renders nothing then.
     *
     * Synchronous: the list comes down in config, so a switcher paints with
     * the page. (This used to fetch exchange rates; that is `rates()` now, and
     * an `await` on this still resolves to the same array.)
     */
    currencies() {
        const configured = this.config.get('currency.enabled');

        if (Array.isArray(configured) && configured.length) return configured;

        const base = this.baseCurrency;
        const labels = this.config.get('currency.labels', {}) || {};

        return [{ code: base, name: base, label: labels[base] || base }];
    }

    /** True when the switcher has more than one option. */
    get isMultiCurrency() {
        return !!this.config.get('currency.multi', false) || this.currencies().length > 1;
    }

    /**
     * Exchange rates, cached for an hour.
     *
     * Informational only — prices are never converted in the browser. Rates
     * move slowly and a page that shows them would otherwise re-request them
     * on every navigation, so the TTL is doing real work here.
     */
    async rates() {
        const cached = this.storage.getWithTTL('currency.rates');

        if (cached) return cached;

        try {
            const response = await this.client.withoutNotifier(() => this.call('rates'));
            const rates = normalise(response);

            if (rates.length) this.storage.setWithTTL('currency.rates', rates, 60);

            this.event.currenciesFetched(rates);

            return rates;
        } catch (error) {
            // A store with no rates configured simply has one currency; that is
            // not an error worth showing a shopper.
            this.event.currenciesFailed(error);
            return [];
        }
    }

    /**
     * Same shape as languageUrl(): the storefront reads `?currency` on the
     * way in, converts every price it renders, and sets the cookie so the
     * next page needs no parameter.
     */
    currencyUrl(code) {
        const url = new URL(window.location.href);
        url.searchParams.set('currency', String(code).toUpperCase());
        return url.toString();
    }

    /**
     * Records the choice and navigates.
     *
     * Prices are formatted server-side as well as by falak.money(), so a
     * reload is the only way to get both agreeing. Converting in place would
     * leave server-rendered prices in the old currency.
     */
    switchCurrency(code) {
        code = String(code || '').toUpperCase();

        if (!code || code === this.currency) return null;

        if (!this.currencies().some(option => option.code === code)) return null;

        this.storage.set('currency', code);
        this.event.currencyChanged({ code });

        window.location.href = this.currencyUrl(code);

        return code;
    }
}

/** The rates endpoint has changed shape before; accept the plausible ones. */
function normalise(response) {
    const raw = Array.isArray(response)
        ? response
        : (response?.data ?? response?.rates ?? response?.exchange_rates ?? response?.conversion_rates ?? []);

    if (Array.isArray(raw)) {
        return raw
            .map(entry => ({
                code: String(entry.code ?? entry.currency ?? '').toUpperCase(),
                name: entry.name ?? entry.title ?? null,
                symbol: entry.symbol ?? null,
                rate: Number(entry.rate ?? entry.value ?? 1) || 1,
            }))
            .filter(entry => entry.code);
    }

    // `{ "USD": 3.75, "AED": 0.98 }`
    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([code, rate]) => ({
            code: String(code).toUpperCase(),
            name: null,
            symbol: null,
            rate: Number(rate) || 1,
        }));
    }

    return [];
}
