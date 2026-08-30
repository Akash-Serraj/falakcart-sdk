import FalakElement from '../base.js';

/**
 * <falak-mini-checkout></falak-mini-checkout>      (one per page; created on demand)
 *
 * "Buy now" — mirroring <salla-mini-checkout-modal>: a modal that checks out
 * ONE product right there, without touching whatever's already in the
 * shopper's cart. Salla's version embeds an iframe to their own hosted
 * checkout app; this one is a native modal over falak.buyNow, a genuinely
 * separate order-creation path from the cart checkout (see
 * BuyNowController's docblock on the backend for the exact scope — physical
 * products, shipment-gateway shipping, no coupons/special offers).
 *
 * <falak-add-product-button mini-checkout> / <falak-quick-buy mini-checkout>
 * open it. It can also be driven from the bus:
 * falak.event.dispatch('buy-now::open', { productId, variationId, quantity, name, image, price }).
 *
 * A guest sees the sign-in card, same as <falak-checkout>, and the flow
 * resumes on `auth::logged.in`.
 */
export default class FalakMiniCheckout extends FalakElement {
    static observedAttributes = [];

    static COUNTRY_NAMES = {
        SA: ['Saudi Arabia', 'المملكة العربية السعودية'], AE: ['United Arab Emirates', 'الإمارات العربية المتحدة'],
        KW: ['Kuwait', 'الكويت'], OM: ['Oman', 'عُمان'], BH: ['Bahrain', 'البحرين'], QA: ['Qatar', 'قطر'],
    };

    /** Finds or creates the page's dialog and opens it for a product. */
    /**
     * Brings back a buy-now the shopper left to sign in. The dialog is
     * created on demand (below), so after the post-login reload there is no
     * instance to resume itself — this runs once the SDK is ready and makes
     * one if a pending item is waiting and the sign-in actually happened.
     */
    static resume() {
        const sdk = window.falak;
        if (!sdk?.storage) return;

        const pending = sdk.storage.getWithTTL(FalakMiniCheckout.PENDING_KEY);
        if (!pending) return;

        sdk.storage.remove(FalakMiniCheckout.PENDING_KEY);

        // A guest again (sign-in abandoned): the intent is stale, not resumable.
        if (!sdk.auth?.isLoggedIn()) return;

        FalakMiniCheckout.open(pending);
    }

    static open(item) {
        let host = document.querySelector('falak-mini-checkout');

        if (!host) {
            host = document.createElement('falak-mini-checkout');
            document.body.appendChild(host);
        }

        return host.open(item);
    }

    get isRtl() { return this.sdk.lang.locale === 'ar'; }

    initialState() {
        const user = this.sdk.auth.user || {};

        return {
            step: 1,               // 1 delivery, 2 payment
            loading: true,
            error: '',
            shippingMethods: [],
            paymentMethods: [],
            method: null,
            countries: [],
            cities: [],
            citiesLoading: false,
            form: {
                name: user.name || '', phone: user.phone || '', email: user.email || '',
                country: '', city: '', cityName: '',
                street: '', postal: '', notes: '',
            },
            payment: null,
            totals: null,
            calculating: false,
            placing: false,
        };
    }

    /** Storage key for a buy-now interrupted by sign-in (see the sign-in click handler). */
    static PENDING_KEY = 'buy_now.pending';

    get hasItem() { return !!this._item; }
    get isCod() { return this.paymentMethod()?.code === 'cash_on_delivery'; }

    paymentMethod() {
        return this.state.paymentMethods.find(m => String(m.id) === String(this.state.payment)) || null;
    }

    eligiblePaymentMethods() {
        const method = this.state.method;
        return this.state.paymentMethods.filter(m => {
            if (m.code !== 'cash_on_delivery') return true;
            return method?.shipment_type === 'private_courier' ? this.truthy(method.cash_on_delivery) : true;
        });
    }

    truthy(value) { return value === true || value === 1 || value === '1'; }

