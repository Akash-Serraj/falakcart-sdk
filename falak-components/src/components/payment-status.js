import FalakElement from '../base.js';
import FalakOrderSummary from './order-summary.js';
import { openPayDialog, closeDialog } from './concerns/pay-dialog.js';

/**
 * <falak-payment-status thank-you-url="/thank-you/{order}" checkout-url="/checkout"></falak-payment-status>
 *
 * The page an online payment gateway sends the shopper back to
 * (`/payment-status?order_number=…`). It asks the platform for the gateway's
 * verdict (`/api/customer/orders/callback/{order}`, which verifies with the
 * gateway and fulfils the order) and shows one of five states:
 *
 *   verifying  a spinner while the verdict is fetched
 *   success    paid — a short confirmation, then the thank-you page
 *   pending    placed but not confirmed yet (a late webhook, a BNPL review):
 *              the items, the total, and the ways forward; re-checked a few
 *              times on its own before it stops polling
 *   failed     declined or cancelled: retry with any online method right
 *              here, or go to the order
 *   error      the verdict itself could not be fetched (network, sign-in)
 *
 * Reads the query string itself, so a theme just places it on the page.
 * `order_number` is the only parameter that matters; the gateway's own
 * parameters are forwarded to the platform untouched.
 */
export default class FalakPaymentStatus extends FalakElement {
    static observedAttributes = ['thank-you-url', 'checkout-url', 'order-url'];

    /** Pending re-checks: every 5 s, six times, then the shopper decides. */
    static POLL_INTERVAL_MS = 5000;
    static POLL_ATTEMPTS = 6;
    static SUCCESS_REDIRECT_MS = 1800;

    get thankYouUrl() { return this.attr('thank-you-url', '/thank-you/{order}'); }
    get checkoutUrl() { return this.attr('checkout-url', '/checkout'); }
    get orderUrl() { return this.attr('order-url', '/customer/orders/{order}'); }
    get homeUrl() { return this.sdk.config.get('store.url', '/') || '/'; }

    url(template) {
        return template.replace('{order}', encodeURIComponent(this._order?.number || this._number || ''));
    }

