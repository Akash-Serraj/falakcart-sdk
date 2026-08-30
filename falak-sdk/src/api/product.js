import BaseApi from './base.js';

/**
 * Products. Every endpoint here is public (set.tenant + tenant.resolved only),
 * so components using it work for guests with no auth flow in the way.
 */
export default class ProductApi extends BaseApi {
    static CACHE_TTL_MS = 2 * 60 * 1000;

    constructor(client, event) {
        super(client);
        this.event = event;

        this.methods = { notify: 'post' };
        this.endpoints = {
            list: 'products',
            show: 'products/{product}',
            notify: 'products/{product}/notify-availability',
            byCategory: 'categories/{category}/products',
            categories: 'categories',
            filters: 'products/filters',
        };
    }

    /**
     * The listing endpoint returns every active product as a bare array, so
     * paging is applied here rather than by the server. Slicing client-side is
     * a deliberate interim: it keeps <falak-products-list> honest about limit
     * and page today, and becomes a query string the day the endpoint supports
     * one — without the component changing.
     */
    async fetch({ limit = null, page = 1, category = null, search = null } = {}) {
        const endpoint = category ? ['byCategory', category] : 'list';

        let products = await this.cachedList(category ? `category:${category}` : 'list', endpoint);

        if (search) {
            const needle = String(search).toLowerCase();
            products = products.filter(product =>
                `${product.name ?? ''} ${product.name_ar ?? ''}`.toLowerCase().includes(needle));
        }

        const total = products.length;

        if (limit) {
            const offset = (Math.max(1, page) - 1) * limit;
            products = products.slice(offset, offset + limit);
        }

        const result = { products, total, page, limit };

        this.event.fetched(result);

        return result;
    }

    /**
     * The listing sidebar's options — categories with counts, price bounds,
     * rating, availability — scoped to a category when one is given. Shaped
     * for <falak-filters>; see App\Services\Storefront\ProductFilters.
     */
    async filters({ category = null } = {}) {
        const params = category ? { category_id: category } : {};
        const response = await this.call('filters', { params });

        return Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []);
    }

    /**
     * The raw list/by-category call, memoised for a couple of minutes.
     * Without this, a live-search box (a keystroke every few hundred ms)
     * would re-fetch the whole catalog from the network on every pause —
     * the endpoint has no query-string filtering to fetch less instead.
     * Product data is not stock-ticker fresh in a search dropdown, so a
     * short staleness window is the right trade for cutting that down to
     * one request per search session.
     */
    async cachedList(key, endpoint) {
        this._cache ??= new Map();
        const cached = this._cache.get(key);

        if (cached && Date.now() - cached.at < ProductApi.CACHE_TTL_MS) return cached.list;

        const raw = await this.call(endpoint);
        // The list endpoint returns a bare array; the by-category endpoint
        // wraps its rows: { id, categoryName, products: [...] }.
        const list = Array.isArray(raw) ? raw : (raw?.products ?? raw?.data ?? []);

        this._cache.set(key, { list, at: Date.now() });

        return list;
    }

    /**
     * "Notify me when it's back" for a sold-out product or variant. Either
     * contact may be omitted; a signed-in customer's details fill the gap.
     */
    async notifyWhenAvailable(productId, { email = '', phone = '', variationId = null } = {}) {
        if (!productId) return this.reject('There is no product "id"!');

        const body = {};
        if (email) body.email = email;
        if (phone) body.phone = phone;
        if (variationId) body.product_variation_id = Number(variationId);

        const response = await this.call(['notify', productId], { body });

        this.event.availabilitySubscribed({ productId, variationId, response });

        return response;
    }

    async show(productId) {
        if (!productId) return this.reject('There is no product "id"!');

        const product = await this.call(['show', productId]);

        this.event.detailFetched(product);

        return product;
    }

    categories() {
        return this.call('categories');
    }
}
