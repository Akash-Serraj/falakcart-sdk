import FalakElement from '../base.js';

/**
 * <falak-cart-coupons></falak-cart-coupons>
 * <falak-cart-coupons source="coupons"></falak-cart-coupons>
 * <falak-cart-coupons coupons='[{"code":"SAVE10","type":"percentage","amount":10}]'></falak-cart-coupons>
 *
 * The cart page's coupon control, mirroring <salla-cart-coupons>: a code
 * input with an apply button that turns into "remove" once a coupon is on
 * the cart, an inline error, the applied code as a chip, and — when the
 * store exposes public coupons — a strip of coupon cards a shopper taps to
 * apply.
 *
 * One coupon per cart, which is what this platform's cart supports; the
 * applied code is read from the SDK's cart so it survives a page refresh.
 * The component performs the apply/remove itself (falak.cart) and reports
 * through the SDK's `cart::coupon.applied` / `cart::coupon.removed` /
 * `cart::coupon.failed` events plus DOM events `applied` / `removed` /
 * `failed` on the element. It never reloads the page; a server-rendered
 * cart page listens and reloads when it wants fresh totals.
 *
 * | attribute | role                                                        |
 * | source    | API path returning public coupons (none by default: the     |
 * |           | platform has no public coupon list yet)                     |
 * | coupons   | JSON array of coupons to offer, when the theme has them      |
 * | per-view  | cards visible at once (default 2)                           |
 *
 * Coupon shape (either attribute or API): { code, type: 'percentage'|'fixed',
 * amount, minimum_amount?, maximum_amount?, remaining_days?, free_shipping? }
 */
export default class FalakCartCoupons extends FalakElement {
    static observedAttributes = ['source', 'coupons', 'per-view'];

    get source() { return this.attr('source', ''); }

    /** Cards visible at once; two suits a summary column, more a full-width strip. */
    get perView() { return Math.max(1, this.numAttr('per-view', 2)); }

    /** The code currently on the cart, per the SDK. */
    get applied() { return this.sdk.cart?.discountCode || ''; }

    /** Basis for a coupon's minimum: the cart's subtotal. */
    get cartSubtotal() {
        const cart = this.sdk.cart;
        const fromSummary = Number(cart?.summary?.subtotal);

        if (Number.isFinite(fromSummary) && fromSummary > 0) return fromSummary;

        return (cart?.lines || []).reduce((sum, line) => sum + Number(line.total || 0), 0);
    }

    disconnectedCallback() {
        (this._offs || []).forEach(off => typeof off === 'function' && off());
        this._offs = [];

        super.disconnectedCallback();
    }

    /* ------------------------------------------------------------ render */

    render() {
        this.classList.add('f-cart-coupons');

        const applied = this.applied;
        const busy = !!this._busy;
        const error = this._error || '';
        const draft = this._draft || '';

        this.innerHTML = `
            <div class="f-cart-coupons__form">
                <label class="f-cart-coupons__label" for="f-coupon-input">${this.escape(this.trans('cart.have_coupon'))}</label>
                <div class="f-cart-coupons__row">
                    <input id="f-coupon-input" type="text" name="coupon" autocomplete="off"
                           class="f-cart-coupons__input${error ? ' is-invalid' : ''}"
                           placeholder="${this.escape(this.trans('cart.coupon_placeholder'))}"
                           value="${this.escape(applied || draft)}"
                           ${applied || busy ? 'disabled' : ''}
                           aria-label="${this.escape(this.trans('cart.coupon'))}"
                           data-coupon-input>
                    <button type="button"
                            class="f-btn f-btn--solid ${applied ? 'f-btn--danger' : 'f-btn--primary'} f-cart-coupons__button"
                            ${busy ? 'disabled' : ''}
                            ${applied ? 'data-coupon-remove' : 'data-coupon-apply'}
                            aria-label="${this.escape(this.trans(applied ? 'cart.remove_coupon' : 'cart.apply'))}">
                        ${busy ? '<span class="f-btn__loader" aria-hidden="true"></span>' : ''}
                        ${applied ? '&#x2715;' : `<span>${this.escape(this.trans('cart.apply'))}</span>`}
                    </button>
                </div>
                <p class="f-cart-coupons__error" role="alert" data-coupon-error ${error ? '' : 'hidden'}>${this.escape(error)}</p>
                ${applied ? `
                <div class="f-cart-coupons__applied">
                    <span class="f-cart-coupons__code" data-coupon-code>${this.escape(applied)}</span>
                    <span class="f-cart-coupons__applied-note">${this.escape(this.trans('cart.coupon_applied'))}</span>
                </div>` : ''}
            </div>
            ${this.cardsHtml()}`;

        this._input = this.querySelector('[data-coupon-input]');
    }

    cardsHtml() {
        const coupons = this._coupons || [];
        if (!coupons.length) return '';

        return `
            <falak-slider class="f-cart-coupons__slider" slides-per-view="${this.perView}">
                <div slot="items">
                    ${coupons.map(coupon => this.cardHtml(coupon)).join('')}
                </div>
            </falak-slider>`;
    }

