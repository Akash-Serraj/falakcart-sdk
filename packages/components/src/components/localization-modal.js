import FalakElement from '../base.js';

/**
 * <falak-localization-modal></falak-localization-modal>
 * <falak-localization-modal show-trigger></falak-localization-modal>
 *
 * The preferences sheet: language as option cards, currency as a select,
 * and one Ok that applies both. Nothing happens until Ok — a shopper can
 * flip language and currency together and the page reloads once with both
 * (`?lang=&currency=`), which the storefront reads and remembers in cookies.
 *
 * Opened by <falak-language> and <falak-currency> in the header (they emit
 * `localization::open`), by its own trigger with `show-trigger`, or by any
 * theme code that dispatches that event. Usually placed once, without a
 * trigger, beside the two pills.
 */
export default class FalakLocalizationModal extends FalakElement {
    static observedAttributes = ['show-trigger', 'visible'];

    get showTrigger() { return this.boolAttr('show-trigger'); }
    get visible() { return this.hasAttribute('visible'); }

    open(payload = {}) {
        this._focus = payload?.focus || null;
        // Re-rendered so the `autofocus` lands on the section the opening
        // pill named: <falak-modal> rebuilds its children when it opens, so
        // an attribute set on a node afterwards would not survive.
        this.render();
        this.setAttribute('visible', '');
        return this;
    }

    close() { this.removeAttribute('visible'); return this; }

    async setup() {
        this.languages = this.sdk.localization.languages();
        this.locale = this.sdk.localization.locale;
        this.currencies = this.sdk.localization.currencies();
        this.currency = this.sdk.localization.currency;

        this.pending = { lang: this.locale, currency: this.currency };

        this._off = this.sdk.event.on('localization::open', payload => this.open(payload));
    }

    disconnectedCallback() {
        this._off?.();
        super.disconnectedCallback();
    }

    render() {
        const current = this.languages.find(language => language.code === this.locale);
        const multiCurrency = this.currencies.length > 1;

        this.classList.add('f-locale', 'f-locale--sheet');

        const trigger = this.showTrigger
            ? `<button type="button" class="f-locale__trigger" data-open>
                   <span class="f-locale__globe" aria-hidden="true">${GLOBE}</span>
                   <span class="f-locale__current">${this.escape(current?.native || current?.name || this.locale.toUpperCase())}</span>
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
                        ${this.languages.map(language => this.option(language, language.code === this.pending.lang)).join('')}
                    </div>
                </div>
                ${multiCurrency ? `
                <div class="f-locale__group">
                    <h3 class="f-locale__heading">${this.escape(this.trans('common.currency'))}</h3>
                    <label class="f-locale__select-wrap">
                        <select class="f-locale__select" data-currency-select aria-label="${this.escape(this.trans('common.currency'))}"${this._focus === 'currency' ? ' autofocus' : ''}>
                            ${this.currencies.map(option => `
                                <option value="${this.escape(option.code)}" ${option.code === this.pending.currency ? 'selected' : ''}>
                                    ${this.escape(option.name || option.code)} (${this.escape(option.code)})
                                </option>`).join('')}
                        </select>
                        <span class="f-locale__select-chevron" aria-hidden="true">${CHEVRON}</span>
                    </label>
                </div>` : ''}
                <div class="f-locale__actions">
                    <button type="button" class="f-btn f-btn--solid f-btn--primary f-btn--wide" data-locale-apply>
                        ${this.escape(this.trans('common.ok'))}
                    </button>
                </div>
            </falak-modal>`;

        this._modal = this.querySelector('falak-modal');
    }

    option(language, isCurrent) {
        const native = language.native || language.name || language.code;
        const sub = language.name && language.name !== native ? language.name : '';

        return `
            <button type="button" class="f-locale__option${isCurrent ? ' is-current' : ''}"
                    role="radio" aria-checked="${isCurrent}"${isCurrent && this._focus !== 'currency' ? ' autofocus' : ''}
                    data-lang="${this.escape(language.code)}">
                <span class="f-locale__option-label">
                    <span class="f-locale__option-name">${this.escape(native)}</span>
                    ${sub ? `<span class="f-locale__option-sub">${this.escape(sub)}</span>` : ''}
                </span>
                <span class="f-locale__code">${this.escape(String(language.code).toUpperCase())}</span>
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
            if (language) {
                this.pending.lang = language.dataset.lang;
                this.querySelectorAll('[data-lang]').forEach(card => {
                    const on = card.dataset.lang === this.pending.lang;
                    card.classList.toggle('is-current', on);
                    card.setAttribute('aria-checked', String(on));
                });
                return;
            }

            if (event.target.closest('[data-locale-apply]')) this.apply();
        });

        this.listen(this, 'change', event => {
            const select = event.target.closest('[data-currency-select]');
            if (select) this.pending.currency = select.value;
        });

        // Keep the wrapper's state honest when the inner modal dismisses
        // itself (close button, overlay, Escape) — a wrapper still marked
        // visible would re-open the modal on its next render.
        this.listen(this, 'modal-close', () => this.removeAttribute('visible'));
    }

    /**
     * One navigation carrying every change. `?lang=` and `?currency=` are
     * what the storefront reads on the way in; each is persisted to its
     * cookie there, so the next page needs neither.
     */
    apply() {
        const url = new URL(window.location.href);
        let changed = false;

        if (this.pending.lang && this.pending.lang !== this.locale) {
            url.searchParams.set('lang', this.pending.lang);
            this.sdk.storage.set('locale', this.pending.lang);
            this.sdk.event.emit('localization::language.changed', { code: this.pending.lang });
            changed = true;
        }

        if (this.pending.currency && this.pending.currency !== this.currency) {
            url.searchParams.set('currency', String(this.pending.currency).toUpperCase());
            this.sdk.storage.set('currency', this.pending.currency);
            this.sdk.event.emit('localization::currency.changed', { code: this.pending.currency });
            changed = true;
        }

        if (!changed) {
            this.close();
            return;
        }

        window.location.href = url.toString();
    }

    onAttributeChange(name) {
        if (name !== 'visible') return;

        if (this.visible) {
            // <falak-modal> focuses the first `input, select, [autofocus]` in
            // document order on open; render() put `autofocus` on the section
            // the opening pill named, and the language card precedes the select.
            this._modal?.open?.();
            return;
        }

        this._modal?.close?.();
    }
}

const GLOBE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
