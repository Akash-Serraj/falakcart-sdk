import FalakElement from '../base.js';
import { openDialog, closeDialog, dialogBody, setDialogError, setDialogBusy, openPayDialog } from './concerns/pay-dialog.js';

/**
 * <falak-order-summary order-number="ORD-1001"></falak-order-summary>
 * <falak-order-summary order='{"number":"ORD-1001", ...}' compact hide-timeline></falak-order-summary>
 *
 * One order, laid out — the customer's order page. The header with the status
 * and payment pills and the invoice; a payment banner while the order is
 * unpaid; the progress stepper; the products with their tags and per-product
 * rating; digital downloads; the review the customer left; the payment
 * details and totals; and a sidebar with the shipping address, the carrier
 * tracking (locked until paid), the actions (pay, return, rate, cancel,
 * confirm delivery) and the order info.
 *
 * Two sources, used together when both are present:
 *   - `order` — the server-rendered order (the storefront's page data),
 *     shown at once so nothing waits for a request;
 *   - `order-number` — fetched through falak.checkout.orderDetails() for
 *     the customer who owns it, which adds the timeline, the live status
 *     and everything the actions need. Guests with only a number are asked
 *     to sign in.
 *
 * Whatever markup the theme puts inside is shown until the first render,
 * so the page is complete even before the script runs.
 *
 * | attribute      | role                                                  |
 * | order-number   | fetch this order (customer must be signed in)         |
 * | order          | JSON: the order as the page already has it            |
 * | compact        | items + totals only (thank-you page)                  |
 * | hide-items | hide-timeline | hide-address | hide-totals | hide-header |
 * | hide-actions | hide-downloads | hide-tracking | hide-info | hide-invoice |
 *
 * Events: DOM `loaded` (detail: order) on the element; bus
 * `order::updated` after an action changed the order (cancel, review, …).
 */
export default class FalakOrderSummary extends FalakElement {
    static observedAttributes = ['order-number', 'order', 'compact', 'hide-items', 'hide-timeline', 'hide-address', 'hide-totals', 'hide-header'];

    static NON_GATEWAY_METHODS = ['cash_on_delivery', 'cod', 'bank_transfer'];
    static REVIEWABLE_STATUSES = ['delivered', 'waiting_for_review', 'completed'];
    static SHIPPED_STATUSES = ['shipped', 'out_for_delivery', 'delivered', 'completed', 'waiting_for_review'];
    static RETURN_REASONS = ['defective', 'wrong_item', 'changed_mind', 'other'];

    get orderNumber() { return this.attr('order-number', '') || this._order?.number || ''; }
    get compact() { return this.boolAttr('compact'); }

    hides(section) {
        if (this.boolAttr(`hide-${section}`)) return true;

        return this.compact && ['header', 'banner', 'timeline', 'address', 'payment', 'actions', 'downloads', 'tracking', 'info', 'invoice', 'review'].includes(section);
    }

    /* ------------------------------------------------------------- flags */

    flags(order) {
        const pay = String(order.payment_status || '').toLowerCase();
        const status = String(order.status || '').toLowerCase();
        const method = String(order.payment_method || '').toLowerCase();

        const isPaid = pay === 'paid' || pay === 'completed';
        const isPayPending = pay === 'pending';
        const isPayFailed = pay === 'failed';
        const isCancelled = status === 'cancelled';
        const isNonGateway = FalakOrderSummary.NON_GATEWAY_METHODS.includes(method);
        const trackingNumber = order.shipment?.tracking_number || order.tracking_number || '';

        return {
            isPaid,
            isPayPending,
            isPayFailed,
            isCancelled,
            isNonGateway,
            isShipped: FalakOrderSummary.SHIPPED_STATUSES.includes(status),
            showProgress: isPaid && !isCancelled,
            showTracking: isPaid && !!trackingNumber,
            trackingNumber,
            canRetryPay: !isNonGateway && !isCancelled && (status === 'awaiting_payment' || isPayPending || isPayFailed),
            hasReturnableItems: (order.items || []).some(item => item.is_returnable !== false && !['digital', 'voucher'].includes(String(item.product_type || '').toLowerCase())),
            hasSubmittedReview: !!order.reviewed_at && (order.review_rating != null || !!order.review_comment),
            isReviewable: FalakOrderSummary.REVIEWABLE_STATUSES.includes(status),
            canCancel: order.can_cancel === true,
            canConfirmDelivery: status === 'out_for_delivery',
            returnRequest: (order.return_requests || [])[0] || null,
        };
    }

    /* ------------------------------------------------------------ render */

