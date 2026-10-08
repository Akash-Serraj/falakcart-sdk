import BaseApi from './base.js';
import { capabilitiesOf, checkoutFieldsOf, fieldOptionsState, validateCheckoutFields } from './capabilities.js';

/**
 * falak.checkout — everything between the cart and the order.
 *
 * Thin, typed wrappers over the storefront's checkout endpoints, in the
 * order the checkout walks them:
 *
 *   shipmentGateways()                 the merchant's shipping options
 *   capabilities(method)               what that method can do
 *   checkoutFields(method)             the extra fields it needs
 *   fieldOptionsState(field, state)    whether a field is answerable yet
 *   validateCheckoutFields(fs, state)  which of them are unsatisfied
 *   paymentGateways()                  the merchant's payment methods
 *   countries(gateway)                 a shipping gateway's countries
 *   cities(gateway, country)           … cities of a country
 *   districts(gateway, cityId)         … districts, for gateways that need them
 *   calculateTotal(payload)            subtotal / tax / shipping / COD / total
 *   placeOrder(payload)                creates the order; online payments answer
 *                                      with gateway_response.url to redirect to
 *   paymentStatus(orderNumber, query)  the gateway's verdict after it returns
 *   order(orderNumber)                 the customer's order
 *
 * Every call is authenticated the way the rest of the SDK is (bearer token
 * from sign-in); a checkout requires a signed-in customer.
 */
export default class CheckoutApi extends BaseApi {
    constructor(client, event, config) {
        super(client);

        this.event = event;
        this.config = config;

        this.endpoints = {
            shipmentGateways: '/api/customer/shipment-gateways',
            paymentGateways: '/api/customer/payment-gateways',
            countries: '/api/customer/shipment-gateway/countries',
            cities: '/api/customer/shipment-gateway/cities',
            districts: '/api/customer/shipment-gateway/districts',
            calculateTotal: '/api/customer/orders/calculate-total',
            checkout: '/api/customer/orders/checkout',
            callback: '/api/customer/orders/callback/{order}',
            order: '/api/customer/orders/{order}',
            orders: '/api/customer/orders',
        };

        this.methods = {
            shipmentGateways: 'get', paymentGateways: 'get', countries: 'get', cities: 'post',
            districts: 'get', calculateTotal: 'post', checkout: 'post', callback: 'get', order: 'get', orders: 'get',
        };
    }

    /* ------------------------------------------------------------ catalogue */

    async shipmentGateways() {
        const response = await this.call('shipmentGateways');

        return Array.isArray(response?.data) ? response.data : [];
    }

    async paymentGateways() {
        const response = await this.call('paymentGateways');
        const list = Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []);