    countryName(code) {
        const known = FalakMiniCheckout.COUNTRY_NAMES[code];
        return known ? known[this.isRtl ? 1 : 0] : code;
    }

    /* ------------------------------------------------------ imperative API */

    async open(item) {
        if (!item?.productId) return null;

        this._item = {
            productId: item.productId,
            variationId: item.variationId || null,
            quantity: Math.max(1, Number(item.quantity) || 1),
            name: item.name || '',
            image: item.image || '',
            price: item.price ?? null,
            currency: item.currency || null,
        };

        this.state = this.initialState();
        this._visible = true;
        this.render();

        if (this.sdk.auth.isLoggedIn()) await this.load();
        else this.render();

        return this;
    }

    close() {
        this._visible = false;
        this._modal?.close();
    }

    /* ------------------------------------------------------------ render */

    /**
     * <falak-modal> snapshots its content ONCE on first render (see its own
     * doc comment) and otherwise only reacts to its own attributes — that's
     * why <falak-quick-add> builds a whole fresh modal per open() rather than
     * fighting that cache. This component re-renders far more often than a
     * one-shot dialog (every shipping/payment choice recalculates totals),
     * so doing the same thing here recreated the <falak-modal> element on
     * every keystroke-adjacent update: a brand new DOM node replays the
     * overlay/body's CSS entrance animation every time, which is the
     * "blinking" — not a one-time open animation, but a fade+rise firing on
     * every re-render. The modal chrome is now built exactly once; every
     * later render only replaces the inner content div in place, leaving the
     * <falak-modal> element itself (and its animation) untouched.
     */
    render() {
        this.classList.add('f-mini-checkout');

        if (!this.hasItem) {
            this._modal = null;
            this.innerHTML = '';
            return;
        }

        if (!this.state) this.state = this.initialState();

        this.syncForm();

        const body = !this.sdk.auth.isLoggedIn()
            ? this.signInHtml()
            : `
                ${this.itemHtml()}
                ${this.state.loading ? `<div class="f-checkout__loading"><span class="f-modal__spinner" aria-hidden="true"></span></div>` : `
                    ${this.state.error ? `<p class="f-checkout__error" role="alert">${this.escape(this.state.error)}</p>` : ''}
                    ${this.deliveryHtml()}
                    ${this.paymentHtml()}
                    ${this.footerHtml()}`}`;

        if (!this._modal || !this._modal.isConnected) {
            this.innerHTML = `
                <falak-modal id="falak-mini-checkout" width="md" modal-title="${this.escape(this.trans('checkout.buy_now_title'))}">
                    <div data-mini-checkout-content>${body}</div>
                </falak-modal>`;
            this._modal = this.querySelector('falak-modal');
        } else {
            const content = this._modal.querySelector('[data-mini-checkout-content]');
            if (content) content.innerHTML = body;
        }

        this._visible ? this._modal.open() : this._modal.close();
    }

    itemHtml() {
        const item = this._item;
        const price = typeof item.price === 'number' ? this.money(item.price, item.currency) : (item.price || '');

        return `
            <div class="f-mini-checkout__item">
                ${item.image ? `<img class="f-mini-checkout__image" src="${this.escape(item.image)}" alt="" loading="lazy">` : `<span class="f-mini-checkout__image f-mini-checkout__image--empty" aria-hidden="true"></span>`}
                <div class="f-mini-checkout__item-text">
                    <span class="f-mini-checkout__item-name">${this.escape(item.name)}</span>
                    <span class="f-mini-checkout__item-meta">${this.escape(this.trans('cart.quantity'))}: ${item.quantity}${price ? ` · ${this.escape(price)}` : ''}</span>
                </div>
            </div>`;
    }

    signInHtml() {
        return `
            <div class="f-checkout__signin">
                <p class="f-checkout__hint">${this.escape(this.trans('checkout.sign_in_hint'))}</p>
                <button type="button" class="f-btn f-btn--solid f-btn--primary f-btn--wide" data-mini-checkout-signin>${this.escape(this.trans('auth.login'))}</button>
            </div>`;
    }

