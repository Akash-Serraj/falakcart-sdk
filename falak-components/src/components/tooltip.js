import FalakElement from '../base.js';

/**
 * <falak-tooltip text="Cash on delivery adds a small handling fee.">
 *     <button type="button" aria-label="More info">?</button>
 * </falak-tooltip>
 * <falak-tooltip text="…" position="bottom"><span>ⓘ</span></falak-tooltip>
 *
 * A small hover/focus hint — mirroring <salla-tooltip>. Wraps whatever
 * trigger the caller puts inside it (an icon, a badge, a word) and shows
 * `text` near it on hover or keyboard focus, hiding again on blur, mouse
 * leave, or Escape. The trigger keeps whatever behaviour it already has —
 * this never intercepts clicks. Wrap a naturally focusable element (a
 * button, a link) if the hint should be reachable by keyboard too.
 *
 * | attribute | role                                                       |
 * | text      | required — the hint shown                                  |
 * | position  | top (default) | bottom | start | end                       |
 */
export default class FalakTooltip extends FalakElement {
    static observedAttributes = ['text', 'position'];

    static _seq = 0;

    get text() { return this.attr('text', ''); }
    get position() { return this.attr('position', 'top'); }

    connectedCallback() {
        // Author markup is the trigger. Captured before the first render
        // replaces it — and only once, so re-renders (e.g. `text` changing) keep it.
        if (this._trigger === undefined) this._trigger = this.innerHTML.trim();

        return super.connectedCallback();
    }

    render() {
        this.classList.add('f-tooltip');
        this.setAttribute('data-tooltip-position', this.position);

        if (!this._id) this._id = `f-tooltip-${++FalakTooltip._seq}`;

        this.innerHTML = `
            <span class="f-tooltip__trigger" aria-describedby="${this._id}">${this._trigger}</span>
            <span class="f-tooltip__bubble" role="tooltip" id="${this._id}">${this.escape(this.text)}</span>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'mouseenter', () => this.show());
        this.listen(this, 'mouseleave', () => this.hide());
        this.listen(this, 'focusin', () => this.show());
        this.listen(this, 'focusout', () => this.hide());
        this.listen(this, 'keydown', event => { if (event.key === 'Escape') this.hide(); });
    }

    show() {
        if (this.text) this.classList.add('is-open');
    }

    hide() {
        this.classList.remove('is-open');
    }
}