        return list.filter(method => method && method.enabled !== false);
    }

    async countries(gatewayCode) {
        const response = await this.call('countries', { params: { gateway_code: gatewayCode } });
        const list = response?.data?.countries ?? response?.countries ?? [];

        return Array.isArray(list) ? list : [];
    }

    async cities(gatewayCode, countryCode) {
        const response = await this.call('cities', { body: { gateway_code: gatewayCode, country_code: countryCode } });
        const list = response?.data?.cities ?? response?.cities ?? [];

        return Array.isArray(list) ? list : [];
    }

    /**
     * What a shipping method can do — the server's answer, or a fallback for a
     * cached payload that predates the field.
     *
     * Reads a payload you already have; makes no request. Exposed because a
     * theme building its own checkout would otherwise have to rediscover that
     * LogesTechs needs a district and Fastcoo a national address, which is the
     * hardcoded carrier knowledge the capabilities payload exists to remove.
     */
    capabilities(method) {
        return capabilitiesOf(method);
    }

    /**
     * The extra fields this method needs beyond name, phone, country, city and
     * street — each with its type, label key, whether it is required and what
     * it depends on.
     *
     * Render AND validate from this one list. Two rounds of the same bug came
     * from a renderer and a validator reading the same intention through
     * separate code: first an order went out with no district and the carrier
     * refused it, then the form demanded a district it had not drawn.
     */
    checkoutFields(method) {
        return checkoutFieldsOf(method);
    }

    /**
     * Whether a field's options are available yet: `waiting`, `loading`,
     * `failed` or `ready`.
     *
     * Pass the form values plus the option list and its load state. A district
     * cannot be chosen before a city, so `waiting` is a legitimate state in
     * which the field is required but not yet answerable.
     */
    fieldOptionsState(field, state) {
        return fieldOptionsState(field, state);
    }

    /**
     * Which declared fields are unsatisfied, as `{ missing, blockedBy }`.
     *
     * `missing` holds label keys to name in "please fill in …"; `blockedBy`
     * is set when the shopper cannot proceed at all — options that could not
     * be loaded, or a lookup still in flight.
     *
     * Validate with this and render with `fieldOptionsState()` and the two
     * cannot disagree, which is what both rounds of the district bug were.
     */
    validateCheckoutFields(fields, state) {
        return validateCheckoutFields(fields, state);
    }
    async districts(gatewayCode, cityId, cityName = null) {
        const query = { gateway_code: gatewayCode, city_id: cityId };
        if (cityName) query.city_name = cityName;

        const response = await this.call('districts', { params: query });
        const list = response?.data?.districts ?? response?.districts ?? [];

        return Array.isArray(list) ? list : [];
    }

    /* --------------------------------------------------------------- money */

    /**
     * @param {{ payment_type: 'cod'|'online', shipment_type?: string, shipment_method_id?: number|string, shipping_address?: object|string }} payload
     * @returns {Promise<object>} the API's `data`: subtotal, tax_amount, shipping_cost, cod_fee, discount_amount, total, currency, breakdown
     */
    async calculateTotal(payload) {
        const body = { ...payload };
        if (body.shipping_address && typeof body.shipping_address !== 'string') body.shipping_address = JSON.stringify(body.shipping_address);
        if (body.shipment_method_id !== undefined && body.shipment_method_id !== null) body.shipment_method_id = String(body.shipment_method_id);

        try {
            const response = await this.call('calculateTotal', { body });
            const totals = response?.data ?? response;

            this.event.totalsCalculated(totals);

            return totals;
        } catch (error) {
            this.event.failed(error, { step: 'calculate-total' });
            throw error;
        }
    }

    /**
     * Places the order. Online payment → `gateway_response.url` to redirect
     * the shopper to; otherwise the order is final and `order_number` is set.
     */
    async placeOrder(payload) {
        const body = { sales_channel: 'site', currency: this.config.get('currency.code', 'SAR'), ...payload };

        for (const key of ['shipping_address', 'billing_address']) {
            if (body[key] && typeof body[key] !== 'string') body[key] = JSON.stringify(body[key]);
        }
        if (body.shipment_method_id !== undefined && body.shipment_method_id !== null) body.shipment_method_id = String(body.shipment_method_id);

        try {
            const response = await this.call('checkout', { body });

            this.event.orderPlaced({
                orderNumber: response?.order_number ?? response?.order?.order_number ?? null,
                redirectUrl: response?.gateway_response?.url ?? null,
                response,
            });

            return response;
        } catch (error) {
            this.event.failed(error, { step: 'checkout' });
            throw error;
        }
    }

    /** The gateway's verdict once it has sent the shopper back. */
    async paymentStatus(orderNumber, query = {}) {
        return this.call(['callback', orderNumber], { params: query });
    }

    async order(orderNumber) {
        const response = await this.call(['order', orderNumber]);

        return response?.order ?? response;
    }

    /**
     * Everything the order endpoint knows: { order, payment_status,
     * status_badge, timeline[], can_review, next_actions, download_access }.
     * order() above returns just the order for callers that want only that.
     */
    async orderDetails(orderNumber) {
        return this.call(['order', orderNumber]);
    }

    async orders(query = {}) {
        return this.call('orders', { params: query });
    }
}