    stepHead(number, title, state) {
        return `
            <header class="f-checkout__step-head">
                <h3 class="f-checkout__step-title">${this.escape(title)}</h3>
                ${state === 'done' ? `<button type="button" class="f-btn f-btn--outline f-btn--light-outline f-btn--small" data-mini-checkout-goto="${number}">${this.escape(this.trans('checkout.edit'))}</button>` : ''}
            </header>`;
    }

    stepState(number) {
        if (this.state.step === number) return 'active';
        return this.state.step > number ? 'done' : 'todo';
    }

    deliveryHtml() {
        const state = this.stepState(1);
        const f = this.state.form;
        const method = this.state.method;

        const summary = state === 'done' && method
            ? `<p class="f-checkout__done-line">${this.escape(method.name)} · ${this.escape([f.street, f.cityName || f.city, this.countryName(f.country)].filter(Boolean).join(', '))}</p>`
            : '';

        return `
            <section class="f-checkout__step f-checkout__step--${state}" data-mini-checkout-step="1">
                ${this.stepHead(1, this.trans('checkout.delivery_title'), state)}
                ${summary}
                ${state === 'active' ? `
                <div class="f-checkout__body">
                    <div class="f-checkout__methods" role="radiogroup">
                        ${this.state.shippingMethods.filter(m => m.shipment_type === 'shipment_gateway').map(m => this.methodCardHtml(m)).join('')}
                    </div>
                    ${method ? this.addressFormHtml() : `<p class="f-checkout__hint">${this.escape(this.trans('checkout.choose_shipping'))}</p>`}
                </div>` : ''}
            </section>`;
    }

    methodCardHtml(m) {
        const chosen = this.state.method && String(this.state.method.id) === String(m.id);
        const cod = this.truthy(m.cash_on_delivery);

        return `
            <label class="f-checkout__method${chosen ? ' is-selected' : ''}">
                <input type="radio" name="mini_shipping_method" value="${m.id}" ${chosen ? 'checked' : ''} data-mini-checkout-method>
                <span class="f-checkout__method-text">
                    <b>${this.escape(m.name)}</b>
                    ${m.shipping_time ? `<small>${this.escape(m.shipping_time)}</small>` : ''}
                    ${cod ? `<small class="f-checkout__tag">${this.escape(this.trans('checkout.cod_available'))}</small>` : ''}
                </span>
            </label>`;
    }

    addressFormHtml() {
        const f = this.state.form;

        const countryOptions = this.state.countries.map(c =>
            `<option value="${this.escape(c.code)}" ${c.code === f.country ? 'selected' : ''}>${this.escape(c.name)}</option>`).join('');

        const suggestions = this.state.cities.length
            ? `<datalist id="f-mini-checkout-cities">${this.state.cities.map(c => `<option value="${this.escape(c.name)}"></option>`).join('')}</datalist>`
            : '';

        return `
            <form class="f-checkout__form" data-mini-checkout-address novalidate>
                <div class="f-checkout__grid">
                    ${this.field('name', 'checkout.full_name', f.name, 'text', true)}
                    ${this.field('phone', 'checkout.phone', f.phone, 'tel', true, 'ltr')}
                    <label class="f-field">
                        <span class="f-field__label">${this.escape(this.trans('checkout.country'))} *</span>
                        <select class="f-input" name="country" required data-mini-checkout-country>
                            <option value="">${this.escape(this.trans('checkout.choose_country'))}</option>
                            ${countryOptions}
                        </select>
                    </label>
                    <label class="f-field">
                        <span class="f-field__label">${this.escape(this.trans('checkout.city'))}</span>
                        <input class="f-input" type="text" name="city" value="${this.escape(f.cityName || f.city)}"
                               placeholder="${this.escape(this.state.citiesLoading ? this.trans('common.loading') : this.trans('checkout.city'))}"
                               ${suggestions ? 'list="f-mini-checkout-cities"' : ''} data-mini-checkout-field="cityName">
                        ${suggestions}
                    </label>
                    ${this.field('street', 'checkout.street', f.street, 'text', true, null, null, 'f-field--wide')}
                </div>
                <p class="f-checkout__error" role="alert" data-mini-checkout-form-error hidden></p>
                <button type="submit" class="f-btn f-btn--solid f-btn--primary f-btn--wide">${this.escape(this.trans('checkout.continue_to_payment'))}</button>
            </form>`;
    }

