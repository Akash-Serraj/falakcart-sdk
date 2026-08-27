import FalakElement from '../base.js';

/**
 * <falak-order-summary order-number="ORD-1001"></falak-order-summary>
 * <falak-order-summary order='{"number":"ORD-1001", ...}' compact hide-timeline></falak-order-summary>
 *
 * One order, laid out — mirroring <salla-order-summary>: status and date,
 * the progress timeline, the items, the totals, where it ships to, how it
 * was paid and the tracking number.
 *
 * Two sources, used together when both are present:
 *   - `order` — the server-rendered order (the storefront's page data),
 *     shown at once so nothing waits for a request;
 *   - `order-number` — fetched through falak.checkout.orderDetails() for
 *     the customer who owns it, which adds the timeline and the live
 *     status. Guests with only a number are asked to sign in.
 *
 * Whatever markup the theme puts inside is shown until the first render,
 * so the page is complete even before the script runs.
 *
 * | attribute      | role                                                  |
 * | order-number   | fetch this order (customer must be signed in)         |
 * | order          | JSON: the order as the page already has it            |
 * | compact        | items + totals only (no header, timeline, address)    |
 * | hide-items | hide-timeline | hide-address | hide-totals | hide-header |
 *
 * Events: DOM `loaded` (detail: order) on the element.
 */
export default class FalakOrderSummary extends FalakElement {
    static observedAttributes = ['order-number', 'order', 'compact', 'hide-items', 'hide-timeline', 'hide-address', 'hide-totals', 'hide-header'];

    get orderNumber() { return this.attr('order-number', '') || this._order?.number || ''; }
    get compact() { return this.boolAttr('compact'); }