    render() {
        this.classList.add('f-order');

        if (!this._order) {
            const given = this.jsonAttr('order');
            if (given) this._order = FalakOrderSummary.normalize(given);
        }

        const order = this._order;

        if (!order) {
            if (this.attr('order-number') && !this.sdk.auth.isLoggedIn()) {
                this.innerHTML = `
                    <div class="f-order__guest">
                        <p>${this.escape(this.trans('account.order_sign_in'))}</p>
                        <button type="button" class="f-btn f-btn--primary" data-order-login>${this.escape(this.trans('auth.sign_in'))}</button>
                    </div>`;
            } else if (this._failed) {
                this.innerHTML = `<p class="f-order__empty">${this.escape(this.trans('account.order_not_found'))}</p>`;
            } else if (!this._keepInitial) {
                this.innerHTML = `
                    <div class="f-order__skeleton" aria-busy="true">
                        <falak-skeleton width="40%" height="1.4rem"></falak-skeleton>
                        <falak-skeleton shape="text" lines="2"></falak-skeleton>
                        <falak-skeleton height="4.5rem"></falak-skeleton>
                    </div>`;
            }
            return;
        }

        this._keepInitial = false;

        if (this.compact) {
            const parts = [];
            if (!this.hides('items') && order.items?.length) parts.push(this.itemsHtml(order));
            if (!this.hides('totals')) parts.push(this.totalsHtml(order));
            this.innerHTML = parts.join('');
            return;
        }

        const f = this.flags(order);
        const main = [];
        const side = [];

        if (!this.hides('items') && order.items?.length) main.push(this.productsHtml(order, f));
        if (!this.hides('downloads') && f.isPaid && this._downloads?.length) main.push(this.downloadsHtml(order));
        if (!this.hides('review') && f.hasSubmittedReview) main.push(this.reviewHtml(order));
        if (!this.hides('payment') || !this.hides('totals')) main.push(this.paymentHtml(order, f));

        if (!this.hides('address')) side.push(this.addressHtml(order));
        if (!this.hides('tracking')) side.push(this.trackingHtml(order, f));
        if (!this.hides('actions')) side.push(this.actionsHtml(order, f));
        if (!this.hides('info')) side.push(this.infoHtml(order, f));

        this.innerHTML = `
            ${this.hides('banner') ? '' : this.bannerHtml(order, f)}
            ${this.hides('header') ? '' : this.headerHtml(order, f)}
            ${this.hides('timeline') ? '' : this.progressHtml(order, f)}
            <div class="f-order__grid">
                <div class="f-order__main">${main.join('')}</div>
                <aside class="f-order__side">${side.filter(Boolean).join('')}</aside>
            </div>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => this.onClick(event));

        this._offIn = this.sdk.event.on('auth::logged.in', () => this.load());

        if (this.attr('order-number') && this.sdk.auth.isLoggedIn()) this.load();
    }

    connectedCallback() {
        // Show the theme's server-rendered markup until we have something better.
        this._keepInitial = this.innerHTML.trim().length > 0 && !this.jsonAttr('order');
        super.connectedCallback();
    }

    disconnectedCallback() {
        if (typeof this._offIn === 'function') this._offIn();
        this.closeDialog();
        super.disconnectedCallback();
    }

    /* -------------------------------------------------------------- data */

    async load() {
        const number = this.attr('order-number');
        if (!number || !this.sdk.auth.isLoggedIn()) return;

        try {
            const details = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.orderDetails(number));
            const fresh = FalakOrderSummary.normalize(details?.order || details, details);

            this._order = { ...(this._order || {}), ...fresh, items: fresh.items?.length ? fresh.items : (this._order?.items || []) };
            this._failed = false;
            this.render();
            this.emit('loaded', { order: this._order });

            await this.loadExtras();
        } catch (error) {
            if (!this._order) {
                this._failed = true;
                this.render();
            }
        }
    }

    /**
     * The pieces that have their own endpoints: the digital files once the
     * order is paid, and what may still be rated once it is delivered. Each
     * is silent and optional — the page is complete without them.
     */
    async loadExtras() {
        const order = this._order;
        if (!order || this.compact) return;

        const f = this.flags(order);
        const jobs = [];

        if (f.isPaid && !this.hides('downloads')) {
            jobs.push(this.sdk.api.withoutNotifier(() => this.sdk.checkout.downloads(order.number))
                .then(response => { this._downloads = Array.isArray(response?.downloads) ? response.downloads : []; })
                .catch(() => { this._downloads = []; }));
        }

        if (f.isReviewable) {
            jobs.push(this.sdk.api.withoutNotifier(() => this.sdk.review.reviewableItems(order.number))
                .then(response => { this._reviewable = response && typeof response === 'object' ? response : null; })
                .catch(() => { this._reviewable = null; }));
        }

        if (!jobs.length) return;

        await Promise.all(jobs);
        this.render();
    }

    /* ------------------------------------------------------------ pieces */

    bannerHtml(order, f) {
        if (f.isCancelled) {
            return `
                <div class="f-order__banner f-order__banner--muted" role="status">
                    <span class="f-order__banner-icon" aria-hidden="true">${FalakOrderSummary.icon('x-circle')}</span>
                    <p class="f-order__banner-text">
                        <strong>${this.escape(this.label('account.status.cancelled', 'Cancelled'))}</strong>
                        ${order.cancellation_reason ? `<span>${this.escape(this.trans('account.cancellation_reason'))}: ${this.escape(order.cancellation_reason)}</span>` : ''}
                    </p>
                </div>`;
        }

        if (f.isPayFailed) {
            return `
                <div class="f-order__banner f-order__banner--danger" role="alert">
                    <span class="f-order__banner-icon" aria-hidden="true">${FalakOrderSummary.icon('x-circle')}</span>
                    <p class="f-order__banner-text">
                        <strong>${this.escape(this.trans('account.payment_failed_title'))}</strong>
                        <span>${this.escape(this.trans('account.payment_failed_hint'))}</span>
                    </p>
                    ${f.canRetryPay ? `<button type="button" class="f-btn f-btn--primary f-order__banner-cta" data-order-pay>${this.escape(this.trans('account.retry_payment'))}</button>` : ''}
                </div>`;
        }

        if (f.isPayPending) {
            return `
                <div class="f-order__banner f-order__banner--warn" role="status">
                    <span class="f-order__banner-icon" aria-hidden="true">${FalakOrderSummary.icon('warning')}</span>
                    <p class="f-order__banner-text">
                        <strong>${this.escape(this.trans('account.payment_required'))}</strong>
                        <span>${this.escape(this.trans('account.payment_required_hint'))}</span>
                    </p>
                    ${f.canRetryPay ? `<button type="button" class="f-btn f-btn--primary f-order__banner-cta" data-order-pay>${this.escape(this.trans('account.pay_now'))}</button>` : ''}
                </div>`;
        }

        return '';
    }

    headerHtml(order, f) {
        const status = order.status || '';
        const pay = order.payment_status || '';
        const placed = order.created_at ? this.formatDate(order.created_at) : '';
        const name = order.address?.name || '';

        return `
            <header class="f-order__head f-order__card">
                <div class="f-order__head-main">
                    <h2 class="f-order__title"><span>${this.escape(this.trans('account.order'))}</span><span dir="ltr">-${this.escape(order.number || '')}</span></h2>
                    <div class="f-order__pills">
                        <span class="f-order__status f-order__status--${this.escape(status)}">${this.escape(this.label(`account.status.${status}`, status))}</span>
                        ${pay ? `<span class="f-order__pay-status f-order__pay-status--${this.escape(pay)}">${FalakOrderSummary.icon(f.isPaid ? 'check-circle' : f.isPayFailed ? 'x-circle' : 'clock')} ${this.escape(this.label(`account.payment_status.${pay}`, pay))}</span>` : ''}
                        ${f.isShipped && !f.isPaid ? `<span class="f-order__status f-order__status--locked">${FalakOrderSummary.icon('lock')} ${this.escape(this.trans('account.locked'))}</span>` : ''}
                    </div>
                    <p class="f-order__meta">
                        ${placed ? `<span>${this.escape(this.trans('account.order_placed'))} <time datetime="${this.escape(order.created_at)}">${this.escape(placed)}</time></span>` : ''}
                        ${name ? `<span class="f-order__meta-sep" aria-hidden="true">·</span><span>${this.escape(this.trans('account.ordered_by'))} <strong>${this.escape(name)}</strong></span>` : ''}
                    </p>
                </div>
                ${this.hides('invoice') ? '' : `
                    <button type="button" class="f-btn f-btn--primary f-order__invoice" data-order-invoice>
                        ${FalakOrderSummary.icon('download')} ${this.escape(this.trans('account.invoice'))}
                    </button>`}
            </header>`;
    }

    /** The stepper: every step the order walks, done / current / pending, with its date. */
    progressHtml(order, f) {
        if (f.isCancelled) return '';

        if (!f.showProgress) {
            return `
                <section class="f-order__card f-order__locked">
                    <span class="f-order__locked-icon" aria-hidden="true">${FalakOrderSummary.icon('lock')}</span>
                    <p class="f-order__locked-text">${this.escape(this.trans('account.progress_locked'))}</p>
                    ${f.canRetryPay ? `<button type="button" class="f-btn f-btn--primary" data-order-pay>${FalakOrderSummary.icon('card')} ${this.escape(this.trans(f.isPayFailed ? 'account.retry_payment' : 'account.complete_payment'))}</button>` : ''}
                </section>`;
        }

        const steps = order.timeline || [];
        if (!steps.length) return '';

        const ar = this.isArabic();
        const eta = order.estimated_delivery ? this.formatDate(order.estimated_delivery) : '';

        return `
            <section class="f-order__card f-order__progress">
                <div class="f-order__card-head">
                    <h3 class="f-order__card-title">${FalakOrderSummary.icon('route')} ${this.escape(this.trans('account.order_timeline'))}</h3>
                    ${eta ? `<span class="f-order__tag">${this.escape(this.trans('account.estimated_arrival'))}: ${this.escape(eta)}</span>` : ''}
                </div>
                <ol class="f-order__steps">
                    ${steps.map((step, index) => {
                        const done = step.status === 'completed';
                        const current = step.status === 'current';
                        const title = ar ? (step.event_ar || step.event) : step.event;
                        const text = ar ? (step.description_ar || step.description) : step.description;
                        return `<li class="f-order__step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}" ${text ? `title="${this.escape(text)}"` : ''}>
                            ${index < steps.length - 1 ? `<span class="f-order__step-line ${done ? 'is-done' : ''}" aria-hidden="true"></span>` : ''}
                            <span class="f-order__step-dot" aria-hidden="true">${done ? FalakOrderSummary.icon('check') : ''}</span>
                            <div class="f-order__step-body">
                                <strong class="f-order__step-title">${this.escape(title || '')}</strong>
                                ${step.date ? `<time class="f-order__step-date">${this.escape(this.formatDate(step.date))}</time>` : ''}
                                ${text ? `<span class="f-order__step-text">${this.escape(text)}</span>` : ''}
                            </div>
                        </li>`;
                    }).join('')}
                </ol>
            </section>`;
    }

    productsHtml(order, f) {
        const items = this._reviewable?.reviewable_items || [];
        const canReviewProducts = this._reviewable?.can_review_products === true;

        return `
            <section class="f-order__card f-order__products">
                <div class="f-order__card-head">
                    <h3 class="f-order__card-title">${FalakOrderSummary.icon('box')} ${this.escape(this.trans('account.products'))}</h3>
                    <span class="f-order__tag ${f.isPaid ? 'f-order__tag--success' : 'f-order__tag--warn'}">${FalakOrderSummary.icon(f.isPaid ? 'truck' : 'clock')} ${this.escape(this.trans(f.isPaid ? 'account.fulfilled' : 'account.unfulfilled'))}</span>
                </div>
                <ul class="f-order__items">
                    ${order.items.map(item => {
                        const reviewable = items.find(entry => String(entry.product_id) === String(item.product_id));
                        const type = String(item.product_type || '').toLowerCase();
                        return `
                        <li class="f-order__item">
                            ${item.image ? `<img class="f-order__item-image" src="${this.escape(item.image)}" alt="" loading="lazy">` : `<span class="f-order__item-image f-order__item-image--empty" aria-hidden="true">${FalakOrderSummary.icon('box')}</span>`}
                            <div class="f-order__item-info">
                                ${item.url ? `<a class="f-order__item-name" href="${this.escape(item.url)}">${this.escape(item.name)}</a>` : `<span class="f-order__item-name">${this.escape(item.name)}</span>`}
                                <span class="f-order__item-meta">${this.escape(this.trans('account.qty'))} ${this.escape(String(item.quantity))} &times; ${this.escape(this.money(item.price))}</span>
                                <span class="f-order__item-tags">
                                    ${type ? `<span class="f-order__tag f-order__tag--sm">${this.escape(this.label(`account.product_type.${type}`, type))}</span>` : ''}
                                    ${item.is_returnable === false ? `<span class="f-order__tag f-order__tag--sm f-order__tag--warn">${this.escape(this.trans('account.non_returnable'))}</span>` : ''}
                                </span>
                                ${this.productReviewHtml(item, reviewable, canReviewProducts)}
                            </div>
                            <span class="f-order__item-total">${this.escape(this.money(item.total))}</span>
                        </li>`;
                    }).join('')}
                </ul>
            </section>`;
    }

    /** Compact mode (thank-you page): the lines only, no card chrome. */
    itemsHtml(order) {
        return `
            <section class="f-order__section f-order__items-wrap">
                <ul class="f-order__items">
                    ${order.items.map(item => `
                        <li class="f-order__item">
                            ${item.image ? `<img class="f-order__item-image" src="${this.escape(item.image)}" alt="" loading="lazy">` : '<span class="f-order__item-image f-order__item-image--empty"></span>'}
                            <div class="f-order__item-info">
                                ${item.url ? `<a class="f-order__item-name" href="${this.escape(item.url)}">${this.escape(item.name)}</a>` : `<span class="f-order__item-name">${this.escape(item.name)}</span>`}
                                <span class="f-order__item-meta">${this.escape(String(item.quantity))} &times; ${this.escape(this.money(item.price))}</span>
                            </div>
                            <span class="f-order__item-total">${this.escape(this.money(item.total))}</span>
                        </li>`).join('')}
                </ul>
            </section>`;
    }

    productReviewHtml(item, reviewable, canReviewProducts) {
        if (!canReviewProducts || !reviewable) return '';

        if (reviewable.review) {
            return `
                <span class="f-order__item-reviewed">
                    <falak-rating-stars value="${this.escape(String(reviewable.review.rating || 0))}"></falak-rating-stars>
                    <span>${this.escape(this.trans('account.reviewed'))}</span>
                </span>`;
        }

        if (reviewable.can_review) {
            return `
                <button type="button" class="f-btn f-btn--primary f-btn--small f-order__item-rate"
                        data-order-rate-product="${this.escape(String(item.product_id))}" data-product-name="${this.escape(item.name)}">
                    ${FalakOrderSummary.icon('star')} ${this.escape(this.trans('account.rate_product'))}
                </button>`;
        }

        return '';
    }

    downloadsHtml(order) {
        return `
            <section class="f-order__card f-order__downloads">
                <div class="f-order__card-head">
                    <h3 class="f-order__card-title">${FalakOrderSummary.icon('download')} ${this.escape(this.trans('account.digital_downloads'))}</h3>
                </div>
                <ul class="f-order__files">
                    ${this._downloads.map(file => {
                        const meta = [this.fileSize(file.file_size)];
                        if (file.download_limit) meta.push(this.trans('account.downloads_left', { count: file.remaining_downloads ?? 0 }));
                        if (file.expires_at) meta.push(`${this.trans('account.expires')} ${this.formatDate(file.expires_at)}`);
                        const busy = this._downloading === String(file.file_id);
                        return `
                        <li class="f-order__file">
                            <span class="f-order__file-icon" aria-hidden="true">${FalakOrderSummary.icon('file')}</span>
                            <div class="f-order__file-info">
                                <span class="f-order__file-name">${this.escape(file.file_name || this.trans('account.file'))}</span>
                                <span class="f-order__file-meta">${this.escape(meta.filter(Boolean).join(' · '))}</span>
                                ${file.can_download ? '' : `<span class="f-order__file-meta f-order__file-meta--warn">${this.escape(this.trans('account.download_unavailable'))}</span>`}
                            </div>
                            <button type="button" class="f-btn f-btn--primary f-btn--small" data-order-download="${this.escape(String(file.file_id))}"
                                    data-file-name="${this.escape(file.file_name || '')}" ${!file.can_download || busy ? 'disabled' : ''}>
                                ${FalakOrderSummary.icon('download')} ${this.escape(this.trans(busy ? 'account.downloading' : 'account.download'))}
                            </button>
                        </li>`;
                    }).join('')}
                </ul>
            </section>`;
    }

    reviewHtml(order) {
        return `
            <section class="f-order__card f-order__review">
                <div class="f-order__card-head">
                    <h3 class="f-order__card-title">${FalakOrderSummary.icon('star')} ${this.escape(this.trans('account.your_review'))}</h3>
                    <falak-rating-stars value="${this.escape(String(order.review_rating || 0))}"></falak-rating-stars>
                </div>
                ${order.review_comment ? `<p class="f-order__review-text">${this.escape(order.review_comment)}</p>` : ''}
                ${order.review_reply ? `
                    <div class="f-order__review-reply">
                        <strong>${this.escape(this.trans('account.store_reply'))}</strong>
                        ${order.review_replied_at ? `<time>${this.escape(this.formatDate(order.review_replied_at))}</time>` : ''}
                        <p>${this.escape(order.review_reply)}</p>
                    </div>` : ''}
            </section>`;
    }

    paymentHtml(order, f) {
        const pay = order.payment_status || '';
        const payment = order.payment || {};
        const methodName = this.localized(order.payment_method_name) || order.payment_method || '';
        const method = methodName
            ? this.label(`account.payment_method.${String(order.payment_method || '').toLowerCase()}`, FalakOrderSummary.titleCase(methodName))
            : '';
        const reference = payment.gateway_reference || '';
        const currency = payment.currency || order.charged_currency || order.currency || '';

        const rows = [];
        if (!this.hides('payment') && method) {
            rows.push(`
                <div class="f-order__pay-row">
                    <span class="f-order__pay-row-icon" aria-hidden="true">${FalakOrderSummary.icon('card')}</span>
                    <span class="f-order__pay-row-body">
                        <span class="f-order__pay-row-label">${this.escape(this.trans('account.payment_method_label'))}</span>
                        <span class="f-order__pay-row-value">${this.escape(method)}</span>
                    </span>
                    ${reference ? `<code class="f-order__badge" dir="ltr" title="${this.escape(reference)}">${this.escape(FalakOrderSummary.truncate(reference, 18))}</code>` : ''}
                </div>`);
        }
        if (!this.hides('payment') && currency) {
            rows.push(`
                <div class="f-order__pay-row">
                    <span class="f-order__pay-row-icon" aria-hidden="true">${FalakOrderSummary.icon('globe')}</span>
                    <span class="f-order__pay-row-body">
                        <span class="f-order__pay-row-label">${this.escape(this.trans('account.currency'))}</span>
                        <span class="f-order__pay-row-value" dir="ltr">${this.escape(String(currency).toUpperCase())}</span>
                    </span>
                    ${payment.gateway ? `<span class="f-order__badge">${this.escape(String(payment.gateway).toUpperCase())}</span>` : ''}
                </div>`);
        }
        if (!this.hides('payment') && f.isPayFailed && f.canRetryPay) {
            rows.push(`
                <div class="f-order__pay-failed">
                    <span aria-hidden="true">${FalakOrderSummary.icon('x-circle')}</span>
                    <span>${this.escape(this.trans('account.last_payment_failed'))}</span>
                    <button type="button" class="f-btn f-btn--primary-outline f-btn--small" data-order-pay>${this.escape(this.trans('common.retry'))}</button>
                </div>`);
        }

        return `
            <section class="f-order__card f-order__payment">
                <div class="f-order__card-head">
                    <h3 class="f-order__card-title">${FalakOrderSummary.icon('card')} ${this.escape(this.trans('account.payment_details'))}</h3>
                    ${pay ? `<span class="f-order__pay-status f-order__pay-status--${this.escape(pay)}">${this.escape(this.label(`account.payment_status.${pay}`, pay))}</span>` : ''}
                </div>
                ${rows.length ? `<div class="f-order__pay-rows">${rows.join('')}</div>` : ''}
                ${this.hides('totals') ? '' : this.totalsHtml(order)}
            </section>`;
    }

    totalsHtml(order) {
        const row = (label, amount, mod = '', note = '') => `
            <div class="f-order__row ${mod}">
                <span>${this.escape(label)}${note ? `<small class="f-order__row-note">${this.escape(note)}</small>` : ''}</span>
                <span>${mod.includes('discount') ? '&minus; ' : ''}${this.escape(amount)}</span>
            </div>`;

        const count = (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || (order.items || []).length;
        const subtotalLabel = this.compact ? this.trans('cart.subtotal') : this.trans('account.items_count', { count });
        const carrier = order.shipment?.carrier || order.shipping_method || '';

        return `
            <section class="f-order__section f-order__totals">
                ${row(subtotalLabel, this.money(order.subtotal))}
                ${order.discount > 0 ? row(this.trans('cart.discount'), this.money(order.discount), 'f-order__row--discount') : ''}
                ${order.shipping > 0 || (!this.compact && order.shipping === 0 && carrier)
                    ? row(this.trans('account.shipping'), order.shipping > 0 ? this.money(order.shipping) : this.trans('account.free'), '', carrier ? `${this.trans('account.via')} ${String(carrier).toUpperCase()}` : '')
                    : ''}
                ${order.cod_fee > 0 ? row(this.trans('checkout.cod_fee'), this.money(order.cod_fee)) : ''}
                ${order.tax > 0 ? row(this.trans('checkout.tax'), this.money(order.tax)) : ''}
                ${row(this.trans('cart.total'), this.money(order.total), 'f-order__row--total')}
                ${this.chargedHtml(order)}
            </section>`;
    }

    /**
     * "Your payment provider charged 240.03 $" — the gateway's own currency
     * and amount, frozen on the order at checkout, when it differs from what
     * the shopper is reading now. Printed verbatim, never re-converted.
     */
    chargedHtml(order) {
        const charged = String(order.charged_currency || '').toUpperCase();
        const display = this.sdk.localization.currency;

        if (!charged || charged === display || !Number.isFinite(Number(order.charged_amount))) return '';

        const amount = this.sdk.money(order.charged_amount, charged, { convert: false });

        return `<p class="f-order__charged">${this.escape(this.trans('thank_you.charged', { amount }))}</p>`;
    }

    addressHtml(order) {
        const address = order.address || {};
        const line = [address.address, address.district].filter(Boolean).join(', ');
        const city = [address.city, address.country, address.postal_code].filter(Boolean).join(', ');

        if (!address.name && !line && !city && !address.phone) return '';

        return `
            <section class="f-order__card f-order__address">
                <h3 class="f-order__card-title">${FalakOrderSummary.icon('pin')} ${this.escape(this.trans('account.shipping_address'))}</h3>
                <p class="f-order__detail-text">
                    ${address.name ? `<strong>${this.escape(address.name)}</strong><br>` : ''}
                    ${line ? `${this.escape(line)}<br>` : ''}
                    ${city ? `${this.escape(city)}` : ''}
                </p>
                ${address.phone || address.email ? `
                    <p class="f-order__detail-text f-order__contact">
                        ${address.phone ? `<span>${FalakOrderSummary.icon('phone')} <span dir="ltr">${this.escape(address.phone)}</span></span>` : ''}
                        ${address.email ? `<span>${FalakOrderSummary.icon('mail')} <span dir="ltr">${this.escape(address.email)}</span></span>` : ''}
                    </p>` : ''}
            </section>`;
    }

    trackingHtml(order, f) {
        const shipment = order.shipment || {};
        const row = (label, value, mono = false) => (value === null || value === undefined || value === '')
            ? ''
            : `<div class="f-order__kv"><span class="f-order__kv-label">${this.escape(label)}</span><span class="f-order__kv-value ${mono ? 'is-mono' : ''}" ${mono ? 'dir="ltr"' : ''}>${this.escape(String(value))}</span></div>`;

        let body;
        if (f.showTracking) {
            body = `
                <div class="f-order__kvs">
                    ${row(this.trans('account.carrier'), (shipment.carrier || order.shipping_method || '').toUpperCase())}
                    ${row(this.trans('account.tracking_number'), f.trackingNumber, true)}
                    ${row(this.trans('account.service'), shipment.service || '')}
                    ${row(this.trans('account.weight'), shipment.weight ? `${shipment.weight} KG` : '')}
                    ${row(this.trans('account.created'), shipment.created_at ? this.formatDateTime(shipment.created_at) : '')}
                </div>
                <div class="f-order__tracking-actions">
                    <button type="button" class="f-btn f-btn--primary-outline f-btn--small" data-order-track>${FalakOrderSummary.icon('truck')} ${this.escape(this.trans('account.track_shipment'))}</button>
                    ${shipment.tracking_url ? `<a class="f-order__link" href="${this.escape(shipment.tracking_url)}" target="_blank" rel="noopener">${this.escape(this.trans('account.track_on_carrier'))} ↗</a>` : ''}
                </div>`;
        } else {
            const text = f.isCancelled
                ? this.trans('account.tracking_unavailable')
                : f.isNonGateway || f.isPaid
                    ? this.trans('account.tracking_pending')
                    : this.trans('account.tracking_locked');
            body = `
                <div class="f-order__locked f-order__locked--inline">
                    <span class="f-order__locked-icon" aria-hidden="true">${FalakOrderSummary.icon('lock')}</span>
                    <p class="f-order__locked-text">${this.escape(text)}</p>
                </div>`;
        }

        return `
            <section class="f-order__card f-order__tracking">
                <div class="f-order__card-head">
                    <h3 class="f-order__card-title">${FalakOrderSummary.icon('truck')} ${this.escape(this.trans('account.tracking_title'))}</h3>
                    <span class="f-order__tag ${f.showTracking ? 'f-order__tag--success' : ''}">${this.escape(this.trans(f.showTracking ? 'account.active' : 'account.locked'))}</span>
                </div>
                ${body}
            </section>`;
    }

    actionsHtml(order, f) {
        const buttons = [];
        const status = String(order.status || '').toLowerCase();

        if (f.canRetryPay) {
            buttons.push(`<button type="button" class="f-btn f-btn--primary f-btn--wide" data-order-pay>${FalakOrderSummary.icon('card')} ${this.escape(this.trans(f.isPayFailed ? 'account.retry_payment' : 'account.complete_payment'))}</button>`);
        }

        if (f.canConfirmDelivery) {
            buttons.push(`<button type="button" class="f-btn f-btn--primary f-btn--wide" data-order-confirm-delivery>${FalakOrderSummary.icon('check-circle')} ${this.escape(this.trans('account.confirm_delivery'))}</button>`);
        }

        if (status === 'delivered' && f.hasReturnableItems && order.shipment?.supports_returns !== false) {
            const sent = !!f.returnRequest;
            buttons.push(`<button type="button" class="f-btn f-btn--primary f-btn--wide" data-order-return ${sent ? 'disabled' : ''}>${FalakOrderSummary.icon('return')} ${this.escape(this.trans(sent ? 'account.request_sent' : 'account.request_return'))}</button>`);
        }

        if (f.returnRequest) {
            const rs = String(f.returnRequest.status || '').toLowerCase();
            buttons.push(`<p class="f-order__return-status"><span class="f-order__status f-order__status--return-${this.escape(rs)}">${this.escape(this.label(`account.return_status.${rs}`, rs))}</span>${f.returnRequest.requested_at ? ` <time>${this.escape(this.formatDate(f.returnRequest.requested_at))}</time>` : ''}</p>`);
        }

        if (f.isReviewable && !f.hasSubmittedReview && this._reviewable?.can_add_store_review === true) {
            buttons.push(`<button type="button" class="f-btn f-btn--primary f-btn--wide" data-order-rate>${FalakOrderSummary.icon('star')} ${this.escape(this.trans('account.rate_order'))}</button>`);
        }

        if (f.canCancel && order.id) {
            buttons.push(`<button type="button" class="f-btn f-btn--light-outline f-btn--wide f-order__cancel" data-order-cancel>${FalakOrderSummary.icon('x-circle')} ${this.escape(this.trans('account.cancel_order'))}</button>`);
        }

        if (!buttons.length) return '';

        return `
            <section class="f-order__card f-order__actions">
                <h3 class="f-order__card-title">${FalakOrderSummary.icon('bolt')} ${this.escape(this.trans('account.actions'))}</h3>
                <div class="f-order__action-list">${buttons.join('')}</div>
            </section>`;
    }

    infoHtml(order, f) {
        const row = (label, value, mod = '') => (value === null || value === undefined || value === '')
            ? ''
            : `<div class="f-order__kv"><span class="f-order__kv-label">${this.escape(label)}</span><span class="f-order__kv-value ${mod}">${this.escape(String(value))}</span></div>`;

        const supports = order.shipment?.supports_returns;

        return `
            <section class="f-order__card f-order__info">
                <h3 class="f-order__card-title">${FalakOrderSummary.icon('info')} ${this.escape(this.trans('account.order_info'))}</h3>
                <div class="f-order__kvs">
                    ${row(this.trans('account.order_id'), order.id ? `#${order.id}` : '', 'is-mono')}
                    ${row(this.trans('account.channel'), order.channel || '')}
                    ${row(this.trans('account.shipment_type'), order.shipment_type ? this.label(`account.shipment_type.${order.shipment_type}`, order.shipment_type) : '')}
                    ${typeof supports === 'boolean' ? row(this.trans('account.supports_returns'), this.trans(supports ? 'common.yes' : 'common.no'), supports ? 'is-positive' : 'is-negative') : ''}
                    ${row(this.trans('account.updated'), order.updated_at ? this.formatDateTime(order.updated_at) : '')}
                </div>
            </section>`;
    }

    /* ----------------------------------------------------------- actions */

    onClick(event) {
        const target = event.target;
        const hit = selector => target.closest(selector);

        if (hit('[data-order-login]')) { this.sdk.auth.requireLoginThen(() => this.load()); return; }
        if (hit('[data-order-pay]')) { this.openPayDialog(); return; }
        if (hit('[data-order-invoice]')) { this.openInvoiceDialog(); return; }
        if (hit('[data-order-return]')) { this.openReturnDialog(); return; }
        if (hit('[data-order-rate]')) { this.openRateOrderDialog(); return; }
        if (hit('[data-order-track]')) { this.openTrackingDialog(); return; }
        if (hit('[data-order-cancel]')) { this.cancelOrder(); return; }
        if (hit('[data-order-confirm-delivery]')) { this.confirmDelivery(); return; }

        const rate = hit('[data-order-rate-product]');
        if (rate) { this.openRateProductDialog(rate.dataset.orderRateProduct, rate.dataset.productName); return; }

        const download = hit('[data-order-download]');
        if (download) this.downloadFile(download.dataset.orderDownload, download.dataset.fileName);
    }

    async downloadFile(fileId, fileName) {
        if (this._downloading) return;

        this._downloading = String(fileId);
        this.render();

        try {
            await this.sdk.checkout.downloadFile(this._order.number, fileId, fileName);
        } catch (error) {
            // The client already toasted the server's reason (limit reached, expired).
        }

        this._downloading = null;
        // Counts changed on the server; refresh what is left.
        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.downloads(this._order.number));
            this._downloads = Array.isArray(response?.downloads) ? response.downloads : this._downloads;
        } catch (error) { /* keep what we had */ }
        this.render();
    }

    async cancelOrder() {
        const order = this._order;
        if (!order?.id) return;
        if (!window.confirm(this.trans('account.cancel_order_confirm'))) return;

        try {
            await this.sdk.checkout.cancelOrder(order.id);
            await this.refresh();
        } catch (error) { /* toasted by the client */ }
    }

    async confirmDelivery() {
        const order = this._order;
        if (!order?.number) return;

        try {
            await this.sdk.checkout.confirmDelivery(order.number);
            await this.refresh();
        } catch (error) { /* toasted by the client */ }
    }

    /** Re-fetches the order after an action and tells the page. */
    async refresh() {
        this._reviewable = null;
        await this.load();
        this.emitBus('order::updated', { orderNumber: this._order?.number, order: this._order });
    }

    /* ----------------------------------------------------------- dialogs */

    // Dialog plumbing lives in concerns/pay-dialog.js, shared with the
    // payment-return page; these keep the call sites below readable.
    openDialog(id, title, html, options) { return openDialog(this, `order-${id}`, title, html, options); }
    closeDialog() { closeDialog(this); }
    dialogBody() { return dialogBody(this); }
    setDialogError(message) { setDialogError(this, message); }
    setDialogBusy(busy, label) { setDialogBusy(this, busy, label); }

    /** Invoice: pick the document's language, then the PDF downloads. */
    openInvoiceDialog() {
        const modal = this.openDialog('invoice', this.trans('account.invoice_language'), `
            <p class="f-order-dialog__hint">${this.escape(this.trans('account.invoice_language_hint'))}</p>
            <div class="f-order-dialog__choices">
                <button type="button" class="f-btn f-btn--primary-outline" data-invoice-lang="en">${FalakOrderSummary.icon('file')} English</button>
                <button type="button" class="f-btn f-btn--primary-outline" data-invoice-lang="ar">${FalakOrderSummary.icon('file')} العربية</button>
            </div>`);

        modal.addEventListener('click', async event => {
            const button = event.target.closest('[data-invoice-lang]');
            if (!button) return;

            modal.querySelectorAll('[data-invoice-lang]').forEach(b => { b.disabled = true; });
            try {
                await this.sdk.checkout.downloadInvoice(this._order.number, button.dataset.invoiceLang);
                this.closeDialog();
            } catch (error) {
                this.setDialogError(error?.message || this.trans('account.invoice_failed'));
                modal.querySelectorAll('[data-invoice-lang]').forEach(b => { b.disabled = false; });
            }
        });
    }

    /** Pay now / retry: the store's online methods, then off to the gateway. */
    openPayDialog() {
        return openPayDialog(this, this._order, { isFailed: this.flags(this._order).isPayFailed, onPaid: () => this.refresh() });
    }

    /** Return request: eligibility first, then reason + notes. */
    async openReturnDialog() {
        const order = this._order;
        const modal = this.openDialog('return', this.trans('account.request_return'), `<span class="f-modal__spinner" aria-hidden="true"></span>`);

        let eligibility;
        try {
            eligibility = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.returnEligibility(order.number));
        } catch (error) {
            this.setDialogError(error?.message || this.trans('common.load_failed'));
            const body = this.dialogBody(); if (body) body.querySelector('.f-modal__spinner')?.remove();
            return;
        }

        const body = this.dialogBody();
        if (!body || this._dialog !== modal) return;

        if (!eligibility?.can_request_return) {
            body.innerHTML = `<p class="f-order-dialog__hint">${this.escape(this.trans(eligibility?.has_pending_return ? 'account.return_already_pending' : 'account.return_not_eligible'))}</p>`;
            return;
        }

        body.innerHTML = `
            ${eligibility.return_deadline ? `<p class="f-order-dialog__hint">${this.escape(this.trans('account.return_deadline'))}: <b>${this.escape(this.formatDate(eligibility.return_deadline))}</b></p>` : ''}
            <form class="f-order-dialog__form" data-return-form>
                <label class="f-field">
                    <span class="f-field__label">${this.escape(this.trans('account.return_reason'))} *</span>
                    <select class="f-input" name="reason" required>
                        <option value="">${this.escape(this.trans('account.select_reason'))}</option>
                        ${FalakOrderSummary.RETURN_REASONS.map(reason => `<option value="${reason}">${this.escape(this.label(`account.return_reason.${reason}`, reason))}</option>`).join('')}
                    </select>
                </label>
                <label class="f-field">
                    <span class="f-field__label">${this.escape(this.trans('account.return_notes'))}</span>
                    <textarea class="f-input" name="customer_notes" rows="3" maxlength="1000" placeholder="${this.escape(this.trans('account.return_notes_placeholder'))}"></textarea>
                </label>
                <div class="f-order-dialog__footer">
                    <button type="button" class="f-btn f-btn--primary-outline" data-modal-close>${this.escape(this.trans('common.cancel'))}</button>
                    <button type="submit" class="f-btn f-btn--primary" data-dialog-submit>${this.escape(this.trans('account.submit_return'))}</button>
                </div>
            </form>`;

        modal.addEventListener('submit', async event => {
            const form = event.target.closest('[data-return-form]');
            if (!form) return;
            event.preventDefault();

            const data = new FormData(form);
            const reason = String(data.get('reason') || '').trim();
            if (!reason) return;

            this.setDialogBusy(true, this.trans('account.submitting'));
            try {
                await this.sdk.api.withoutNotifier(() => this.sdk.checkout.requestReturn(order.number, {
                    reason,
                    customer_notes: String(data.get('customer_notes') || '').trim() || undefined,
                    locale: this.isArabic() ? 'ar' : 'en',
                }));
                this.closeDialog();
                this.sdk.notify.success(this.trans('account.return_submitted'));
                await this.refresh();
            } catch (error) {
                this.setDialogError(error?.message || this.trans('common.load_failed'));
                this.setDialogBusy(false);
            }
        });
    }

    /** The store-experience review for the whole order. */
    openRateOrderDialog() {
        const order = this._order;
        const modal = this.openDialog('rate', `${this.trans('account.rate_order')} — #${order.number}`, this.reviewFormHtml(this.trans('account.rate_order_hint'), 1000));

        this.wireReviewForm(modal, async ({ rating, comment }) => {
            await this.sdk.api.withoutNotifier(() => this.sdk.checkout.reviewOrder(order.number, { rating, comment: comment || undefined }));
            this.closeDialog();
            this.sdk.notify.success(this.trans('account.review_submitted'));
            await this.refresh();
        });
    }