    field(name, key, value, type, required, dir = null, placeholder = null, extra = '') {
        return `
            <label class="f-field ${extra}">
                <span class="f-field__label">${this.escape(this.trans(key))}${required ? ' *' : ''}</span>
                <input class="f-input" type="${type}" name="${name}" value="${this.escape(value || '')}" ${required ? 'required' : ''}
                       ${dir ? `dir="${dir}"` : ''} ${placeholder ? `placeholder="${this.escape(placeholder)}"` : ''} data-mini-checkout-field="${name}">
            </label>`;
    }

    paymentHtml() {
        const state = this.stepState(2);
        const methods = this.eligiblePaymentMethods();

        return `
            <section class="f-checkout__step f-checkout__step--${state}" data-mini-checkout-step="2">
                ${this.stepHead(2, this.trans('checkout.payment_title'), state)}
                ${state === 'active' ? `
                <div class="f-checkout__body">
                    ${methods.length ? `
                    <div class="f-checkout__methods" role="radiogroup">
                        ${methods.map(m => `
                            <label class="f-checkout__method${String(m.id) === String(this.state.payment) ? ' is-selected' : ''}">
                                <input type="radio" name="mini_payment_method" value="${this.escape(m.id)}" ${String(m.id) === String(this.state.payment) ? 'checked' : ''} data-mini-checkout-payment>
                                <span class="f-checkout__method-text"><b>${this.escape(m.name)}</b></span>
                            </label>`).join('')}
                    </div>`
                    : `<p class="f-checkout__error" role="alert">${this.escape(this.trans('checkout.no_payment_methods'))}</p>`}
                </div>` : ''}
            </section>`;
    }

    totalRow(key, amount, currency, cls = '') {
        return `
            <div class="f-checkout__row ${cls}">
                <span>${this.escape(this.trans(key))}</span>
                <span>${this.escape(this.money(amount, currency))}</span>
            </div>`;
    }

    footerHtml() {
        if (this.stepState(2) !== 'done' && this.state.step !== 2) return '';
        if (!this.state.payment) return '';

        const t = this.state.totals;

        return `
            <div class="f-mini-checkout__footer">
                ${this.state.calculating || !t
                    ? `<div class="f-checkout__loading"><span class="f-modal__spinner" aria-hidden="true"></span></div>`
                    : `
                    <div class="f-checkout__totals">
                        ${this.totalRow('cart.subtotal', t.subtotal, t.currency)}
                        ${t.shipping_cost > 0 ? this.totalRow('checkout.shipping', t.shipping_cost, t.currency) : ''}
                        ${t.cod_fee > 0 ? this.totalRow('checkout.cod_fee', t.cod_fee, t.currency) : ''}
                        ${t.tax_amount > 0 ? this.totalRow('checkout.tax', t.tax_amount, t.currency) : ''}
                        ${this.totalRow('checkout.total', t.total, t.currency, 'f-checkout__row--total')}
                    </div>
                    <button type="button" class="f-btn f-btn--solid f-btn--primary f-btn--wide f-btn--large" data-mini-checkout-place ${this.state.placing ? 'disabled' : ''}>
                        ${this.state.placing ? '<span class="f-btn__loader" aria-hidden="true"></span>' : ''}
                        ${this.escape(this.isCod ? this.trans('checkout.place_order') : this.trans('checkout.pay_now'))}
                    </button>`}
            </div>`;
    }

