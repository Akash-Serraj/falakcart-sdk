import BaseApi from './base.js';

/**
 * Language and currency.
 *
 * Neither is a server round trip on this platform: the storefront reads `?lang`
 * per request, and the merchant's currency comes down in config. So the API
 * surface here is small on purpose — it fetches exchange rates when a shopper
 * wants prices in something other than the store currency, and otherwise just
 * reads what the platform already sent.
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

    get currency() {
        return this.storage.get('currency') || this.config.get('currency.code', 'SAR');
    }

    /**
     * Exchange rates, cached for an hour.
     *
     * Rates move slowly and a currency switcher on every page would otherwise
     * re-request them on every navigation, so the TTL is doing real work here
     * rather than being a habit.
     */
    async currencies() {
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
     * Records the choice and reloads.
     *
     * Prices are formatted server-side as well as by falak.money(), so a full
     * reload is the only way to get both agreeing. Converting in place would
     * leave server-rendered prices in the old currency.
     */
    async switchCurrency(code) {
        if (code === this.currency) return null;

        this.storage.set('currency', code);
        this.config.set('currency.code', code);
        this.event.currencyChanged({ code });

        window.location.reload();

        return code;
    }
}

/** The rates endpoint has changed shape before; accept the plausible ones. */
function normalise(response) {
    const raw = Array.isArray(response)
        ? response
        : (response?.data ?? response?.rates ?? response?.exchange_rates ?? []);

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
            code: code.toUpperCase(),
            name: null,
            symbol: null,
            rate: Number(rate) || 1,
        }));
    }

    return [];
}
