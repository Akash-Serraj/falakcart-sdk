/**
 * Base class for every <falak-*> element.
 *
 * Three conventions are enforced here so no component has to remember them:
 *
 *  1. Light DOM only. Nothing calls attachShadow, so the theme's compiled
 *     app.css styles every component with no piercing and no overrides. The
 *     component contributes markup and state; the theme owns appearance.
 *
 *  2. Render is gated on falak.onReady(). Script order on a merchant page is
 *     not ours to control, and a component that reads config before init would
 *     render a store with no name and no currency.
 *
 *  3. State is published as data-* attributes, never as inline styles. CSS
 *     decides what "collapsed" or "loading" looks like.
 */
export default class FalakElement extends HTMLElement {
    constructor() {
        super();
        this.ready = false;
        this._renderQueued = false;
    }

    /** The SDK, or a loud failure — every component needs it except by design. */
    get sdk() {
        return window.falak;
    }

    async connectedCallback() {
        if (!this.sdk) {
            console.warn(`<${this.localName}> rendered before the Falak SDK loaded.`);
            return;
        }

        await this.sdk.onReady();

        this.ready = true;
        this.setAttribute('data-falak', '');

        await this.setup?.();

        this.render();

        /*
         * Strings may still be in flight; re-render rather than block first
         * paint. But ONLY when they genuinely are: onLoaded() resolves
         * immediately once loaded, which scheduled a pointless second render a
         * microtask after afterRender() — replacing every component's DOM
         * right after its listeners were bound to the old one. That is how the
         * slider's prev arrow froze disabled: its scroll listener died with
         * the first track.
         */
        if (!this.sdk.lang.loaded) {
            this.sdk.lang.onLoaded(() => this.ready && this.render());
        }

        this.afterRender?.();
    }

    disconnectedCallback() {
        (this._teardown || []).forEach(fn => fn());
        this._teardown = [];
    }

    /**
     * Attribute changes re-render, but only after the first one — the initial
     * upgrade sets several attributes in a row and each must not repaint.
     */
    attributeChangedCallback(name, previous, next) {
        if (!this.ready || previous === next) return;

        this.onAttributeChange?.(name, previous, next);
        this.queueRender();
    }

    /** Coalesces bursts of attribute writes into one paint. */
    queueRender() {
        if (this._renderQueued) return;

        this._renderQueued = true;

        requestAnimationFrame(() => {
            this._renderQueued = false;
            if (this.ready && this.isConnected) this.render();
        });
    }

    render() { /* subclasses implement */ }

    /* ------------------------------------------------------- attribute reads */

    attr(name, fallback = null) {
        return this.hasAttribute(name) ? this.getAttribute(name) : fallback;
    }

    /** Present-and-not-"false" — so `bordered` and `bordered="true"` both work. */
    boolAttr(name) {
        if (!this.hasAttribute(name)) return false;
        const value = this.getAttribute(name);
        return value !== 'false' && value !== '0';
    }

    /**
     * A missing attribute must yield the fallback, and `hasAttribute` is the
     * only reliable test for that: `Number(null)` is 0, and 0 is finite, so a
     * plain isFinite check silently turns every absent numeric attribute into
     * zero. That is what made `max` default to 0 and clamp quantity inputs to
     * nothing.
     */
    numAttr(name, fallback = 0) {
        if (!this.hasAttribute(name)) return fallback;

        const raw = this.getAttribute(name);

        if (raw === null || raw.trim() === '') return fallback;

        const value = Number(raw);

        return Number.isFinite(value) ? value : fallback;
    }

    jsonAttr(name, fallback = null) {
        return this.sdk.helpers.parseJson(this.getAttribute(name), fallback);
    }

    /* --------------------------------------------------------------- output */

    trans(key, replacements) {
        return this.sdk.lang.get(key, replacements);
    }

    money(amount, currency) {
        return this.sdk.money(amount, currency);
    }

    escape(value) {
        return this.sdk.helpers.escape(value);
    }

    /**
     * Components announce twice, on purpose:
     *   - a bubbling DOM event, for a theme listening in Twig or app.js
     *   - a bus event, for other components that have no DOM relationship
     * Neither audience should have to know about the other.
     */
    emit(name, detail = {}) {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
        return this;
    }

    emitBus(event, payload) {
        this.sdk.event.dispatch(event, payload);
        return this;
    }

    /** Registers a listener that disconnectedCallback will clean up. */
    listen(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        (this._teardown ||= []).push(() => target.removeEventListener(event, handler, options));
        return this;
    }

    /* ---------------------------------------------------------------- state */

    setState(name, value) {
        this.setAttribute(`data-${name}`, String(value));
        return this;
    }

    setBusy(busy) {
        busy ? this.setAttribute('data-busy', 'true') : this.removeAttribute('data-busy');
        return this;
    }
}
