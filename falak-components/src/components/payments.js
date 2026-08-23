import FalakElement from '../base.js';

/**
 * <falak-payments>                                every enabled method
 * <falak-payments exclude='["cash_on_delivery"]'> minus some
 *
 * Reads the store's enabled `payment_methods` rows, which the platform puts in
 * config as `[{ code, name, logo }]`. Those are real rows, not a settings array
 * — the codes are things like `tap`, `cash_on_delivery`, `tamara`.
 *
 * A gateway code (`tap`, `noon`, `moyasar`) is not a brand a shopper
 * recognises: it fronts several card networks. Those expand into the card marks
 * they actually accept, which is what a checkout badge row is for.
 *
 * Marks are inline SVG so no CSP widening and no remote image is needed, and a
 * method this component has never heard of still renders — as its own name,
 * rather than disappearing.
 */
export default class FalakPayments extends FalakElement {
    static observedAttributes = ['exclude', 'methods'];

    /** Gateways that front multiple card networks, expanded for display. */
    static GATEWAY_BRANDS = {
        tap: ['mada', 'visa', 'mastercard', 'apple_pay'],
        noon: ['mada', 'visa', 'mastercard'],
        moyasar: ['mada', 'visa', 'mastercard', 'apple_pay'],
        paytabs: ['mada', 'visa', 'mastercard'],
        hyperpay: ['mada', 'visa', 'mastercard'],
        checkout: ['visa', 'mastercard'],
    };

    /** Display order. Anything unlisted sorts last but is still shown. */
    static ORDER = [
        'mada', 'visa', 'mastercard', 'amex', 'apple_pay', 'stcpay',
        'tabby', 'tamara', 'madfu', 'mispay', 'emkan',
        'cash_on_delivery', 'bank_transfer',
    ];

    /**
     * @returns {Array<{code: string, name: string, logo: ?string}>}
     */
    get methods() {
        const declared = this.jsonAttr('methods', null);
        const configured = declared || this.sdk.config.get('store.settings.payments', []);
        const exclude = (this.jsonAttr('exclude', []) || []).map(normalise);

        const seen = new Map();

        (Array.isArray(configured) ? configured : []).forEach(entry => {
            // Accepts both the config shape and a plain array of code strings,
            // so a checkout page can pass `["tabby"]` without building objects.
            const method = typeof entry === 'string' ? { code: entry, name: entry, logo: null } : entry;
            const code = normalise(method.code || method.name);

            if (!code || exclude.includes(code)) return;

            const brands = FalakPayments.GATEWAY_BRANDS[code];

            if (brands) {
                brands
                    .filter(brand => !exclude.includes(brand))
                    .forEach(brand => seen.set(brand, { code: brand, name: LABELS[brand] || brand, logo: null }));
                return;
            }

            seen.set(code, { code, name: method.name || LABELS[code] || code, logo: method.logo || null });
        });

        return [...seen.values()].sort((a, b) => {
            const ai = FalakPayments.ORDER.indexOf(a.code);
            const bi = FalakPayments.ORDER.indexOf(b.code);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
    }

    render() {
        const methods = this.methods;

        if (!methods.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.classList.add('f-payments');

        const title = this.boolAttr('hide-title')
            ? ''
            : (this.attr('title-text') || this.trans('footer.payments'));

        this.innerHTML = `
            ${title ? `<h3 class="f-payments__title">${this.escape(title)}</h3>` : ''}
            <ul class="f-payments__list">
                ${methods.map(method => `
                    <li class="f-payments__item f-payments__item--${this.escape(method.code)}"
                        title="${this.escape(method.name)}">
                        ${this.markFor(method)}
                    </li>`).join('')}
            </ul>`;
    }

    /** A merchant-uploaded logo wins; then a known mark; then the name. */
    markFor(method) {
        if (method.logo) {
            return `<img class="f-payments__logo" src="${this.escape(method.logo)}"
                         alt="${this.escape(method.name)}" loading="lazy" decoding="async">`;
        }

        return MARKS[method.code]
            || `<span class="f-payments__label">${this.escape(method.name)}</span>`;
    }
}

/** Codes arrive in several spellings (`cod`, `cash-on-delivery`); fold them. */
function normalise(value) {
    const code = String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_');

    return ({
        cod: 'cash_on_delivery',
        cashondelivery: 'cash_on_delivery',
        applepay: 'apple_pay',
        stc_pay: 'stcpay',
        master: 'mastercard',
        bank: 'bank_transfer',
    })[code] || code;
}

const LABELS = {
    mada: 'مدى', visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex',
    apple_pay: 'Apple Pay', stcpay: 'stc pay', tabby: 'Tabby', tamara: 'Tamara',
    madfu: 'Madfu', mispay: 'MisPay', emkan: 'Emkan',
    cash_on_delivery: 'Cash on delivery', bank_transfer: 'Bank transfer',
};

/*
 * Flat marks on a neutral card — enough to recognise a method at 38px without
 * shipping third-party trademark artwork.
 */
const card = inner => `<svg viewBox="0 0 48 30" width="46" height="29" role="img" aria-hidden="true">${inner}</svg>`;
const wordmark = (text, size = 10) =>
    card(`<text x="24" y="19" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${size}" font-weight="700" fill="currentColor">${text}</text>`);

const MARKS = {
    visa: card('<text x="24" y="20" text-anchor="middle" font-family="Archivo,system-ui,sans-serif" font-size="12" font-weight="700" font-style="italic" fill="currentColor">VISA</text>'),
    mastercard: card('<circle cx="19" cy="15" r="8" fill="currentColor" opacity=".85"/><circle cx="29" cy="15" r="8" fill="currentColor" opacity=".45"/>'),
    mada: wordmark('mada', 11),
    amex: wordmark('AMEX', 9),
    stcpay: wordmark('stc pay', 9),
    tabby: wordmark('tabby'),
    tamara: wordmark('tamara', 9),
    madfu: wordmark('madfu', 9),
    mispay: wordmark('MisPay', 9),
    emkan: wordmark('emkan', 9),
    apple_pay: card('<path d="M20.8 10.6c.5-.6.8-1.4.7-2.2-.7 0-1.6.5-2.1 1.1-.5.5-.9 1.4-.7 2.2.8.1 1.6-.4 2.1-1.1z" fill="currentColor"/><path d="M21.5 11.9c-1.2-.1-2.2.7-2.7.7-.6 0-1.4-.6-2.3-.6-1.2 0-2.3.7-2.9 1.8-1.2 2.1-.3 5.3.9 7 .6.9 1.3 1.8 2.2 1.8.9 0 1.2-.6 2.3-.6s1.4.6 2.3.6c1 0 1.6-.9 2.2-1.7.7-1 .9-1.9 1-2-.1 0-1.9-.7-1.9-2.8 0-1.7 1.4-2.6 1.5-2.6-.8-1.2-2-1.4-2.6-1.6z" fill="currentColor"/><text x="34" y="20" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="600" fill="currentColor">Pay</text>'),
    cash_on_delivery: card('<rect x="10" y="9" width="28" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="24" cy="15" r="3" fill="currentColor"/>'),
    bank_transfer: card('<path d="M24 7 12 13h24zM14 15v7M20 15v7M28 15v7M34 15v7M11 24h26" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'),
};
