import FalakElement from '../base.js';

/**
 * <falak-progress-bar value="65"></falak-progress-bar>
 * <falak-progress-bar value="2" max="3" label="Step 2 of 3" show-value></falak-progress-bar>
 * <falak-progress-bar value="65" color="success" size="lg"></falak-progress-bar>
 *
 * A filled bar — mirroring <salla-progress-bar>: checkout's "step 2 of 3",
 * a bulk-discount tier, any place a bare number reads better as a fraction
 * of a whole than on its own.
 *
 * | attribute  | role                                                       |
 * | value      | the current amount (clamped to [0, max])                   |
 * | max        | the whole (default 100, so `value` reads as a percentage)  |
 * | label      | text shown above the bar                                   |
 * | show-value | also shows "N%" (or "N / max" when max isn't 100)          |
 * | color      | primary (default) | success | warning | danger             |
 * | size       | sm | md (default) | lg                                   |
 */
export default class FalakProgressBar extends FalakElement {
    static observedAttributes = ['value', 'max', 'label', 'show-value', 'color', 'size'];

    get max() { return Math.max(1, this.numAttr('max', 100)); }
    get value() { return Math.min(this.max, Math.max(0, this.numAttr('value', 0))); }
    get percent() { return Math.round((this.value / this.max) * 100); }
    get color() { return this.attr('color', 'primary'); }
    get size() { return this.attr('size', 'md'); }

    render() {
        this.classList.add('f-progress', `f-progress--${this.color}`, `f-progress--${this.size}`);
        this.setAttribute('role', 'progressbar');
        this.setAttribute('aria-valuemin', '0');
        this.setAttribute('aria-valuemax', String(this.max));
        this.setAttribute('aria-valuenow', String(this.value));

        const label = this.attr('label', '');
        const showValue = this.boolAttr('show-value');
        const valueText = this.max === 100 ? `${this.percent}%` : `${this.value} / ${this.max}`;

        this.innerHTML = `
            ${label || showValue ? `
                <div class="f-progress__head">
                    ${label ? `<span class="f-progress__label">${this.escape(label)}</span>` : ''}
                    ${showValue ? `<span class="f-progress__value">${this.escape(valueText)}</span>` : ''}
                </div>` : ''}
            <div class="f-progress__track">
                <div class="f-progress__fill" style="inline-size: ${this.percent}%"></div>
            </div>`;
    }
}
