import FalakElement from '../base.js';

/**
 * <falak-localization-modal show-trigger></falak-localization-modal>
 *
 * Language and currency in one sheet, as <salla-localization-modal> does it.
 * With `show-trigger` the component renders its own button; without it, a theme
 * opens it by dispatching `localization::open`.
 *
 * The currency half only appears when the store actually has more than one —
 * a switcher with a single option is a control that does nothing.
 */
export default class FalakLocalizationModal extends FalakElement {
    static observedAttributes = ['show-trigger', 'visible'];

    get showTrigger() { return this.boolAttr('show-trigger'); }
    get visible() { return this.hasAttribute('visible'); }

    open() { this.setAttribute('visible', ''); return this; }
    close() { this.removeAttribute('visible'); return this; }

    async setup() {
        this.languages = this.sdk.localization.languages();
        this.currency = this.sdk.localization.currency;
        this.locale = this.sdk.localization.locale;

        this._off = this.sdk.event.on('localization::open', () => this.open());

        /*
         * Rates are fetched once the sheet is first opened, not on page load:
         * most shoppers never touch the switcher, and this sits in the header
         * of every page.
         */
        this.currencies = [];
    }

    disconnectedCallback() {
        this._off?.();
        super.disconnectedCallback();
    }

    async loadCurrencies() {
        if (this._loaded) return;
        this._loaded = true;

        this.currencies = await this.sdk.localization.currencies();

        if (this.currencies.length) this.render();
    }

    render() {
        const current = this.languages.find(language => language.code === this.locale);

        this.classList.add('f-locale');

        const trigger = this.showTrigger
            ? `<button type="button" class="f-locale__trigger" data-open>
                   <span class="f-locale__globe" aria-hidden="true">${GLOBE}</span>
                   <span class="f-locale__current">${this.escape(current?.native || this.locale.toUpperCase())}</span>
                   ${this.hasCurrencyChoice ? `<span class="f-locale__sep" aria-hidden="true">·</span><span>${this.escape(this.currency)}</span>` : ''}
               </button>`
            : '';

        this.innerHTML = `
            ${trigger}
            <falak-modal id="falak-localization" width="sm" ${this.visible ? 'visible' : ''}
                         modal-title="${this.escape(this.trans('common.preferences'))}">
                <div class="f-locale__group">
                    <h3 class="f-locale__heading">${this.escape(this.trans('common.language'))}</h3>
                    <div class="f-locale__options" role="radiogroup"
                         aria-label="${this.escape(this.trans('common.language'))}">
                        ${this.languages.map(language => this.option('lang', language.code, language.native || language.name, language.code === this.locale)).join('')}
                    </div>
                </div>

                ${this.hasCurrencyChoice ? `
                    <div class="f-locale__group">
                        <h3 class="f-locale__heading">${this.escape(this.trans('common.currency'))}</h3>
                        <div class="f-locale__options" role="radiogroup"
                             aria-label="${this.escape(this.trans('common.currency'))}">
                            ${this.currencies.map(entry => this.option('currency', entry.code, entry.name || entry.code, entry.code === this.currency)).join('')}
                        </div>
                    </div>` : ''}
            </falak-modal>`;

        this._modal = this.querySelector('falak-modal');
    }

    get hasCurrencyChoice() {
        return this.currencies.length > 1;
    }

    option(kind, value, label, isCurrent) {
        return `
            <button type="button" class="f-locale__option${isCurrent ? ' is-current' : ''}"
                    role="radio" aria-checked="${isCurrent}"
                    data-${kind}="${this.escape(value)}">
                <span class="f-locale__option-label">${this.escape(label)}</span>
                <span class="f-locale__code">${this.escape(String(value).toUpperCase())}</span>
            </button>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-open]')) {
                this.open();
                this.loadCurrencies();
                return;
            }

            const language = event.target.closest('[data-lang]');
            if (language) {
                this.sdk.localization.switchLanguage(language.dataset.lang);
                return;
            }

            const currency = event.target.closest('[data-currency]');
            if (currency) this.sdk.localization.switchCurrency(currency.dataset.currency);
        });
    }

    onAttributeChange(name) {
        if (name !== 'visible') return;

        if (this.visible) {
            this._modal?.open?.();
            this.loadCurrencies();
            return;
        }

        this._modal?.close?.();
    }
}

const GLOBE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>';
