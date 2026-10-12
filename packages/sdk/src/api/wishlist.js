import BaseApi from './base.js';

/**
 * falak.wishlist — the shopper's saved products.
 *
 * Guest or customer, the API keys the list on the same identity the cart
 * uses (bearer token, else the browser's `falak_cart` cookie), so a shopper
 * can save products before signing in and finds them merged afterwards.
 *
 * State is the set of saved product ids: every <falak-wishlist-button> on
 * the page reads it, and one fetch serves them all. A snapshot is kept in
 * storage so hearts paint right on the next page before the fetch lands.
 *
 *   await falak.wishlist.toggle(12)      add or remove
 *   falak.wishlist.has(12)               synchronous, from the loaded set
 *   await falak.wishlist.items()         full product records for a page
 */
export default class WishlistApi extends BaseApi {
    static STORAGE_KEY = 'wishlist.ids';

    constructor(client, event, config, storage) {
        super(client);

        this.event = event;
        this.config = config;
        this.storage = storage;

        this.endpoints = {
            fetch: '/api/customer/wishlist',
            add: '/api/customer/wishlist',
            remove: '/api/customer/wishlist/{id}',
        };

        this.methods = { fetch: 'get', add: 'post', remove: 'delete' };

        this.set = new Set(this.snapshot());
        this.products = [];
        this.loaded = false;
        this.pending = null;
    }

    /* ---------------------------------------------------------------- read */

    async fetch() {
        const response = await this.call('fetch');

        this.absorb(response);
        this.event.fetched({ ids: this.list(), items: this.products });

        return { ids: this.list(), items: this.products };
    }

    /** Saved ids; fetches once (shared across concurrent callers). */
    async ids() {
        if (!this.loaded) {
            this.pending = this.pending || this.fetch().finally(() => { this.pending = null; });
            await this.pending;
        }

        return this.list();
    }

    /**
     * Full product records, for a wishlist page or drawer. An add since the
     * last fetch means the records are behind the ids: re-read them.
     */
    async items() {
        await this.ids();

        if (this.productsStale) await this.fetch();

        return this.products;
    }

    /** Drops the cache and re-reads ids and records from the server. */
    async refresh() {
        this.loaded = false;
        this.pending = null;

        return this.fetch();
    }

    has(productId) {
        return this.set.has(Number(productId));
    }

    count() {
        return this.set.size;
    }

    list() {
        return Array.from(this.set);
    }

    /* --------------------------------------------------------------- write */

    async add(productId) {
        const id = Number(productId);
        if (!id) return this.reject('There is no product "id"!');

        try {
            const response = await this.call('add', { body: { product_id: id } });

            this.absorbIds(response, () => this.set.add(id));
            this.productsStale = true;
            this.event.added({ productId: id, ids: this.list() });
            this.event.updated({ productId: id, added: true, ids: this.list() });

            return response;
        } catch (error) {
            this.event.failed(error, { productId: id, action: 'add' });
            throw error;
        }
    }

    async remove(productId) {
        const id = Number(productId);
        if (!id) return this.reject('There is no product "id"!');

        try {
            const response = await this.call(['remove', id]);

            this.absorbIds(response, () => this.set.delete(id));
            this.products = this.products.filter(product => Number(product.id) !== id);
            this.event.removed({ productId: id, ids: this.list() });
            this.event.updated({ productId: id, added: false, ids: this.list() });

            return response;
        } catch (error) {
            this.event.failed(error, { productId: id, action: 'remove' });
            throw error;
        }
    }

    async toggle(productId) {
        await this.ids();

        return this.has(productId) ? this.remove(productId) : this.add(productId);
    }

    /* ------------------------------------------------------------- internal */

    absorb(response) {
        const ids = Array.isArray(response?.product_ids) ? response.product_ids : [];

        this.set = new Set(ids.map(Number));
        this.products = Array.isArray(response?.items) ? response.items : [];
        this.productsStale = false;
        this.loaded = true;
        this.remember();
    }

    /** The server's id list is authoritative when it sends one. */
    absorbIds(response, fallback) {
        if (Array.isArray(response?.product_ids)) this.set = new Set(response.product_ids.map(Number));
        else fallback();

        this.loaded = true;
        this.remember();
    }

    /**
     * Whose list this is just changed (sign-in/out): start over and fetch
     * once, however many hearts ask. Each of them calling reset()+ids() on
     * its own turned one sign-in into one request per heart.
     */
    reload() {
        if (!this.reloading) {
            this.reset();
            this.reloading = this.fetch().finally(() => { this.reloading = null; });
        }

        return this.reloading;
    }

    /** Whose list this is just changed (sign-in/out): start over. */
    reset() {
        this.set = new Set();
        this.products = [];
        this.productsStale = false;
        this.loaded = false;
        this.pending = null;
        this.remember();
    }

    snapshot() {
        try {
            const stored = this.storage?.get(WishlistApi.STORAGE_KEY);
            return Array.isArray(stored) ? stored.map(Number) : [];
        } catch (e) {
            return [];
        }
    }

    remember() {
        try { this.storage?.set(WishlistApi.STORAGE_KEY, this.list()); } catch (e) { /* storage unavailable */ }
    }
}
