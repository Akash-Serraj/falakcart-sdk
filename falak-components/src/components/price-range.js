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
 * Attributes, `.range` and the `change` detail are all in the store's BASE
 * currency — the one the listing's `?min_price=` is filtered in. What the
 * shopper SEES is the display currency: the numbers and the slider scale are
 * multiplied by the page's rate on the way out and divided on the way in,
 * the same rate falak.money() applies, so a QAR shopper types QAR and the
 * query string still carries base.
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

    /** base → display multiplier for this page; 1 when the shopper reads base. */
    get rate() {
        const rate = Number(this.sdk?.config?.get('currency.rate', 1));
        return Number.isFinite(rate) && rate > 0 ? rate : 1;
    }

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

    /* Whole display units: a filter slider has no use for cents. */
    toDisplay(base) { return this.rate === 1 ? base : Math.round(base * this.rate); }
    toBase(display) { return this.rate === 1 ? display : Math.round(display / this.rate); }

    percent(value) {
        return ((value - this.min) / (this.max - this.min)) * 100;
    }

    render() {
        this.classList.add('f-price-range');

        const { min: valMin, max: valMax } = this._values;
        const dMin = this.toDisplay(this.min), dMax = this.toDisplay(this.max);
        const dValMin = this.toDisplay(valMin), dValMax = this.toDisplay(valMax);

        this.innerHTML = `
            <div class="f-price-range__numbers">
                <input class="f-input f-price-range__number" type="number" data-range-number="min"
                       min="${dMin}" max="${dValMax}" step="${this.step}" value="${dValMin}">
                <span class="f-price-range__sep">—</span>
                <input class="f-input f-price-range__number" type="number" data-range-number="max"
                       min="${dValMin}" max="${dMax}" step="${this.step}" value="${dValMax}">
            </div>
            <div class="f-price-range__track">
                <div class="f-price-range__fill" style="inset-inline-start: ${this.percent(valMin)}%; inset-inline-end: ${100 - this.percent(valMax)}%"></div>
                <input class="f-price-range__slider" type="range" data-range-slider="min" min="${dMin}" max="${dMax}" step="${this.step}" value="${dValMin}" aria-label="${this.escape(this.trans('common.minimum_price'))}">
                <input class="f-price-range__slider" type="range" data-range-slider="max" min="${dMin}" max="${dMax}" step="${this.step}" value="${dValMax}" aria-label="${this.escape(this.trans('common.maximum_price'))}">
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
        let value = this.clamp(this.toBase(Number(slider.value)));

        value = which === 'min' ? Math.min(value, this._values.max) : Math.max(value, this._values.min);
        this._values = { ...this._values, [which]: value };

        slider.value = this.toDisplay(value);
        const otherSlider = this.querySelector(`[data-range-slider="${other}"]`);
        if (otherSlider) otherSlider.value = this.toDisplay(this._values[other]);

        const fill = this.querySelector('.f-price-range__fill');
        if (fill) {
            fill.style.insetInlineStart = `${this.percent(this._values.min)}%`;
            fill.style.insetInlineEnd = `${100 - this.percent(this._values.max)}%`;
        }

        const numberInput = this.querySelector(`[data-range-number="${which}"]`);
        if (numberInput) numberInput.value = this.toDisplay(value);
    }

    applyNumberInput(input) {
        const which = input.getAttribute('data-range-number');
        let value = this.clamp(this.toBase(Number(input.value) || 0));

        value = which === 'min' ? Math.min(value, this._values.max) : Math.max(value, this._values.min);
        this._values = { ...this._values, [which]: value };

        this.render();
        this.commit();
    }

    commit() {
        this.emit('change', this.range);
    }
}
