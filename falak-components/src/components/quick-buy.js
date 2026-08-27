import FalakAddProductButton from './add-product-button.js';

/**
 * <falak-quick-buy product-id="12" quantity-selector="falak-quantity-input"></falak-quick-buy>
 * <falak-quick-buy product-id="12" has-options product-name="…" product-image="…" product-price="…"></falak-quick-buy>
 *
 * "Buy now" — mirroring <salla-quick-buy>: skip the stop at the cart page
 * and go straight to checkout. It shares every attribute, and all of the
 * option/quantity/stock-exceeded handling, with <falak-add-product-button>
 * (it extends it) — the only difference is what happens once the add
 * succeeds: instead of a toast and the fly-to-cart animation, the page
 * leaves for checkout, with a <falak-loading page> shown for the moment
 * in between.
 *
 * On a variant product met outside its own page (`has-options`, no
 * <falak-product-options> in scope) it opens the same dialog
 * <falak-add-product-button has-options> does, but tells it to redirect
 * once the add succeeds rather than just closing.
 *
 * See <falak-add-product-button>'s own doc comment for the full attribute
 * list — product-id, quantity, quantity-selector, options-selector,
 * variation-id, has-options, product-status, product-type, has-pre-order,
 * button-class, width/size/color/fill, source all apply here unchanged.
 *
 * | checkout-url | where the browser goes once the add succeeds (default /checkout) |
 */
export default class FalakQuickBuy extends FalakAddProductButton {
    static observedAttributes = [...FalakAddProductButton.observedAttributes, 'checkout-url'];

    get checkoutUrl() { return this.attr('checkout-url', '/checkout'); }

    // A secondary CTA next to "Add to cart" reads better outlined than solid;
    // still just the attribute's default, so `fill="solid"` overrides it.
    get fill() { return this.attr('fill', 'outline'); }

    render() {
        super.render();
        if (!this.productId) return;

        this.classList.add('f-add-product--quick-buy');
        this._button?.setAttribute('data-quick-buy', this.productId);
    }

    labelKey() {
        if (this.isForSale && this.needsQuickAdd()) return 'product.choose_options';
        if (this.isForSale && this.hasPreOrder) return 'product.pre_order';
        if (this.isForSale && this.productType === 'booking') return 'product.book_now';
        if (this.isForSale) return 'product.buy_now';
        if (this.productType === 'donating') return 'product.donation_exceed';

        return 'product.out_of_stock';
    }

    quickAddOptions() {
        return { redirect: this.checkoutUrl };
    }

    /** No toast, no fly-to-cart animation: the whole point is skipping that stop. */
    onAdded() {
        const FalakLoading = customElements.get('falak-loading');
        FalakLoading?.showPage(this.trans('checkout.title'));

        window.location.href = this.checkoutUrl;
    }
}