    /** One product on the order. */
    openRateProductDialog(productId, productName) {
        const order = this._order;
        const modal = this.openDialog('rate-product', `${this.trans('account.rate_product')}: ${productName || ''}`, this.reviewFormHtml('', 2000));

        this.wireReviewForm(modal, async ({ rating, comment }) => {
            await this.sdk.api.withoutNotifier(() => this.sdk.review.add(productId, { rating, comment, orderId: order.id }));
            this.closeDialog();
            this.sdk.notify.success(this.trans('account.review_submitted'));
            try {
                this._reviewable = await this.sdk.api.withoutNotifier(() => this.sdk.review.reviewableItems(order.number));
            } catch (error) { /* keep */ }
            this.render();
        });
    }

    reviewFormHtml(hint, maxLength) {
        return `
            ${hint ? `<p class="f-order-dialog__hint">${this.escape(hint)}</p>` : ''}
            <form class="f-order-dialog__form" data-review-form>
                <div class="f-order-dialog__stars">
                    <falak-rating-stars interactive value="5"></falak-rating-stars>
                    <input type="hidden" name="rating" value="5">
                </div>
                <label class="f-field">
                    <span class="f-field__label">${this.escape(this.trans('account.review_comment'))}</span>
                    <textarea class="f-input" name="comment" rows="4" maxlength="${maxLength}" placeholder="${this.escape(this.trans('account.review_comment_placeholder'))}"></textarea>
                </label>
                <div class="f-order-dialog__footer">
                    <button type="button" class="f-btn f-btn--primary-outline" data-modal-close>${this.escape(this.trans('common.cancel'))}</button>
                    <button type="submit" class="f-btn f-btn--primary" data-dialog-submit>${this.escape(this.trans('account.submit_review'))}</button>
                </div>
            </form>`;
    }

