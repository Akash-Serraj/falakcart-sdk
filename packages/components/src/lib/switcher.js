import FalakElement from '../base.js';

/**
 * The anchored dropdown behind <falak-language> and <falak-currency>.
 *
 * One trigger pill and one panel under it: a heading, then a row per option
 * — code chip, name, a secondary line, a check on the current one. A real
 * popover rather than a native <select>, so it looks the same in every
 * browser, a theme can style it, and it behaves like a menu: arrows, Home,
 * End, Escape, outside click.
 *
 * Subclasses supply the data and the trigger's class names (kept distinct so
 * each theme's existing header rules — .f-locale__trigger, .f-currency__field
 * — still apply); the panel shares `.f-switch__*` classes between the two.
 */
export default class FalakSwitcher extends FalakElement {
    /** @returns {{ trigger: string, icon: string, current: string, chevron: string }} */
    get classes() { throw new Error('classes() not implemented'); }

    /** @returns {Array<{ code: string, name: string, sub?: string|null, label?: string }>} */
    get options() { return []; }

    /** The current option's code. */
    get current() { return ''; }

    /** The panel heading. */
    get heading() { return ''; }

    /** What the trigger prints beside the icon. */
    triggerText(current) { return current?.code || ''; }

    /** Icon SVG for the trigger. */
    get icon() { return ''; }

    /** Act on a chosen code. */
    select(code) {} // eslint-disable-line no-unused-vars

    get isOpen() { return this.classList.contains('is-open'); }

    /**
     * The preferences sheet, when the page has one. Then the pill is a
     * button that opens it (language and currency are chosen together there,
     * with one Ok) and the dropdown below is never shown. Without a sheet
     * the pill falls back to its own dropdown, so a theme that renders only
     * the pills still gets a working control.
     */
    get sheet() { return document.querySelector('falak-localization-modal'); }

    /** What the sheet should focus when this pill opened it. */
    get sheetFocus() { return null; }

    renderDropdown(options, current) {
        const c = this.classes;
        const label = this.heading;
        const sheet = !!this.sheet;

        this._panelId = this._panelId || `${c.trigger}-${Math.random().toString(36).slice(2, 8)}`;

        this.innerHTML = `
            <button type="button" class="${c.trigger}" data-switch-toggle
                    aria-haspopup="${sheet ? 'dialog' : 'listbox'}" aria-expanded="false" ${sheet ? '' : `aria-controls="${this._panelId}"`}
                    aria-label="${this.escape(label)}: ${this.escape(current.name || current.code)}">
                <span class="${c.icon}" aria-hidden="true">${this.icon}</span>
                <span class="${c.current}">${this.escape(this.triggerText(current))}</span>
                <span class="${c.chevron}" aria-hidden="true">${CHEVRON}</span>
            </button>
            ${sheet ? '' : this.panelHtml(options, current)}`;
    }

    panelHtml(options, current) {
        const label = this.heading;

        return `
            <div class="f-switch__panel" id="${this._panelId}" role="listbox"
                 aria-label="${this.escape(label)}" tabindex="-1" hidden>
                <p class="f-switch__title">${this.escape(label)}</p>
                <div class="f-switch__list">
                    ${options.map(option => this.item(option, option.code === current.code)).join('')}
                </div>
            </div>`;
    }

    item(option, isCurrent) {
        const sub = option.sub && option.sub !== option.name ? option.sub : '';

        return `
            <button type="button" role="option" class="f-switch__item${isCurrent ? ' is-current' : ''}"
                    aria-selected="${isCurrent}" data-switch-option="${this.escape(option.code)}" tabindex="-1">
                <span class="f-switch__code" aria-hidden="true">${this.escape(option.code.toUpperCase())}</span>
                <span class="f-switch__text">
                    <span class="f-switch__name">${this.escape(option.name || option.code)}</span>
                    ${sub ? `<span class="f-switch__sub">${this.escape(sub)}</span>` : ''}
                </span>
            </button>`;
    }

    /* ----------------------------------------------------------- behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-switch-toggle]')) {
                this.toggle();
                return;
            }

            const option = event.target.closest('[data-switch-option]');
            if (option) {
                this.close();
                this.select(option.dataset.switchOption);
            }
        });

        this.listen(this, 'keydown', event => this.onKeydown(event));

        // Outside click and Escape close it; registered through listen() so
        // they go when the element does.
        this.listen(document, 'pointerdown', event => {
            if (this.isOpen && !this.contains(event.target)) this.close();
        });
        this.listen(document, 'keydown', event => {
            if (event.key === 'Escape' && this.isOpen) {
                this.close();
                this.querySelector('[data-switch-toggle]')?.focus();
            }
        });
    }

    toggle() { this.isOpen ? this.close() : this.open(); }

    open() {
        // A sheet on the page takes over: both pills open the same one.
        if (this.sheet) {
            this.sdk.event.emit('localization::open', { focus: this.sheetFocus });
            return;
        }

        const panel = this.querySelector('.f-switch__panel');
        const trigger = this.querySelector('[data-switch-toggle]');
        if (!panel || !trigger) return;

        // One open menu at a time: a sibling switcher closes.
        document.querySelectorAll('.is-open[data-falak]').forEach(el => { if (el !== this && el.close) el.close(); });

        panel.hidden = false;
        this.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');

        this.place(panel);

        (this.querySelector('.f-switch__item.is-current') || this.querySelector('.f-switch__item'))?.focus();
    }

    close() {
        const panel = this.querySelector('.f-switch__panel');
        const trigger = this.querySelector('[data-switch-toggle]');

        this.classList.remove('is-open');
        if (panel) { panel.hidden = true; panel.style.removeProperty('--f-switch-shift'); }
        trigger?.setAttribute('aria-expanded', 'false');
    }

    /**
     * The panel hangs from the trigger's inline-end edge and opens towards
     * the page. Where that runs past a viewport edge — a phone, a trigger
     * near the start — it is slid back inside by exactly the overflow, via a
     * CSS variable so the open animation's transform is not fought over.
     */
    place(panel) {
        panel.style.removeProperty('--f-switch-shift');

        const rect = panel.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const margin = 8;
        let shift = 0;

        if (rect.right > vw - margin) shift = (vw - margin) - rect.right;
        if (rect.left + shift < margin) shift = margin - rect.left;

        if (shift) panel.style.setProperty('--f-switch-shift', `${Math.round(shift)}px`);
    }

    onKeydown(event) {
        const items = [...this.querySelectorAll('.f-switch__item')];
        if (!items.length) return;

        const onTrigger = !!event.target.closest('[data-switch-toggle]');
        const index = items.indexOf(document.activeElement);

        if (onTrigger && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            if (!this.isOpen) this.open();
            return;
        }

        if (index === -1) return;

        const move = next => { event.preventDefault(); items.at(((next % items.length) + items.length) % items.length).focus(); };

        if (event.key === 'ArrowDown') move(index + 1);
        else if (event.key === 'ArrowUp') move(index - 1);
        else if (event.key === 'Home') move(0);
        else if (event.key === 'End') move(items.length - 1);
        else if (event.key === 'Tab') this.close();
    }

    disconnectedCallback() {
        this.close();
        super.disconnectedCallback();
    }
}

export const CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
export const GLOBE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>';
export const COINS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="M14.5 7.5a6 6 0 1 1-7 7"/></svg>';
