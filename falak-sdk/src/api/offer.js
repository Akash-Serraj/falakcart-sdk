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
        // One request per page: the header banner and any offers section on
        // the same page share the result instead of racing the endpoint.
        if (this._fetched) return this._fetched;

        try {
            const response = await this.client.withoutNotifier(() => this.call('active'));
            const offers = Array.isArray(response) ? response : (response?.data ?? []);

            this.event.fetched(offers);

            return this._fetched = offers;
        } catch (error) {
            this.event.fetchFailed(error);
            return [];
        }
    }

}