    cardHtml(coupon) {
        const eligible = this.isEligible(coupon);
        const current = coupon.code === this.applied;
        const minimum = Number(coupon.minimum_amount?.amount ?? coupon.minimum_amount ?? 0);
        const maximum = coupon.maximum_amount?.amount ?? coupon.maximum_amount;
        const days = coupon.remaining_days;
        const currency = coupon.minimum_amount?.currency || coupon.amount?.currency;

        let secondary = '';
        if (coupon.free_shipping) secondary = `+ ${this.escape(this.trans('cart.free_shipping_short'))}`;
        else if (maximum) secondary = `${this.escape(this.trans('cart.up_to'))} ${this.escape(this.money(maximum, currency))}`;

        let expiry = '';
        if (days !== undefined && days !== null) {
            expiry = days <= 0
                ? this.trans('cart.expires_today')
                : this.trans('cart.expires_after', { days });
        }

        return `
            <div class="f-coupon-card${eligible ? '' : ' f-coupon-card--disabled'}${current ? ' f-coupon-card--current' : ''}"
                 data-coupon-card="${this.escape(coupon.code)}" role="button" tabindex="${eligible ? 0 : -1}"
                 aria-disabled="${eligible ? 'false' : 'true'}">
                <div class="f-coupon-card__top">
                    <div class="f-coupon-card__amount">${this.formatAmount(coupon)}</div>
                    ${secondary ? `<div class="f-coupon-card__secondary">${secondary}</div>` : ''}
                    <div class="f-coupon-card__code">${this.escape(coupon.code)}</div>
                </div>
                <div class="f-coupon-card__divider" aria-hidden="true"></div>
                <div class="f-coupon-card__bottom">
                    <div class="f-coupon-card__terms">
                        ${expiry ? `<div class="f-coupon-card__expiry${days <= 3 ? ' is-soon' : ''}">${this.escape(expiry)}</div>` : ''}
                        ${minimum > 0 ? `<div class="f-coupon-card__minimum">${this.escape(this.trans('cart.minimum'))} ${this.escape(this.money(minimum, currency))}</div>` : ''}
                    </div>
                    <div class="f-coupon-card__action">
                        ${this.escape(this.trans(current ? 'cart.coupon_applied' : (eligible ? 'cart.apply' : 'cart.coupon_not_eligible')))}
                    </div>
                </div>
            </div>`;
    }

    formatAmount(coupon) {
        const raw = typeof coupon.amount === 'object' ? coupon.amount?.amount : coupon.amount;

        if (coupon.type === 'percentage') return `${this.escape(String(Number(raw) || 0))}%`;

        const currency = typeof coupon.amount === 'object' ? coupon.amount?.currency : coupon.minimum_amount?.currency;

        return this.escape(this.money(Number(raw) || 0, currency));
    }

    isEligible(coupon) {
        const minimum = Number(coupon.minimum_amount?.amount ?? coupon.minimum_amount ?? 0);

        return !(minimum > 0 && this.cartSubtotal < minimum);
    }

    /* ---------------------------------------------------------- behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        const refresh = () => { if (!this._busy) this.render(); };
        this._offs = ['cart::fetched', 'cart::updated', 'cart::coupon.applied', 'cart::coupon.removed']
            .map(name => this.sdk.event.on(name, refresh));

        this.listen(this, 'input', event => {
            if (!event.target.matches('[data-coupon-input]')) return;
            this._draft = event.target.value;
            if (this._error) { this._error = ''; this.querySelector('[data-coupon-error]').hidden = true; }
        });

        this.listen(this, 'keydown', event => {
            if (event.key === 'Enter' && event.target.matches('[data-coupon-input]')) {
                event.preventDefault();
                this.apply(this.typed());
            }
        });

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-coupon-apply]')) return this.apply(this.typed());
            if (event.target.closest('[data-coupon-remove]')) return this.remove();

            const card = event.target.closest('[data-coupon-card]');
            if (card && card.getAttribute('aria-disabled') !== 'true') this.apply(card.getAttribute('data-coupon-card'));
        });

        // The applied code comes from the cart; make sure it is loaded.
        if (!this.sdk.cart.loaded) this.sdk.cart.items().catch(() => {});

        this.loadCoupons();
    }

    async loadCoupons() {
        const inline = this.jsonAttr('coupons', null);

        if (Array.isArray(inline)) {
            this._coupons = inline;
            this.render();
            return;
        }

        if (!this.source) return;

        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.api.request(this.source));
            const raw = response?.data ?? response;
            this._coupons = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
        } catch (error) {
            this._coupons = [];
        }

        this.render();
    }

    /** What is in the field right now — typed, pasted, or set by a script. */
    typed() {
        return this._input?.value ?? this._draft ?? '';
    }

    async apply(code) {
        const value = String(code ?? '').trim();

        if (!value) {
            this._error = this.trans('cart.enter_coupon_code');
            this.render();
            this._input?.focus();
            return;
        }

        await this.run(async () => {
            await this.sdk.api.withoutNotifier(() => this.sdk.cart.applyCoupon(value));
            this._draft = '';
            this.emit('applied', { code: value, summary: this.sdk.cart.summary });
        }, value);
    }

    async remove() {
        await this.run(async () => {
            const code = this.applied;
            await this.sdk.api.withoutNotifier(() => this.sdk.cart.removeCoupon());
            this.emit('removed', { code, summary: this.sdk.cart.summary });
        });
    }

    async run(action, code = null) {
        if (this._busy) return;

        this._busy = true;
        this._error = '';
        this.render();

        try {
            await action();
        } catch (error) {
            this._error = error?.message || this.trans('cart.coupon_invalid');
            this.emit('failed', { code, error });
        } finally {
            this._busy = false;
            this.render();
            if (this._error) this._input?.focus();
        }
    }
}