    /* --------------------------------------------------------- behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this._offOpen = this.sdk.event.on('buy-now::open', item => this.open(item || {}));
        this._offIn = this.sdk.event.on('auth::logged.in', () => { if (this.hasItem) { this.state = null; this.render(); this.load(); } });

        this.listen(this, 'click', event => {
            const t = event.target;
            if (t.closest('[data-mini-checkout-signin]')) {
                // Signing in reloads the page (the login modal's call — the
                // server-rendered chrome has to catch up), which would drop
                // this dialog. Remember what was being bought so the reload
                // brings it straight back, signed in and ready.
                this.sdk.storage.setWithTTL(FalakMiniCheckout.PENDING_KEY, this._item, 15);
                this.sdk.event.dispatch('auth::required');
                return;
            }
            const goto = t.closest('[data-mini-checkout-goto]');
            if (goto) { this.setStep(Number(goto.getAttribute('data-mini-checkout-goto'))); return; }
            if (t.closest('[data-mini-checkout-place]')) { this.place(); }
        });

        this.listen(this, 'change', event => {
            const t = event.target;
            if (t.matches('[data-mini-checkout-method]')) { this.chooseMethod(t.value); return; }
            if (t.matches('[data-mini-checkout-country]')) { this.chooseCountry(t.value); return; }
            if (t.matches('[data-mini-checkout-payment]')) { this.state.payment = t.value; this.refreshTotals(); this.render(); }
        });

        this.listen(this, 'submit', event => {
            if (!event.target.matches('[data-mini-checkout-address]')) return;
            event.preventDefault();
            this.submitAddress(event.target);
        });

        this.listen(this, 'modal-close', () => {
            this._visible = false;
            this._item = null;
            this.sdk.storage.remove(FalakMiniCheckout.PENDING_KEY);
            this.render();
        });

        this.resumePending();
    }

    /** A theme-placed element resumes through the same path as an on-demand one. */
    resumePending() {
        FalakMiniCheckout.resume();
    }

    disconnectedCallback() {
        this._offOpen?.();
        this._offIn?.();
        super.disconnectedCallback();
    }

    syncForm() {
        this.querySelectorAll('[data-mini-checkout-field]').forEach(input => {
            this.state.form[input.getAttribute('data-mini-checkout-field')] = input.value;
        });
    }

