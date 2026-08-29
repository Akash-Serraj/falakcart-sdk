import FalakElement from '../base.js';

/**
 * <falak-price-range min="0" max="500"></falak-price-range>
 * <falak-price-range min="0" max="1000" value-min="100" value-max="600" step="10"></falak-price-range>
 *
 * A min/max price filter — mirroring <salla-price-range>: two handles over
 * one track, with exact numbers shown and editable alongside. A pure UI
 * primitive — it has no opinion about where the chosen range goes (a page
 * reload with `?min_price=&max_price=`, a client-side re-filter, anything);
 * read `.range` or listen for `change`.
 *
 * | attribute              | role                                          |
 * | min / max              | the filterable bounds (default 0 / 1000)       |
 * | value-min / value-max  | the initial selection (defaults to min/max)    |
 * | step                   | default 1                                      |
 *
 * Events: DOM `change` on the element (detail: `{ min, max }`) — fired
 * once a drag ends or a typed number is committed, not on every frame of
 * a drag in progress.
 */
export default class FalakPriceRange extends FalakElement {
    static observedAttributes = ['min', 'max', 'value-min', 'value-max', 'step'];

    get min() { return this.numAttr('min', 0); }
    get max() { return Math.max(this.min + 1, this.numAttr('max', 1000)); }
    get step() { return Math.max(1, this.numAttr('step', 1)); }
    get range() { return { ...this._values }; }

    connectedCallback() {
        if (this._values === undefined) {
            this._values = {
                min: this.clamp(this.numAttr('value-min', this.min)),
                max: this.clamp(this.numAttr('value-max', this.max)),
            };
        }

        return super.connectedCallback();
    }

    clamp(value) {
        return Math.min(this.max, Math.max(this.min, value));
    }

    percent(value) {
        return ((value - this.min) / (this.max - this.min)) * 100;
    }

    render() {
        this.classList.add('f-price-range');

        const { min: valMin, max: valMax } = this._values;

        this.innerHTML = `
            <div class="f-price-range__numbers">
                <input class="f-input f-price-range__number" type="number" data-range-number="min"
                       min="${this.min}" max="${valMax}" step="${this.step}" value="${valMin}">
                <span class="f-price-range__sep">—</span>
                <input class="f-input f-price-range__number" type="number" data-range-number="max"
                       min="${valMin}" max="${this.max}" step="${this.step}" value="${valMax}">
            </div>
            <div class="f-price-range__track">
                <div class="f-price-range__fill" style="inset-inline-start: ${this.percent(valMin)}%; inset-inline-end: ${100 - this.percent(valMax)}%"></div>
                <input class="f-price-range__slider" type="range" data-range-slider="min" min="${this.min}" max="${this.max}" step="${this.step}" value="${valMin}" aria-label="${this.escape(this.trans('common.minimum_price'))}">
                <input class="f-price-range__slider" type="range" data-range-slider="max" min="${this.min}" max="${this.max}" step="${this.step}" value="${valMax}" aria-label="${this.escape(this.trans('common.maximum_price'))}">
            </div>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        // 'input' fires continuously while dragging — updated WITHOUT a
        // render(): replacing the DOM mid-drag would drop the pointer
        // capture on the slider the shopper's hand is still on.
        this.listen(this, 'input', event => {
            const slider = event.target.closest('[data-range-slider]');
            if (slider) { event.stopImmediatePropagation(); this.applySliderDrag(slider); }
        });

        // The sliders'/number inputs' own native 'change' would otherwise
        // bubble straight past this element to whatever listens for OUR
        // OWN 'change' from commit() — stopped here so only the one clean
        // event (with a real {min, max} detail) is ever visible outside.
        this.listen(this, 'change', event => {
            if (event.target.closest('[data-range-slider]')) {
                event.stopImmediatePropagation();
                this.render();
                this.commit();
                return;
            }

            const number = event.target.closest('[data-range-number]');
            if (number) {
                event.stopImmediatePropagation();
                this.applyNumberInput(number);
            }
        });
    }

    applySliderDrag(slider) {
        const which = slider.getAttribute('data-range-slider');
        const other = which === 'min' ? 'max' : 'min';
        let value = Number(slider.value);

        value = which === 'min' ? Math.min(value, this._values.max) : Math.max(value, this._values.min);
        this._values = { ...this._values, [which]: value };

        slider.value = value;
        const otherSlider = this.querySelector(`[data-range-slider="${other}"]`);
        if (otherSlider) otherSlider.value = this._values[other];

        const fill = this.querySelector('.f-price-range__fill');
        if (fill) {
            fill.style.insetInlineStart = `${this.percent(this._values.min)}%`;
            fill.style.insetInlineEnd = `${100 - this.percent(this._values.max)}%`;
        }

        const numberInput = this.querySelector(`[data-range-number="${which}"]`);
        if (numberInput) numberInput.value = value;
    }

    applyNumberInput(input) {
        const which = input.getAttribute('data-range-number');
        let value = this.clamp(Number(input.value) || 0);

        value = which === 'min' ? Math.min(value, this._values.max) : Math.max(value, this._values.min);
        this._values = { ...this._values, [which]: value };

        this.render();
        this.commit();
    }

    commit() {
        this.emit('change', this.range);
    }
}
