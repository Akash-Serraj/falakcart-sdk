import FalakElement from '../base.js';

/**
 * <falak-orders></falak-orders>
 * <falak-orders orders='[…]'></falak-orders>            (server-rendered first paint)
 * <falak-orders per-page="5" hide-search hide-filter></falak-orders>
 *
 * The customer's order list — mirroring <salla-orders>: a status filter, a
 * search by order number, paged with "load more". Reads the same paginated
 * endpoint the account dashboard uses (falak.checkout.orders()), so a filter
 * or search is a real server-side query, not a client-side re-sort of
 * whatever page already loaded.
 *
 * A guest is asked to sign in, matching <falak-order-summary>.
 *
 * | attribute    | role                                                        |
 * | orders       | JSON: server-rendered orders (number/status/created_at/     |
 * |              | total/url) shown before the first live fetch resolves        |
 * | per-page     | page size for the live fetch (default 10)                    |
 * | hide-search  | hide the order-number search box                              |
 * | hide-filter  | hide the status filter                                        |
 *
 * Events: DOM `loaded` (detail: `{ orders, page }`) on the element.
 */
export default class FalakOrders extends FalakElement {
    static observedAttributes = ['orders', 'per-page', 'hide-search', 'hide-filter'];

    static STATUSES = [
        'pending', 'awaiting_payment', 'processing', 'shipped', 'out_for_delivery',
        'delivered', 'waiting_for_review', 'completed', 'cancelled', 'refunded', 'returned',
    ];

    get perPage() { return this.numAttr('per-page', 10); }

    connectedCallback() {
        if (this._orders === undefined) {
            const initial = this.jsonAttr('orders', null);
            this._orders = Array.isArray(initial) ? initial.map(order => FalakOrders.normalize(order)) : null;
            this._page = 1;
            this._lastPage = 1;
            this._status = '';
            this._search = '';
        }

        return super.connectedCallback();
    }

    render() {
        this.classList.add('f-orders');

        /*
         * Live auth state decides this, never the initial `orders` attribute:
         * the twig template always emits an array (possibly empty), so an
         * empty array cannot tell "guest" apart from "signed in, zero orders".
         */
        if (!this.sdk.auth.isLoggedIn()) {
            this.innerHTML = `
                <div class="f-orders__guest">
                    <p>${this.escape(this.trans('account.order_sign_in'))}</p>
                    <button type="button" class="f-btn f-btn--primary" data-orders-login>${this.escape(this.trans('auth.sign_in'))}</button>
                </div>`;
            return;
        }

        const orders = this._orders;

        this.innerHTML = `
            ${this.toolbarHtml()}
            ${orders === null
                ? `<div class="f-orders__skeleton"><falak-skeleton shape="text" lines="4"></falak-skeleton></div>`
                : orders.length
                    ? `<ul class="f-orders__list">${orders.map(order => this.rowHtml(order)).join('')}</ul>`
                    : `<falak-placeholder icon="📦" text="${this.escape(this.trans('account.no_orders'))}"
                                         action-text="${this.escape(this.trans('cart.start_shopping'))}" action-href="/products"></falak-placeholder>`}
            ${orders && orders.length && this._page < this._lastPage ? `
                <div class="f-orders__more">
                    <falak-button color="light" fill="outline" size="small" data-orders-more>
                        ${this.escape(this.trans('account.more_orders'))}
                    </falak-button>
                </div>` : ''}`;
    }

    toolbarHtml() {
        if (this.boolAttr('hide-search') && this.boolAttr('hide-filter')) return '';

        return `
            <div class="f-orders__toolbar">
                ${this.boolAttr('hide-search') ? '' : `
                    <input class="f-input f-orders__search" type="search" data-orders-search
                           placeholder="${this.escape(this.trans('account.search_order_placeholder'))}" value="${this.escape(this._search)}">`}
                ${this.boolAttr('hide-filter') ? '' : `
                    <select class="f-input f-orders__filter" data-orders-status>
                        <option value="">${this.escape(this.trans('account.all_statuses'))}</option>
                        ${FalakOrders.STATUSES.map(status => `
                            <option value="${status}" ${this._status === status ? 'selected' : ''}>${this.escape(this.trans(`account.status.${status}`))}</option>`).join('')}
                    </select>`}
            </div>`;
    }

