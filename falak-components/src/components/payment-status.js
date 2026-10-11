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
 * Every state is drawn as the same page: a hero that says where the payment
 * stands, a three-step strip (placed → payment → confirmed) so the shopper
 * sees how far along they are, the order number ready to copy, and — once
 * the order is known — the items with their totals beside the payment,
 * delivery and "what happens next" cards.
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
        this.innerHTML = `<div class="f-payment-status__shell">${(views[state] || views.verifying)()}</div>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-check]')) this.verify(true);
            if (event.target.closest('[data-retry]')) this.retry();
            if (event.target.closest('[data-login]')) this.sdk.auth.requireLoginThen(() => this.verify(true));
            const copy = event.target.closest('[data-copy]');
            if (copy) this.copyNumber(copy);
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

    /* ------------------------------------------------------------ helpers */

    isArabic() {
        return (document.documentElement.lang || '').toLowerCase().startsWith('ar');
    }

    /** trans() hands back the key when a theme lacks the string; fall back then. */
    label(key, fallback = '') {
        const value = this.trans(key);
        return value && value !== key ? value : fallback;
    }

    /** A plain string, or one side of a { en, ar } pair the API left localized. */
    localized(value) {
        if (value === null || value === undefined) return '';
        if (typeof value !== 'object') return String(value);
        const lang = this.isArabic() ? 'ar' : 'en';
        return String(value[lang] || value.en || value.ar || Object.values(value).find(Boolean) || '');
    }

    formatDate(value) {
        if (!value) return '';
        const date = new Date(String(value).replace(' ', 'T'));
        if (Number.isNaN(date.getTime())) return String(value);

        try {
            return date.toLocaleDateString(this.isArabic() ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (error) {
            return date.toISOString().slice(0, 10);
        }
    }

    methodName(order) {
        const name = this.localized(order?.payment_method_name) || order?.payment_method || '';
        if (!name) return '';
        return this.label(`account.payment_method.${String(order.payment_method || '').toLowerCase()}`, FalakOrderSummary.titleCase(name));
    }

    async copyNumber(button) {
        const number = this._order?.number || this._number || '';
        if (!number) return;

        try {
            await navigator.clipboard.writeText(number);
        } catch (error) {
            return;
        }

        const label = button.querySelector('.f-payment-status__pill-label');
        if (!label) return;

        const was = label.textContent;
        label.textContent = this.trans('thank_you.copied');
        button.classList.add('is-copied');
        window.clearTimeout(this._copyTimer);
        this._copyTimer = window.setTimeout(() => { label.textContent = was; button.classList.remove('is-copied'); }, 1600);
    }

    /* ------------------------------------------------------------- pieces */

    /** The order number, as a button that copies it. */
    pill(number) {
        if (!number) return '';
        return `
            <button type="button" class="f-payment-status__pill" data-copy title="${this.escape(this.trans('thank_you.copy_number'))}">
                <span class="f-payment-status__pill-label">${this.escape(this.trans('checkout.order_number'))}</span>
                <b dir="ltr">#${this.escape(number)}</b>
                <span class="f-payment-status__pill-copy" aria-hidden="true">${FalakOrderSummary.icon('file')}</span>
            </button>`;
    }

    /**
     * Order placed → Payment → Confirmed. `payment` is what the middle step
     * shows: 'current' (in progress), 'done', or 'failed'.
     */
    steps(payment) {
        const items = [
            { key: 'checkout.step_order_placed', state: 'done' },
            { key: 'checkout.payment_title', state: payment },
            { key: 'checkout.step_confirmed', state: payment === 'done' ? 'done' : 'todo' },
        ];
        const mark = state => state === 'done'
            ? FalakOrderSummary.icon('check')
            : state === 'failed' ? FalakOrderSummary.icon('x-circle') : '';

        return `
            <ol class="f-payment-status__steps" aria-label="${this.escape(this.trans('checkout.payment_status'))}">
                ${items.map((item, index) => `
                    <li class="f-payment-status__step is-${item.state}">
                        <span class="f-payment-status__step-dot" aria-hidden="true">${mark(item.state) || `<i>${index + 1}</i>`}</span>
                        <span class="f-payment-status__step-label">${this.escape(this.trans(item.key))}</span>
                    </li>`).join('')}
            </ol>`;
    }

    /** Total, method and date under the title, when the order is known. */
    meta(order) {
        if (!order) return '';
        const method = this.methodName(order);
        const placed = this.formatDate(order.created_at);
        const cells = [
            order.total !== null && order.total !== undefined ? [this.trans('checkout.total'), this.money(order.total)] : null,
            method ? [this.trans('checkout.payment_method'), method] : null,
            placed ? [this.trans('checkout.placed_on'), placed] : null,
        ].filter(Boolean);

        if (!cells.length) return '';

        return `
            <dl class="f-payment-status__meta">
                ${cells.map(([term, value]) => `<div class="f-payment-status__meta-item"><dt>${this.escape(term)}</dt><dd>${this.escape(value)}</dd></div>`).join('')}
            </dl>`;
    }

    hero({ tone, icon, title, text, steps, number, extra = '', role = 'status' }) {
        return `
            <section class="f-payment-status__hero is-${tone}" role="${role}">
                <span class="f-payment-status__icon" aria-hidden="true">${icon}</span>
                <p class="f-payment-status__eyebrow">${this.escape(this.trans('checkout.payment_status'))}</p>
                <h1 class="f-payment-status__title">${this.escape(title)}</h1>
                ${text ? `<p class="f-payment-status__text">${this.escape(text)}</p>` : ''}
                ${steps || ''}
                ${this.pill(number)}
                ${extra}
            </section>`;
    }

    verifyingHtml() {
        return this.hero({
            tone: 'verifying',
            icon: '<span class="f-payment-status__spinner"></span>',
            title: this.trans('checkout.verifying_payment'),
            text: this.trans('checkout.verifying_hint'),
            steps: this.steps('current'),
            number: this._number,
        });
    }

    successHtml() {
        const order = this._order;
        return `
            ${this.hero({
                tone: 'success',
                icon: FalakOrderSummary.icon('check-circle'),
                title: this.trans('checkout.payment_success'),
                text: this.trans('checkout.payment_success_hint'),
                steps: this.steps('done'),
                number: order?.number,
                extra: `
                    ${this.meta(order)}
                    <p class="f-payment-status__redirect">
                        <span class="f-payment-status__spinner f-payment-status__spinner--sm" aria-hidden="true"></span>
                        ${this.escape(this.trans('checkout.redirecting_thank_you'))}
                    </p>
                    <span class="f-payment-status__progress" aria-hidden="true"><i></i></span>`,
            })}
            <div class="f-payment-status__actions">
                <a class="f-btn f-btn--primary" href="${this.escape(this.url(this.thankYouUrl))}">${this.escape(this.trans('common.continue'))}</a>
            </div>`;
    }

    pendingHtml(failed) {
        const order = this._order;
        const polling = !failed && this._polls > 0 && this._polls <= FalakPaymentStatus.POLL_ATTEMPTS;

        const pollingHtml = polling ? `
            <p class="f-payment-status__polling">
                <span class="f-payment-status__spinner f-payment-status__spinner--sm" aria-hidden="true"></span>
                <span>${this.escape(this.trans('checkout.payment_checking'))}</span>
                <span class="f-payment-status__polling-count">${this.escape(this.trans('checkout.poll_attempt', { n: this._polls, total: FalakPaymentStatus.POLL_ATTEMPTS }))}</span>
            </p>` : '';

        return `
            ${this.hero({
                tone: failed ? 'failed' : 'pending',
                icon: FalakOrderSummary.icon(failed ? 'x-circle' : 'clock'),
                title: this.trans(failed ? 'checkout.payment_failed' : 'checkout.payment_pending'),
                text: this._message || this.trans(failed ? 'checkout.payment_failed_hint' : 'checkout.payment_pending_hint'),
                steps: this.steps(failed ? 'failed' : 'current'),
                number: order?.number,
                extra: `${this.meta(order)}${pollingHtml}`,
            })}

            ${order ? `
                <div class="f-payment-status__grid">
                    ${this.itemsCard(order)}
                    <div class="f-payment-status__side">
                        ${this.paymentCard(order, failed)}
                        ${this.deliveryCard(order)}
                        ${this.nextCard(failed)}
                    </div>
                </div>` : ''}

            <div class="f-payment-status__actions">
                ${failed && this._canRetry
                    ? `<button type="button" class="f-btn f-btn--primary" data-retry>${FalakOrderSummary.icon('card')} ${this.escape(this.trans('account.retry_payment'))}</button>`
                    : ''}
                ${order?.number
                    ? `<a class="f-btn ${failed && this._canRetry ? 'f-btn--primary-outline' : 'f-btn--primary'}" href="${this.escape(this.url(this.orderUrl))}">${this.escape(this.trans(failed ? 'account.view_order' : 'checkout.view_order_and_pay'))}</a>`
                    : ''}
                <button type="button" class="f-btn f-btn--light-outline" data-check>${FalakOrderSummary.icon('return')} ${this.escape(this.trans('checkout.check_status'))}</button>
                <a class="f-btn f-btn--light-link" href="${this.escape(this.homeUrl)}">${this.escape(this.trans('checkout.continue_shopping'))}</a>
            </div>`;
    }

    errorHtml() {
        const guest = !this.sdk.auth.isLoggedIn();
        return `
            ${this.hero({
                tone: 'failed',
                role: 'alert',
                icon: FalakOrderSummary.icon(guest ? 'lock' : 'warning'),
                title: this.trans(guest ? 'account.order_sign_in' : 'checkout.payment_error'),
                text: this._message || this.trans('checkout.payment_error_hint'),
                number: this._number,
            })}
            <div class="f-payment-status__actions">
                ${guest
                    ? `<button type="button" class="f-btn f-btn--primary" data-login>${FalakOrderSummary.icon('lock')} ${this.escape(this.trans('auth.sign_in'))}</button>`
                    : `<button type="button" class="f-btn f-btn--primary" data-check>${FalakOrderSummary.icon('return')} ${this.escape(this.trans('checkout.try_again'))}</button>`}
                ${this._number ? `<a class="f-btn f-btn--primary-outline" href="${this.escape(this.url(this.orderUrl))}">${this.escape(this.trans('account.view_order'))}</a>` : ''}
                <a class="f-btn f-btn--light-link" href="${this.escape(this.homeUrl)}">${this.escape(this.trans('common.back_home'))}</a>
            </div>`;
    }

    /* -------------------------------------------------------------- cards */

    itemsCard(order) {
        const items = order.items || [];
        const count = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
        const rows = [
            ['checkout.subtotal', order.subtotal, 'cart.subtotal'],
            ['checkout.shipping', order.shipping],
            ['cart.discount', order.discount ? -Math.abs(Number(order.discount)) : null],
            ['checkout.tax', order.tax],
            ['checkout.cod_fee', order.cod_fee],
        ].filter(([, amount]) => amount !== null && amount !== undefined && Number(amount) !== 0);

        return `
            <section class="f-payment-status__card f-payment-status__card--items">
                <h2 class="f-payment-status__card-title">
                    ${FalakOrderSummary.icon('box')}
                    <span>${this.escape(this.trans('checkout.your_items'))}</span>
                    ${count ? `<small>${this.escape(this.trans('account.items_count', { count }))}</small>` : ''}
                </h2>
                ${items.length ? `
                    <ul class="f-payment-status__items">
                        ${items.map(item => `
                            <li class="f-payment-status__item">
                                <span class="f-payment-status__thumb">
                                    ${item.image ? `<img src="${this.escape(item.image)}" alt="" loading="lazy">` : FalakOrderSummary.icon('box')}
                                    <b class="f-payment-status__qty">${this.escape(String(item.quantity))}</b>
                                </span>
                                <span class="f-payment-status__item-body">
                                    <span class="f-payment-status__item-name">${this.escape(item.name)}</span>
                                    ${Number(item.quantity) > 1 && item.price !== null && item.price !== undefined
                                        ? `<span class="f-payment-status__item-each">${this.escape(String(item.quantity))} × ${this.escape(this.money(item.price))}</span>`
                                        : ''}
                                </span>
                                <span class="f-payment-status__item-total">${this.escape(this.money(item.total))}</span>
                            </li>`).join('')}
                    </ul>` : ''}
                <dl class="f-payment-status__totals">
                    ${rows.map(([key, amount, alt]) => `
                        <div class="f-payment-status__totals-row">
                            <dt>${this.escape(this.label(key, alt ? this.trans(alt) : key))}</dt>
                            <dd>${this.escape(this.money(amount))}</dd>
                        </div>`).join('')}
                    <div class="f-payment-status__totals-row f-payment-status__totals-row--grand">
                        <dt>${this.escape(this.trans('checkout.total'))}</dt>
                        <dd>${this.escape(this.money(order.total))}</dd>
                    </div>
                </dl>
            </section>`;
    }

    paymentCard(order, failed) {
        const method = this.methodName(order);
        // A declined attempt is what this page knows; the order row still says pending.
        const status = failed ? 'failed' : String(order.payment_status || 'pending').toLowerCase();
        const statusLabel = this.label(`account.payment_status.${status}`, FalakOrderSummary.titleCase(status));
        const charged = order.charged_amount && order.charged_currency && order.charged_currency !== order.currency
            ? this.trans('thank_you.charged', { amount: this.money(order.charged_amount, order.charged_currency) })
            : '';

        return `
            <section class="f-payment-status__card">
                <h2 class="f-payment-status__card-title">${FalakOrderSummary.icon('card')} <span>${this.escape(this.trans('checkout.payment_title'))}</span></h2>
                <dl class="f-payment-status__facts">
                    ${method ? `<div><dt>${this.escape(this.trans('checkout.payment_method'))}</dt><dd>${this.escape(method)}</dd></div>` : ''}
                    <div><dt>${this.escape(this.trans('checkout.payment_status'))}</dt><dd><span class="f-payment-status__badge is-${this.escape(failed ? 'failed' : status)}">${this.escape(statusLabel)}</span></dd></div>
                    <div><dt>${this.escape(this.trans('checkout.total_to_pay'))}</dt><dd><strong>${this.escape(this.money(order.total))}</strong></dd></div>
                </dl>
                ${charged ? `<p class="f-payment-status__note">${this.escape(charged)}</p>` : ''}
            </section>`;
    }

    /** Where it ships — nothing at all for an order with nothing to ship. */
    deliveryCard(order) {
        const address = order.address;
        if (!address || address.type === 'digital_order') return '';

        const lines = [
            address.name,
            address.address || address.street || address.line1,
            [address.district, address.city, address.region, address.country].filter(Boolean).join(', '),
            address.phone,
        ].filter(Boolean);

        if (!lines.length) return '';

        return `
            <section class="f-payment-status__card">
                <h2 class="f-payment-status__card-title">${FalakOrderSummary.icon('pin')} <span>${this.escape(this.trans('checkout.deliver_to'))}</span></h2>
                <address class="f-payment-status__address">
                    ${lines.map((line, index) => `<span class="${index === 0 ? 'f-payment-status__address-name' : ''}">${this.escape(line)}</span>`).join('')}
                </address>
            </section>`;
    }

    nextCard(failed) {
        const prefix = failed ? 'checkout.payment_failed_next_' : 'checkout.payment_pending_next_';
        const points = [1, 2, 3].map(n => this.label(`${prefix}${n}`)).filter(Boolean);
        if (!points.length) return '';

        return `
            <section class="f-payment-status__card f-payment-status__card--next">
                <h2 class="f-payment-status__card-title">${FalakOrderSummary.icon('route')} <span>${this.escape(this.trans('thank_you.what_next'))}</span></h2>
                <ol class="f-payment-status__next">
                    ${points.map(point => `<li>${this.escape(point)}</li>`).join('')}
                </ol>
            </section>`;
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
