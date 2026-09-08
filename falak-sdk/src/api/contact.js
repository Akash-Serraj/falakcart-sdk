import BaseApi from './base.js';

/**
 * The store's contact form.
 *
 * One endpoint, POST /api/storefront/contact (Storefront\Api\QueryController),
 * which existed with no domain in front of it. Public: a shopper writing to a
 * shop has not signed in, so there is no auth gate here and no /api/customer
 * counterpart.
 *
 * The server's contract, from StoreQueryRequest — restated here because it is
 * what `send()` is shaped around, not because this file enforces it:
 *
 *   name          required, max 255
 *   email         required, email, max 255
 *   message       required, max 5000
 *   phone         optional, max 30
 *   subject       optional, max 255
 *   order_number  optional, max 100
 *   category      optional, max 100
 *   country       optional, exactly 2 characters
 *   attachment    optional file: jpg/jpeg/png/pdf, 5MB
 */
export default class ContactApi extends BaseApi {
    constructor(client, event) {
        super(client);
        this.event = event;

        this.endpoints = { send: 'contact' };
        this.methods = { send: 'post' };
    }

    /**
     * Sends one enquiry.
     *
     * Accepts a plain object or a FormData. FormData is passed through
     * untouched so an attachment survives — the client sets no content-type
     * for it and lets the browser write the multipart boundary. A plain object
     * is sent as JSON, which is the common case and the cheaper one.
     *
     * @param {Object|FormData} fields
     * @returns {Promise<{id: ?number, message: ?string}>}
     */
    async send(fields) {
        const isForm = typeof FormData !== 'undefined' && fields instanceof FormData;

        if (!fields || (!isForm && typeof fields !== 'object')) {
            return this.reject('Contact fields are required.');
        }

        /*
         * Empty optionals are dropped rather than sent as "". The server types
         * `country` as exactly two characters and `email` as an email, and an
         * empty string fails both — a form that renders an optional field the
         * shopper left alone would otherwise be rejected for a rule about a
         * field they never touched.
         */
        const body = isForm ? fields : Object.fromEntries(
            Object.entries(fields).filter(([, value]) =>
                value !== undefined && value !== null && String(value).trim() !== '')
        );

        try {
            const response = await this.call('send', { body });

            const result = {
                id: response?.data?.id ?? null,
                message: response?.message ?? null,
            };

            this.event?.sent?.(result);

            return result;
        } catch (error) {
            this.event?.sendFailed?.(error);
            throw error;
        }
    }
}
