import FalakElement from '../base.js';

/**
 * <falak-payment-status thank-you-url="/thank-you/{order}" checkout-url="/checkout"></falak-payment-status>
 *
 * The page an online payment gateway sends the shopper back to
 * (`/payment-status?order_number=…&success=…`). It asks the platform for
 * the gateway's verdict (`/api/customer/orders/callback/{order}`, which
 * verifies with the gateway and fulfils the order) and shows one of three
 * states: verifying, paid (with the way to the thank-you page), or failed
 * (with the way back to the checkout and to the order).
 *
 * Reads the query string itself, so a theme just places it on the page.
 */
export default class FalakPaymentStatus extends FalakElement {
    static observedAttributes = ['thank-you-url', 'checkout-url', 'order-url'];

    get thankYouUrl() { return this.attr('thank-you-url', '/thank-you/{order}'); }
    get checkoutUrl() { return this.attr('checkout-url', '/checkout'); }
    get orderUrl() { return this.attr('order-url', '/customer/orders/{order}'); }

    render() {
        this.classList.add('f-payment-status');

        const state = this._state || 'verifying';
        const number = this._order || '';
        const url = template => template.replace('{order}', encodeURIComponent(number));

        const views = {
            verifying: `
                <div class="f-payment-status__box">
                    <span class="f-modal__spinner" aria-hidden="true"></span>
                    <h1 class="f-payment-status__title">${this.escape(this.trans('checkout.verifying_payment'))}</h1>
                    <p>${this.escape(this.trans('checkout.verifying_hint'))}</p>
                </div>`,
            success: `
                <div class="f-payment-status__box is-success">
                    <span class="f-payment-status__icon" aria-hidden="true">✓</span>
                    <h1 class="f-payment-status__title">${this.escape(this.trans('checkout.payment_success'))}</h1>
                    <p>${this.escape(this.trans('checkout.order_number'))} <b>#${this.escape(number)}</b></p>
                    <a class="f-btn f-btn--solid f-btn--primary" href="${this.escape(url(this.thankYouUrl))}">${this.escape(this.trans('common.continue'))}</a>
                </div>`,
            failed: `
                <div class="f-payment-status__box is-failed">
                    <span class="f-payment-status__icon" aria-hidden="true">✕</span>
                    <h1 class="f-payment-status__title">${this.escape(this.trans('checkout.payment_failed'))}</h1>
                    <p>${this.escape(this._message || this.trans('checkout.payment_failed_hint'))}</p>
                    <div class="f-payment-status__actions">
                        ${number ? `<a class="f-btn f-btn--outline f-btn--light-outline" href="${this.escape(url(this.orderUrl))}">${this.escape(this.trans('account.order'))} #${this.escape(number)}</a>` : ''}
                        ${number
                            ? `<button type="button" class="f-btn f-btn--solid f-btn--primary" data-retry ${this._retrying ? 'disabled' : ''}>
                                   ${this._retrying ? '<span class="f-btn__loader" aria-hidden="true"></span>' : ''}
                                   ${this.escape(this.trans('checkout.try_again'))}
                               </button>`
                            : `<a class="f-btn f-btn--solid f-btn--primary" href="${this.escape(this.checkoutUrl)}">${this.escape(this.trans('checkout.try_again'))}</a>`}
                    </div>
                </div>`,
        };

        this.innerHTML = views[state] || views.verifying;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-retry]')) this.retry();
        });

        this.verify();
    }

    /**
     * "Try again" pays the SAME order again. Placing the order already spent
     * the cart, so sending the shopper back to the checkout only shows them
     * an empty cart; the order is still there awaiting payment, and the
     * retry endpoint hands back a fresh gateway URL for it. When a retry is
     * refused (already paid, a method that cannot be retried) the reason is
     * shown and the order link stays as the way forward.
     */
    async retry() {
        if (this._retrying || !this._order) return;

        this._retrying = true;
        this.render();

        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.retryPayment(this._order));
            const url = response?.gateway_response?.url;
            const status = String(response?.payment_status || '').toLowerCase();

            if (url) { window.location.assign(url); return; }
            if (['completed', 'paid', 'success'].includes(status)) {
                window.location.assign(this.thankYouUrl.replace('{order}', encodeURIComponent(this._order)));
                return;
            }

            this._message = response?.message || this.trans('checkout.payment_failed_hint');
        } catch (error) {
            this._message = error?.message || this.trans('checkout.payment_failed_hint');
        }

        this._retrying = false;
        this.render();
    }

    async verify() {
        const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
        this._order = params.order_number || params.order || '';

        if (!this._order) {
            this._state = 'failed';
            this._message = this.trans('checkout.order_not_found');
            this.render();
            return;
        }

        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.paymentStatus(this._order, params));
            const status = String(response?.status || response?.payment_status || '').toLowerCase();

            this._state = ['success', 'paid', 'completed'].includes(status) ? 'success' : 'failed';
            this._message = this._state === 'failed' ? (response?.message || '') : '';
        } catch (error) {
            this._state = 'failed';
            this._message = error?.message || '';
        }

        this.emitBus('checkout::payment.verified', { orderNumber: this._order, success: this._state === 'success' });
        this.render();

        if (this._state === 'success') {
            window.setTimeout(() => window.location.assign(this.thankYouUrl.replace('{order}', encodeURIComponent(this._order))), 1500);
        }
    }
}