    rowHtml(order) {
        return `
            <li class="f-orders__row">
                <a href="${this.escape(order.url)}" class="f-orders__main">
                    <span class="f-orders__number" dir="ltr">#${this.escape(order.number)}</span>
                    <span class="f-orders__date">${this.escape(this.formatDate(order.created_at))}</span>
                </a>
                <span class="f-orders__status f-orders__status--${this.escape(order.status)}">${this.escape(this.statusLabel(order.status))}</span>
                <span class="f-orders__total">${this.escape(this.money(order.total))}</span>
            </li>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-orders-login]')) this.sdk.auth.requireLoginThen(() => this.reload());
            if (event.target.closest('[data-orders-more]')) this.loadMore();
        });

        this.listen(this, 'change', event => {
            if (event.target.matches('[data-orders-status]')) { this._status = event.target.value; this.reload(); }
        });

        let debounce;
        this.listen(this, 'input', event => {
            if (!event.target.matches('[data-orders-search]')) return;
            clearTimeout(debounce);
            debounce = setTimeout(() => { this._search = event.target.value.trim(); this.reload(); }, 350);
        });

        this._offIn = this.sdk.event.on('auth::logged.in', () => this.reload());

        if (this.sdk.auth.isLoggedIn()) this.reload();
    }

    disconnectedCallback() {
        if (typeof this._offIn === 'function') this._offIn();
        super.disconnectedCallback();
    }

    /** Fresh query — filter/search changed, or the first live load. */
    async reload() {
        this._page = 1;
        await this.fetchPage();
        this.render();
        this.emit('loaded', { orders: this._orders, page: this._page });
    }

    async loadMore() {
        const button = this.querySelector('[data-orders-more]');
        button?.load?.();

        this._page += 1;
        const previous = this._orders || [];

        await this.fetchPage();

        this._orders = [...previous, ...(this._orders || [])];
        this.render();
        this.emit('loaded', { orders: this._orders, page: this._page });
    }

    async fetchPage() {
        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.orders({
                page: this._page,
                per_page: this.perPage,
                status: this._status || undefined,
                search: this._search || undefined,
            }));

            const paged = response?.orders || {};
            const list = Array.isArray(paged.data) ? paged.data : (Array.isArray(paged) ? paged : []);

            this._orders = list.map(order => FalakOrders.normalize(order));
            this._lastPage = paged.last_page ?? 1;
        } catch (error) {
            this._orders = this._orders || [];
        }
    }

    /** trans() returns the key when it has no phrase for this status; fall back to something readable. */
    statusLabel(status) {
        const text = this.trans(`account.status.${status}`);

        return text && text !== `account.status.${status}` ? text : String(status || '').replace(/_/g, ' ');
    }

    formatDate(value) {
        if (!value) return '';

        const date = new Date(String(value).replace(' ', 'T'));
        if (Number.isNaN(date.getTime())) return String(value);

        try {
            return new Intl.DateTimeFormat(this.sdk.lang.locale, { dateStyle: 'medium' }).format(date);
        } catch (error) {
            return date.toISOString().slice(0, 10);
        }
    }

    /** One shape from either source: the storefront page's mapped order, or the API's raw Order model. */
    static normalize(raw) {
        if (!raw || typeof raw !== 'object') return null;

        return {
            number: raw.number ?? raw.order_number ?? '',
            status: raw.status ?? '',
            created_at: raw.created_at ?? '',
            total: Number(raw.total ?? raw.total_amount ?? 0) || 0,
            url: raw.url ?? (raw.order_number ? `/customer/orders/${raw.order_number}` : '#'),
        };
    }
}
