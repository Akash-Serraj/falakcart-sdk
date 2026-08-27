import FalakElement from '../base.js';

/**
 * <falak-add-product-button product-id="12"></falak-add-product-button>
 * <falak-add-product-button product-id="12" quantity="3" width="wide"></falak-add-product-button>
 * <falak-add-product-button product-id="12" product-status="out"></falak-add-product-button>
 * <falak-add-product-button product-id="12" quantity-selector="[data-cart-quantity]">
 *     <svg …></svg> Add to cart            ← author markup becomes the label
 * </falak-add-product-button>
 *
 * The one "add to cart" control, mirroring <salla-add-product-button>'s
 * attribute vocabulary — product-id, quantity, product-status, product-type,
 * has-pre-order, width/size/color/fill — so theme markup carries over.
 *
 * It calls the cart API itself (falak.cart.add) rather than announcing an
 * intent for the theme to fulfil: every theme then gets a working button for
 * free, with one behaviour, and cannot double-add by handling both. It reports
 * back two ways — DOM events `success` / `failed` on the element for markup
 * that wraps it, and the SDK's own `cart::added` / `cart::failed` on the bus.
 *
 * | attribute          | role                                                    |
 * | product-id         | required                                                |
 * | quantity           | units to add when there is no selector (default 1)      |
 * | quantity-selector  | CSS selector of a <falak-quantity-input> to read instead |
 * | options-selector   | selector of the <falak-product-options> to consult        |
 * | variation-id       | fixed variation to add (no options element on the page)  |
 * | has-options        | the product has variants and there is no options element |
 * |                    | in scope: the click opens <falak-quick-add> instead        |
 * | product-name /     | what the quick-add dialog shows for the product           |
 * | -image / -price    |                                                          |
 * | product-status     | sale (default) | out | out-and-notify                   |
 * | product-type       | product (default) | booking | donating                  |
 * | has-pre-order      | label becomes "pre-order" (still adds to the cart)      |
 * | button-class       | extra class(es) forwarded to the inner <button>, so a  |
 * |                    | theme's existing button skin keeps applying            |
 * | width / size /     | forwarded as f-btn modifier classes                     |
 * | color / fill       |                                                         |
 * | source             | analytics label; falls back to the enclosing list/card  |
 */
export default class FalakAddProductButton extends FalakElement {
    static observedAttributes = [
        'product-id', 'quantity', 'product-status', 'product-type', 'has-pre-order',
        'width', 'size', 'color', 'fill', 'button-class', 'quantity-selector', 'options-selector', 'variation-id', 'source',
        'has-options', 'product-name', 'product-image', 'product-price',
    ];

    get productId() { return this.attr('product-id'); }
    get quantity() { return Math.max(1, this.numAttr('quantity', 1)); }
    get productStatus() { return this.attr('product-status', 'sale'); }
    get productType() { return this.attr('product-type', 'product'); }
    get hasPreOrder() { return this.boolAttr('has-pre-order'); }
    get buttonClass() { return this.attr('button-class', ''); }
    get quantitySelector() { return this.attr('quantity-selector', '[data-cart-quantity]'); }
    get optionsSelector() { return this.attr('options-selector', 'falak-product-options'); }
    get variationId() { return this.attr('variation-id', null); }
    get hasOptions() { return this.boolAttr('has-options'); }
    get width() { return this.attr('width', 'normal'); }
    get size() { return this.attr('size', 'medium'); }
    get color() { return this.attr('color', 'primary'); }
    get fill() { return this.attr('fill', 'solid'); }

    get isForSale() { return this.productStatus === 'sale'; }

    /** Where the add came from, for analytics: explicit, else the enclosing section. */
    get source() {
        if (this.hasAttribute('source')) return this.getAttribute('source');

        const parent = this.closest('falak-products-list, falak-products-slider')
            ?? this.closest('falak-product-card');

        return parent?.getAttribute('source') || 'button';
    }

    connectedCallback() {
        // Author markup is the label. Captured before the first render
        // replaces it — and only once, so re-renders keep it.
        if (this._label === undefined) {
            const passed = this.innerHTML.trim();
            this._label = passed || null;
        }

        return super.connectedCallback();
    }

    /* ------------------------------------------------------------- render */

    render() {
        if (!this.productId) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.classList.add('f-add-product');
        this.classList.toggle('f-add-product--unavailable', !this.isForSale);

        /*
         * Two skins, never both. With `button-class` the THEME owns the look
         * (its own .btn rules) and the SDK's f-btn modifiers stay off, so the
         * two vocabularies never fight over one element. Without it, the
         * SDK's f-btn default applies — and, being layered, still yields to
         * any rule the theme writes for it.
         */
        const classes = ['f-add-product__button'];

        if (this.buttonClass) {
            classes.push(...this.buttonClass.split(/\s+/).filter(Boolean));
        } else {
            classes.push('f-btn', `f-btn--${this.fill}`, `f-btn--${this.isForSale ? this.color : 'light'}`);
            if (this.size !== 'medium') classes.push(`f-btn--${this.size}`);
            if (this.width !== 'normal') classes.push(`f-btn--${this.width}`);
        }

        this.innerHTML = `
            <button type="button" class="${classes.join(' ')}"
                    ${this.isForSale ? '' : 'disabled'}
                    data-add-product="${this.escape(this.productId)}">
                ${this.labelHtml()}
            </button>`;

        this._button = this.querySelector('button');
    }

    /**
     * Author markup wins. Otherwise the wording follows the product, in the
     * same order of precedence Salla uses: pre-order, booking, sale, sold out.
     */
    labelHtml() {
        if (this._label) return this._label;

        return `<span>${this.escape(this.trans(this.labelKey()))}</span>`;
    }

