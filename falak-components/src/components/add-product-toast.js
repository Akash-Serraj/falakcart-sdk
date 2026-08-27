import FalakElement from '../base.js';

/**
 * <falak-add-product-toast cart-url="/cart" checkout-url="/checkout"></falak-add-product-toast>
 *
 * The "added to your cart" card — mirroring <salla-add-product-toast>.
 * Placed once per page. Whenever anything adds to the cart (the add
 * button, quick-add, a re-order link) it slides in with the product's
 * image, name, the amount just added, and a way to the cart or straight
 * to checkout; then leaves on its own.
 *
 * It listens to the SDK bus, so a theme never wires it to a button.
 *
 * | attribute     | role                                                       |
 * | cart-url      | where "View cart" goes (default /cart)                     |
 * | checkout-url  | where "Checkout" goes (default /checkout); hide-checkout    |
 * |               | drops that button                                          |
 * | duration      | ms before it leaves on its own (default 6000; 0 = stays)   |
 * | position      | bottom-end (default) | bottom-start | bottom-center |       |
 * |               | top-end | top-start | top-center                            |
 *
 * Events: DOM `shown` / `hidden` on the element; `cart::toast.shown` on the bus.
 */
export default class FalakAddProductToast extends FalakElement {
    static observedAttributes = ['cart-url', 'checkout-url', 'duration', 'position', 'hide-checkout'];

    get cartUrl() { return this.attr('cart-url', '/cart'); }
    get checkoutUrl() { return this.attr('checkout-url', '/checkout'); }
    get duration() { return this.numAttr('duration', 6000); }
    get position() { return this.attr('position', 'bottom-end'); }

    render() {
        this.classList.add('f-add-toast', `f-add-toast--${this.position}`);
        this.setAttribute('aria-live', 'polite');

        const line = this._line;

        if (!line) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');

        const lines = this.sdk.cart.lines || [];
        const count = lines.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const total = lines.reduce((sum, item) => sum + Number(item.total || 0), 0);
        const variant = line.variation && typeof line.variation === 'object'
            ? Object.values(line.variation).filter(Boolean).join(' / ')
            : '';

        this.innerHTML = `
            <div class="f-add-toast__card" role="status">
                <button type="button" class="f-add-toast__close" data-toast-close aria-label="${this.escape(this.trans('common.close'))}">&times;</button>
                <div class="f-add-toast__head">
                    ${FalakAddProductToast.ICON}
                    <span>${this.escape(this.trans('cart.added_title'))}</span>
                </div>
                <div class="f-add-toast__product">
                    ${line.image ? `<img class="f-add-toast__image" src="${this.escape(line.image)}" alt="">` : '<span class="f-add-toast__image f-add-toast__image--empty"></span>'}
                    <div class="f-add-toast__info">
                        ${line.url ? `<a class="f-add-toast__name" href="${this.escape(line.url)}">${this.escape(line.name)}</a>` : `<span class="f-add-toast__name">${this.escape(line.name)}</span>`}
                        ${variant ? `<span class="f-add-toast__variant">${this.escape(variant)}</span>` : ''}
                        <span class="f-add-toast__price">${this.escape(String(line.added))} &times; ${this.escape(this.money(line.price))}</span>
                    </div>
                </div>
                <p class="f-add-toast__summary">${this.escape(this.trans('cart.items_total', { count, total: this.money(total) }))}</p>
                <div class="f-add-toast__actions">
                    <a class="f-btn f-btn--primary f-add-toast__cart" href="${this.escape(this.cartUrl)}">${this.escape(this.trans('cart.view_cart'))}</a>
                    ${this.boolAttr('hide-checkout') ? '' : `<a class="f-btn f-btn--outline f-add-toast__checkout" href="${this.escape(this.checkoutUrl)}">${this.escape(this.trans('cart.checkout'))}</a>`}
                </div>
            </div>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this._off = this.sdk.event.on('cart::added', payload => this.show(payload));

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-toast-close]')) this.hide();
        });

        // Hovering pauses the clock: nobody likes a card leaving mid-read.
        this.listen(this, 'mouseenter', () => this.clearTimer());
        this.listen(this, 'mouseleave', () => this.arm());
    }

    disconnectedCallback() {
        if (typeof this._off === 'function') this._off();
        this.clearTimer();
        super.disconnectedCallback();
    }

    /** Called with the `cart::added` payload: { productId, variationId, added, quantity, response }. */
    show(payload = {}) {
        const lines = this.sdk.cart.lines || [];
        const wanted = String(payload.productId ?? '');
        const variation = payload.variationId ? String(payload.variationId) : null;

        const line = lines.find(item => String(item.productId) === wanted && (!variation || String(item.variationId ?? '') === variation))
            || lines.find(item => String(item.productId) === wanted);

        if (!line) return;

        this._line = { ...line, added: Number(payload.added ?? payload.quantity ?? 1) || 1 };
        this.render();

        this.classList.remove('is-in');
        requestAnimationFrame(() => this.classList.add('is-in'));

        this.arm();
        this.emit('shown', { line: this._line });
        this.emitBus('cart::toast.shown', { productId: line.productId, variationId: line.variationId });
    }

    hide() {
        this.clearTimer();
        if (!this._line) return;

        this.classList.remove('is-in');
        this._line = null;

        // Let the exit transition finish before the card is dropped.
        this._leaving = setTimeout(() => {
            this._leaving = null;
            this.render();
            this.emit('hidden');
        }, 260);
    }

    arm() {
        this.clearTimer();
        if (this._line && this.duration > 0) this._timer = setTimeout(() => this.hide(), this.duration);
    }

    clearTimer() {
        if (this._timer) clearTimeout(this._timer);
        if (this._leaving) clearTimeout(this._leaving);
        this._timer = null;
        this._leaving = null;
    }

    static ICON = '<svg class="f-add-toast__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
}
