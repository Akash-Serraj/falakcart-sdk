import FalakElement from '../base.js';

/**
 * <falak-tabs>
 *     <falak-tabs-content label="Description">…</falak-tabs-content>
 *     <falak-tabs-content label="Specifications">…</falak-tabs-content>
 *     <falak-tabs-content label="Reviews" badge="24">…</falak-tabs-content>
 * </falak-tabs>
 *
 * A horizontal tab switcher — mirroring <salla-tabs> / <salla-tabs-content>.
 * The header strip is generated from each <falak-tabs-content> child's
 * `label` (and optional `badge`); only one panel shows at a time. Panels
 * stay in the light DOM and are only ever hidden, never rebuilt — so a
 * component nested inside one (a form, another SDK component) keeps its
 * own state across tab switches instead of losing it every time the
 * shopper looks at something else and comes back.
 *
 * Panels are read once, at connect — add/remove a <falak-tabs-content>
 * afterwards and call `.render()` on the host to pick it up.
 *
 * | attribute | role                                                        |
 * | active    | index of the tab shown first (default 0)                    |
 *
 * Events: DOM `changed` on the element (detail: `{ index }`).
 */
export default class FalakTabs extends FalakElement {
    static observedAttributes = ['active'];

    static _seq = 0;

    get panels() {
        return [...this.children].filter(el => el.tagName === 'FALAK-TABS-CONTENT');
    }

    connectedCallback() {
        if (this._active === undefined) this._active = this.numAttr('active', 0);

        return super.connectedCallback();
    }

    render() {
        this.classList.add('f-tabs');

        const panels = this.panels;
        if (!panels.length) return;

        this._active = Math.min(Math.max(0, this._active), panels.length - 1);

        if (!this._header) {
            this._header = document.createElement('div');
            this._header.className = 'f-tabs__header';
            this._header.setAttribute('role', 'tablist');
            this.insertBefore(this._header, this.firstChild);
        }

        this._header.innerHTML = panels.map((panel, index) => {
            const active = index === this._active;
            const id = this.panelId(index);
            const badge = panel.getAttribute('badge');

            return `
                <button type="button" id="${id}-tab" class="f-tabs__tab${active ? ' is-active' : ''}"
                        role="tab" aria-selected="${active}" aria-controls="${id}" data-tab-index="${index}">
                    ${this.escape(panel.getAttribute('label') || '')}
                    ${badge ? `<span class="f-tabs__badge">${this.escape(badge)}</span>` : ''}
                </button>`;
        }).join('');

        panels.forEach((panel, index) => {
            const id = this.panelId(index);
            panel.id = id;
            panel.hidden = index !== this._active;
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', `${id}-tab`);
        });
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            const tab = event.target.closest('[data-tab-index]');
            if (tab) this.select(Number(tab.getAttribute('data-tab-index')));
        });
    }

    panelId(index) {
        if (!this._idBase) this._idBase = `f-tabs-${++FalakTabs._seq}`;

        return `${this._idBase}-${index}`;
    }

    select(index) {
        if (index === this._active) return;

        this._active = index;
        this.render();
        this.emit('changed', { index });
    }
}