    labelKey() {
        if (this.isForSale && this.needsQuickAdd()) return 'product.choose_options';
        if (this.isForSale && this.hasPreOrder) return 'product.pre_order';
        if (this.isForSale && this.productType === 'booking') return 'product.book_now';
        if (this.isForSale) return 'product.add_to_cart';
        if (this.productType === 'donating') return 'product.donation_exceed';

        return 'product.out_of_stock';
    }

    /* ------------------------------------------------------------- action */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (!event.target.closest('button')) return;

            event.preventDefault();
            event.stopPropagation();

            this.add();
        });
    }

    /**
     * Units to add: a live quantity input when the page has one (the product
     * page's stepper), else the attribute. The selector is resolved inside the
     * nearest form first so two products on one page cannot read each other's
     * stepper, then page-wide for the common single-product case.
     */
    selectedQuantity() {
        const selector = this.quantitySelector;

        if (selector) {
            const scope = this.closest('form') || document;
            const input = [...scope.querySelectorAll(selector)].find(el => this.speaksFor(el));
            const value = Number(input?.value);

            if (Number.isFinite(value) && value > 0) return value;
        }

        return this.quantity;
    }

    /**
     * The product's picture flies into the header's <falak-cart-summary>,
     * when there is one: the nearest image inside the enclosing card or
     * product page. Purely cosmetic; a page without either is untouched.
     */
    flyToCart() {
        const summary = document.querySelector('falak-cart-summary');
        if (!summary?.animateToCart) return;

        const scope = this.closest('falak-product-card, .f-card, .product-card, [data-product-scope], .product-page, main');
        const image = scope?.querySelector('img');

        summary.animateToCart(image || null);
    }

    /** The options element for this product, nearest form first. */
    optionsElement() {
        const selector = this.optionsSelector;
        if (!selector) return null;

        const scope = this.closest('form') || document;
        const found = [...scope.querySelectorAll(selector)].find(el => this.speaksFor(el));

        return found && found.variations?.length ? found : null;
    }

    /**
     * An element found outside this button's own form may only speak for
     * this product if it carries the same product-id (or none). Without
     * this, a related-products card on a variant product's page picked up
     * the PAGE product's chosen variation and posted a variation that did
     * not belong to the card's product — every add then failed with
     * "No query results for model ProductVariation".
     */
    speaksFor(el) {
        const owner = el.getAttribute?.('product-id');

        return !owner || String(owner) === String(this.productId);
    }

    /**
     * A variant product outside its own page: nothing here can take the
     * choice, so the click opens the quick-add dialog. On the product page
     * (an options element in scope) the button adds directly.
     */
    needsQuickAdd() {
        return this.hasOptions && !this.optionsElement();
    }

    openQuickAdd() {
        const FalakQuickAdd = customElements.get('falak-quick-add');
        const product = {
            productId: this.productId,
            name: this.attr('product-name', ''),
            image: this.attr('product-image', ''),
            price: this.attr('product-price', ''),
        };

        if (FalakQuickAdd?.open) FalakQuickAdd.open(product);
        else this.sdk.event.dispatch('quick-add::open', product);
    }

    async add() {
        if (!this.isForSale || this._pending) return;

        if (this.needsQuickAdd()) {
            this.openQuickAdd();
            return;
        }

        // Booking is a different flow (a date, a slot) that this platform has
        // not wired for storefronts yet; announce the intent for a theme to
        // pick up rather than pretend it went into the cart.
        if (this.productType === 'booking') {
            if (!this.sdk.auth.isLoggedIn()) {
                this.sdk.event.dispatch('auth::required');
                return;
            }

            this.emitBus('booking::add', { productId: this.productId, source: this.source });
            return;
        }

        /*
         * A variant product must have its variant chosen. The options
         * element (scoped like the quantity stepper) validates itself —
         * flags the missing group, scrolls to it — and hands back the
         * variation; a sold-out variant is refused here, not by the cart.
         */
        let variationId = this.variationId;
        const options = this.optionsElement();

        if (options) {
            if (typeof options.reportValidity === 'function' && !options.reportValidity()) return;

            const variation = options.variation;
            if (variation && !variation.inStock) {
                this.sdk.notify.error(this.trans('product.out_of_stock'));
                return;
            }

            variationId = variation?.id ?? variationId;
        }

        const quantity = this.selectedQuantity();

        this._pending = true;
        this.setBusy(true);
        this._button?.setAttribute('disabled', '');

        try {
            const response = await this.sdk.api.withoutNotifier(
                () => this.sdk.cart.add(this.productId, { quantity, variationId }),
            );

            // One toast, worded for the shopper — not the API's generic
            // "cart updated" that withoutNotifier suppressed above.
            // A <falak-add-product-toast> on the page shows the product card
            // instead (it listens to cart::added), so no second toast here.
            if (!document.querySelector('falak-add-product-toast')) this.sdk.notify.success(this.trans('cart.added'));
            this.emit('success', { productId: this.productId, variationId, quantity, source: this.source, response });
            this.flyToCart();
        } catch (error) {
            this.sdk.notify.error(error?.message || this.trans('common.load_failed'));
            this.emit('failed', { productId: this.productId, quantity, error });

            // "Requested quantity exceeds available stock": the page can cap
            // the stepper and offer "notify me" instead of a dead end.
            const payload = error?.falak?.payload;
            const available = payload?.available ?? payload?.available_stock;
            if (available !== undefined && available !== null) {
                this.emitBus('product::stock.exceeded', {
                    productId: this.productId, variationId, available: Number(available), requested: quantity, message: error?.message,
                });
            }
        } finally {
            this._pending = false;
            this.setBusy(false);
            if (this.isForSale) this._button?.removeAttribute('disabled');
        }
    }
}
