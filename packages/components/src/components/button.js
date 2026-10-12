import FalakElement from '../base.js';

/**
 * <falak-button color="primary" fill="solid" size="medium">Add to cart</falak-button>
 * <falak-button shape="icon" aria-label="Close">&times;</falak-button>
 * <falak-button href="/cart" color="light" fill="outline">Cart</falak-button>
 *
 * The attribute vocabulary mirrors Salla's <salla-button> deliberately — shape,
 * color, fill, size, width, loader-position — so markup ports across with only
 * the tag name changed. So does the imperative surface: other components call
 * load()/stop()/disable()/setText() on a button they hold a reference to, and
 * the API client itself puts a button into its loading state for the duration
 * of a request.
 *
 * Everything the author put on the host is forwarded to the inner <button>,
 * minus the styling attributes that are ours to interpret.
 */
export default class FalakButton extends FalakElement {
    static observedAttributes = ['color', 'fill', 'size', 'width', 'shape', 'loading', 'disabled', 'href'];

    /** Styling inputs are consumed here, never copied onto the inner element. */
    static STYLE_ATTRS = ['color', 'fill', 'size', 'width', 'shape', 'loader-position', 'href', 'id', 'class'];

    get shape() { return this.attr('shape', 'btn'); }
    get color() { return this.attr('color', 'primary'); }
    get fill() { return this.attr('fill', 'solid'); }
    get size() { return this.attr('size', 'medium'); }
    get width() { return this.attr('width', 'normal'); }
    get loaderPosition() { return this.attr('loader-position', 'after'); }
    get href() { return this.attr('href'); }
    get isLoading() { return this.boolAttr('loading'); }
    get isDisabled() { return this.boolAttr('disabled'); }

    /* ------------------------------------------------------ imperative API */

    /** Start the spinner. Centre position hides the label rather than shifting it. */
    load() {
        this.setAttribute('loading', '');
        if (this.loaderPosition === 'center') this._label?.classList.add('f-btn__text--hidden');
        return this;
    }

    stop() {
        this.removeAttribute('loading');
        this._label?.classList.remove('f-btn__text--hidden');
        return this;
    }

    disable() {
        this.setAttribute('disabled', '');
        return this;
    }

    enable() {
        this.removeAttribute('disabled');
        return this;
    }

    /**
     * Replaces the label only. Callers pass markup (an icon, a price), so this
     * writes innerHTML — but never from an untrusted source: every caller in the
     * SDK passes a translated string or its own template.
     */
    setText(html) {
        if (this._label) this._label.innerHTML = html;
        return this;
    }

    /* ------------------------------------------------------------- render */

    /**
     * The class list is assembled rather than toggled so a single pass produces
     * the final value — a button re-renders on every attribute change, and
     * accumulating toggles would leave stale modifiers behind.
     */
    classesFor() {
        const shape = this.shape;
        const fill = this.fill;
        const classes = [
            'f-btn',
            `f-btn--${shape}`,
            `f-btn--${fill === 'none' ? 'fill-none' : fill}`,
        ];

        if (this.size !== 'medium') classes.push(`f-btn--${this.size}`);
        if (this.width !== 'normal') classes.push(`f-btn--${this.width}`);

        if (shape === 'link') {
            classes.push(`f-btn--${this.color}-link`);
        } else if (fill === 'outline') {
            classes.push(`f-btn--${this.color}-outline`);
        } else {
            classes.push(`f-btn--${this.color}`);
        }

        if (this.isDisabled) classes.push('f-btn--disabled');

        classes.push(shape === 'icon' ? 'f-btn--loader-center' : `f-btn--loader-${this.loaderPosition}`);

        return classes.join(' ');
    }

    /** Author attributes pass through to the real control; ours are filtered out. */
    forwardedAttributes() {
        const forwarded = {};

        for (const { name, value } of Array.from(this.attributes)) {
            if (!FalakButton.STYLE_ATTRS.includes(name)) forwarded[name] = value;
        }

        forwarded.type = forwarded.type || 'button';

        return forwarded;
    }

    render() {
        // Capture the author's label once — every later render reuses it, so a
        // setText() call is not undone by an unrelated attribute change.
        if (this._labelHtml === undefined) this._labelHtml = this.innerHTML;

        const attrs = Object.entries(this.forwardedAttributes())
            .map(([name, value]) => `${name}="${this.escape(value)}"`)
            .join(' ');

        const control = `
            <button class="${this.classesFor()}" ${attrs} ${this.isDisabled ? 'disabled' : ''}>
                <span class="f-btn__text">${this._labelHtml}</span>
                ${this.isLoading ? '<span class="f-btn__loader" aria-hidden="true"></span>' : ''}
            </button>`;

        this.classList.add('f-btn-wrap');
        this.innerHTML = this.href
            ? `<a class="f-btn__link" href="${this.escape(this.href)}">${control}</a>`
            : control;

        this._label = this.querySelector('.f-btn__text');

        if (this.isLoading && this.loaderPosition === 'center') {
            this._label.classList.add('f-btn__text--hidden');
        }

        this.setAttribute('data-loading', String(this.isLoading));
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        /*
         * A disabled or loading button must not act. `disabled` on the inner
         * control already blocks the click, but the host still receives it when
         * the pointer lands on padding, so it is stopped here too.
         */
        this.listen(this, 'click', event => {
            if (!this.isDisabled && !this.isLoading) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
    }
}
