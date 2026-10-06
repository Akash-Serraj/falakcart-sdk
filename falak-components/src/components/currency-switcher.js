import FalakSwitcher, { COINS } from '../lib/switcher.js';

/**
 * <falak-currency></falak-currency>            header dropdown
 * <falak-currency inline></falak-currency>     flat option cards (the preferences sheet)
 *
 * The shopper's display currency. Lists what the merchant enabled, with the
 * store's own currency first, and renders NOTHING when there is only one —
 * a theme can place this in every header without checking first.
 *
 * Each row: the ISO code, the currency's name in the page language, and its
 * name in the other language underneath — the same for every row, so the
 * list never looks half-filled the way a symbol column would (several of
 * these currencies have no symbol in Latin script).
 *
 * Choosing navigates: the storefront reads `?currency=` on the way in,
 * converts every price it renders at a server-side rate, and sets a cookie
 * so the next page needs no parameter. Nothing is converted here.
 */
export default class FalakCurrency extends FalakSwitcher {
    static observedAttributes = ['inline'];

    get inline() { return this.boolAttr('inline'); }

    get classes() {
        return { trigger: 'f-currency__field', icon: 'f-currency__icon', current: 'f-currency__current', chevron: 'f-currency__chevron' };
    }

    get icon() { return COINS; }
    get heading() { return this.trans('common.currency'); }
    get sheetFocus() { return 'currency'; }
    get current() { return this.sdk.localization.currency; }

    get options() {
        const locale = this.sdk.localization.locale;

        return this.sdk.localization.currencies().map(option => ({
            code: option.code,
            name: option.name || option.code,
            // The other language's name, when the server sent both.
            sub: option.names ? (option.names[locale === 'ar' ? 'en' : 'ar'] || null) : null,
            label: option.label || option.code,
        }));
    }

    select(code) { this.sdk.localization.switchCurrency(code); }

    render() {
        const options = this.options;

        this.classList.add('f-currency');

        if (options.length < 2) {
            this.innerHTML = '';
            this.hidden = true;
            return;
        }

        this.hidden = false;

        const current = options.find(option => option.code === this.current) || options[0];

        if (this.inline) {
            this.innerHTML = `
                <div class="f-currency__options" role="radiogroup" aria-label="${this.escape(this.heading)}">
                    ${options.map(option => `
                        <button type="button" class="f-currency__option${option.code === current.code ? ' is-current' : ''}"
                                role="radio" aria-checked="${option.code === current.code}"
                                data-switch-option="${this.escape(option.code)}">
                            <span class="f-currency__option-label">${this.escape(option.name)}</span>
                            <span class="f-currency__code">${this.escape(option.label)}</span>
                        </button>`).join('')}
                </div>`;
            return;
        }

        this.renderDropdown(options, current);
    }
}
