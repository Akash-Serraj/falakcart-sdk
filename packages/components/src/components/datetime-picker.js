import FalakElement from '../base.js';

/**
 * <falak-datetime-picker></falak-datetime-picker>
 * <falak-datetime-picker min="2026-09-01" max="2026-12-31"></falak-datetime-picker>
 * <falak-datetime-picker slots='["10:00","10:30","11:00"]'></falak-datetime-picker>
 *
 * A date (and, given `slots`, a time) picker — mirroring
 * <salla-datetime-picker>: booking an appointment, a delivery window,
 * anything that needs a date plus an available slot rather than a bare
 * `<input type=date>`. A pure UI primitive: it collects a choice and emits
 * it, with no opinion about what happens next — read `.value` or listen
 * for `change`.
 *
 * | attribute | role                                                          |
 * | min / max | earliest / latest selectable date (ISO yyyy-mm-dd)            |
 * | value     | the pre-selected date                                         |
 * | slots     | JSON array of time strings ("10:00") shown once a date is     |
 * |           | picked; omitted entirely when there's nothing to choose        |
 * |           | beyond the date itself                                        |
 * | label     | the date field's own label (default: a generic prompt)        |
 *
 * Events: DOM `change` on the element (detail: `{ date, time }` — `time`
 * stays null until `slots` is given and one is picked).
 */
export default class FalakDatetimePicker extends FalakElement {
    static observedAttributes = ['min', 'max', 'value', 'slots', 'label'];

    get slots() { return this.jsonAttr('slots', null) || []; }
    get value() { return { date: this._date || null, time: this._time }; }

    connectedCallback() {
        if (this._date === undefined) {
            this._date = this.attr('value', '') || '';
            this._time = null;
        }

        return super.connectedCallback();
    }

    render() {
        this.classList.add('f-datetime');

        const label = this.attr('label') || this.trans('common.choose_date');
        const min = this.attr('min');
        const max = this.attr('max');
        const slots = this.slots;

        this.innerHTML = `
            <label class="f-field f-datetime__field">
                <span class="f-field__label">${this.escape(label)}</span>
                <input class="f-input f-datetime__date" type="date" data-datetime-date value="${this.escape(this._date)}"
                       ${min ? `min="${this.escape(min)}"` : ''} ${max ? `max="${this.escape(max)}"` : ''}>
            </label>
            ${this._date && slots.length ? `
                <div class="f-datetime__slots" role="radiogroup" aria-label="${this.escape(this.trans('common.choose_time'))}">
                    ${slots.map(time => `
                        <button type="button" class="f-datetime__slot${time === this._time ? ' is-selected' : ''}"
                                role="radio" aria-checked="${time === this._time}" data-datetime-slot="${this.escape(time)}">
                            ${this.escape(time)}
                        </button>`).join('')}
                </div>` : ''}`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        // The date input's own native 'change' would otherwise bubble past
        // this element to whatever listens for OUR OWN 'change' from
        // commit() — stopped here so only the clean {date, time} event
        // is ever visible outside (same reason <falak-price-range> does this).
        this.listen(this, 'change', event => {
            if (!event.target.matches('[data-datetime-date]')) return;

            event.stopImmediatePropagation();
            this._date = event.target.value;
            // A new date invalidates whatever slot was chosen for the old one.
            this._time = null;
            this.render();
            this.commit();
        });

        this.listen(this, 'click', event => {
            const slot = event.target.closest('[data-datetime-slot]');
            if (!slot) return;

            this._time = slot.getAttribute('data-datetime-slot');
            this.render();
            this.commit();
        });
    }

    commit() {
        this.emit('change', this.value);
    }
}
