import FalakElement from '../base.js';

/**
 * <falak-image-compare before="/a.jpg" after="/b.jpg"
 *                      before-label="Before" after-label="After">
 *
 * A draggable before/after comparison.
 *
 * Built around a native range input rather than a pointer handler: the input
 * arrives with drag, touch, arrow keys and a focus ring already working, and
 * the only thing script contributes is `--f-compare-pos`. Everything visible
 * reads that one value, so the block still renders correctly at its 50%
 * default if the script never runs — and both photos are real <img> tags, so a
 * visitor with no JavaScript sees the comparison rather than an empty frame.
 *
 * The thumb is a hairline and the knob is an ordinary element. A thumb styled
 * as the knob was the obvious build and the wrong one twice over: a range
 * thumb travels between the track's insets, so its centre stops half a knob
 * short of each edge while the divider runs the full width, and Chrome paints
 * the thumb straight through an ancestor's `overflow: hidden`, leaving a
 * circle hanging outside the rounded corner.
 *
 * | attribute     | role                                        |
 * | before        | the "before" image URL (required)           |
 * | after         | the "after" image URL (required)            |
 * | before-label  | pill over the before side                   |
 * | after-label   | pill over the after side                    |
 * | start         | opening handle position, 0-100 (default 50) |
 */
export default class FalakImageCompare extends FalakElement {
    static observedAttributes = ['before', 'after', 'before-label', 'after-label', 'start'];

    get before() { return this.attr('before', ''); }
    get after() { return this.attr('after', ''); }
    get beforeLabel() { return this.attr('before-label', ''); }
    get afterLabel() { return this.attr('after-label', ''); }

    get start() {
        const value = this.numAttr('start', 50);
        return Math.min(Math.max(value, 0), 100);
    }

    render() {
        this.classList.add('f-compare');

        if (!this.before || !this.after) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.style.setProperty('--f-compare-pos', `${this.start}%`);

        const handleLabel = this.trans('compare.handle') || 'Drag to compare';

        this.innerHTML = `
            <img class="f-compare__photo" src="${this.escape(this.after)}" loading="lazy"
                 alt="${this.escape(this.afterLabel || this.trans('compare.after') || '')}">

            <div class="f-compare__before" aria-hidden="true">
                <img class="f-compare__photo" src="${this.escape(this.before)}" alt="" loading="lazy">
            </div>

            ${this.beforeLabel ? `<span class="f-compare__label f-compare__label--before">${this.escape(this.beforeLabel)}</span>` : ''}
            ${this.afterLabel ? `<span class="f-compare__label f-compare__label--after">${this.escape(this.afterLabel)}</span>` : ''}

            <input class="f-compare__range" type="range" min="0" max="100" step="0.1"
                   value="${this.start}" aria-label="${this.escape(handleLabel)}">

            <span class="f-compare__divider" aria-hidden="true"></span>
            <span class="f-compare__knob" aria-hidden="true"></span>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        /* Delegated, so a re-render replacing the input needs no re-wiring. */
        this.listen(this, 'input', event => {
            const range = event.target.closest('.f-compare__range');
            if (!range) return;

            this.style.setProperty('--f-compare-pos', `${range.value}%`);
            this.emit('compare.moved', { position: Number(range.value) });
        });
    }
}
