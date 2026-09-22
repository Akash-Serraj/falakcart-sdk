import FalakElement from '../base.js';

/**
 * <falak-localization-modal show-trigger></falak-localization-modal>
 *
 * Language only. With `show-trigger` the component renders its own button;
 * without it, a theme opens it by dispatching `localization::open`.
 *
 * The sheet used to carry a currency switcher beside the language one. It was
 * removed on 2026-09-22: a storefront prices in the currency its merchant
 * settled on, and letting a shopper convert that in the header made the price
 * they read and the price they are charged two different numbers.
 *
 * What went is the RENDERED HALF only. `sdk.localization.currency`,
 * `switchCurrency()` and the currencies endpoint are all still there, so a
 * theme or a future surface that has a reason to change currency still can —
 * nothing that existed has been taken away from the API.
 */
export default class FalakLocalizationModal extends FalakElement {
    static observedAttributes = ['show-trigger', 'visible'];

    get showTrigger() { return this.boolAttr('show-trigger'); }
    get visible() { return this.hasAttribute('visible'); }

    open() { this.setAttribute('visible', ''); return this; }
    close() { this.removeAttribute('visible'); return this; }

    async setup() {
        this.languages = this.sdk.localization.languages();
        this.locale = this.sdk.localization.locale;

        this._off = this.sdk.event.on('localization::open', () => this.open());
    }

    disconnectedCallback() {
        this._off?.();
        super.disconnectedCallback();
    }

    render() {
        const current = this.languages.find(language => language.code === this.locale);

        this.classList.add('f-locale');

        const trigger = this.showTrigger
            ? `<button type="button" class="f-locale__trigger" data-open>
                   <span class="f-locale__globe" aria-hidden="true">${GLOBE}</span>
                   <span class="f-locale__current">${this.escape(current?.native || this.locale.toUpperCase())}</span>
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
            </falak-modal>`;

        this._modal = this.querySelector('falak-modal');
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
                return;
            }

            const language = event.target.closest('[data-lang]');
            if (language) this.sdk.localization.switchLanguage(language.dataset.lang);
        });

        // Keep the wrapper's state honest when the inner modal dismisses
        // itself (close button, overlay, Escape) — a wrapper still marked
        // visible would re-open the modal on its next render.
        this.listen(this, 'modal-close', () => this.removeAttribute('visible'));
    }

    onAttributeChange(name) {
        if (name !== 'visible') return;

        if (this.visible) {
            this._modal?.open?.();
            return;
        }

        this._modal?.close?.();
    }
}

const GLOBE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>';
