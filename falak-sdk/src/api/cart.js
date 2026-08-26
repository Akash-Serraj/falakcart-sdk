import BaseApi from './base.js';

/**
 * The shopping cart.
 *
 * Works for a signed-in customer and for a guest alike: the platform resolves
 * ownership from either a bearer token or an HttpOnly cookie it sets itself,
 * so nothing here has to know which one is in play — and there is no local
 * mirror to drift out of sync with the server.
 *
 * TWO THINGS ABOUT THE ENDPOINT THAT SHAPE THIS WHOLE CLASS:
 *
 *  1. `POST /cart` REPLACES the cart — it deletes every line and inserts what
 *     you send. So `add()` is a read-modify-write, never a bare post. Sending
 *     one item to "add" it would silently discard everything else.
 *
 *  2. The read shape groups lines under their product:
 *       data[] -> { product: { id, name, ..., variations: [ line, line ] } }
 *     A cart is really a flat list of (product, variation) lines, so that is
 *     what this exposes; the grouping is undone on the way in.
 */
export default class CartApi extends BaseApi {
    constructor(client, event, config) {
        super(client);
        this.event = event;
        this.config = config;

        this.endpoints = {
            fetch: '/api/customer/cart',
            summary: '/api/customer/cart/summary',
            save: '/api/customer/cart',
            remove: '/api/customer/cart',
            clear: '/api/customer/cart/clear',
        };

        this.methods = { save: 'post', remove: 'delete', clear: 'delete' };

        this.lines = [];
        this.summary = null;
        this.discountCode = null;
        this.loaded = false;
    }

    /* ---------------------------------------------------------------- read */

    async fetch() {
        const response = await this.call('fetch');

        this.absorb(response);
        this.event.fetched({ lines: this.lines, summary: this.summary });

        return { lines: this.lines, summary: this.summary };
    }

    /** Cached lines; fetches once if nothing has been loaded yet. */
    async items() {
        if (! this.loaded) await this.fetch();

        return this.lines;
    }

    /** Total units, for the header badge. */
    count() {
        return this.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    }

    /* --------------------------------------------------------------- write */

    /**
     * @param {number|string} productId
     * @param {{ quantity?: number, variationId?: number|null }} options
     *
     * Adds to the existing quantity rather than setting it — a shopper
     * pressing "add" twice expects two.
     */
    async add(productId, { quantity = 1, variationId = null } = {}) {
        if (! productId) return this.reject('There is no product "id"!');

        const lines = await this.items();
        const line = this.find(lines, productId, variationId);
        const next = (line ? Number(line.quantity) : 0) + Number(quantity);

        return this.save(this.withLine(lines, productId, variationId, next), {
            productId,
            added: quantity,
        });
    }

    /** Sets an absolute quantity; 0 or less removes the line. */
    async update(productId, quantity, { variationId = null } = {}) {
        if (! productId) return this.reject('There is no product "id"!');

        const amount = Number(quantity);

        if (! Number.isFinite(amount) || amount < 1) {
            return this.remove(productId, { variationId });
        }

        const lines = await this.items();

        return this.save(this.withLine(lines, productId, variationId, amount), { productId });
    }

    /**
     * Removing has its own endpoint, so it does not go through the
     * replace-the-whole-cart path.
     */
    async remove(productId, { variationId = null } = {}) {
        if (! productId) return this.reject('There is no product "id"!');

        const body = { product_id: Number(productId) };

        if (variationId) body.product_variation_id = Number(variationId);

        try {
            await this.call('remove', { body });
            await this.fetch();

            this.event.updated({ lines: this.lines, summary: this.summary, removed: productId });

            return { lines: this.lines, summary: this.summary };
        } catch (error) {
            this.event.failed(error, productId);
            throw error;
        }
    }

    async clear() {
        try {
            await this.call('clear');
            await this.fetch();

            this.event.updated({ lines: this.lines, summary: this.summary, cleared: true });

            return { lines: this.lines, summary: this.summary };
        } catch (error) {
            this.event.failed(error, null);
            throw error;
        }
    }

