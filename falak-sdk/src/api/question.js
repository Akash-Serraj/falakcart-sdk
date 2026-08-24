import BaseApi from './base.js';

/**
 * Product questions & answers.
 *
 * Reading is public; asking and replying need an authenticated customer.
 * Unlike reviews there is no purchase gate — any signed-in customer may ask —
 * so the component only has to distinguish guest from customer.
 *
 * Two prefixes, hence the rooted write paths: reading sits under
 * /api/storefront, writing under /api/customer behind auth:sanctum.
 */
export default class QuestionApi extends BaseApi {
    constructor(client, event, config) {
        super(client);
        this.event = event;
        this.config = config;

        this.endpoints = {
            list: 'products/{product}/questions',

            ask: '/api/customer/questions',
            reply: '/api/customer/questions/{question}/replies',
        };

        this.methods = { ask: 'post', reply: 'post' };
    }

    /* ---------------------------------------------------------------- read */

    /**
     * Returns { questions, total }. The controller wraps its payload in
     * { status, data: { questions, total_questions } }, so this unwraps once
     * here rather than in every caller.
     */
    async fetch(productId) {
        if (!productId) return this.reject('There is no product "id"!');

        const response = await this.call(['list', productId]);
        const data = response?.data ?? response ?? {};

        const result = {
            questions: Array.isArray(data.questions) ? data.questions : [],
            total: Number(data.total_questions ?? data.total ?? 0),
        };

        this.event.fetched(result, productId);

        return result;
    }

    /* --------------------------------------------------------------- write */

    /**
     * @param {number|string} productId
     * @param {{ question: string, anonymous?: boolean }} payload
     *
     * A guest is rejected locally with AUTH_REQUIRED — the same contract the
     * review API uses, so callers can route both to the login modal.
     */
    async ask(productId, { question, anonymous = false } = {}) {
        if (!productId) return this.reject('There is no product "id"!');

        const text = String(question ?? '').trim();
        if (!text) return this.reject('A question is required.');

        if (this.config.isGuest()) {
            this.event.askFailed('guest', productId);
            return this.reject('AUTH_REQUIRED');
        }

        try {
            const response = await this.call('ask', {
                body: {
                    product_id: Number(productId),
                    question: text,
                    is_anonymous: Boolean(anonymous),
                },
            });

            this.event.asked(response, productId);

            return response;
        } catch (error) {
            this.event.askFailed(error, productId);
            throw error;
        }
    }

    async reply(questionId, reply) {
        if (!questionId) return this.reject('There is no question "id"!');

        const text = String(reply ?? '').trim();
        if (!text) return this.reject('A reply is required.');

        if (this.config.isGuest()) {
            this.event.replyFailed('guest', questionId);
            return this.reject('AUTH_REQUIRED');
        }

        try {
            const response = await this.call(['reply', questionId], { body: { reply: text } });

            this.event.replied(response, questionId);

            return response;
        } catch (error) {
            this.event.replyFailed(error, questionId);
            throw error;
        }
    }
}
