import BaseApi from './base.js';

/**
 * The store's mailing list.
 *
 * One public endpoint, POST /api/storefront/newsletter/subscribe
 * (Storefront\Api\NewsletterController) — subscribing is something a guest
 * does, so there is no auth gate and no /api/customer counterpart. The
 * unsubscribe side is a signed link in the emails themselves, not an API a
 * storefront calls, so it has no method here.
 *
 * The server's contract, restated from the controller's validate():
 *
 *   email   required, RFC email, max 255
 *
 * Subscribing an address that is already on the list is not an error — the
 * controller upserts — so a shopper who subscribes twice hears "thanks" twice
 * rather than being told about a uniqueness constraint they cannot act on.
 */
export default class NewsletterApi extends BaseApi {
    constructor(client, event) {
        super(client);
        this.event = event;

        this.endpoints = { subscribe: 'newsletter/subscribe' };
        this.methods = { subscribe: 'post' };
    }

    /**
     * Adds one address to the list.
     *
     * The trim/lowercase mirror what the server does to the value anyway;
     * doing it here too means the local emptiness check below cannot disagree
     * with the server about whether "   " is an address.
     *
     * @param {string} email
     * @returns {Promise<{message: ?string}>}
     */
    async subscribe(email) {
        const address = String(email ?? '').trim().toLowerCase();

        if (!address) {
            return this.reject('An email address is required.');
        }

        try {
            const response = await this.call('subscribe', { body: { email: address } });

            const result = { message: response?.message ?? null };

            this.event?.subscribed?.({ email: address, ...result });

            return result;
        } catch (error) {
            this.event?.subscribeFailed?.(error);
            throw error;
        }
    }
}
