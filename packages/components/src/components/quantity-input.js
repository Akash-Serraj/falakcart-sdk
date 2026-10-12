import FalakElement from '../base.js';

/**
 * <falak-quantity-input value="1" min="1" max="20" name="quantity">
 *
 * Component #1, and deliberately the one that touches no SDK API at all: it
 * exists to establish the conventions — attribute reflection, dual event
 * emission, data-* state, a hidden input so it works inside a plain <form>.
 */
export default class FalakQuantityInput extends FalakElement {
    static observedAttributes = ['value', 'min', 'max', 'disabled'];

    get value() {
        return this.clamp(this.numAttr('value', this.min));
    }

    set value(next) {
        this.setAttribute('value', String(this.clamp(next)));
    }

    get min() { return this.numAttr('min', 1); }
    get max() { return this.numAttr('max', Infinity); }
    get disabled() { return this.boolAttr('disabled'); }

    /**
     * Raise to min first, then cap at max.
     *
     * The order matters and the unbounded case is the trap: with no max, the
     * cap has to be the *raised* value, not the original — capping at the
     * original silently undoes the raise, so `value="0" min="2"` came back as 0.
     */
    clamp(value) {
        const min = this.min;
        const max = this.max;

        if (!Number.isFinite(value)) return min;

        const raised = Math.max(value, min);

        return Number.isFinite(max) ? Math.min(raised, max) : raised;
    }

    render() {
        const value = this.value;
        const label = this.attr('label') || this.trans('product.quantity');

        this.innerHTML = `
            <div class="f-qty" role="group" aria-label="${this.escape(label)}">
                <button type="button" class="f-qty__step" data-step="-1"
                        aria-label="${this.escape(this.trans('product.decrease_qty'))}"
                        ${value <= this.min || this.disabled ? 'disabled' : ''}>&minus;</button>
                <input class="f-qty__input" type="text" inputmode="numeric"
                       value="${this.escape(this.sdk.number(value))}"
                       aria-label="${this.escape(label)}" ${this.disabled ? 'disabled' : ''}>
                <button type="button" class="f-qty__step" data-step="1"
                        aria-label="${this.escape(this.trans('product.increase_qty'))}"
                        ${value >= this.max || this.disabled ? 'disabled' : ''}>+</button>
            </div>`;

        // A hidden input keeps the element usable inside a normal form submit,
        // which is how the theme's product page posts today.
        if (this.attr('name')) {
            const hidden = document.createElement('input');
            hidden.type = 'hidden';
            hidden.name = this.attr('name');
            hidden.value = String(value);
            this.appendChild(hidden);
        }

        this.setState('value', value);
    }

    setup() {
        const mine = payload => payload && String(payload.productId) === String(this.attr('product-id'));

        // The chosen variant's stock caps the stepper (unlimited clears it).
        this._offOptions = this.sdk.event.on('product::options.changed', payload => {
            if (!mine(payload)) return;
            const stock = payload.complete ? payload.quantity : null;

            if (Number.isFinite(Number(stock)) && stock !== null) this.setAttribute('max', String(Math.max(0, Number(stock))));
            else this.removeAttribute('max');
        });

        // The API refused the amount: cap to what it said is available.
        this._offStock = this.sdk.event.on('product::stock.exceeded', payload => {
            if (!mine(payload) || !Number.isFinite(Number(payload.available))) return;
            this.setAttribute('max', String(Math.max(0, Number(payload.available))));
        });

        this.listen(this, 'click', event => {
            const step = event.target.closest('[data-step]');
            if (!step || this.disabled) return;

            event.preventDefault();
            this.commit(this.value + Number(step.dataset.step));
        });

        // Typed input is validated on blur, not per keystroke: clamping mid-typing
        // makes "10" impossible to enter when min is 2.
        this.listen(this, 'change', event => {
            const input = event.target.closest('.f-qty__input');
            if (!input) return;

            this.commit(parseInt(String(input.value).replace(/[^\d-]/g, ''), 10));
        });
    }

    disconnectedCallback() {
        this._offOptions?.();
        this._offStock?.();
        super.disconnectedCallback();
    }

    commit(next) {
        const value = this.clamp(next);

        if (value === this.value) {
            this.render();   // snap the field back to the clamped value
            return;
        }

        this.value = value;

        this.emit('change', { value });
        this.emitBus('product::quantity.changed', { value, productId: this.attr('product-id') });
    }
}
