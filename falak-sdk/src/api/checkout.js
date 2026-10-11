import BaseApi from './base.js';

/**
 * falak.checkout — everything between the cart and the order.
 *
 * Thin, typed wrappers over the storefront's checkout endpoints, in the
 * order the checkout walks them:
 *
 *   shipmentGateways()                 the merchant's shipping options
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
 * And once the order exists:
 *   downloadInvoice(n, lang)           saves the invoice PDF
 *   downloads(n) / downloadFile(n, id) digital files bought on the order
 *   returnEligibility(n) / requestReturn(n, payload) / returnRequests()
 *   reviewOrder(n, { rating, comment }) the store-experience review
 *   confirmDelivery(n) / cancelOrder(id) / trackShipment(identifier)
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
            retryPayment: '/api/customer/orders/{order}/retry-payment',
            order: '/api/customer/orders/{order}',
            orders: '/api/customer/orders',

            // After the order: the documents and actions of one order.
            invoice: '/api/customer/orders/{order}/invoice',
            downloads: '/api/customer/orders/{order}/downloads',
            downloadFile: '/api/customer/orders/{order}/download/{file}',
            returnEligibility: '/api/customer/orders/{order}/return-eligibility',
            returnRequest: '/api/customer/orders/{order}/return-request',
            returnRequests: '/api/customer/orders/return-requests/list',
            reviewOrder: '/api/customer/orders/{order}/review',
            confirmDelivery: '/api/customer/orders/{order}/confirm-delivery',
            cancelOrder: '/api/customer/orders/{id}/cancel',

            // The contact step of an order that ships nothing: the profile the
            // store already holds behind the account's phone, and re-verifying
            // a number the shopper changes there.
            customerProfile: '/api/customer/checkout/customer-profile',
            sendPhoneOtp: '/api/customer/checkout/phone/send-otp',
            verifyPhoneOtp: '/api/customer/checkout/phone/verify-otp',
            trackShipment: '/api/customer/shipments/track',
        };

        this.methods = {
            shipmentGateways: 'get', paymentGateways: 'get', countries: 'get', cities: 'post',
            districts: 'get', calculateTotal: 'post', checkout: 'post', callback: 'get', retryPayment: 'post', order: 'get', orders: 'get',
            invoice: 'get', downloads: 'get', downloadFile: 'get', returnEligibility: 'get', returnRequest: 'post',
            returnRequests: 'get', reviewOrder: 'post', confirmDelivery: 'post', cancelOrder: 'delete', trackShipment: 'get',
            customerProfile: 'get', sendPhoneOtp: 'post', verifyPhoneOtp: 'post',
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

    /**
     * A second attempt at paying an order whose online payment failed or was
     * abandoned. The order already exists and the cart was spent placing it,
     * so this is the way back to the gateway — not the checkout. Replies like
     * placeOrder(): `gateway_response.url` to send the shopper to. Pass
     * `payment_method_id` to switch to another online method.
     */
    async retryPayment(orderNumber, payload = {}) {
        const response = await this.call(['retryPayment', orderNumber], { body: payload });

        this.event.orderPlaced({
            orderNumber: response?.order_number ?? orderNumber,
            redirectUrl: response?.gateway_response?.url ?? null,
            response,
            retry: true,
        });

        return response;
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

    /*
     * What the store knows about the signed-in customer for a checkout
     * without an address step: `profile` (name, e-mail, phone, address
     * gathered from earlier orders, across the merchant's stores),
     * `recognized` when any of that was found, and `phone_verified` — the
     * account's flag, set when a sign-in code was accepted for its number.
     */
    async customerProfile() {
        return this.call('customerProfile');
    }

    /* A code to a number typed on the contact step. Answers `otp_delivery`
       ('sms' | 'direct') and, when direct, the `otp` itself. */
    async sendPhoneOtp(phone) {
        return this.call('sendPhoneOtp', { body: { phone: String(phone || '').trim() } });
    }

    /* Same answer shape as customerProfile(), for the number just verified. */
    async verifyPhoneOtp(phone, otp) {
        return this.call('verifyPhoneOtp', { body: { phone: String(phone || '').trim(), otp: String(otp || '').trim() } });
    }

    async orders(query = {}) {
        return this.call('orders', { params: query });
    }

    /* ---------------------------------------------- one order, afterwards */

    /**
     * The invoice PDF, handed to the browser as a download. `lang` picks the
     * document's language ('en' | 'ar'); the figures are always the store's
     * base currency, which is what the merchant books.
     */
    async downloadInvoice(orderNumber, lang = 'en') {
        // Rendering a PDF is slower than an API read; give it well past the client's 20 s default.
        const blob = await this.call(['invoice', orderNumber], { params: { lang }, responseType: 'blob', timeout: 90000 });

        CheckoutApi.saveBlob(blob, `Invoice_${orderNumber}_${lang}.pdf`);

        return blob;
    }

    /** { order_number, downloads[] } — empty until the order is paid. */
    async downloads(orderNumber) {
        return this.call(['downloads', orderNumber]);
    }

    /** Streams one digital file and saves it under `filename` (or the file's own name). */
    async downloadFile(orderNumber, fileId, filename = '') {
        // A digital file can be large; let the stream run for minutes, not seconds.
        const blob = await this.call(['downloadFile', orderNumber, fileId], { responseType: 'blob', timeout: 300000 });

        CheckoutApi.saveBlob(blob, filename || `download-${fileId}`);

        return blob;
    }

    /** { can_request_return, has_pending_return, return_deadline, returnable_items[] } */
    async returnEligibility(orderNumber) {
        return this.call(['returnEligibility', orderNumber]);
    }

    /** payload: { reason, customer_notes?, locale?, items?: [{ order_item_id, quantity }] } */
    async requestReturn(orderNumber, payload) {
        return this.call(['returnRequest', orderNumber], { body: payload });
    }

    async returnRequests(query = {}) {
        return this.call('returnRequests', { params: query });
    }

    /** The order-level (store experience) review: { rating 1–5, comment? }. */
    async reviewOrder(orderNumber, payload) {
        return this.call(['reviewOrder', orderNumber], { body: payload });
    }

    async confirmDelivery(orderNumber) {
        return this.call(['confirmDelivery', orderNumber], { body: {} });
    }

    /** By the order's numeric id — the one endpoint not keyed by order number. */
    async cancelOrder(orderId) {
        return this.call(['cancelOrder', orderId]);
    }

    /** Carrier tracking by order number or tracking number: { success, data: { tracking_details, public_tracking_url } }. */
    async trackShipment(identifier) {
        return this.call('trackShipment', { params: { identifier } });
    }

    /**
     * Hands a Blob to the browser as a file. Object URLs are revoked a beat
     * later so the click has consumed it first.
     */
    static saveBlob(blob, filename) {
        if (!(blob instanceof Blob) || typeof document === 'undefined') return;

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = filename;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
