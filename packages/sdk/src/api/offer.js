import BaseApi from './base.js';

/**
 * Special offers.
 *
 * Public, so the offer modal works for guests — which is the point of it: an
 * offer shown only to signed-in shoppers is an offer most visitors never see.
 */
export default class OfferApi extends BaseApi {
    constructor(client, event, storage) {
        super(client);
        this.event = event;
        this.storage = storage;

        this.endpoints = { active: 'special-offers' };
        this.methods = { active: 'get' };
    }

    /**
     * Offers for the current store.
     *
     * Silent by design: a store with no offers is the common case, and a store
     * whose offers endpoint is unhappy should not toast a shopper about it.
     */
    async fetch() {
        /*
         * One request per page — and the memo has to hold the PROMISE, not the
         * resolved list.
         *
         * Caching the result only deduplicates callers that arrive after the
         * first response has landed. Callers that arrive in the same tick all
         * saw `_fetched` still undefined and all fired: two elements on a page
         * got away with it, but a listing whose sixty product cards each ask
         * for offers issued sixty identical requests. Storing the in-flight
         * promise makes every caller after the first await the same one.
         */
        if (this._fetched) return this._fetched;

        this._fetched = (async () => {
            try {
                const response = await this.client.withoutNotifier(() => this.call('active'));
                const offers = Array.isArray(response) ? response : (response?.data ?? []);

                this.event.fetched(offers);

                return offers;
            } catch (error) {
                this.event.fetchFailed(error);

                // Not cached as a permanent empty: a failed request should not
                // silence offers for the rest of the page's life.
                this._fetched = null;

                return [];
            }
        })();

        return this._fetched;
    }

}
