import BaseApi from './base.js';

/**
 * falak.buyNow — a single-item checkout that skips the cart entirely.
 *
 * A deliberately separate API from falak.checkout (which is cart-shaped end
 * to end — see BuyNowController's docblock on the backend for the full scope
 * note). Same response shape as CheckoutApi.calculateTotal()/placeOrder()
 * (subtotal/tax/shipping/total, order_number, gateway_response.url) so
 * <falak-mini-checkout> can reuse the same redirect/thank-you handling
 * <falak-checkout> already has.
 */
export default class BuyNowApi extends BaseApi {
    constructor(client, event) {
        super(client);

        this.event = event;

        this.endpoints = {
            calculateTotal: '/api/customer/buy-now/calculate-total',
            checkout: '/api/customer/buy-now/checkout',
        };

        this.methods = { calculateTotal: 'post', checkout: 'post' };
    }

    /**
     * @param {{ productId: number, variationId?: number, quantity: number, paymentType: 'cod'|'online', shipmentMethodId?: number, shippingAddress?: object|string }} payload
     */
    async calculateTotal(payload) {
        const body = this.mapPayload(payload);

        try {
            const response = await this.call('calculateTotal', { body });
            const totals = response?.data ?? response;

            this.event.totalsCalculated(totals);

            return totals;
        } catch (error) {
            this.event.failed(error, { step: 'buy-now-calculate-total' });
            throw error;
        }
    }

    /**
     * @param {{ productId: number, variationId?: number, quantity: number, paymentMethodId: number|string, shipmentMethodId: number, shippingAddress: object|string, billingAddress?: object|string, customerNotes?: string }} payload
     */
    async checkout(payload) {
        const body = {
            ...this.mapPayload(payload),
            payment_method_id: payload.paymentMethodId,
            billing_address: this.jsonify(payload.billingAddress ?? payload.shippingAddress),
            customer_notes: payload.customerNotes || '',
        };

        try {
            const response = await this.call('checkout', { body });

            this.event.orderPlaced({
                orderNumber: response?.order_number ?? null,
                redirectUrl: response?.gateway_response?.url ?? null,
                response,
                source: 'buy-now',
            });

            return response;
        } catch (error) {
            this.event.failed(error, { step: 'buy-now-checkout' });
            throw error;
        }
    }

    mapPayload(payload) {
        const body = {
            product_id: payload.productId,
            quantity: payload.quantity,
        };

        if (payload.variationId) body.product_variation_id = payload.variationId;
        if (payload.paymentType) body.payment_type = payload.paymentType;
        if (payload.shipmentMethodId) body.shipment_method_id = payload.shipmentMethodId;
        if (payload.shippingAddress) body.shipping_address = this.jsonify(payload.shippingAddress);

        return body;
    }

    jsonify(value) {
        return value && typeof value !== 'string' ? JSON.stringify(value) : value;
    }
}
