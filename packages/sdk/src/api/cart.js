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

        /*
         * Ordering guard. On a signed-in page load several components ask
         * for the cart at once, and a shopper can add before those reads
         * return. A read that started BEFORE a write must never overwrite
         * the state the write produced: every read and write takes a
         * sequence number, and a read only absorbs its response if nothing
         * newer has started since. Without this the add landed on the
         * server while the badge stayed put — "nothing happened".
         */
        this.seq = 0;
        this.pending = null;
    }

    /* ---------------------------------------------------------------- read */

    async fetch() {
        const seq = ++this.seq;
        const response = await this.call('fetch');

        // Superseded by a later read or write: its answer is already stale.
        if (seq !== this.seq) return { lines: this.lines, summary: this.summary };

        this.absorb(response);
        this.event.fetched({ lines: this.lines, summary: this.summary });

        return { lines: this.lines, summary: this.summary };
    }

    /** Cached lines; the first load is shared by every concurrent caller. */
    async items() {
        if (! this.loaded) {
            this.pending = this.pending || this.fetch().finally(() => { this.pending = null; });
            await this.pending;
        }

        return this.lines;
    }

    /** Drops the cache and reads again — after sign-in or sign-out. */
    async refresh() {
        this.loaded = false;
        this.pending = null;

        return this.fetch();
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
            this.seq++;
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
            this.seq++;
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
            this.seq++;
            const response = await this.call('save', { body });

            await this.fetch();

            this.event.updated({ lines: this.lines, summary: this.summary, ...context });

            if (context.added) this.event.added({ ...context, response });

            /*
             * The server trims lines the stock no longer covers instead of
             * refusing the whole save; the shopper has to hear about it even
             * when the caller silenced the usual toasts (add-to-cart does, to
             * show its own), so this one is raised here, not by the client.
             */
            const notice = response?.stock_notice;
            if (notice) {
                this.event.stockAdjusted({ ...notice, lines: this.lines, summary: this.summary });

                const text = this.client.localised(notice['message-lang']) ?? notice.message;
                if (text) this.client.notify.info(text);
            }

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
                /*
                 * The chosen options already named by the server —
                 * [{ key, label, value, value_label }] in the merchant's order,
                 * resolved to this locale. `variation.attributes` is still the
                 * raw map beside it; prefer this when showing a shopper what
                 * they picked, or the cart says "Color: Red" on a page whose
                 * product said "اللون: أحمر".
                 */
                options: Array.isArray(line.selected_options) ? line.selected_options : [],
                name: name || '',
                /*
                 * A video-commerce line shows the CLIP's picture, never the
                 * gallery's.
                 *
                 * These products are sold from a video wall: the shopper
                 * watched a clip, saw its poster on the card, and added THAT.
                 * The gallery beside it is a separate set of photographs that
                 * need not show the same thing — a product with four handbag
                 * photographs against a clip of an abaya had the cart telling a
                 * shopper they had ordered something they never saw.
                 *
                 * Null when the merchant saved no poster, which a theme can
                 * draw as the clip's own first frame (`video` below) and,
                 * failing that, as its empty tile. Both are honest; the
                 * gallery's first photograph is not.
                 *
                 * Every other product resolves exactly as it always did, with
                 * the poster added only as a last fallback for the case where
                 * there are no photographs at all.
                 */
                image: (product.is_video_commerce
                    ? (product.video_thumbnail_url ?? product.video_thumbnail_path ?? null)
                    : (product.images?.[0]?.url
                        ?? product.image_path
                        ?? product.video_thumbnail_url
                        ?? product.video_thumbnail_path
                        ?? null))
                    // The platform's stand-in for a product with no photograph.
                    ?? this.config.get('store.placeholders.product')
                    ?? null,
                /*
                 * The clip itself, for the one case the fallback cannot cover:
                 * a merchant who uploaded a video and never a poster for it.
                 * There is then no still anywhere to show, so a theme can point
                 * a muted <video> at this and seek its first frame. Null for
                 * every product without a clip, which is nearly all of them.
                 */
                video: product.video_url ?? product.video_path ?? null,
                url: this.client ? `/product/${product.id}` : null,
                quantity: Number(line.quantity || 0),
                price: Number(line.unit_price || 0),
                originalPrice: Number(line.original_price || line.unit_price || 0),
                total: Number(line.total_price || 0),
                discount: Number(line.discount_amount || 0),
                // A variant line is limited by the VARIANT it holds; the
                // product-level number is not what was put in the cart.
                stock: (line.variation_id ? line.selected_variation?.quantity : product.quantity) ?? null,
                productType: product.product_type ?? null,
                /*
                 * Whether this line needs a courier — the rule the server applies
                 * when it decides if an order must carry a shipment at all
                 * (OrderController::isItemShippableForCharges): a product the
                 * merchant marked non-shippable (a download, a voucher, a
                 * service) ships nothing, and so does an M5azn digital row
                 * whatever its flag says. The flag is read the way the legacy
                 * storefront read it, tolerating 0 / "0" / "false" from an older
                 * row. <falak-checkout> drops its whole delivery step when no
                 * line in the cart is shippable.
                 */
                shippable: !(
                    [false, 0, '0', 'false', 'False'].includes(product.is_shippable)
                    || (product.provider_type === 'm5azn' && product.product_type === 'digital')
                ),
            }));
        });

        this.summary = response?.cart_summary ?? null;
        this.discountCode = this.summary?.discount_code || null;
        this.loaded = true;
    }
}