    wireReviewForm(modal, submit) {
        modal.addEventListener('rate', event => {
            const input = modal.querySelector('input[name="rating"]');
            if (input && event.detail?.rating) input.value = String(event.detail.rating);
        });

        modal.addEventListener('submit', async event => {
            const form = event.target.closest('[data-review-form]');
            if (!form) return;
            event.preventDefault();

            const data = new FormData(form);
            const rating = Math.min(5, Math.max(1, Number(data.get('rating')) || 5));
            const comment = String(data.get('comment') || '').trim();

            this.setDialogBusy(true, this.trans('account.submitting'));
            try {
                await submit({ rating, comment });
            } catch (error) {
                this.setDialogError(error?.message || this.trans('common.load_failed'));
                this.setDialogBusy(false);
            }
        });
    }

    /** Carrier tracking: the live status and history from the shipment gateway. */
    async openTrackingDialog() {
        const order = this._order;
        const f = this.flags(order);
        this.openDialog('track', this.trans('account.track_shipment'), `<span class="f-modal__spinner" aria-hidden="true"></span>`, { width: 'md' });

        let data = null;
        let message = '';
        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.trackShipment(f.trackingNumber || order.number));
            data = response?.data || null;
            if (!response?.success) message = this.sdk.api.localised?.(response?.['message-lang']) || response?.message || '';
        } catch (error) {
            message = error?.message || '';
        }

        const body = this.dialogBody();
        if (!body) return;

        if (!data) {
            body.innerHTML = `<p class="f-order-dialog__hint">${this.escape(message || this.trans('account.tracking_unavailable'))}</p>`;
            return;
        }

        const details = data.tracking_details || {};
        const status = details.status_label || details.status || details.current_status || details.status_code || details.Status || '';
        const location = details.location || details.current_location || '';
        const history = FalakOrderSummary.trackingEvents(details);

        body.innerHTML = `
            <div class="f-order__kvs">
                ${data.gateway_name ? `<div class="f-order__kv"><span class="f-order__kv-label">${this.escape(this.trans('account.carrier'))}</span><span class="f-order__kv-value">${this.escape(data.gateway_name)}</span></div>` : ''}
                <div class="f-order__kv"><span class="f-order__kv-label">${this.escape(this.trans('account.tracking_number'))}</span><span class="f-order__kv-value is-mono" dir="ltr">${this.escape(data.tracking_number || f.trackingNumber)}</span></div>
                ${status ? `<div class="f-order__kv"><span class="f-order__kv-label">${this.escape(this.trans('account.tracking_status'))}</span><span class="f-order__kv-value">${this.escape(String(status))}${location ? ` · ${this.escape(String(location))}` : ''}</span></div>` : ''}
            </div>
            ${data.public_tracking_url ? `<a class="f-order__link" href="${this.escape(data.public_tracking_url)}" target="_blank" rel="noopener">${this.escape(this.trans('account.track_on_carrier'))} ↗</a>` : ''}
            ${history.length ? `
                <h4 class="f-order-dialog__subtitle">${this.escape(this.trans('account.tracking_history'))}</h4>
                <ol class="f-order__events">
                    ${history.map(entry => `
                        <li class="f-order__event">
                            <strong>${this.escape(entry.title)}</strong>
                            <span class="f-order__event-meta">${this.escape([entry.date ? this.formatDateTime(entry.date) : '', entry.location].filter(Boolean).join(' · '))}</span>
                            ${entry.note ? `<span class="f-order__event-meta">${this.escape(entry.note)}</span>` : ''}
                        </li>`).join('')}
                </ol>` : ''}`;
    }

    /**
     * Carriers disagree on the shape of a history. Aramex nests it under
     * raw.TrackingResults[0].Value with .NET dates; others send a flat
     * events/history array. Reduce both to { title, date, location, note }.
     */
    static trackingEvents(details) {
        const aramex = details?.raw?.TrackingResults?.[0]?.Value;
        if (Array.isArray(aramex)) {
            return aramex.map(entry => ({
                title: entry.UpdateDescription || entry.UpdateCode || '',
                date: FalakOrderSummary.dotNetDate(entry.UpdateDateTime),
                location: entry.UpdateLocation || '',
                note: entry.Comments || '',
            })).filter(entry => entry.title);
        }

        const list = details?.events || details?.history || details?.tracking_history || details?.checkpoints || details?.raw?.events || [];
        if (!Array.isArray(list)) return [];

        return list.map(entry => ({
            title: entry.status || entry.description || entry.message || entry.event || entry.title || '',
            date: entry.date || entry.datetime || entry.timestamp || entry.time || entry.created_at || '',
            location: entry.location || entry.city || '',
            note: entry.note || entry.comment || entry.details || '',
        })).filter(entry => entry.title);
    }

    static dotNetDate(value) {
        const match = /\/Date\((\d+)/.exec(String(value || ''));
        return match ? new Date(Number(match[1])).toISOString() : (value || '');
    }

    /* ------------------------------------------------------------ helpers */

    /** trans() returns the key when it has no phrase; fall back to something readable. */
    label(key, fallback) {
        const text = this.trans(key);

        return text && text !== key ? text : String(fallback || '').replace(/_/g, ' ');
    }

    isArabic() {
        return (document.documentElement.lang || '').toLowerCase().startsWith('ar');
    }

    /** A plain string, or one side of a { en, ar } pair the API left localized. */
    localized(value) {
        if (value === null || value === undefined) return '';
        if (typeof value !== 'object') return String(value);
        const lang = this.isArabic() ? 'ar' : 'en';
        return String(value[lang] || value.en || value.ar || Object.values(value)[0] || '');
    }

    parseDate(value) {
        const date = new Date(String(value).replace(' ', 'T'));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    formatDate(value) {
        const date = this.parseDate(value);
        if (!date) return String(value);

        try {
            return date.toLocaleDateString(this.isArabic() ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (error) {
            return date.toISOString().slice(0, 10);
        }
    }

    formatDateTime(value) {
        const date = this.parseDate(value);
        if (!date) return String(value);

        try {
            return date.toLocaleString(this.isArabic() ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch (error) {
            return date.toISOString().slice(0, 16).replace('T', ' ');
        }
    }

    fileSize(bytes) {
        const size = Number(bytes);
        if (!Number.isFinite(size) || size <= 0) return '';
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    static titleCase(value) {
        return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    }

    static truncate(value, length) {
        const text = String(value || '');
        return text.length > length ? `${text.slice(0, length)}…` : text;
    }

    static icon(name) {
        const paths = {
            'check': '<path d="M20 6L9 17l-5-5"/>',
            'check-circle': '<circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/>',
            'x-circle': '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
            'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
            'lock': '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
            'box': '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>',
            'truck': '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
            'card': '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
            'pin': '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
            'phone': '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.7a2 2 0 0 1 1.9 2.2z"/>',
            'mail': '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M22 6l-10 7L2 6"/>',
            'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
            'file': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
            'warning': '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
            'route': '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
            'bolt': '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
            'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
            'globe': '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
            'star': '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
            'return': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
        };

        return `<svg class="f-order__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
    }

    /**
     * One shape from either source: the storefront page's mapped order
     * ({ number, subtotal, items[] }) or the API's Order model with its
     * envelope ({ order_number, subtotal_amount, order_items[] } + timeline,
     * payment, shipment, return_requests …).
     */
    static normalize(raw, envelope = null) {
        if (!raw || typeof raw !== 'object') return null;

        const num = value => Number(value || 0) || 0;
        const items = Array.isArray(raw.items)
            ? raw.items
            : (raw.order_items || raw.orderItems || []).map(item => ({
                id: item.id ?? null,
                product_id: item.product_id ?? null,
                name: item.product_name || item.product?.name || '',
                quantity: num(item.quantity),
                price: num(item.unit_price),
                total: num(item.total_price),
                // product_image is a checkout-time snapshot that may be a bare disk path; the API resolves it.
                image: item.product_image_url
                    || (/^(https?:)?\/\//.test(item.product_image || '') ? item.product_image : null)
                    || item.product?.images?.[0]?.url
                    || null,
                url: item.product_id ? `/product/${item.product_id}` : null,
                product_type: item.product?.product_type ?? item.product_type ?? null,
                is_returnable: item.product ? item.product.is_returnable !== false && item.product.is_returnable !== 0 : (item.is_returnable ?? null),
            }));

        let address = raw.address ?? raw.shipping_address ?? null;
        if (typeof address === 'string') {
            try { address = JSON.parse(address); } catch (error) { address = { address }; }
        }
        if (address && typeof address === 'object' && !address.email && raw.billing_address) {
            try {
                const billing = typeof raw.billing_address === 'string' ? JSON.parse(raw.billing_address) : raw.billing_address;
                if (billing?.email) address = { ...address, email: billing.email };
            } catch (error) { /* ignore */ }
        }

        const shipmentDetails = raw.shipment_details && typeof raw.shipment_details === 'object' ? raw.shipment_details : {};
        const shipment = envelope?.shipment && typeof envelope.shipment === 'object'
            ? { ...envelope.shipment, service: shipmentDetails.carrier_name || shipmentDetails.service_id || null }
            : (raw.shipment ?? null);

        return {
            id: raw.id ?? null,
            number: raw.number ?? raw.order_number ?? '',
            status: raw.status ?? '',
            payment_status: raw.payment_status ?? envelope?.payment_status ?? '',
            payment_method: raw.payment_method ?? '',
            payment_method_name: envelope?.payment_method_name ?? raw.payment_method_name ?? '',
            payment: envelope?.payment ?? raw.payment_summary ?? (Array.isArray(raw.payment) ? raw.payment[raw.payment.length - 1] : null),
            created_at: raw.created_at ?? '',
            updated_at: raw.updated_at ?? '',
            subtotal: num(raw.subtotal ?? raw.subtotal_amount),
            shipping: num(raw.shipping ?? raw.shipping_amount),
            tax: num(raw.tax ?? raw.tax_amount),
            cod_fee: num(raw.cod_fee),
            discount: num(raw.discount ?? raw.discount_amount),
            total: num(raw.total ?? raw.total_amount),
            currency: raw.currency ?? null,
            display_currency: raw.display_currency ?? null,
            display_total: raw.display_total ?? null,
            charged_currency: raw.charged_currency ?? null,
            charged_amount: raw.charged_amount ?? null,
            items,
            address: address && typeof address === 'object' ? address : null,
            tracking_number: raw.tracking_number ?? null,
            shipping_method: raw.shipping_method ?? null,
            shipment_type: raw.shipment_type ?? null,
            shipment,
            estimated_delivery: raw.estimated_delivery ?? null,
            cancellation_reason: raw.cancellation_reason ?? null,
            reviewed_at: raw.reviewed_at ?? null,
            review_rating: raw.review_rating ?? null,
            review_comment: raw.review_comment ?? null,
            review_reply: raw.review_reply ?? null,
            review_replied_at: raw.review_replied_at ?? null,
            can_cancel: envelope?.can_cancel ?? raw.can_cancel ?? false,
            can_review: envelope?.can_review ?? raw.can_review ?? false,
            channel: envelope?.channel ?? raw.channel ?? raw.sales_channel_meta?.channel ?? null,
            return_requests: Array.isArray(envelope?.return_requests) ? envelope.return_requests : (Array.isArray(raw.return_requests) ? raw.return_requests : []),
            timeline: Array.isArray(envelope?.timeline) ? envelope.timeline : (Array.isArray(raw.timeline) ? raw.timeline : []),
        };
    }
}
