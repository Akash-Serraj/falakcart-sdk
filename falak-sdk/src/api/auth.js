import BaseApi from './base.js';

/**
 * Customer authentication.
 *
 * FalakCart authenticates by one-time password on a phone number, not by
 * email and password: `send-otp` creates the customer if they are new, and
 * `verify-otp` returns a Sanctum token plus the user record. There is no
 * separate register step, so `is_new_user` on the verify response is the only
 * signal that a first-time customer just arrived.
 *
 * These endpoints live under /api/customer rather than /api/storefront, hence
 * the rooted paths.
 */
export default class AuthApi extends BaseApi {
    constructor(client, event, config, storage) {
        super(client);
        this.event = event;
        this.config = config;
        this.storage = storage;

        this.endpoints = {
            sendOtp: '/api/customer/auth/send-otp',
            verifyOtp: '/api/customer/auth/verify-otp',
            logout: '/api/customer/logout',
            user: '/api/customer/user',
            profile: '/api/customer/profile',
            updateProfile: '/api/customer/profile',
        };

        this.methods = { sendOtp: 'post', verifyOtp: 'post', logout: 'post', user: 'get', profile: 'get', updateProfile: 'put' };
    }

    /* --------------------------------------------------------------- state */

    get token() {
        return this.config.get('token') || this.storage.get('auth.token');
    }

    get user() {
        return this.config.get('user') || this.storage.get('auth.user');
    }

    isLoggedIn() {
        return !!this.token;
    }

    /* ---------------------------------------------------------------- flow */

    /**
     * Step one. The response says how the code was delivered; in local
     * development it comes back in the body as `otp`, which the login form
     * shows so nobody has to read the SMS log.
     */
    async sendOtp(phone) {
        const value = String(phone || '').trim();

        if (!value) return this.reject('A phone number is required.');

        const response = await this.call('sendOtp', { body: { phone: value } });

        this.storage.setWithTTL('auth.pending_phone', value, 15);
        this.event.otpSent(response, value);

        return response;
    }

    /**
     * Step two. On success the token is persisted and every later request
     * carries it — the client reads `config.token` when building headers.
     */
    async verifyOtp(phone, otp) {
        const value = String(phone || '').trim();
        const code = String(otp || '').trim();

        if (!value) return this.reject('A phone number is required.');
        if (!/^\d{6}$/.test(code)) return this.reject('The code is six digits.');

        let response;

        try {
            response = await this.call('verifyOtp', { body: { phone: value, otp: code } });
        } catch (error) {
            this.event.loginFailed(error, value);
            throw error;
        }

        this.persist(response.token, response.user);
        this.storage.remove('auth.pending_phone');

        // Registered and logged-in are the same request here, so both events
        // fire off the one flag rather than from separate endpoints.
        if (response.is_new_user) this.event.registered(response);

        this.event.loggedIn(response);

        return response;
    }

    /**
     * Clears local state first, then tells the server.
     *
     * Order matters: if the request fails the customer must still be logged out
     * in this browser, or a broken session leaves them stuck with a token the
     * server has already rejected.
     */
    async logout() {
        const hadToken = this.isLoggedIn();

        this.forget();
        this.event.loggedOut();

        if (!hadToken) return null;

        try {
            return await this.client.withoutNotifier(() => this.call('logout'));
        } catch (error) {
            // Already signed out locally; a 401 here is the expected outcome.
            return null;
        }
    }

    /**
     * The customer's profile with their order statistics:
     * { user, statistics: { total_orders, pending_orders, completed_orders, delivered_orders } }.
     */
    async profile() {
        if (!this.isLoggedIn()) return null;

        const response = await this.client.withoutNotifier(() => this.call('profile'));
        const user = response?.user || null;

        if (user) this.persist(this.token, user);

        return {
            user,
            statistics: response?.statistics || {},
            // The merchant's extra profile questions — see <falak-custom-fields>.
            customFieldsSchema: response?.custom_fields_schema || [],
        };
    }

    /**
     * Saves name / email / phone / address / custom_fields. Only the keys
     * given are sent, so a form can update one field without resending the
     * rest. The stored customer is refreshed and `auth::user.fetched` fires,
     * so every user menu on the page shows the new name at once.
     */
    async updateProfile(data = {}) {
        if (!this.isLoggedIn()) return this.reject('Sign in to update the profile.');

        const body = {};
        for (const key of ['name', 'email', 'phone', 'address']) {
            if (data[key] !== undefined && data[key] !== null) body[key] = data[key];
        }
        if (data.customFields !== undefined && data.customFields !== null) body.custom_fields = data.customFields;

        const response = await this.client.withoutNotifier(() => this.call('updateProfile', { body }));
        const user = response?.user || { ...(this.user || {}), ...body };

        this.persist(this.token, user);
        this.event.userFetched(user);
        this.event.profileUpdated({ user, changes: body });

        return user;
    }

    /** Re-reads the customer, e.g. after a profile change elsewhere. */
    async fetchUser() {
        if (!this.isLoggedIn()) return null;

        try {
            const response = await this.client.withoutNotifier(() => this.call('user'));
            const user = response?.user || response?.data || response;

            this.persist(this.token, user);
            this.event.userFetched(user);

            return user;
        } catch (error) {
            // A token the server no longer honours is worse than none at all:
            // leaving it in place makes every later request fail the same way.
            if (error.falak?.status === 401) {
                this.forget();
                this.event.tokenInvalid(error);
            }

            return null;
        }
    }

    /* -------------------------------------------------------------- storage */

    persist(token, user) {
        if (token) {
            this.config.set('token', token);
            this.storage.set('auth.token', token);
        }

        if (user) {
            this.config.set('user', user);
            this.storage.set('auth.user', user);
        }

        return this;
    }

    forget() {
        this.config.set('token', null);
        this.config.set('user', null);
        this.storage.remove('auth.token');
        this.storage.remove('auth.user');

        return this;
    }

    /**
     * Runs a callback once the customer is signed in, opening the login modal
     * if they are not.
     *
     * This is the primitive every gated action needs — rate a product, save a
     * wishlist item, check out — so each of them does not grow its own
     * "log in and then come back" dance.
     */
    requireLoginThen(callback) {
        if (this.isLoggedIn()) return Promise.resolve(callback());

        return new Promise(resolve => {
            const off = this.event.onLoggedIn(() => {
                off?.();
                resolve(callback());
            });

            this.event.loginRequired();
        });
    }
}
