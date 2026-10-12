import FalakElement from '../base.js';

/**
 * <falak-product-availability product-id="12" product-status="out"></falak-product-availability>
 * <falak-product-availability product-id="12" product-status="sale"></falak-product-availability>
 *
 * "Notify me when it's back" — mirroring <salla-product-availability>.
 * Shown only while the product (or the chosen variant) is sold out; a
 * click opens a dialog asking for an email and/or phone, prefilled from
 * the signed-in customer, and files the request through
 * falak.product.notifyWhenAvailable(). Guests can use it too.
 *
 * On a variant product it follows <falak-product-options>: it appears when
 * the chosen variant is out of stock and hides when an in-stock one is
 * picked, subscribing for that exact variant.
 *
 * | attribute      | role                                                  |
 * | product-id     | required                                              |
 * | product-status | sale (default) | out — the product-level state        |
 * | button-class   | class(es) for the trigger, so a theme skin applies    |
 *
 * Events: DOM `subscribed` on the element; `product::availability.subscribed` on the bus.
 */
export default class FalakProductAvailability extends FalakElement {
    static observedAttributes = ['product-id', 'product-status', 'button-class'];

    get productId() { return this.attr('product-id'); }
    get productStatus() { return this.attr('product-status', 'sale'); }
    get buttonClass() { return this.attr('button-class', ''); }

    /**
     * Sold out at the product level, the chosen variant is, or the shopper
     * just asked for more than the stock allows — which for them is the
     * same thing: they cannot get what they want now.
     */
    get isOut() {
        if (this._exceeded) return true;
        if (this._variant) return !this._variant.inStock;

        return this.productStatus === 'out';
    }

    render() {
        this.classList.add('f-availability');

        if (!this.productId || !this.isOut) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');

        const classes = ['f-availability__button'];
        if (this.buttonClass) classes.push(...this.buttonClass.split(/\s+/).filter(Boolean));
        else classes.push('f-btn', 'f-btn--outline', 'f-btn--primary-outline');

        const note = this._exceeded && !this._done
            ? `<p class="f-availability__note">${this.escape(this.trans('product.notify_low_stock', { count: this._exceeded.available }))}</p>`
            : '';

        this.innerHTML = this._done
            ? `<p class="f-availability__done">${FalakProductAvailability.ICON} ${this.escape(this.trans('product.availability_done'))}</p>`
            : `${note}<button type="button" class="${classes.join(' ')}" data-availability-open>
                   ${FalakProductAvailability.ICON}
                   <span>${this.escape(this.trans('product.notify_me'))}</span>
               </button>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-availability-open]')) this.open();
        });

        // Follow the variant chooser for this product.
        this._off = this.sdk.event.on('product::options.changed', payload => {
            if (String(payload?.productId) !== String(this.productId)) return;
            this._variant = payload.complete ? { id: payload.variationId, inStock: payload.inStock !== false } : null;
            this._exceeded = null;
            this._done = false;
            this.render();
        });

        // The cart refused the amount for this product: offer the alert.
        this._offStock = this.sdk.event.on('product::stock.exceeded', payload => {
            if (String(payload?.productId) !== String(this.productId)) return;
            this._exceeded = { available: Number(payload.available) || 0 };
            this._done = false;
            this.render();
        });
    }

    disconnectedCallback() {
        if (typeof this._off === 'function') this._off();
        if (typeof this._offStock === 'function') this._offStock();
        this._modal?.remove();
        super.disconnectedCallback();
    }

    open() {
        this._modal?.remove();

        const user = this.sdk.auth.user || {};
        const modal = document.createElement('falak-modal');
        modal.setAttribute('width', 'sm');
        modal.setAttribute('modal-title', this.trans('product.notify_me'));
        modal.setAttribute('sub-title', this.trans('product.notify_me_hint'));
        modal.className = 'f-availability__modal';
        modal.innerHTML = `
            <form class="f-availability__form" data-availability-form novalidate>
                <label class="f-field">
                    <span class="f-field__label">${this.escape(this.trans('checkout.email'))}</span>
                    <input class="f-input" type="email" name="email" dir="ltr" value="${this.escape(user.email || '')}" autocomplete="email">
                </label>
                <label class="f-field">
                    <span class="f-field__label">${this.escape(this.trans('checkout.phone'))}</span>
                    <input class="f-input" type="tel" name="phone" dir="ltr" value="${this.escape(user.phone || '')}" autocomplete="tel">
                </label>
                <p class="f-availability__error" role="alert" data-availability-error hidden></p>
                <button type="submit" class="f-btn f-btn--solid f-btn--primary f-btn--wide" data-availability-submit>${this.escape(this.trans('product.notify_me_submit'))}</button>
            </form>`;

        modal.addEventListener('submit', event => {
            if (!event.target.matches('[data-availability-form]')) return;
            event.preventDefault();
            this.submit(event.target, modal);
        });

        this.appendChild(modal);
        this._modal = modal;
        Promise.resolve().then(() => modal.open());
    }

    async submit(form, modal) {
        const email = form.querySelector('[name="email"]').value.trim();
        const phone = form.querySelector('[name="phone"]').value.trim();
        const error = form.querySelector('[data-availability-error]');
        const button = form.querySelector('[data-availability-submit]');

        if (!email && !phone) {
            error.textContent = this.trans('product.notify_me_contact_required');
            error.hidden = false;
            return;
        }

        error.hidden = true;
        button.disabled = true;

        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.product.notifyWhenAvailable(this.productId, {
                email, phone, variationId: this._variant?.id ?? null,
            }));

            this._done = true;
            this.sdk.notify.success(response?.message || this.trans('product.availability_done'));
            this.emit('subscribed', { productId: this.productId, variationId: this._variant?.id ?? null, email, phone });
            modal.close();
            this.render();
        } catch (err) {
            error.textContent = err?.message || this.trans('common.load_failed');
            error.hidden = false;
        } finally {
            button.disabled = false;
        }
    }

    static ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
}