    render() {
        this.classList.add('f-payment-status');

        const state = this._state || 'verifying';
        const views = {
            verifying: () => this.verifyingHtml(),
            success: () => this.successHtml(),
            pending: () => this.pendingHtml(false),
            failed: () => this.pendingHtml(true),
            error: () => this.errorHtml(),
        };

        this.setAttribute('data-state', state);
        this.innerHTML = (views[state] || views.verifying)();
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-check]')) this.verify(true);
            if (event.target.closest('[data-retry]')) this.retry();
            if (event.target.closest('[data-login]')) this.sdk.auth.requireLoginThen(() => this.verify(true));
        });

        this._offIn = this.sdk.event.on('auth::logged.in', () => { if (this._state === 'error') this.verify(true); });

        this.verify();
    }

    disconnectedCallback() {
        this.stopPolling();
        if (typeof this._offIn === 'function') this._offIn();
        closeDialog(this);
        super.disconnectedCallback();
    }

    /* ------------------------------------------------------------- pieces */

    pill(number, dark = false) {
        return `<span class="f-payment-status__pill ${dark ? 'is-dark' : ''}"><span class="f-payment-status__pill-label">${this.escape(this.trans('checkout.order_number'))}</span><b dir="ltr">#${this.escape(number)}</b></span>`;
    }

    verifyingHtml() {
        return `
            <div class="f-payment-status__box f-payment-status__box--card">
                <span class="f-payment-status__spinner" aria-hidden="true"></span>
                <h1 class="f-payment-status__title">${this.escape(this.trans('checkout.verifying_payment'))}</h1>
                <p class="f-payment-status__text">${this.escape(this.trans('checkout.verifying_hint'))}</p>
                ${this._number ? this.pill(this._number) : ''}
            </div>`;
    }

    successHtml() {
        const order = this._order;
        return `
            <div class="f-payment-status__box f-payment-status__box--card is-success" role="status">
                <span class="f-payment-status__icon" aria-hidden="true">${FalakOrderSummary.icon('check-circle')}</span>
                <h1 class="f-payment-status__title">${this.escape(this.trans('checkout.payment_success'))}</h1>
                <p class="f-payment-status__text">${this.escape(this.trans('checkout.payment_success_hint'))}</p>
                ${order?.number ? this.pill(order.number) : ''}
                <div class="f-payment-status__actions">
                    <a class="f-btn f-btn--primary" href="${this.escape(this.url(this.thankYouUrl))}">${this.escape(this.trans('common.continue'))}</a>
                </div>
            </div>`;
    }

    pendingHtml(failed) {
        const order = this._order;
        const polling = !failed && this._polls > 0 && this._polls <= FalakPaymentStatus.POLL_ATTEMPTS;

        return `
            <div class="f-payment-status__stack">
                <div class="f-payment-status__box f-payment-status__box--card ${failed ? 'is-failed' : 'is-pending'}" role="status">
                    <span class="f-payment-status__icon" aria-hidden="true">${FalakOrderSummary.icon(failed ? 'x-circle' : 'clock')}</span>
                    <h1 class="f-payment-status__title">${this.escape(this.trans(failed ? 'checkout.payment_failed' : 'checkout.payment_pending'))}</h1>
                    <p class="f-payment-status__text">${this.escape(this._message || this.trans(failed ? 'checkout.payment_failed_hint' : 'checkout.payment_pending_hint'))}</p>
                    ${order?.number ? this.pill(order.number, true) : ''}
                    ${polling ? `<p class="f-payment-status__polling"><span class="f-payment-status__spinner f-payment-status__spinner--sm" aria-hidden="true"></span>${this.escape(this.trans('checkout.payment_checking'))}</p>` : ''}
                </div>

                ${order?.items?.length ? `
                    <section class="f-payment-status__card">
                        <h2 class="f-payment-status__card-title">${FalakOrderSummary.icon('box')} ${this.escape(this.trans('checkout.your_items'))}</h2>
                        <ul class="f-payment-status__items">
                            ${order.items.map(item => `
                                <li class="f-payment-status__item">
                                    <span class="f-payment-status__thumb">
                                        ${item.image ? `<img src="${this.escape(item.image)}" alt="" loading="lazy">` : FalakOrderSummary.icon('box')}
                                        <b class="f-payment-status__qty">${this.escape(String(item.quantity))}</b>
                                    </span>
                                    <span class="f-payment-status__item-name">${this.escape(item.name)}</span>
                                    <span class="f-payment-status__item-total">${this.escape(this.money(item.total))}</span>
                                </li>`).join('')}
                        </ul>
                        <div class="f-payment-status__total">
                            <span>${this.escape(this.trans('cart.total'))}</span>
                            <strong>${this.escape(this.money(order.total))}</strong>
                        </div>
                        ${order.address?.name || order.address?.address ? `
                            <p class="f-payment-status__address">
                                ${FalakOrderSummary.icon('pin')}
                                ${[order.address.name, order.address.address, [order.address.city, order.address.country].filter(Boolean).join(', ')].filter(Boolean).map(part => `<span>${this.escape(part)}</span>`).join('')}
                            </p>` : ''}
                    </section>` : ''}

                <div class="f-payment-status__actions f-payment-status__actions--stacked">
                    ${failed && this._canRetry
                        ? `<button type="button" class="f-btn f-btn--primary f-btn--wide" data-retry>${FalakOrderSummary.icon('card')} ${this.escape(this.trans('account.retry_payment'))}</button>`
                        : ''}
                    ${order?.number
                        ? `<a class="f-btn ${failed && this._canRetry ? 'f-btn--primary-outline' : 'f-btn--primary'} f-btn--wide" href="${this.escape(this.url(this.orderUrl))}">${this.escape(this.trans(failed ? 'account.view_order' : 'checkout.view_order_and_pay'))}</a>`
                        : ''}
                    <button type="button" class="f-btn f-btn--light-outline f-btn--wide" data-check>${this.escape(this.trans('checkout.check_status'))}</button>
                    <a class="f-btn f-btn--light-link f-btn--wide" href="${this.escape(this.homeUrl)}">${this.escape(this.trans('checkout.continue_shopping'))}</a>
                </div>
            </div>`;
    }

    errorHtml() {
        const guest = !this.sdk.auth.isLoggedIn();
        return `
            <div class="f-payment-status__stack">
                <div class="f-payment-status__box f-payment-status__box--card is-failed" role="alert">
                    <span class="f-payment-status__icon" aria-hidden="true">${FalakOrderSummary.icon(guest ? 'lock' : 'return')}</span>
                    <h1 class="f-payment-status__title">${this.escape(this.trans(guest ? 'account.order_sign_in' : 'checkout.payment_error'))}</h1>
                    <p class="f-payment-status__text">${this.escape(this._message || this.trans('checkout.payment_error_hint'))}</p>
                    ${this._number ? this.pill(this._number, true) : ''}
                </div>
                <div class="f-payment-status__actions f-payment-status__actions--stacked">
                    ${guest
                        ? `<button type="button" class="f-btn f-btn--primary f-btn--wide" data-login>${this.escape(this.trans('auth.sign_in'))}</button>`
                        : `<button type="button" class="f-btn f-btn--primary f-btn--wide" data-check>${FalakOrderSummary.icon('return')} ${this.escape(this.trans('checkout.try_again'))}</button>`}
                    ${this._number ? `<a class="f-btn f-btn--primary-outline f-btn--wide" href="${this.escape(this.url(this.orderUrl))}">${this.escape(this.trans('account.view_order'))}</a>` : ''}
                    <a class="f-btn f-btn--light-link f-btn--wide" href="${this.escape(this.homeUrl)}">${this.escape(this.trans('common.back_home'))}</a>
                </div>
            </div>`;
    }

    /* ------------------------------------------------------------ actions */

    /** Pay the SAME order again — the cart was spent placing it. */
    retry() {
        if (!this._order?.number) return;
        openPayDialog(this, this._order, { isFailed: true, onPaid: () => this.verify(true) });
    }

    async verify(manual = false) {
        const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
        this._number = params.order_number || params.order || '';

        if (!this._number) {
            this._state = 'error';
            this._message = this.trans('checkout.order_not_found');
            this.render();
            return;
        }

        if (manual) {
            this.stopPolling();
            this._state = 'verifying';
            this.render();
        }

        if (!this.sdk.auth.isLoggedIn()) {
            this._state = 'error';
            this._message = '';
            this.render();
            return;
        }

        let response;
        try {
            response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.paymentStatus(this._number, params));
        } catch (error) {
            const payload = error?.falak?.payload;
            const status = String(payload?.status || payload?.payment_status || '').toLowerCase();

            // A 400 "declined or cancelled" is a verdict, not a failure to get one.
            if (payload && ['failed', 'declined', 'cancelled'].includes(status)) {
                response = { ...payload, status: 'failed' };
            } else {
                this._state = 'error';
                this._message = error?.falak?.status === 404 ? this.trans('checkout.order_not_found') : (error?.message || '');
                this.render();
                return;
            }
        }

        const status = String(response?.status || response?.payment_status || '').toLowerCase();
        const payStatus = String(response?.payment_status || '').toLowerCase();
        const isPaid = ['success', 'paid', 'completed'].includes(status) || ['paid', 'completed'].includes(payStatus);
        const isFailed = ['failed', 'declined', 'cancelled'].includes(status) || payStatus === 'failed';

        this._order = FalakOrderSummary.normalize(response?.order || null, response);
        this._message = isPaid ? '' : (this.sdk.api.localised?.(response?.['message-lang']) || '');
        const method = String(this._order?.payment_method || '').toLowerCase();
        this._canRetry = !!this._order?.number && !FalakOrderSummary.NON_GATEWAY_METHODS.includes(method);

        this._state = isPaid ? 'success' : isFailed ? 'failed' : 'pending';
        this.emitBus('checkout::payment.verified', { orderNumber: this._number, success: isPaid, status: this._state });
        this.render();

        if (isPaid) {
            this.stopPolling();
            // The order spent the cart; the header's count follows.
            this.sdk.cart.fetch?.().catch?.(() => {});
            window.setTimeout(() => window.location.assign(this.url(this.thankYouUrl)), FalakPaymentStatus.SUCCESS_REDIRECT_MS);
            return;
        }

        if (this._state === 'pending') this.schedulePoll();
        else this.stopPolling();
    }

    /** A late webhook usually lands within seconds; look a few times, then stop. */
    schedulePoll() {
        this._polls = (this._polls || 0) + 1;
        if (this._polls > FalakPaymentStatus.POLL_ATTEMPTS) { this._polls = 0; this.render(); return; }

        this._pollTimer = window.setTimeout(() => this.verify(), FalakPaymentStatus.POLL_INTERVAL_MS);
    }

    stopPolling() {
        if (this._pollTimer) window.clearTimeout(this._pollTimer);
        this._pollTimer = null;
        this._polls = 0;
    }
}