    /* ------------------------------------------------------------- internal */

    /* -------------------------------------------------------------- coupon */

    /**
     * Applies a discount code to the cart as it stands. The endpoint takes
     * the code alongside the items, so this is a save with one extra field;
     * a rejected code comes back as a 422 whose message the client surfaces.
     */
    async applyCoupon(code) {
        const value = String(code ?? '').trim();

        if (! value) return this.reject('A coupon code is required.');

        const lines = await this.items();

        try {
            const result = await this.save(lines, { coupon: value }, value);
            this.event.couponApplied({ code: value, summary: this.summary });

            return result;
        } catch (error) {
            this.event.couponFailed(error, value);
            throw error;
        }
    }

    /** An explicit empty code is how the endpoint spells "remove it". */
    async removeCoupon() {
        const lines = await this.items();
        const result = await this.save(lines, { couponRemoved: true }, '');

        this.event.couponRemoved({ summary: this.summary });

        return result;
    }

    /**
     * Writes the whole cart back, because that is what POST /cart means.
     *
     * @param {string|undefined} coupon  undefined keeps whatever is applied;
     *                                   '' removes it; a code applies it.
     *
     * The endpoint DROPS an applied coupon whenever a request omits
     * discount_code — so a plain quantity change used to silently strip the
     * shopper's discount. Every write now carries the current code.
     */
    async save(lines, context = {}, coupon = undefined) {
        const items = lines
            .filter(line => Number(line.quantity) > 0)
            .map(line => ({
                product_id: Number(line.productId),
                product_variation_id: line.variationId ? Number(line.variationId) : null,
                quantity: Number(line.quantity),
            }));

        // An empty items array is rejected by the endpoint's validation, so an
        // emptied cart is a clear, not a save.
        if (! items.length) return this.clear();

        const body = { items };
        const code = coupon === undefined ? this.discountCode : coupon;

        if (code !== null && code !== undefined) body.discount_code = code;

        try {
            const response = await this.call('save', { body });

            await this.fetch();

            this.event.updated({ lines: this.lines, summary: this.summary, ...context });

            if (context.added) this.event.added({ ...context, response });

            return { lines: this.lines, summary: this.summary };
        } catch (error) {
            this.event.failed(error, context.productId ?? null);
            throw error;
        }
    }

    find(lines, productId, variationId) {
        return lines.find(line => String(line.productId) === String(productId)
            && String(line.variationId ?? '') === String(variationId ?? ''));
    }

    /** The line list with one entry set to `quantity` (added when absent). */
    withLine(lines, productId, variationId, quantity) {
        const next = lines.map(line => ({ ...line }));
        const line = this.find(next, productId, variationId);

        if (line) {
            line.quantity = quantity;

            return next;
        }

        next.push({ productId, variationId, quantity });

        return next;
    }

    /** Flattens the grouped read shape into plain lines. */
    absorb(response) {
        const groups = Array.isArray(response?.data) ? response.data : [];
        const locale = this.config.get('locale', 'ar');

        this.lines = groups.flatMap(group => {
            const product = group?.product || {};
            const name = locale === 'ar' && product.name_ar ? product.name_ar : product.name;

            return (product.variations || []).map(line => ({
                cartItemId: line.cart_item_id,
                productId: product.id,
                variationId: line.variation_id ?? null,
                variation: line.selected_variation ?? null,
                name: name || '',
                image: product.images?.[0]?.url ?? product.image_path ?? null,
                url: this.client ? `/product/${product.id}` : null,
                quantity: Number(line.quantity || 0),
                price: Number(line.unit_price || 0),
                originalPrice: Number(line.original_price || line.unit_price || 0),
                total: Number(line.total_price || 0),
                discount: Number(line.discount_amount || 0),
                stock: product.quantity ?? null,
            }));
        });

        this.summary = response?.cart_summary ?? null;
        this.discountCode = this.summary?.discount_code || null;
        this.loaded = true;
    }
}