    hides(section) {
        if (this.boolAttr(`hide-${section}`)) return true;

        return this.compact && ['header', 'timeline', 'address', 'payment'].includes(section);
    }

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
                this.innerHTML = `<p class="f-order__loading">${this.escape(this.trans('common.loading'))}</p>`;
            }
            return;
        }

        this._keepInitial = false;

        const parts = [];
        if (!this.hides('header')) parts.push(this.headerHtml(order));
        if (!this.hides('timeline') && order.timeline?.length) parts.push(this.timelineHtml(order));
        if (!this.hides('items') && order.items?.length) parts.push(this.itemsHtml(order));
        if (!this.hides('totals')) parts.push(this.totalsHtml(order));
        if (!this.hides('address') || !this.hides('payment')) parts.push(this.detailsHtml(order));

        this.innerHTML = parts.join('');
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-order-login]')) this.sdk.auth.requireLoginThen(() => this.load());
        });

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
        super.disconnectedCallback();
    }

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
        } catch (error) {
            if (!this._order) {
                this._failed = true;
                this.render();
            }
        }
    }

    /* -------------------------------------------------------------- pieces */

    headerHtml(order) {
        const status = order.status || '';
        const statusLabel = this.label(`account.status.${status}`, status);
        const date = order.created_at ? this.formatDate(order.created_at) : '';

        return `
            <header class="f-order__head">
                <div>
                    <h2 class="f-order__title">${this.escape(this.trans('account.order'))} <span dir="ltr">#${this.escape(order.number || '')}</span></h2>
                    ${date ? `<time class="f-order__date" datetime="${this.escape(order.created_at)}">${this.escape(date)}</time>` : ''}
                </div>
                <span class="f-order__status f-order__status--${this.escape(status)}">${this.escape(statusLabel)}</span>
            </header>`;
    }

    timelineHtml(order) {
        const ar = this.isArabic();

        return `
            <section class="f-order__section f-order__timeline">
                <h3 class="f-order__section-title">${this.escape(this.trans('account.order_timeline'))}</h3>
                <ol class="f-order__steps">
                    ${order.timeline.map(step => {
                        const done = step.status === 'completed';
                        const title = ar ? (step.event_ar || step.event) : step.event;
                        const text = ar ? (step.description_ar || step.description) : step.description;
                        return `<li class="f-order__step ${done ? 'is-done' : step.status === 'current' ? 'is-current' : ''}">
                            <span class="f-order__step-dot" aria-hidden="true"></span>
                            <div class="f-order__step-body">
                                <strong class="f-order__step-title">${this.escape(title || '')}</strong>
                                ${text ? `<span class="f-order__step-text">${this.escape(text)}</span>` : ''}
                                ${step.date ? `<time class="f-order__step-date">${this.escape(this.formatDate(step.date))}</time>` : ''}
                            </div>
                        </li>`;
                    }).join('')}
                </ol>
            </section>`;
    }

    itemsHtml(order) {
        return `
            <section class="f-order__section f-order__items-wrap">
                ${this.compact ? '' : `<h3 class="f-order__section-title">${this.escape(this.trans('account.items'))}</h3>`}
                <ul class="f-order__items">
                    ${order.items.map(item => `
                        <li class="f-order__item">
                            ${item.image ? `<img class="f-order__item-image" src="${this.escape(item.image)}" alt="">` : '<span class="f-order__item-image f-order__item-image--empty"></span>'}
                            <div class="f-order__item-info">
                                ${item.url ? `<a class="f-order__item-name" href="${this.escape(item.url)}">${this.escape(item.name)}</a>` : `<span class="f-order__item-name">${this.escape(item.name)}</span>`}
                                <span class="f-order__item-meta">${this.escape(String(item.quantity))} &times; ${this.escape(this.money(item.price))}</span>
                            </div>
                            <span class="f-order__item-total">${this.escape(this.money(item.total))}</span>
                        </li>`).join('')}
                </ul>
            </section>`;
    }

    totalsHtml(order) {
        const row = (label, amount, mod = '') => `
            <div class="f-order__row ${mod}">
                <span>${this.escape(label)}</span>
                <span>${mod.includes('discount') ? '&minus; ' : ''}${this.escape(this.money(amount))}</span>
            </div>`;

        return `
            <section class="f-order__section f-order__totals">
                ${row(this.trans('cart.subtotal'), order.subtotal)}
                ${order.discount > 0 ? row(this.trans('cart.discount'), order.discount, 'f-order__row--discount') : ''}
                ${order.shipping > 0 ? row(this.trans('account.shipping'), order.shipping) : ''}
                ${order.cod_fee > 0 ? row(this.trans('checkout.cod_fee'), order.cod_fee) : ''}
                ${order.tax > 0 ? row(this.trans('checkout.tax'), order.tax) : ''}
                ${row(this.trans('cart.total'), order.total, 'f-order__row--total')}
            </section>`;
    }

    detailsHtml(order) {
        const blocks = [];
        const address = order.address || {};
        const addressLine = [address.address, address.district, address.city, address.country].filter(Boolean).join(', ');

        if (!this.hides('address') && addressLine) {
            blocks.push(`
                <div class="f-order__detail">
                    <h3 class="f-order__section-title">${this.escape(this.trans('checkout.deliver_to'))}</h3>
                    <p class="f-order__detail-text">
                        ${address.name ? `<strong>${this.escape(address.name)}</strong><br>` : ''}
                        ${this.escape(addressLine)}
                        ${address.phone ? `<br><span dir="ltr">${this.escape(address.phone)}</span>` : ''}
                    </p>
                </div>`);
        }

        if (!this.hides('payment') && (order.payment_method || order.payment_status || order.tracking_number)) {
            const method = order.payment_method
                ? this.label(`account.payment_method.${order.payment_method}`, order.payment_method === 'cash_on_delivery' ? 'Cash on delivery' : order.payment_method)
                : '';
            const status = order.payment_status ? this.label(`account.payment_status.${order.payment_status}`, order.payment_status) : '';

            blocks.push(`
                <div class="f-order__detail">
                    <h3 class="f-order__section-title">${this.escape(this.trans('account.payment'))}</h3>
                    <p class="f-order__detail-text">
                        ${method ? `${this.escape(method)}` : ''}
                        ${status ? `<span class="f-order__pay-status f-order__pay-status--${this.escape(order.payment_status)}">${this.escape(status)}</span>` : ''}
                    </p>
                    ${order.tracking_number ? `<p class="f-order__detail-text"><span class="f-order__detail-label">${this.escape(this.trans('account.tracking'))}:</span> <span dir="ltr">${this.escape(order.tracking_number)}</span></p>` : ''}
                </div>`);
        }

        return blocks.length ? `<section class="f-order__section f-order__details">${blocks.join('')}</section>` : '';
    }

    /* ------------------------------------------------------------- helpers */

    /** trans() returns the key when it has no phrase; fall back to something readable. */
    label(key, fallback) {
        const text = this.trans(key);

        return text && text !== key ? text : String(fallback || '').replace(/_/g, ' ');
    }

    isArabic() {
        return (document.documentElement.lang || '').toLowerCase().startsWith('ar');
    }

    formatDate(value) {
        const date = new Date(String(value).replace(' ', 'T'));
        if (Number.isNaN(date.getTime())) return String(value);

        try {
            return date.toLocaleDateString(this.isArabic() ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (error) {
            return date.toISOString().slice(0, 10);
        }
    }

    /**
     * One shape from either source: the storefront page's mapped order
     * ({ number, subtotal, items[] }) or the API's Order model
     * ({ order_number, subtotal_amount, order_items[] }).
     */
    static normalize(raw, envelope = null) {
        if (!raw || typeof raw !== 'object') return null;

        const num = value => Number(value || 0) || 0;
        const items = Array.isArray(raw.items)
            ? raw.items
            : (raw.order_items || raw.orderItems || []).map(item => ({
                name: item.product_name || item.product?.name || '',
                quantity: num(item.quantity),
                price: num(item.unit_price),
                total: num(item.total_price),
                image: item.product_image || item.product?.images?.[0]?.url || null,
                url: item.product_id ? `/product/${item.product_id}` : null,
            }));

        let address = raw.address ?? raw.shipping_address ?? null;
        if (typeof address === 'string') {
            try { address = JSON.parse(address); } catch (error) { address = { address }; }
        }

        return {
            number: raw.number ?? raw.order_number ?? '',
            status: raw.status ?? '',
            payment_status: raw.payment_status ?? envelope?.payment_status ?? '',
            payment_method: raw.payment_method ?? '',
            created_at: raw.created_at ?? '',
            subtotal: num(raw.subtotal ?? raw.subtotal_amount),
            shipping: num(raw.shipping ?? raw.shipping_amount),
            tax: num(raw.tax ?? raw.tax_amount),
            cod_fee: num(raw.cod_fee),
            discount: num(raw.discount ?? raw.discount_amount),
            total: num(raw.total ?? raw.total_amount),
            items,
            address: address && typeof address === 'object' ? address : null,
            tracking_number: raw.tracking_number ?? null,
            timeline: Array.isArray(envelope?.timeline) ? envelope.timeline : (Array.isArray(raw.timeline) ? raw.timeline : []),
        };
    }
}