    async load() {
        this.state = this.state || this.initialState();
        this.state.loading = true;
        this.render();

        try {
            const [shipping, payments] = await Promise.all([
                this.sdk.api.withoutNotifier(() => this.sdk.checkout.shipmentGateways()),
                this.sdk.api.withoutNotifier(() => this.sdk.checkout.paymentGateways()),
            ]);

            this.state.shippingMethods = shipping.filter(m => m.shipment_type === 'shipment_gateway');
            this.state.paymentMethods = payments;
            this.state.loading = false;

            if (this.state.shippingMethods.length === 1) await this.chooseMethod(this.state.shippingMethods[0].id, false);
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
    }

    async chooseMethod(value, rerender = true) {
        const method = this.state.shippingMethods.find(m => String(m.id) === String(value)) || null;

        this.syncForm();
        this.state.method = method;
        this.state.countries = [];
        this.state.cities = [];
        Object.assign(this.state.form, { country: '', city: '', cityName: '' });

        if (!method) { if (rerender) this.render(); return; }

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

        if (this.state.countries.length === 1) {
            this.state.form.country = this.state.countries[0].code;
            await this.loadCities();
        }

        const eligible = this.eligiblePaymentMethods();
        if (!eligible.some(m => String(m.id) === String(this.state.payment))) this.state.payment = eligible[0]?.id ?? null;

        if (rerender) this.render();
    }

    async chooseCountry(code) {
        this.syncForm();
        this.state.form.country = code;
        Object.assign(this.state.form, { city: '', cityName: '' });
        this.state.cities = [];
        await this.loadCities();
        this.render();
    }

    async loadCities() {
        const method = this.state.method;
        const country = this.state.form.country;
        if (!method || !country) return;

        this.state.citiesLoading = true;
        this.render();

        try {
            const raw = await this.sdk.api.withoutNotifier(() => this.sdk.checkout.cities(method.code, country));
            this.state.cities = raw.map(c => typeof c === 'string' ? { value: c, name: c } : { value: c.value ?? c.id ?? c.name, name: (this.isRtl && c.name_ar) || c.name || c.value });
        } catch (error) {
            this.state.cities = [];
            this.state.error = error?.message || this.trans('common.load_failed');
        } finally {
            this.state.citiesLoading = false;
        }

        this.render();
    }

    submitAddress(form) {
        this.syncForm();
        const f = this.state.form;
        const error = form.querySelector('[data-mini-checkout-form-error]');
        const missing = [];

        if (!f.name.trim()) missing.push(this.trans('checkout.full_name'));
        if (!f.phone.trim()) missing.push(this.trans('checkout.phone'));
        if (!f.country) missing.push(this.trans('checkout.country'));
        if (!f.street.trim()) missing.push(this.trans('checkout.street'));

        if (missing.length) {
            error.textContent = this.trans('checkout.fill_required', { fields: missing.join(', ') });
            error.hidden = false;
            return;
        }

        error.hidden = true;

        // A city typed by hand that matches a known suggestion carries its id too.
        const known = this.state.cities.find(c => String(c.name).toLowerCase() === String(f.cityName || '').trim().toLowerCase());
        if (known) f.city = known.value;

        this.setStep(2);
        this.refreshTotals();
    }

    shippingAddress() {
        const f = this.state.form;
        const address = {
            name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(),
            address: f.street.trim(), city: f.cityName || f.city, country: f.country,
        };
        if (f.city) { address.city_id = f.city; }

        return address;
    }

    /**
     * Choosing a shipping method and choosing a payment method both trigger
     * this — a shopper clicking COD right after the address step's own
     * (default-payment) totals request is still in flight would otherwise
     * see whichever response happens to land LAST, not the one matching
     * their actual selection: the address-step request for the default
     * payment can resolve after the COD-click request and silently overwrite
     * a correct total with a stale one. A request token, checked before the
     * response is applied, is the same guard <falak-search> uses against the
     * identical race on a debounced query.
     */
    async refreshTotals() {
        if (!this.state.method || !this.state.payment) return;

        const token = (this._totalsToken = Symbol());

        this.state.calculating = true;
        this.render();

        try {
            const totals = await this.sdk.api.withoutNotifier(() => this.sdk.buyNow.calculateTotal({
                productId: this._item.productId,
                variationId: this._item.variationId,
                quantity: this._item.quantity,
                paymentType: this.isCod ? 'cod' : 'online',
                shipmentMethodId: this.state.method.id,
                shippingAddress: this.shippingAddress(),
            }));

            if (this._totalsToken !== token) return;
            this.state.totals = totals;
        } catch (error) {
            if (this._totalsToken !== token) return;
            this.state.totals = null;
            this.state.error = error?.message || this.trans('common.load_failed');
        } finally {
            if (this._totalsToken === token) {
                this.state.calculating = false;
                this.render();
            }
        }
    }

    async place() {
        if (this.state.placing) return;

        this.state.placing = true;
        this.state.error = '';
        this.render();

        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.buyNow.checkout({
                productId: this._item.productId,
                variationId: this._item.variationId,
                quantity: this._item.quantity,
                paymentMethodId: this.state.payment,
                shipmentMethodId: this.state.method.id,
                shippingAddress: this.shippingAddress(),
            }));

            const url = response?.gateway_response?.url;
            const number = response?.order_number;

            this.emit('placed', { orderNumber: number, redirectUrl: url || null });

            if (url) { window.location.assign(url); return; }
            if (number) { window.location.assign(`/thank-you/${encodeURIComponent(number)}`); return; }

            this.state.error = response?.message || this.trans('checkout.failed');
        } catch (error) {
            this.state.error = error?.message || this.trans('checkout.failed');
        } finally {
            this.state.placing = false;
            this.render();
        }
    }
}
