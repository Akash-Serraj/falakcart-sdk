/**
 * Base class for a domain API.
 *
 * A subclass declares its endpoints as templates and its non-GET methods, then
 * calls them positionally. Keeping URLs in one table per domain — rather than
 * inline at each call — is what makes an API version bump a one-file change.
 *
 *     this.endpoints = { reviews: 'products/{product}/reviews' };
 *     this.call(['reviews', 12], { params: { per_page: 5 } });
 *     // -> GET /api/storefront/products/12/reviews?per_page=5
 */
export default class BaseApi {
    constructor(client) {
        this.client = client;
        this.endpoints = {};
        this.methods = {};
    }

    /** Substitutes {placeholders} left to right with the trailing arguments. */
    url(name, ...args) {
        let template = this.endpoints[name] || name;

        for (const value of args) {
            template = template.replace(/\{[^{}]+\}/, encodeURIComponent(value));
        }

        return template;
    }

    /**
     * @param {string|Array} endpoint  name, or [name, ...url params]
     */
    call(endpoint, options = {}) {
        const isTuple = Array.isArray(endpoint);
        const name = isTuple ? endpoint[0] : endpoint;
        const path = isTuple ? this.url(...endpoint) : this.url(endpoint);

        return this.client.request(path, {
            method: options.method || this.methods[name] || 'get',
            ...options,
        });
    }

    /** Rejects with a shaped error without a round trip — for caller mistakes. */
    reject(message) {
        return Promise.reject(Object.assign(new Error(message), { falak: { local: true } }));
    }
}
