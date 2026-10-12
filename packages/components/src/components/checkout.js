import FalakElement from '../base.js';

/**
 * <falak-checkout></falak-checkout>
 * <falak-checkout thank-you-url="/thank-you/{order}" cart-url="/cart"></falak-checkout>
 *
 * The checkout, the way Salla walks it: the signed-in customer at the top,
 * then delivery (shipping method + address), then payment, then review and
 * "Place order" — with the order summary (lines, coupon, totals) beside it.
 *
 * Data comes from falak.checkout and falak.cart; nothing is hard-coded to a
 * store. Shipping methods are whatever the merchant enabled — carrier
 * gateways (countries/cities from the carrier) or the merchant's own
 * couriers (their own country/city lists) — and payment methods likewise,
 * with cash-on-delivery offered only when the chosen courier supports it.
 * Totals are always the API's (`calculate-total`), never summed here.
 *
 * A guest sees a sign-in card (the login modal) and the checkout resumes
 * on `auth::logged.in`. Placing the order either redirects to the payment
 * gateway (`gateway_response.url`) or lands on the thank-you page.
 *
 * | attribute     | role                                                    |
 * | thank-you-url | where a placed order goes; `{order}` = order number     |
 * | cart-url      | back link (default /cart)                               |
 */
export default class FalakCheckout extends FalakElement {
    static observedAttributes = ['thank-you-url', 'cart-url'];

    /**
     * What this shipping method needs — read through the SDK.
     *
     * The SDK owns this so a theme building its own checkout gets the same
     * answers instead of rediscovering that LogesTechs needs a district and
     * Fastcoo a national address. It also handles the fallback for a cached
     * payload that predates the `capabilities` field.
     *
     * The `?.` chain is not defensive habit: the SDK and these components are
     * SEPARATE bundles loaded from `window`, so a page can genuinely be serving
     * an older SDK than this component. When that happens the method below
     * keeps the component working rather than throwing mid-render.
     */
    methodCapabilities(method) {
        const viaSdk = this.sdk?.checkout?.capabilities;

        if (typeof viaSdk === 'function') {
            return viaSdk.call(this.sdk.checkout, method);
        }

        return FalakCheckout.capabilitiesWithoutSdk(method);
    }

    /**
     * The same answer without the SDK, for an older SDK bundle.
     *
     * Deliberately minimal — just enough for the form to render and validate
     * correctly. The SDK's version is the real one.
     */
    static capabilitiesWithoutSdk(method) {
        const none = {
            integrated: false,
            requires_district: false,
            requires_national_address: false,
            checkout_fields: [],
        };

        if (!method || method.shipment_type === 'private_courier') {
            return none;
        }

        if (method.capabilities) {
            return { ...none, ...method.capabilities };
        }

        /*
         * The last carrier list on the client, and only reachable with an old
         * SDK and an old payload at once. `shipflow` is included: the earlier
         * version of this table listed logestechs and delex but not shipflow,
         * which runs on the same adapter and refuses a shipment without a
         * district just as firmly — so a Shipflow order could not be placed at
         * all and nothing said why.
         */
        const district = {
            key: 'district',
            type: 'select',
            label_key: 'checkout.district',
            required: true,
            depends_on: 'city',
            options_from: 'districts',
        };

        const legacy = {
            logestechs: { requires_district: true, checkout_fields: [district] },
            delex: { requires_district: true, checkout_fields: [district] },
            shipflow: { requires_district: true, checkout_fields: [district] },
            fastcoo: {
                requires_national_address: true,
                checkout_fields: [{
                    key: 'national_address',
                    type: 'text',
                    label_key: 'checkout.national_address',
                    required: true,
                    depends_on: null,
                    options_from: null,
                    max_length: 32,
                    placeholder: 'ABCD1234',
                }],
            },
        };

        return { ...none, ...(legacy[String(method.code || '').toLowerCase()] || {}) };
    }

    get thankYouUrl() { return this.attr('thank-you-url', '/thank-you/{order}'); }
    get cartUrl() { return this.attr('cart-url', '/cart'); }
    get isRtl() { return this.sdk.lang.locale === 'ar'; }

    /* ------------------------------------------------------------- state */

    initialState() {
        const user = this.sdk.auth.user || {};

        return {
            step: 1,                 // 1 delivery, 2 payment, 3 review
            loading: true,
            error: '',
            shippingMethods: [],
            paymentMethods: [],
            needsShipping: true,     // false once the cart is read and no line in it ships
            /*
             * The contact step's own state (digital orders only). `verifiedPhone`
             * is the number the account's flag or a fresh code vouches for; the
             * step counts the phone as verified only while the field still
             * holds that number. `otpPhone` is the number a code was sent to.
             */
            contact: {
                loading: false, recognized: false,
                verified: false, verifiedPhone: '',
                otpStep: false, otpPhone: '', code: '', devCode: null,
                sending: false, verifying: false, error: '',
            },            method: null,            // chosen shipping method (object)
            countries: [],           // [{code, name}]
            cities: [],              // [{value, name}]
            districts: [],           // [{id, name, nationalAddress?}]
            /*
             * Whether the district lookup has been attempted and what came of
             * it. An empty list used to mean both "not needed" and "the
             * carrier did not answer", so a failed lookup silently removed a
             * REQUIRED field and the order was then rejected for missing it.
             */
            districtsLoading: false,
            districtsFailed: false,
            citiesLoading: false,
            /*
             * What the shopper has typed to narrow the city list.
             *
             * Filtering happens here rather than on the server because the
             * list is already loaded — Fastcoo serves 3,185 cities — so a
             * round trip per keystroke would be slower and would break while
             * offline. It also keeps the wire contract unchanged.
             */
            citySearch: '',
            /* Whether the city panel is open. */
            cityOpen: false,
            form: {
                name: user.name || '',
                phone: user.phone || '',
                email: user.email || '',
                country: '',
                city: '',
                cityName: '',
                district: '',
                districtName: '',
                nationalAddress: '',
                street: '',
                postal: '',
                notes: '',
            },
            payment: null,           // chosen payment method id
            totals: null,
            calculating: false,
            placing: false,
        };
    }

    /*
     * Whether this checkout has a delivery step at all. Two things can
     * take it away: the store has no courier configured, or nothing in the
     * cart ships — downloads, vouchers, services. The second is what the
     * legacy storefront already did (its shipping block drops the address
     * and courier steps for such a cart), and what the server expects:
     * validateCheckoutRequest() makes the shipment fields optional exactly
     * when no cart line is shippable. Before this read the cart, a basket
     * of downloads was still asked for a street and a courier.
     */
    get hasShipping() { return this.state.needsShipping && this.state.shippingMethods.length > 0; }

    /*
     * Whether there is a first step before payment. Two shapes of it: the
     * delivery step when the order ships, or the contact step when nothing
     * does — a download still needs a name and an e-mail to be sent to, the
     * way the legacy storefront's checkout asks for them. Only a cart that
     * ships from a store with no courier configured has neither.
     */
    get hasStepOne() { return this.hasShipping || !this.state.needsShipping; }

    /** Any line that ships means the order ships. An unread or empty cart is assumed to. */
    static needsShipping(lines) {
        return !Array.isArray(lines) || lines.length === 0 || lines.some(line => line.shippable !== false);
    }
    get isCod() { return this.paymentMethod()?.code === 'cash_on_delivery'; }

    paymentMethod() {
        return this.state.paymentMethods.find(m => String(m.id) === String(this.state.payment)) || null;
    }

    /** COD only when the courier says so (carrier gateways decide server-side). */
    eligiblePaymentMethods() {
        const method = this.state.method;

        return this.state.paymentMethods.filter(m => {
            if (m.code !== 'cash_on_delivery') return true;
            if (!this.hasShipping) return false;
            if (method?.shipment_type === 'private_courier') return this.truthy(method.cash_on_delivery);
            return true;
        });
    }

    truthy(value) { return value === true || value === 1 || value === '1'; }

    /** A country's name from the list the server gave for this method. */
    countryName(code) {
        return this.state.countries.find(c => c.code === code)?.name || code;
    }

    /**
     * A private courier's countries, named by the server (`country_options`,
     * from the platform's countries table) instead of a list kept in the SDK.
     * A platform too old to send them leaves the bare codes.
     */
    courierCountries(method) {
        const options = Array.isArray(method.country_options) ? method.country_options : [];

        return options.length
            ? options.map(c => ({ code: c.code, name: (this.isRtl && c.name_ar) || c.name || c.code }))
            : this.asList(method.countries).map(code => ({ code, name: code }));
    }

