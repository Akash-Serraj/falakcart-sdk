import BaseApi from './base.js';

/**
 * Product reviews.
 *
 * Reading is public. Writing is verified-purchase only, and that shapes the
 * whole component around it: the platform requires an `order_id`, checks the
 * order belongs to the customer, that it is awaiting review, and that the
 * product was actually in it. There is no way to review something you have not
 * bought and received — so a product page cannot offer an open review form.
 *
 * Two different prefixes, hence the rooted write paths: reading sits under
 * /api/storefront, writing under /api/customer behind auth:sanctum.
 */
export default class ReviewApi extends BaseApi {
    constructor(client, event, config) {
        super(client);
        this.event = event;
        this.config = config;

        this.endpoints = {
            list: 'products/{product}/reviews',
            all: 'reviews',

            add: '/api/customer/product-reviews',
            reviewableOrders: '/api/customer/orders/reviewable',
            reviewableItems: '/api/customer/orders/{order}/reviewable-products',
        };

        this.methods = { add: 'post' };
    }

    /**
     * What a customer may still rate on one order:
     * { reviewable_items: [{ product_id, product_name, can_review, review }], can_review_products, can_add_store_review }.
     * Empty when reviews are off or the order is not delivered yet.
     */
    async reviewableItems(orderNumber) {
        return this.call(['reviewableItems', orderNumber]);
    }

    /* ---------------------------------------------------------------- read */

    /**
     * Returns the controller's shape as-is: { reviews, pagination,
     * average_rating, total }. A store with reviews disabled still answers,
     * with zeroes — so callers need no feature check.
     */
    async fetch(productId, { perPage = 10, page = 1 } = {}) {
        if (!productId) return this.reject('There is no product "id"!');

        const response = await this.call(['list', productId], {
            params: { per_page: perPage, page },
        });

        this.event.fetched(response, productId);

        return response;
    }

    /**
     * The reviews at a glance: { average, total, distribution: {5..1: n} }.
     * One request, one review deep — the summary fields ride on the list.
     */
    async summary(productId) {
        const response = await this.fetch(productId, { perPage: 1, page: 1 });
        const distribution = response?.rating_distribution || {};

        return {
            average: Number(response?.average_rating || 0),
            total: Number(response?.total || 0),
            distribution: Object.fromEntries([5, 4, 3, 2, 1].map(star => [star, Number(distribution[star] || 0)])),
        };
    }

    /** Store-wide feed, used by testimonial sections. */
    all(params = {}) {
        return this.call('all', { params });
    }

    /* --------------------------------------------------------- eligibility */

    /**
     * Orders this customer may still review — delivered, awaiting review, and
     * not yet reviewed.
     *
     * Silent and empty for a guest rather than a rejection: "can this person
     * review?" is a question every product page asks, and the answer for most
     * visitors is simply no.
     */
    async reviewableOrders() {
        if (this.config.isGuest()) return [];

        try {
            const response = await this.client.withoutNotifier(() => this.call('reviewableOrders'));
            const orders = response?.orders?.data ?? response?.orders ?? response?.data ?? [];

            return Array.isArray(orders) ? orders : [];
        } catch (error) {
            return [];
        }
    }

    /**
     * The order id to review `productId` against, or null.
     *
     * Cached for the page: a product page may ask once for the form and again
     * on submit, and this is a list request either way.
     */
    async eligibleOrderFor(productId) {
        if (!productId || this.config.isGuest()) return null;

        this._orders ??= await this.reviewableOrders();

        const wanted = String(productId);

        for (const order of this._orders) {
            const items = order.order_items ?? order.orderItems ?? order.items ?? [];

            const match = items.some(item =>
                String(item.product_id ?? item.product?.id ?? '') === wanted);

            if (match) return order.id ?? null;
        }

        return null;
    }

    /* --------------------------------------------------------------- write */

    /**
     * @param {number|string} productId
     * @param {{ rating: number, comment?: string, title?: string, orderId?: number }} review
     *
     * `orderId` is resolved when not supplied, so a caller that only knows the
     * product still works — but a customer with no eligible order is rejected
     * here rather than by a 422 they cannot act on.
     */
    async add(productId, { rating, comment = '', title = null, orderId = null } = {}) {
        if (!productId) return this.reject('There is no product "id"!');
        if (!rating) return this.reject('A rating is required.');

        if (this.config.isGuest()) {
            this.event.addFailed('guest', productId);
            return this.reject('AUTH_REQUIRED');
        }

        const order = orderId ?? await this.eligibleOrderFor(productId);

        if (!order) {
            this.event.addFailed('no-order', productId);
            return this.reject('ORDER_REQUIRED');
        }

        try {
            const response = await this.call('add', {
                body: {
                    order_id: order,
                    product_id: Number(productId),
                    rating: Number(rating),
                    title,
                    // The column is review_text; `comment` is this SDK's word
                    // for it because that is what the read side returns.
                    review_text: comment || null,
                },
            });

            // The order has been used up; a second review would be rejected.
            this._orders = null;

            this.event.added(response, productId);

            return response;
        } catch (error) {
            this.event.addFailed(error, productId);
            throw error;
        }
    }
}
