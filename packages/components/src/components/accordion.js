import FalakElement from '../base.js';

/**
 * <falak-accordion collapsible bordered size="md">
 *   <falak-accordion-head><span slot="title">Shipping</span></falak-accordion-head>
 *   <falak-accordion-body>...</falak-accordion-body>
 * </falak-accordion>
 *
 * A three-element family, and the reason it is in the starter set: it is the
 * smallest component that has to solve parent/child coordination in the light
 * DOM, where children upgrade in an order nobody controls.
 *
 * State is published as data-collapsed on all three elements. Nothing here
 * touches style.display — the theme's CSS decides what collapsed looks like,
 * which is why these components ship no stylesheet of their own.
 */
export class FalakAccordion extends FalakElement {
    static observedAttributes = ['collapsed', 'collapsible', 'bordered', 'size'];

    get collapsible() { return !this.hasAttribute('collapsible') || this.boolAttr('collapsible'); }
    get collapsed() { return this.attr('collapsed', 'true') !== 'false'; }
    set collapsed(next) { this.setAttribute('collapsed', String(!!next)); }

    setup() {
        /*
         * The toggle event bubbles up from the head. Listening on the host
         * rather than on the child means the head can be replaced, re-rendered
         * or arrive late without the subscription going stale.
         */
        this.listen(this, 'accordion-toggle', event => {
            event.stopPropagation();
            this.collapsed = event.detail.collapsed;
            this.sync();

            this.emit('toggle', { collapsed: this.collapsed });
            this.emitBus('ui::accordion.toggled', {
                collapsed: this.collapsed,
                name: this.attr('name'),
            });
        });
    }

    render() {
        this.classList.add('f-accordion');
        this.classList.toggle('f-accordion--bordered', this.boolAttr('bordered'));

        const size = this.attr('size', 'md');
        this.classList.remove('f-accordion--sm', 'f-accordion--md', 'f-accordion--lg');
        this.classList.add(`f-accordion--${size}`);

        this.setAttribute('dir', this.attr('dir') || (this.sdk.lang.isRtl ? 'rtl' : 'ltr'));

        this.sync();
    }

    /**
     * Pushes state onto the head and body every render.
     *
     * This looks redundant with the head setting its own attributes, and it is
     * — on purpose. Slotted children are upgraded by the browser whenever their
     * definition happens to be registered, so the parent cannot assume they
     * existed when it first rendered. Re-syncing is what makes the pair correct
     * on a soft navigation and on first paint alike.
     */
    sync() {
        const collapsed = String(this.collapsed);

        this.setAttribute('data-collapsed', collapsed);

        const head = this.querySelector(':scope > falak-accordion-head');
        const body = this.querySelector(':scope > falak-accordion-body');

        if (head) {
            head.setAttribute('data-collapsed', collapsed);
            head.setAttribute('collapsed', collapsed);
            head.toggleAttribute('collapsible', this.collapsible);
        }

        if (body) {
            body.setAttribute('data-collapsed', collapsed);
            body.setAttribute('aria-hidden', collapsed);
        }
    }

    /** Imperative API, for a theme driving the accordion from its own script. */
    open() { this.collapsed = false; this.sync(); return this; }
    close() { this.collapsed = true; this.sync(); return this; }
    toggle() { this.collapsed = !this.collapsed; this.sync(); return this; }
}

/**
 * The head owns the click target and announces the change. It never decides
 * the new state on the parent's behalf beyond flipping its own attribute —
 * the parent is the single source of truth and syncs everyone from there.
 */
export class FalakAccordionHead extends FalakElement {
    static observedAttributes = ['collapsed', 'collapsible'];

    get collapsible() { return this.boolAttr('collapsible'); }
    get collapsed() { return this.attr('collapsed', 'true') !== 'false'; }

    setup() {
        this.listen(this, 'click', event => {
            if (event.target.closest('[data-accordion-ignore]')) return;
            this.toggle();
        });

        this.listen(this, 'keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            this.toggle();
        });
    }

    toggle() {
        if (!this.collapsible) return;

        const collapsed = !this.collapsed;

        this.setAttribute('collapsed', String(collapsed));
        this.emit('accordion-toggle', { collapsed });
    }

    render() {
        this.classList.add('f-accordion__head');

        if (this.collapsible) {
            this.setAttribute('role', 'button');
            this.setAttribute('tabindex', '0');
            this.setAttribute('aria-expanded', String(!this.collapsed));
        }

        // The toggle icon is the only markup the head owns; everything else the
        // author slotted in stays exactly where they put it.
        let icon = this.querySelector(':scope > .f-accordion__icon');

        if (this.collapsible && !icon) {
            icon = document.createElement('span');
            icon.className = 'f-accordion__icon';
            icon.setAttribute('aria-hidden', 'true');
            this.appendChild(icon);
        }

        if (icon) icon.textContent = this.collapsed ? '+' : '−';
        if (!this.collapsible && icon) icon.remove();
    }

    onAttributeChange(name) {
        if (name === 'collapsed') this.setAttribute('aria-expanded', String(!this.collapsed));
    }
}

/** The body is a pure container: a class, and the state its parent gives it. */
export class FalakAccordionBody extends FalakElement {
    render() {
        this.classList.add('f-accordion__body');
    }
}