    /**
     * What a shopper chose on one line — "أحمر · كبير".
     *
     * `line.options` is the server's named version, already in the merchant's
     * order and this locale, so the summary agrees with the cart and the
     * product page. The raw attribute map is the fallback for a line read
     * before the API carried it.
     */
    lineOptions(line) {
        if (Array.isArray(line?.options) && line.options.length) {
            return line.options.map(o => o.value_label ?? o.value).filter(Boolean).join(' · ');
        }

        const attributes = line?.variation?.attributes;

        if (!attributes || typeof attributes !== 'object') return '';

        return Object.values(attributes)
            .filter(v => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
            .join(' · ');
    }

    /* ------------------------------------------------------------ render */

    render() {
        this.classList.add('f-checkout');

        if (!this.state) this.state = this.initialState();

        if (!this.sdk.auth.isLoggedIn()) {
            this.innerHTML = this.signInHtml();
            return;
        }

        this.syncForm();

        // Steps are numbered 1 delivery, 2 payment, 3 review throughout; the
        // bar counts only the ones this order has, so a download starts at
        // "step 1 of 2" rather than "step 2 of 3" with nothing before it.
        const stepsTotal = this.hasStepOne ? 3 : 2;
        const stepShown = this.hasStepOne ? this.state.step : this.state.step - 1;

        this.innerHTML = `
            ${this.state.loading ? '' : `<falak-progress-bar class="f-checkout__progress" value="${stepShown}" max="${stepsTotal}"
                                 label="${this.escape(this.trans('checkout.step_progress', { step: stepShown, total: stepsTotal }))}"></falak-progress-bar>`}
            <div class="f-checkout__layout">
                <main class="f-checkout__main">
                    ${this.customerHtml()}
                    ${this.state.loading ? `<div class="f-checkout__loading"><span class="f-modal__spinner" aria-hidden="true"></span></div>` : `
                        ${this.state.error ? `<p class="f-checkout__error" role="alert">${this.escape(this.state.error)}</p>` : ''}
                        ${this.contactHtml()}
                        ${this.deliveryHtml()}
                        ${this.paymentHtml()}
                        ${this.reviewHtml()}`}
                </main>
                <aside class="f-checkout__aside">
                    ${this.summaryHtml()}
                </aside>
            </div>`;
    }

    signInHtml() {
        return `
            <div class="f-checkout__signin">
                <h2 class="f-checkout__title">${this.escape(this.trans('checkout.sign_in_title'))}</h2>
                <p class="f-checkout__hint">${this.escape(this.trans('checkout.sign_in_hint'))}</p>
                <button type="button" class="f-btn f-btn--solid f-btn--primary" data-checkout-signin>${this.escape(this.trans('auth.login'))}</button>
                <a class="f-checkout__back" href="${this.escape(this.cartUrl)}">${this.escape(this.trans('checkout.back_to_cart'))}</a>
            </div>`;
    }

    customerHtml() {
        const user = this.sdk.auth.user || {};

        return `
            <section class="f-checkout__step f-checkout__step--done" data-checkout-customer>
                <header class="f-checkout__step-head">
                    <span class="f-checkout__step-icon" aria-hidden="true">${FalakCheckout.ICONS.user}</span>
                    <div>
                        <h3 class="f-checkout__step-title">${this.escape(this.trans('checkout.welcome', { name: user.name || '' }))}</h3>
                        ${user.phone ? `<small class="f-checkout__step-sub" dir="ltr">${this.escape(user.phone)}</small>` : ''}
                    </div>
                </header>
            </section>`;
    }

    stepHead(number, title, sub, icon, state) {
        return `
            <header class="f-checkout__step-head">
                <span class="f-checkout__step-icon${state === 'active' ? ' is-active' : ''}" aria-hidden="true">${icon}</span>
                <div class="f-checkout__step-text">
                    <h3 class="f-checkout__step-title">${this.escape(title)}</h3>
                    ${sub ? `<small class="f-checkout__step-sub">${this.escape(sub)}</small>` : ''}
                </div>
                ${state === 'done' ? `<button type="button" class="f-btn f-btn--outline f-btn--light-outline f-btn--small f-checkout__edit" data-checkout-goto="${number}">${this.escape(this.trans('checkout.edit'))}</button>` : ''}
            </header>`;
    }

    stepState(number) {
        if (this.state.step === number) return 'active';
        return this.state.step > number ? 'done' : 'todo';
    }

    /* ---- contact details, when nothing ships */

    /*
     * Step one for an order with no delivery — downloads, vouchers, services.
     * It mirrors the legacy storefront's contact step, which is not a form
     * with a decorative tick beside the phone but a small flow:
     *
     *   - on open, the store's checkout profile is read: the name, e-mail
     *     and phone it already holds for this customer, gathered from their
     *     earlier orders. Found details are filled in and announced
     *     ("we found your details"), and the phone counts as verified when
     *     the account's `is_otp_verified` flag says a sign-in code was once
     *     accepted for it;
     *   - the phone can be changed. The moment it no longer matches the
     *     verified number the tick goes and a "send code" appears; the code
     *     is checked by the checkout's own verify endpoint, which also hands
     *     back whatever profile exists behind the new number;
     *   - the step cannot be left with an unverified phone.
     *
     * Silent when the cart ships: the delivery step owns those fields then,
     * and a store that merely has no courier keeps its payment-first opening.
     */
    contactHtml() {
        if (this.state.needsShipping) return '';

        const state = this.stepState(1);
        const f = this.state.form;
        const c = this.state.contact;
        const verified = this.phoneVerified();
        const summary = state === 'done'
            ? `<p class="f-checkout__done-line">${this.escape(f.name)} · <span dir="ltr">${this.escape(f.phone)}</span>${f.email ? ` · <span dir="ltr">${this.escape(f.email)}</span>` : ''}</p>`
            : '';

        return `
            <section class="f-checkout__step f-checkout__step--${state}" data-checkout-step="1" data-checkout-contact-step>
                ${this.stepHead(1, this.trans('checkout.contact_title'), this.trans('checkout.contact_hint'), FalakCheckout.ICONS.user, state)}
                ${summary}
                ${state === 'active' ? `
                <div class="f-checkout__body">
                    ${c.recognized ? `<p class="f-checkout__recognized" data-checkout-recognized>${this.escape(this.trans('checkout.details_found'))}</p>` : ''}
                    <form class="f-checkout__form" data-checkout-contact novalidate>
                        <div class="f-checkout__grid">
                            ${this.field('name', 'checkout.full_name', f.name, 'text', true)}
                            <label class="f-field">
                                <span class="f-field__label">${this.escape(this.trans('checkout.phone'))} *</span>
                                <span class="f-checkout__phone-row">
                                    <input class="f-input" type="tel" name="phone" value="${this.escape(f.phone || '')}" dir="ltr" required ${c.otpStep ? 'readonly' : ''} data-checkout-field="phone" data-checkout-phone>
                                    <button type="button" class="f-btn f-btn--outline f-btn--light-outline f-btn--small" data-checkout-send-otp ${verified || c.otpStep ? 'hidden' : ''} ${c.sending || c.loading ? 'disabled' : ''}>${this.escape(this.trans('auth.verify'))}</button>
                                </span>
                                <small class="f-checkout__tag" data-checkout-phone-status ${verified ? '' : 'hidden'}>${this.escape(this.trans(c.recognized ? 'checkout.phone_verified_details' : 'checkout.phone_verified'))}</small>
                                <small class="f-checkout__hint" data-checkout-phone-unverified ${verified || c.otpStep ? 'hidden' : ''}>${this.escape(this.trans('checkout.phone_unverified'))}</small>
                            </label>
                            ${c.otpStep ? `
                            <div class="f-field f-field--wide f-checkout__otp">
                                <span class="f-field__label">${this.escape(this.trans('auth.code'))}</span>
                                <small class="f-checkout__hint">${this.escape(this.trans('auth.code_hint', { phone: c.otpPhone }))}</small>
                                ${c.devCode ? `<small class="f-checkout__hint">${this.escape(this.trans('auth.dev_code', { code: c.devCode }))}</small>` : ''}
                                <input class="f-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" value="${this.escape(c.code)}" ${c.verifying ? 'disabled' : ''} data-checkout-otp>
                                <span class="f-checkout__otp-actions">
                                    <button type="button" class="f-btn f-btn--solid f-btn--primary f-btn--small" data-checkout-verify-otp ${c.verifying ? 'disabled' : ''}>${this.escape(this.trans('auth.verify'))}</button>
                                    <button type="button" class="f-btn f-btn--outline f-btn--light-outline f-btn--small" data-checkout-send-otp ${c.sending ? 'disabled' : ''}>${this.escape(this.trans('auth.resend'))}</button>
                                    <button type="button" class="f-btn f-btn--outline f-btn--light-outline f-btn--small" data-checkout-cancel-otp>${this.escape(this.trans('common.cancel'))}</button>
                                </span>
                            </div>` : ''}
                            ${this.field('email', 'checkout.email', f.email, 'email', true, 'ltr', null, 'f-field--wide')}
                        </div>
                        <label class="f-field f-field--wide">
                            <span class="f-field__label">${this.escape(this.trans('checkout.notes'))}</span>
                            <textarea class="f-input" name="notes" rows="2" data-checkout-field="notes" placeholder="${this.escape(this.trans('checkout.notes_hint_digital'))}">${this.escape(f.notes)}</textarea>
                        </label>
                        <p class="f-checkout__error" role="alert" data-checkout-form-error ${c.error ? '' : 'hidden'}>${this.escape(c.error)}</p>
                        <button type="submit" class="f-btn f-btn--solid f-btn--primary f-btn--wide">${this.escape(this.trans('checkout.continue_to_payment'))}</button>
                    </form>
                </div>` : ''}
            </section>`;
    }

    /* Verified means: the flag or a code vouched for a number, AND the field
       still holds that number. Editing the phone withdraws it at once. */
    phoneVerified() {
        const c = this.state.contact;
        return c.verified && FalakCheckout.phonesMatch(this.state.form.phone, c.verifiedPhone);
    }

    /* Same comparison the legacy storefront uses: digits only, and a number
       typed without its country code matches the stored one on its last
       nine or more digits. */
    static phoneDigits(value) {
        let digits = String(value || '').replace(/\D/g, '');
        if (digits.startsWith('00')) digits = digits.slice(2);
        return digits;
    }

    static phonesMatch(left, right) {
        const a = FalakCheckout.phoneDigits(left);
        const b = FalakCheckout.phoneDigits(right);
        if (!a || !b) return false;
        if (a === b) return true;
        const shorter = a.length <= b.length ? a : b;
        const longer = a.length > b.length ? a : b;
        return shorter.length >= 9 && longer.endsWith(shorter);
    }

    /* The saved profile over the form. `overwrite` is the legacy rule: a
       recognized customer's stored details replace the account defaults; an
       unrecognized lookup only fills what is still blank. */
    applyContactProfile(response, overwrite) {
        const p = response?.profile || {};
        const f = this.state.form;
        for (const key of ['name', 'email', 'phone']) {
            const value = typeof p[key] === 'string' ? p[key].trim() : '';
            if (!value || !(overwrite || !String(f[key] || '').trim())) continue;
            f[key] = value;
            /* Into the live input as well: render() re-reads the on-screen fields
               into state first (syncForm), so a value set on state alone would
               be undone by the very render meant to show it. */
            const input = this.querySelector('[data-checkout-field="' + key + '"]');
            if (input) input.value = value;
        }
    }

    async loadContactProfile() {
        const c = this.state.contact;
        if (c.loading) return;
        c.loading = true;
        this.render();

        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.customerProfile());
            c.recognized = !!response?.recognized;
            this.applyContactProfile(response, c.recognized);
            if (response?.phone_verified) {
                c.verified = true;
                c.verifiedPhone = response.profile?.phone || this.state.form.phone || '';
            }
        } catch (error) {
            /* The form stays usable with the account's own details; a code can
               still verify the number by hand. */
        } finally {
            c.loading = false;
            this.render();
        }
    }

    /* Typing in the phone field: no re-render (it would drop the caret), the
       tick, the warning and the send button are patched in place. A number
       changed while a code is pending abandons that code. */
    onPhoneInput(input) {
        const c = this.state.contact;
        this.state.form.phone = input.value;

        if (c.otpStep && !FalakCheckout.phonesMatch(input.value, c.otpPhone)) {
            c.otpStep = false; c.code = ''; c.devCode = null;
            this.render();
            this.querySelector('[data-checkout-phone]')?.focus();
            return;
        }

        const verified = this.phoneVerified();
        const status = this.querySelector('[data-checkout-phone-status]');
        const warning = this.querySelector('[data-checkout-phone-unverified]');
        const send = this.querySelector('.f-checkout__phone-row [data-checkout-send-otp]');
        if (status) status.hidden = !verified;
        if (warning) warning.hidden = verified || c.otpStep;
        if (send) send.hidden = verified || c.otpStep;
    }

    async sendPhoneOtp() {
        this.syncForm();
        const c = this.state.contact;
        const phone = String(this.state.form.phone || '').trim();
        c.error = '';
        if (!phone) { c.error = this.trans('auth.phone_required'); this.render(); return; }
        // Nine digits is the shortest national number the store ships to; anything
        // shorter is a typo, and the legacy step refuses it before sending too.
        if (FalakCheckout.phoneDigits(phone).length < 9) { c.error = this.trans('checkout.phone_invalid'); this.render(); return; }
        if (c.sending) return;

        c.sending = true;
        this.render();
        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.sendPhoneOtp(phone));
            c.otpStep = true;
            c.otpPhone = phone;
            c.devCode = response?.otp_delivery === 'direct' && response?.otp ? String(response.otp) : null;
            c.code = c.devCode || '';
        } catch (error) {
            c.error = error?.message || this.trans('common.load_failed');
        } finally {
            c.sending = false;
            this.render();
            this.querySelector('[data-checkout-otp]')?.focus();
        }
    }

    async verifyPhoneOtp() {
        const c = this.state.contact;
        c.code = String(this.querySelector('[data-checkout-otp]')?.value ?? c.code).replace(/\D/g, '').slice(0, 6);
        c.error = '';
        if (!/^\d{6}$/.test(c.code)) { c.error = this.trans('auth.code_invalid'); this.render(); return; }
        if (c.verifying) return;

        c.verifying = true;
        this.render();
        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.verifyPhoneOtp(c.otpPhone, c.code));
            c.recognized = !!response?.recognized;
            this.applyContactProfile(response, c.recognized);
            c.verified = true;
            c.verifiedPhone = response?.profile?.phone || c.otpPhone;
            this.state.form.phone = c.verifiedPhone;
            c.otpStep = false; c.otpPhone = ''; c.code = ''; c.devCode = null;
        } catch (error) {
            c.error = error?.message || this.trans('auth.code_invalid');
        } finally {
            c.verifying = false;
            this.render();
        }
    }

    /* ---- delivery */

    deliveryHtml() {
        if (!this.hasShipping) return '';

        const state = this.stepState(1);
        const f = this.state.form;
        const method = this.state.method;

        const summary = state === 'done' && method
            ? `<p class="f-checkout__done-line">${this.escape(method.name)} · ${this.escape([f.street, f.districtName, f.cityName || f.city, this.countryName(f.country)].filter(Boolean).join(', '))}</p>`
            : '';

        return `
            <section class="f-checkout__step f-checkout__step--${state}" data-checkout-step="1">
                ${this.stepHead(1, this.trans('checkout.delivery_title'), this.trans('checkout.delivery_hint'), FalakCheckout.ICONS.truck, state)}
                ${summary}
                ${state === 'active' ? `
                <div class="f-checkout__body">
                    <div class="f-checkout__methods" role="radiogroup" aria-label="${this.escape(this.trans('checkout.shipping_method'))}">
                        ${this.state.shippingMethods.map(m => this.methodCardHtml(m)).join('')}
                    </div>
                    ${method ? this.addressFormHtml() : `<p class="f-checkout__hint">${this.escape(this.trans('checkout.choose_shipping'))}</p>`}
                </div>` : ''}
            </section>`;
    }

    methodCardHtml(m) {
        const chosen = this.state.method && String(this.state.method.id) === String(m.id) && this.state.method.shipment_type === m.shipment_type;
        const cod = this.truthy(m.cash_on_delivery);

        return `
            <label class="f-checkout__method${chosen ? ' is-selected' : ''}">
                <input type="radio" name="shipping_method" value="${m.shipment_type}:${m.id}" ${chosen ? 'checked' : ''} data-checkout-method>
                ${m.logo ? `<img class="f-checkout__method-logo" src="${this.escape(m.logo)}" alt="">` : `<span class="f-checkout__method-logo f-checkout__method-logo--empty" aria-hidden="true">${FalakCheckout.ICONS.box}</span>`}
                <span class="f-checkout__method-text">
                    <b>${this.escape(m.name)}</b>
                    ${m.description ? `<small>${this.escape(m.description)}</small>` : ''}
                    ${m.shipping_time ? `<small>${this.escape(m.shipping_time)}</small>` : ''}
                    ${cod ? `<small class="f-checkout__tag">${this.escape(this.trans('checkout.cod_available'))}</small>` : ''}
                </span>
            </label>`;
    }

    addressFormHtml() {
        const f = this.state.form;
        const m = this.state.method;
        const isCourier = m.shipment_type === 'private_courier';
        const freeCity = isCourier && this.truthy(m.all_cities);
        const caps = this.methodCapabilities(m);
        /*
         * The carrier's own declared extra fields, served by the backend.
         * The renderer and the validator both read THIS, which is what stops
         * them disagreeing — the previous pair of booleans let the validator
         * demand a district the renderer had not drawn.
         */
        const extraFields = isCourier ? [] : (caps.checkout_fields || []);

        const countryOptions = this.state.countries.map(c =>
            `<option value="${this.escape(c.code)}" ${c.code === f.country ? 'selected' : ''}>${this.escape(c.name)}</option>`).join('');

        /*
         * A SELECT, like country, whenever the carrier has a city list.
         *
         * It used to be a free-text input with a datalist, and that was the
         * root of the district bug: `chooseCity()` — the only thing that loads
         * districts — was wired to `[data-checkout-city]`, a select that no
         * longer existed in the markup, so it never ran for any city and the
         * district list stayed permanently empty.
         *
         * A select also stops the shopper inventing a city the carrier does not
         * serve, and carries the carrier's own city id as the option value
         * instead of recovering it by matching a typed name back.
         */
        const cityLabel = c => (this.isRtl && c.name_ar) ? c.name_ar : c.name;
        const matches = this.matchingCities();

        /*
         * The chosen city is always an option, even when the current search
         * does not match it — otherwise typing a new search would silently
         * deselect what the shopper had already picked.
         */
        const chosen = this.state.cities.find(c => String(c.value) === String(f.city));
        const shown = chosen && !matches.some(c => String(c.value) === String(chosen.value))
            ? [chosen, ...matches]
            : matches;

        /*
         * ONE control: a button showing the chosen city, which opens a panel
         * holding the search box and the filtered list.
         *
         * A separate search input beside a separate <select> was two controls
         * for one decision, and it was not obvious the box filtered the list
         * below it. This is the shape a select2-style widget has, built from
         * plain elements so it needs no library and keeps working without JS
         * for the no-list case below.
         */
        const cityField = this.state.cities.length
            ? `<div class="f-combo${this.state.cityOpen ? ' is-open' : ''}" data-checkout-city-combo>
                   <button type="button" class="f-input f-combo__toggle" data-checkout-city-toggle
                           aria-expanded="${this.state.cityOpen ? 'true' : 'false'}" aria-haspopup="listbox"
                           ${this.state.citiesLoading ? 'disabled' : ''}>
                       <span class="f-combo__value${f.city ? '' : ' is-placeholder'}">${this.escape(
                           f.city ? (f.cityName || this.cityNameFor(f.city)) : this.trans('checkout.choose_city')
                       )}</span>
                       <span class="f-combo__caret" aria-hidden="true">▾</span>
                   </button>
                   ${this.state.cityOpen ? `
                   <div class="f-combo__panel" role="listbox">
                       <input class="f-input f-combo__search" type="search" autocomplete="off"
                              value="${this.escape(this.state.citySearch)}"
                              placeholder="${this.escape(this.trans('checkout.search_city'))}"
                              data-checkout-city-search aria-label="${this.escape(this.trans('checkout.search_city'))}">
                       <ul class="f-combo__list">
                           ${shown.length ? shown.map(c => `
                           <li role="option" aria-selected="${String(c.value) === String(f.city) ? 'true' : 'false'}">
                               <button type="button" class="f-combo__option${String(c.value) === String(f.city) ? ' is-chosen' : ''}"
                                       data-checkout-city-option="${this.escape(c.value)}">${this.escape(cityLabel(c))}</button>
                           </li>`).join('') : `
                           <li class="f-combo__empty">${this.escape(this.trans('checkout.no_cities'))}</li>`}
                       </ul>
                       ${this.state.cities.length > shown.length ? `
                       <small class="f-combo__hint">${this.escape(this.trans('checkout.cities_shown', {
                           shown: shown.length,
                           total: this.state.cities.length,
                       }))}</small>` : ''}
                   </div>` : ''}
               </div>`
            /*
             * No list: a text input, because a disabled select would lock the
             * shopper out. That is the real case for Aramex — its account is
             * blocked so no list can be fetched — and for a private courier
             * serving all cities.
             */
            : `<input class="f-input" type="text" name="city" value="${this.escape(f.cityName || f.city)}"
                      placeholder="${this.escape(this.state.citiesLoading ? this.trans('common.loading') : this.trans('checkout.city'))}"
                      autocomplete="address-level2" data-checkout-field="cityName">`;
        void freeCity;

        return `
            <form class="f-checkout__form" data-checkout-address novalidate>
                <div class="f-checkout__grid">
                    ${this.field('name', 'checkout.full_name', f.name, 'text', true)}
                    ${this.field('phone', 'checkout.phone', f.phone, 'tel', true, 'ltr')}
                    ${this.field('email', 'checkout.email', f.email, 'email', false, 'ltr')}
                    <label class="f-field">
                        <span class="f-field__label">${this.escape(this.trans('checkout.country'))} *</span>
                        <select class="f-input" name="country" required data-checkout-country>
                            <option value="">${this.escape(this.trans('checkout.choose_country'))}</option>
                            ${countryOptions}
                        </select>
                    </label>
                    <label class="f-field">
                        <span class="f-field__label">${this.escape(this.trans('checkout.city'))}</span>
                        ${cityField}
                    </label>
                    ${extraFields.map(field => this.checkoutFieldHtml(field)).join("")}
                    ${this.field('street', 'checkout.street', f.street, 'text', true, null, null, 'f-field--wide')}
                    ${this.field('postal', 'checkout.postal_code', f.postal, 'text', false, 'ltr')}
                </div>
                <label class="f-field f-field--wide">
                    <span class="f-field__label">${this.escape(this.trans('checkout.notes'))}</span>
                    <textarea class="f-input" name="notes" rows="2" data-checkout-field="notes" placeholder="${this.escape(this.trans('checkout.notes_hint'))}">${this.escape(f.notes)}</textarea>
                </label>
                <p class="f-checkout__error" role="alert" data-checkout-form-error hidden></p>
                <button type="submit" class="f-btn f-btn--solid f-btn--primary f-btn--wide">${this.escape(this.trans('checkout.continue_to_payment'))}</button>
            </form>`;
    }

    field(name, key, value, type, required, dir = null, placeholder = null, extra = '') {
        return `
            <label class="f-field ${extra}">
                <span class="f-field__label">${this.escape(this.trans(key))}${required ? ' *' : ''}</span>
                <input class="f-input" type="${type}" name="${name}" value="${this.escape(value || '')}" ${required ? 'required' : ''}
                       ${dir ? `dir="${dir}"` : ''} ${placeholder ? `placeholder="${this.escape(placeholder)}"` : ''} data-checkout-field="${name}">
            </label>`;
    }

    /* ---- payment */

    paymentHtml() {
        const number = 2;
        const state = this.stepState(number);
        const methods = this.eligiblePaymentMethods();
        const chosen = this.paymentMethod();

        return `
            <section class="f-checkout__step f-checkout__step--${state}" data-checkout-step="2">
                ${this.stepHead(number, this.trans('checkout.payment_title'), this.trans('checkout.payment_hint'), FalakCheckout.ICONS.card, state)}
                ${state === 'done' && chosen ? `<p class="f-checkout__done-line">${this.escape(chosen.name)}</p>` : ''}
                ${state === 'active' ? `
                <div class="f-checkout__body">
                    ${methods.length ? `
                    <div class="f-checkout__methods" role="radiogroup" aria-label="${this.escape(this.trans('checkout.payment_method'))}">
                        ${methods.map(m => `
                            <label class="f-checkout__method${String(m.id) === String(this.state.payment) ? ' is-selected' : ''}">
                                <input type="radio" name="payment_method" value="${this.escape(m.id)}" ${String(m.id) === String(this.state.payment) ? 'checked' : ''} data-checkout-payment>
                                ${m.logo ? `<img class="f-checkout__method-logo" src="${this.escape(m.logo)}" alt="">` : `<span class="f-checkout__method-logo f-checkout__method-logo--empty" aria-hidden="true">${FalakCheckout.ICONS.card}</span>`}
                                <span class="f-checkout__method-text"><b>${this.escape(m.name)}</b>${m.description ? `<small>${this.escape(m.description)}</small>` : ''}${this.chargeNote(m)}</span>
                            </label>`).join('')}
                    </div>
                    <button type="button" class="f-btn f-btn--solid f-btn--primary f-btn--wide" data-checkout-review ${this.state.payment ? '' : 'disabled'}>${this.escape(this.trans('checkout.review_order'))}</button>`
                    : `<p class="f-checkout__error" role="alert">${this.escape(this.trans('checkout.no_payment_methods'))}</p>`}
                </div>` : ''}
            </section>`;
    }

    /**
     * "You'll be charged 12.50 USD" under a method that settles in something
     * other than what the shopper is reading — Tap falling back to USD, a BNPL
     * gateway that only takes SAR. The server says which currency each method
     * charges (`charge_currency`), and the amount is the order total converted
     * at the page's rates, the same ones the gateway charge will use. Silent
     * when the method charges the display currency.
     *
     * The API totals only exist once the shopper reaches the review step, so
     * while the methods are being chosen the cart's own total stands in —
     * close enough to tell a shopper reading KWD that COD settles in SAR.
     * The review step calls this again with the exact figure.
     */
    chargeNote(method) {
        const charge = String(method?.charge_currency || '').toUpperCase();
        const display = this.sdk.localization.currency;
        const total = Number(this.state.totals?.total ?? this.sdk.cart.summary?.total);

        if (!charge || charge === display || !Number.isFinite(total)) return '';

        // Printed AS the charge currency: money() would otherwise take a
        // base-currency figure (COD, BNPL settling in SAR) for a catalog
        // amount and convert it back into the display currency.
        const amount = this.money(this.sdk.convert(total, charge), charge, { convert: false });

        return `<small class="f-checkout__charge-note">${this.escape(this.trans('checkout.charged_in', { amount }))}</small>`;
    }

    /* ---- review */

    reviewHtml() {
        const state = this.stepState(3);
        if (state !== 'active') {
            return `<section class="f-checkout__step f-checkout__step--todo" data-checkout-step="3">${this.stepHead(3, this.trans('checkout.review_title'), '', FalakCheckout.ICONS.check, 'todo')}</section>`;
        }

        const t = this.state.totals;
        const f = this.state.form;

        return `
            <section class="f-checkout__step f-checkout__step--active" data-checkout-step="3">
                ${this.stepHead(3, this.trans('checkout.review_title'), this.trans('checkout.review_hint'), FalakCheckout.ICONS.check, 'active')}
                <div class="f-checkout__body">
                    <dl class="f-checkout__review">
                        ${this.hasShipping ? `
                        <div><dt>${this.escape(this.trans('checkout.deliver_to'))}</dt><dd>${this.escape(f.name)} · <span dir="ltr">${this.escape(f.phone)}</span><br>${this.escape([f.street, f.districtName, f.cityName || f.city, this.countryName(f.country)].filter(Boolean).join(', '))}</dd></div>
                        <div><dt>${this.escape(this.trans('checkout.shipping_method'))}</dt><dd>${this.escape(this.state.method?.name || '')}</dd></div>` : (!this.state.needsShipping ? `
                        <div><dt>${this.escape(this.trans('checkout.customer_details'))}</dt><dd>${this.escape(f.name)} · <span dir="ltr">${this.escape(f.phone)}</span>${f.email ? `<br><span dir="ltr">${this.escape(f.email)}</span>` : ''}</dd></div>` : '')}
                        <div><dt>${this.escape(this.trans('checkout.payment_method'))}</dt><dd>${this.escape(this.paymentMethod()?.name || '')}</dd></div>
                    </dl>
                    ${this.state.calculating || !t
                        ? `<div class="f-checkout__loading"><span class="f-modal__spinner" aria-hidden="true"></span></div>`
                        : `<p class="f-checkout__total-line">${this.escape(this.trans('checkout.total_to_pay'))} <b>${this.escape(this.money(t.total))}</b></p>
                           ${this.chargeNote(this.paymentMethod())}
                           <button type="button" class="f-btn f-btn--solid f-btn--primary f-btn--wide f-btn--large" data-checkout-place ${this.state.placing ? 'disabled' : ''}>
                               ${this.state.placing ? '<span class="f-btn__loader" aria-hidden="true"></span>' : ''}
                               ${this.escape(this.isCod ? this.trans('checkout.place_order') : this.trans('checkout.pay_now'))}
                           </button>`}
                </div>
            </section>`;
    }

    /*
     * ---- summary column
     *
     * Every amount here — the cart lines and the API totals alike — is in
     * the store's base currency, which is the one thing the storefront
     * guarantees about a money field. money() with no code converts it to
     * whatever the shopper is reading at the rate the page was rendered
     * with; handing it the server's own `currency` instead meant a single
     * stale field could print a base figure under a foreign sign.
     */

    summaryHtml() {
        const lines = this.sdk.cart.lines || [];
        const t = this.state.totals;

        const row = (key, amount, cls = '', hint = null) => `
            <div class="f-checkout__row ${cls}">
                <span>${this.escape(this.trans(key))}${hint ? `<falak-tooltip text="${this.escape(hint)}"><button type="button" class="f-checkout__info-btn" aria-label="${this.escape(this.trans('common.more_info'))}">${FalakCheckout.ICONS.info}</button></falak-tooltip>` : ''}</span>
                <span>${this.escape(this.money(amount))}</span>
            </div>`;

        return `
            <div class="f-checkout__summary">
                <h3 class="f-checkout__summary-title">${this.escape(this.trans('checkout.order_details'))} <span class="f-checkout__count">${lines.reduce((s, l) => s + Number(l.quantity || 0), 0)}</span></h3>
                <ul class="f-checkout__lines">
                    ${lines.map(l => `
                        <li class="f-checkout__line">
                            <span class="f-checkout__line-media">${l.image ? `<img src="${this.escape(l.image)}" alt="">` : ''}<b class="f-checkout__line-qty">${l.quantity}</b></span>
                            <span class="f-checkout__line-text"><span class="f-checkout__line-name">${this.escape(l.name)}</span>${this.lineOptions(l) ? `<small>${this.escape(this.lineOptions(l))}</small>` : ''}</span>
                            <span class="f-checkout__line-total">${this.escape(this.money(l.total))}</span>
                        </li>`).join('')}
                </ul>
                <falak-cart-coupons class="f-checkout__coupon"></falak-cart-coupons>
                <div class="f-checkout__totals">
                    ${t ? `
                        ${row('cart.subtotal', t.list_subtotal ?? t.subtotal)}
                        ${this.creditRows(row, t.list_subtotal !== undefined
                            ? { product: t.product_discount, coupon: t.coupon_discount, offer: t.special_offer_discount }
                            // An older totals endpoint only knows the combined figure.
                            : { coupon: t.discount_amount })}
                        ${this.hasShipping ? row('checkout.shipping', t.shipping_cost) : ''}
                        ${Number(t.cod_fee) > 0 ? row('checkout.cod_fee', t.cod_fee, '', this.trans('checkout.cod_fee_hint')) : ''}
                        ${Number(t.tax_amount) > 0 ? row('checkout.tax', t.tax_amount) : ''}
                        ${row('checkout.total', t.total, 'f-checkout__row--total')}`
                    : this.cartTotalsHtml(lines, row)}
                </div>
                <a class="f-checkout__back" href="${this.escape(this.cartUrl)}">${this.escape(this.trans('checkout.back_to_cart'))}</a>
            </div>`;
    }

    /** Before the API totals exist: what the cart itself already knows. */
    cartTotalsHtml(lines, row) {
        const s = this.sdk.cart.summary || {};
        const subtotal = Number(s.subtotal ?? lines.reduce((sum, l) => sum + Number(l.total || 0), 0));
        const discount = Number(s.coupon_discount || 0) + Number(s.special_offer_discount || 0) + Number(s.product_discount || 0);

        return `${row('cart.subtotal', subtotal)}
            ${this.creditRows(row, { product: s.product_discount, coupon: s.coupon_discount, offer: s.special_offer_discount })}
            ${discount > 0 ? row('checkout.total', Number(s.total ?? (subtotal - discount)), 'f-checkout__row--total') : ''}
            ${this.hasShipping ? `<p class="f-checkout__hint">${this.escape(this.trans('checkout.totals_after_address'))}</p>` : ''}`;
    }

    /**
     * The three credits the cart page and the cart drawer list — the
     * products' own sale prices, the coupon, the special offer — in that
     * order and under the same names, each left out while it is zero. One
     * place renders them so the checkout can never label a credit
     * differently from the cart.
     */
    creditRows(row, credits) {
        return [
            ['cart.product_discount', credits.product],
            ['cart.discount', credits.coupon],
            ['cart.special_offer', credits.offer],
        ].map(([key, raw]) => {
            const amount = Number(raw || 0);
            return amount > 0 ? row(key, -amount, 'f-checkout__row--discount') : '';
        }).join('');
    }

    /* --------------------------------------------------------- behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this._offs = [
            this.sdk.event.on('auth::logged.in', () => { this.state = null; this.render(); this.load(); }),
            this.sdk.event.on('auth::logged.out', () => { this.state = null; this.render(); }),
            this.sdk.event.on('cart::updated', () => this.cartChanged()),
            this.sdk.event.on('cart::coupon.applied', () => this.refreshTotals()),
            this.sdk.event.on('cart::coupon.removed', () => this.refreshTotals()),
        ];

        this.listen(this, 'click', event => {
            const t = event.target;
            if (t.closest('[data-checkout-signin]')) { this.sdk.event.dispatch('auth::required'); return; }
            /* The city combobox: toggle, pick, or close on an outside click. */
            if (t.closest('[data-checkout-city-toggle]')) {
                this.syncForm();
                this.state.cityOpen = !this.state.cityOpen;
                this.state.citySearch = '';
                this.render();
                if (this.state.cityOpen) this.querySelector('[data-checkout-city-search]')?.focus();
                return;
            }

            const option = t.closest('[data-checkout-city-option]');

            if (option) {
                const value = option.getAttribute('data-checkout-city-option');
                this.state.cityOpen = false;
                this.state.citySearch = '';
                this.chooseCity(value, this.cityNameFor(value));
                return;
            }

            if (this.state.cityOpen && !t.closest('[data-checkout-city-combo]')) {
                this.state.cityOpen = false;
                this.render();
            }

            const goto = t.closest('[data-checkout-goto]');
            if (goto) { this.setStep(Number(goto.getAttribute('data-checkout-goto'))); return; }
            if (t.closest('[data-checkout-review]')) { this.goReview(); return; }
            if (t.closest('[data-checkout-send-otp]')) { this.sendPhoneOtp(); return; }
            if (t.closest('[data-checkout-verify-otp]')) { this.verifyPhoneOtp(); return; }
            if (t.closest('[data-checkout-cancel-otp]')) { Object.assign(this.state.contact, { otpStep: false, otpPhone: '', code: '', devCode: null, error: '' }); this.render(); return; }
            if (t.closest('[data-checkout-place]')) { this.place(); }
        });

        this.listen(this, 'input', event => {
            const t = event.target;
            if (t.matches('[data-checkout-phone]')) { this.onPhoneInput(t); return; }
            if (t.matches('[data-checkout-otp]')) { this.state.contact.code = t.value.replace(/\D/g, '').slice(0, 6); return; }

            /*
             * `input`, not `change`: the city list must narrow as the shopper
             * types rather than only when the search box loses focus.
             */
            if (!t.matches('[data-checkout-city-search]')) return;
            this.state.citySearch = t.value;
            this.render();
            /* Re-renders replace the node, so focus and caret are restored. */
            const box = this.querySelector('[data-checkout-city-search]');
            if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
        });

        this.listen(this, 'change', event => {
            const t = event.target;
            if (t.matches('[data-checkout-method]')) { this.chooseMethod(t.value); return; }
            if (t.matches('[data-checkout-country]')) { this.chooseCountry(t.value); return; }
            /*
             * The city is a TEXT input with a datalist, not a select — so this
             * is what actually fires, and nothing was listening for it.
             *
             * `chooseCity()` was only reachable from `[data-checkout-city]`, a
             * <select> that no longer exists in the markup, so districts were
             * never fetched for any city. The order then went to the carrier
             * with no village id and was refused: "Destination district
             * (village) is required." The field had not been hidden by a
             * failure — it had never been able to appear at all.
             */
            /*
             * Only reached when there is no city LIST and the field falls back
             * to a text input — Aramex, whose account is blocked, and couriers
             * serving all cities. With a list the select above fires instead.
             */
            if (t.matches('[data-checkout-field="cityName"]')) { this.chooseTypedCity(t.value); return; }
            if (t.matches('[data-checkout-district]')) { this.chooseDistrict(t.value, t.options[t.selectedIndex]?.text || ''); return; }
            if (t.matches('[data-checkout-payment]')) { this.state.payment = t.value; this.render(); }
        });

        this.listen(this, 'submit', event => {
            if (event.target.matches('[data-checkout-contact]')) { event.preventDefault(); this.submitContact(event.target); return; }
            if (!event.target.matches('[data-checkout-address]')) return;
            event.preventDefault();
            this.submitAddress(event.target);
        });

        if (this.sdk.auth.isLoggedIn()) this.load();
    }

    disconnectedCallback() {
        (this._offs || []).forEach(off => typeof off === 'function' && off());
        super.disconnectedCallback();
    }

    /**
     * One of the carrier's declared extra fields.
     *
     * Every state is drawn, because a required field that renders nothing is
     * the bug this schema replaced: the shopper was told to fill in a district
     * that had no input on the page.
     */
    checkoutFieldHtml(field) {
        const f = this.state.form;
        const label = `${this.escape(this.trans(field.label_key))}${field.required ? ' *' : ''}`;

        if (field.type !== 'select') {
            return `
                <label class="f-field">
                    <span class="f-field__label">${label}</span>
                    <input class="f-input" type="text" name="${this.escape(field.key)}"
                           value="${this.escape(f[this.formKey(field.key)] || '')}"
                           ${field.max_length ? `maxlength="${Number(field.max_length)}"` : ''}
                           ${field.placeholder ? `placeholder="${this.escape(field.placeholder)}"` : ''}
                           data-checkout-field="${this.escape(this.formKey(field.key))}">
                </label>`;
        }

        const state = this.optionsState(field);

        /* Unavailable is a message, not a field: there is nothing to pick. */
        if (state === 'failed') {
            return `
                <div class="f-field f-field--wide">
                    <p class="f-field__error" role="alert">${this.escape(this.trans('checkout.districts_unavailable'))}</p>
                </div>`;
        }

        if (state !== 'ready') {
            const message = state === 'waiting'
                ? this.trans('checkout.choose_city_first')
                : this.trans('checkout.loading_districts');

            return `
                <label class="f-field">
                    <span class="f-field__label">${label}</span>
                    <select class="f-input" disabled><option>${this.escape(message)}</option></select>
                </label>`;
        }

        return `
            <label class="f-field">
                <span class="f-field__label">${label}</span>
                <select class="f-input" name="${this.escape(field.key)}" ${field.required ? 'required' : ''} data-checkout-district>
                    <option value="">${this.escape(this.trans('checkout.choose_district'))}</option>
                    ${this.state.districts.map(d => `<option value="${this.escape(d.id)}" ${String(d.id) === String(f.district) ? 'selected' : ''}>${this.escape(d.name)}</option>`).join('')}
                </select>
            </label>`;
    }

    /** The display name for a stored city value, for the closed control. */
    cityNameFor(value) {
        const city = (this.state.cities || []).find(c => String(c.value) === String(value));

        if (!city) return String(value || '');

        return (this.isRtl && city.name_ar) ? city.name_ar : city.name;
    }

    /**
     * Cities matching what the shopper has typed, capped for the DOM's sake.
     *
     * Fastcoo serves 3,185 cities and rendering every one as an <option> is
     * both unreadable and heavy, so an empty search shows the first slice and
     * typing narrows it. The cap is on what is RENDERED, never on what is
     * searched — a city far down the alphabet is still findable by name.
     *
     * Matching ignores case, Arabic/English and punctuation, because a shopper
     * types "al khobar" for a list that says "AL KHOBAR" and a carrier that
     * says "Khubar".
     */
    matchingCities() {
        const cities = this.state.cities || [];
        const term = String(this.state.citySearch || '').trim().toLowerCase();

        if (!term) {
            return cities.slice(0, FalakCheckout.CITY_OPTION_LIMIT);
        }

        const loose = term.replace(/[^\p{L}\p{N}]+/gu, '');
        const found = [];

        for (const city of cities) {
            const en = String(city.name || '').toLowerCase();
            const ar = String(city.name_ar || '');

            if (en.includes(term) || ar.includes(term)
                || (loose && en.replace(/[^\p{L}\p{N}]+/gu, '').includes(loose))) {
                found.push(city);

                if (found.length >= FalakCheckout.CITY_OPTION_LIMIT) break;
            }
        }

        return found;
    }
    /** `national_address` is held as `nationalAddress` on the form. */
    formKey(key) {
        return key === 'national_address' ? 'nationalAddress' : key;
    }

    /**
     * Where a fetched select stands: waiting on its dependency, loading,
     * failed, or ready — via the SDK, so the four states are defined once and
     * a theme's own checkout gets them too.
     */
    optionsState(field) {
        const state = {
            form: this.state.form,
            loading: this.state.districtsLoading,
            failed: this.state.districtsFailed,
            options: this.state.districts,
        };

        const viaSdk = this.sdk?.checkout?.fieldOptionsState;

        if (typeof viaSdk === 'function') {
            return viaSdk.call(this.sdk.checkout, field, state);
        }

        if (field.depends_on && !state.form[field.depends_on]) {
            return 'waiting';
        }

        if (state.loading) {
            return 'loading';
        }

        return (state.failed || !state.options.length) ? 'failed' : 'ready';
    }

    /**
     * Which of this carrier's declared fields are unsatisfied.
     *
     * Delegates to the SDK so rendering and validation read one implementation.
     * The inline fallback is for an older SDK bundle — these components and the
     * SDK are built separately and loaded from `window`.
     */
    validateExtraFields() {
        const fields = this.methodCapabilities(this.state.method).checkout_fields || [];
        const state = {
            form: this.state.form,
            loading: this.state.districtsLoading,
            failed: this.state.districtsFailed,
            options: this.state.districts,
        };

        const viaSdk = this.sdk?.checkout?.validateCheckoutFields;

        if (typeof viaSdk === 'function') {
            return viaSdk.call(this.sdk.checkout, fields, state);
        }

        const missing = [];

        for (const field of fields) {
            if (!field?.required) continue;

            if (field.type === 'select' || field.depends_on) {
                const optionState = this.optionsState(field);

                if (optionState === 'waiting') {
                    missing.push(`checkout.${field.depends_on}`);
                    continue;
                }

                if (optionState === 'failed') return { missing: [], blockedBy: 'districts_unavailable' };
                if (optionState === 'loading') return { missing: [], blockedBy: 'loading' };
            }

            if (!String(this.state.form[this.formKey(field.key)] ?? '').trim()) {
                missing.push(field.label_key);
            }
        }

        return { missing, blockedBy: null };
    }
    /** Text fields are read back before any re-render, so typing survives. */
    syncForm() {
        this.querySelectorAll('[data-checkout-field]').forEach(input => {
            this.state.form[input.getAttribute('data-checkout-field')] = input.value;
        });
    }

    async load() {
        this.state = this.state || this.initialState();
        this.state.loading = true;
        this.render();

        try {
            const [shipping, payments, lines] = await Promise.all([
                this.sdk.api.withoutNotifier(() => this.sdk.checkout.shipmentGateways()),
                this.sdk.api.withoutNotifier(() => this.sdk.checkout.paymentGateways()),
                this.sdk.cart.items(),
            ]);

            this.state.shippingMethods = shipping;
            this.state.paymentMethods = payments;
            this.state.needsShipping = FalakCheckout.needsShipping(lines);
            this.state.loading = false;

            if (!this.state.needsShipping) this.loadContactProfile();

            if (!this.hasStepOne) this.state.step = 2;
            if (this.state.shippingMethods.length === 1) await this.chooseMethod(`${shipping[0].shipment_type}:${shipping[0].id}`, false);

            if (!this.state.payment) this.state.payment = this.eligiblePaymentMethods()[0]?.id ?? null;
        } catch (error) {
            this.state.loading = false;
            this.state.error = error?.message || this.trans('common.load_failed');
        }

        this.render();
    }

    setStep(step) {
        this.syncForm();
        this.state.step = step;
        this.render();
        this.querySelector(`[data-checkout-step="${step}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async chooseMethod(value, rerender = true) {
        const [type, id] = String(value).split(':');
        const method = this.state.shippingMethods.find(m => m.shipment_type === type && String(m.id) === id) || null;

        this.syncForm();
        this.state.method = method;
        this.state.countries = [];
        this.state.cities = [];
        this.state.districts = [];
        Object.assign(this.state.form, { country: '', city: '', cityName: '', district: '', districtName: '', nationalAddress: '' });

        if (!method) { if (rerender) this.render(); return; }

        if (method.shipment_type === 'private_courier') {
            this.state.countries = this.courierCountries(method);
        } else {
            if (rerender) this.render();
            try {
                const list = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.countries(method.code));
                this.state.countries = list.map(c => ({
                    code: c.Code ?? c.code ?? c.value ?? c,
                    name: (this.isRtl && (c.NameAr ?? c.name_ar)) || c.Name || c.name || c.code || c,
                }));
            } catch (error) {
                this.state.error = error?.message || this.trans('common.load_failed');
            }
        }

        // One country: choose it for the shopper.
        if (this.state.countries.length === 1) {
            this.state.form.country = this.state.countries[0].code;
            await this.loadCities();
        }

        // Keep the payment choice valid for this courier.
        const eligible = this.eligiblePaymentMethods();
        if (!eligible.some(m => String(m.id) === String(this.state.payment))) this.state.payment = eligible[0]?.id ?? null;

        if (rerender) this.render();
    }

    asList(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; } }
        return [];
    }

    async chooseCountry(code) {
        this.syncForm();
        this.state.form.country = code;
        Object.assign(this.state.form, { city: '', cityName: '', district: '', districtName: '' });
        this.state.cities = [];
        this.state.districts = [];
        await this.loadCities();
        this.render();
    }

    async loadCities() {
        const method = this.state.method;
        const country = this.state.form.country;
        if (!method || !country) return;

        /*
         * A private courier's list comes from the server too. Built here it had
         * no Arabic, ignored which country was chosen, and a courier serving
         * all cities got no list at all — just a box to type into.
         */
        const isCourier = method.shipment_type === 'private_courier';

        this.state.citiesLoading = true;
        this.render();

        try {
            const raw = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.cities(
                method.code, country, isCourier ? { courier_id: method.id } : {}
            ));
            // The server already applied a courier's exclusions, by normalised name.
            const excluded = isCourier ? [] : this.asList(method.excluded_cities);
            this.state.cities = raw
                .map(c => typeof c === 'string' ? { value: c, name: c } : { value: c.value ?? c.id ?? c.name, name: (this.isRtl && c.name_ar) || c.name || c.value })
                .filter(c => !excluded.includes(c.value));
        } catch (error) {
            this.state.cities = [];
            if (isCourier) {
                // A platform without the courier list: the courier's own picks, as before.
                if (!this.truthy(method.all_cities)) {
                    this.state.cities = this.asList(method.cities).map(c => ({ value: c, name: c }));
                }
            } else {
                this.state.error = error?.message || this.trans('common.load_failed');
            }
        } finally {
            this.state.citiesLoading = false;
        }
    }

    /**
     * A city typed into the free-text field.
     *
     * Matched against the list the server sent so the carrier's own city id can
     * be recovered — the carrier needs that id, not the shopper's spelling.
     * An unrecognised name is kept (several carriers accept names they do not
     * publish) but cannot load districts, and the form says so rather than
     * leaving a required field invisible.
     */
    async chooseTypedCity(typed) {
        const name = String(typed || '').trim();
        const known = this.state.cities.find(
            c => String(c.name).trim().toLowerCase() === name.toLowerCase()
        );

        if (!known) {
            this.state.form.cityName = name;
            this.state.form.city = '';
            this.state.form.district = '';
            this.state.form.districtName = '';
            this.state.districts = [];
            this.state.districtsFailed = false;
            this.render();

            return;
        }

        await this.chooseCity(known.value, known.name);
    }

    async chooseCity(value, label) {
        this.syncForm();
        this.state.form.city = value;
        this.state.form.cityName = label;
        this.state.form.district = '';
        this.state.form.districtName = '';
        this.state.districts = [];

        const method = this.state.method;
        this.state.districtsFailed = false;

        if (this.methodCapabilities(method).requires_district && value) {
            this.state.districtsLoading = true;
            this.render();

            try {
                const raw = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.districts(method.code, value, label));
                this.state.districts = raw.map(d => ({ id: d.id ?? d.value ?? d.name, name: (this.isRtl && d.arabicName) || d.name || d.value, nationalAddress: d.nationalAddress }));
                /*
                 * An empty answer is a FAILURE here, not an empty city. The
                 * list comes from the carrier live, so nothing coming back
                 * means we cannot offer a choice the order cannot go without.
                 */
                this.state.districtsFailed = this.state.districts.length === 0;
            } catch (error) {
                this.state.districts = [];
                this.state.districtsFailed = true;
            } finally {
                this.state.districtsLoading = false;
            }
        }

        this.render();
    }

    chooseDistrict(value, label) {
        this.syncForm();
        this.state.form.district = value;
        this.state.form.districtName = label;
        const district = this.state.districts.find(d => String(d.id) === String(value));
        if (district?.nationalAddress && !this.state.form.nationalAddress) this.state.form.nationalAddress = String(district.nationalAddress);
        this.render();
    }

    /* A name to address the order to, an e-mail to send it to, and a phone a
       code has vouched for. A malformed e-mail is caught here rather than by
       the server, which would answer after the payment step. */
    submitContact(form) {
        this.syncForm();
        const f = this.state.form;
        const c = this.state.contact;
        const error = form.querySelector('[data-checkout-form-error]');
        const missing = [];

        if (!f.name.trim()) missing.push(this.trans('checkout.full_name'));
        if (!f.phone.trim()) missing.push(this.trans('checkout.phone'));
        if (!f.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) missing.push(this.trans('checkout.email'));

        if (missing.length) {
            error.textContent = this.trans('checkout.fill_required', { fields: missing.join(', ') });
            error.hidden = false;
            form.querySelector(':invalid, [required]:placeholder-shown')?.focus();
            return;
        }

        if (!this.phoneVerified()) {
            error.textContent = this.trans('checkout.phone_verify_required');
            error.hidden = false;
            (form.querySelector('[data-checkout-otp]') || form.querySelector('[data-checkout-send-otp]:not([hidden])') || form.querySelector('[data-checkout-phone]'))?.focus();
            return;
        }

        c.error = '';
        error.hidden = true;
        this.setStep(2);
    }
    submitAddress(form) {
        this.syncForm();
        const f = this.state.form;
        const error = form.querySelector('[data-checkout-form-error]');
        const missing = [];

        if (!f.name.trim()) missing.push(this.trans('checkout.full_name'));
        if (!f.phone.trim()) missing.push(this.trans('checkout.phone'));
        if (!f.country) missing.push(this.trans('checkout.country'));
        if (!f.street.trim()) missing.push(this.trans('checkout.street'));
        /*
         * The carrier's declared extra fields, judged by the SDK — the same
         * module `optionsState()` asks when rendering them, so the form cannot
         * demand a field it has not drawn. That disagreement was both rounds of
         * the district bug.
         */
        const verdict = this.validateExtraFields();

        if (verdict.blockedBy === 'loading') {
            /* Options still arriving; let the shopper try again in a moment. */
            return;
        }

        if (verdict.blockedBy) {
            error.textContent = this.trans(`checkout.${verdict.blockedBy}`);
            error.hidden = false;

            return;
        }

        verdict.missing.forEach(labelKey => missing.push(this.trans(labelKey)));

        if (missing.length) {
            error.textContent = this.trans('checkout.fill_required', { fields: missing.join(', ') });
            error.hidden = false;
            form.querySelector(':invalid, [required]:placeholder-shown')?.focus();
            return;
        }

        error.hidden = true;
        this.setStep(2);
    }

    shippingAddress() {
        const f = this.state.form;
        // A typed city that matches a known one carries its id too.
        const known = this.state.cities.find(c => String(c.name).toLowerCase() === String(f.cityName || '').trim().toLowerCase());
        f.city = known ? known.value : '';
        const address = {
            name: f.name.trim(),
            phone: f.phone.trim(),
            email: f.email.trim(),
            address: f.street.trim(),
            /*
             * A private courier's list value IS the city name, in English —
             * what the courier stores and coverage is checked against. The
             * shown name may be Arabic, which no courier list would match.
             */
            city: (this.state.method?.shipment_type === 'private_courier' && f.city) ? f.city : (f.cityName || f.city),
            country: f.country,
            postal_code: f.postal.trim(),
        };
        if (f.city) { address.city_id = f.city; address.cityId = Number(f.city) || f.city; }
        if (f.district) { address.village_id = Number(f.district) || f.district; address.villageId = address.village_id; address.district_name = f.districtName; }
        if (f.nationalAddress) { address.national_address = f.nationalAddress.trim(); address.nationalAddress = address.national_address; }

        return address;
    }

    /** Shipment fields shared by calculate-total and checkout. */
    shipmentPayload() {
        if (!this.hasShipping || !this.state.method) return {};

        return {
            shipment_type: this.state.method.shipment_type,
            shipment_method_id: this.state.method.id,
            shipping_address: this.shippingAddress(),
        };
    }

    async goReview() {
        if (!this.state.payment) return;
        this.setStep(3);
        await this.refreshTotals();
    }

    /*
     * The cart changed under the checkout — a line removed in another tab,
     * an offer that added a free item. Whether anything still ships decides
     * whether the delivery step exists, so that is re-read before the totals
     * are; a shopper left on a delivery step for a cart that no longer ships
     * is moved on to payment.
     */
    cartChanged() {
        if (!this.state) return;

        this.state.needsShipping = FalakCheckout.needsShipping(this.sdk.cart.lines || []);
        if (!this.hasStepOne && this.state.step === 1) this.state.step = 2;
        this.render();
        this.refreshTotals();
    }

    async refreshTotals() {
        if (!this.state || this.state.step !== 3 || !this.sdk.auth.isLoggedIn()) return;

        this.state.calculating = true;
        this.state.error = '';
        this.render();

        try {
            this.state.totals = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.calculateTotal({
                payment_type: this.isCod ? 'cod' : 'online',
                ...this.shipmentPayload(),
            }));
        } catch (error) {
            this.state.totals = null;
            this.state.error = error?.message || this.trans('common.load_failed');
            this.state.step = this.hasStepOne ? 1 : 2;
        } finally {
            this.state.calculating = false;
            this.render();
        }
    }

    async place() {
        if (this.state.placing) return;

        this.state.placing = true;
        this.state.error = '';
        this.render();

        try {
            const f = this.state.form;
            const shipment = this.shipmentPayload();
            const billing = shipment.shipping_address || { name: f.name, phone: f.phone, email: f.email };

            const response = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.placeOrder({
                payment_method_id: this.state.payment,
                billing_address: billing,
                customer_notes: f.notes.trim(),
                ...shipment,
            }));

            const url = response?.gateway_response?.url;
            const number = response?.order_number ?? response?.order?.order_number;

            // The cart is spent either way; the header follows.
            this.sdk.cart.fetch().catch(() => {});
            this.emit('placed', { orderNumber: number, redirectUrl: url || null });

            if (url) { window.location.assign(url); return; }
            if (number) { window.location.assign(this.thankYouUrl.replace('{order}', encodeURIComponent(number))); return; }

            this.state.error = response?.message || this.trans('checkout.failed');
        } catch (error) {
            this.state.error = error?.message || this.trans('checkout.failed');
        } finally {
            this.state.placing = false;
            this.render();
        }
    }

    /**
     * How many city <option>s to put in the DOM at once.
     *
     * Fastcoo serves 3,185. Rendering them all is ~150KB of DOM in a control
     * nobody can scan, so the list is sliced and the search box is how a city
     * further down is reached.
     */
    static CITY_OPTION_LIMIT = 100;

    static ICONS = {
        user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 15.5c-1.4.8-5.1 2.6-2.9 4.7 1.1 1 2.3 1.8 3.9 1.8h8.8c1.5 0 2.8-.8 3.9-1.8 2.3-2.2-1.4-3.9-2.9-4.7a11.7 11.7 0 0 0-10.8 0Z"/><circle cx="12" cy="6.5" r="4.5"/></svg>',
        truck: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/><path d="M5 18H3V6h11v12H9m6 0h1V11h4l2 3v4h-2"/></svg>',
        card: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>',
        check: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>',
        box: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
        info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>',
    };
}
