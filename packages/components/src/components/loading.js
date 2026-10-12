import FalakElement from '../base.js';

/**
 * <falak-loading></falak-loading>
 * <falak-loading size="sm"></falak-loading>
 * <falak-loading overlay></falak-loading>     — fills the nearest positioned ancestor
 * <falak-loading page></falak-loading>        — fixed, covers the whole viewport
 *
 * The one spinner, mirroring <salla-loading> — a small, silent building
 * block other components (and a theme) drop in wherever something is
 * mid-fetch, instead of each hand-rolling its own.
 *
 * `overlay` fills the nearest ancestor with `position: relative` (a card,
 * a section) behind a soft backdrop; the caller is responsible for that
 * positioning. `page` is fixed to the viewport, for a moment JS controls
 * directly rather than a component's own render — see showPage() below.
 *
 * | attribute | role                                                        |
 * | size      | sm | md (default) | lg                                        |
 * | label     | shown in `page` mode; screen-reader only otherwise           |
 * | overlay   | fills the positioned ancestor, with a backdrop               |
 * | page      | fixed full-viewport overlay                                  |
 */
export default class FalakLoading extends FalakElement {
    static observedAttributes = ['size', 'label', 'overlay', 'page'];

    get size() { return this.attr('size', 'md'); }
    get overlay() { return this.boolAttr('overlay'); }
    get page() { return this.boolAttr('page'); }

    render() {
        this.classList.add('f-loading', `f-loading--${this.size}`);
        this.classList.toggle('f-loading--overlay', this.overlay && !this.page);
        this.classList.toggle('f-loading--page', this.page);

        const label = this.attr('label') || this.trans('common.loading');

        this.setAttribute('role', 'status');
        this.setAttribute('aria-live', 'polite');

        this.innerHTML = `
            <span class="f-loading__spinner" aria-hidden="true"></span>
            <span class="f-loading__label">${this.escape(label)}</span>`;
    }

    /**
     * A full-page loading state for a moment JS controls directly — a
     * checkout redirect, a payment handoff — with no element of its own to
     * host one. Mirrors <falak-quick-add>'s static open()/close().
     */
    static showPage(label) {
        let host = document.querySelector('falak-loading[page]');

        if (!host) {
            host = document.createElement('falak-loading');
            host.setAttribute('page', '');
            document.body.appendChild(host);
        }

        if (label) host.setAttribute('label', label);

        return host;
    }

    static hidePage() {
        document.querySelector('falak-loading[page]')?.remove();
    }
}
