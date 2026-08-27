import BaseApi from './base.js';

/**
 * Products. Every endpoint here is public (set.tenant + tenant.resolved only),
 * so components using it work for guests with no auth flow in the way.
 */
export default class ProductApi extends BaseApi {
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

        let products = await this.call(endpoint);

        // The list endpoint returns a bare array; the by-category endpoint
        // wraps its rows: { id, categoryName, products: [...] }.
        products = Array.isArray(products) ? products : (products?.products ?? products?.data ?? []);

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
