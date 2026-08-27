import FalakElement from '../base.js';

/**
 * <falak-quick-add></falak-quick-add>            (one per page; created on demand)
 *
 * The "choose options" dialog for a variant product met outside its own
 * page — a listing card, a slider, a related-products row. It carries the
 * product's picture, name and price, a <falak-product-options> that loads
 * the variations, a quantity stepper and an add button, so the shopper
 * picks a variant right there instead of leaving the list.
 *
 * <falak-add-product-button has-options> opens it. It can also be driven
 * from the bus: falak.event.dispatch('quick-add::open', { productId, name,
 * image, price }). One element serves the whole page; each open builds a
 * fresh <falak-modal> because the modal snapshots its content on first
 * render.
 *
 * open(product, { redirect }) leaves for `redirect` once the add succeeds
 * instead of closing — <falak-quick-buy> passes this to reuse the same
 * dialog for a variant product met outside its own page.
 */
export default class FalakQuickAdd extends FalakElement {
    static observedAttributes = [];

    /** Finds or creates the page's dialog and opens it for a product. */
    static open(product, options = {}) {
        let host = document.querySelector('falak-quick-add');

        if (!host) {
            host = document.createElement('falak-quick-add');
            document.body.appendChild(host);
        }

        return host.open(product, options);
    }

    render() {
        // Nothing until opened; the modal is built per product.
        if (!this._modal) this.innerHTML = '';
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this._offOpen = this.sdk.event.on('quick-add::open', product => this.open(product || {}));
    }

    disconnectedCallback() {
        if (typeof this._offOpen === 'function') this._offOpen();
        super.disconnectedCallback();
    }

    /**
     * @param {{ productId: number|string, name?: string, image?: string, price?: string|number, currency?: string }} product
     * @param {{ redirect?: string }} options  redirect: leave for this URL
     *   instead of just closing once the add succeeds — how <falak-quick-buy>
     *   reuses this same dialog to go straight to checkout.
     */
    async open(product, options = {}) {
        const productId = product?.productId ?? product?.id;
        if (!productId) return null;

        this._modal?.remove();

        const price = product.price === undefined || product.price === null
            ? ''
            : (typeof product.price === 'number' ? this.money(product.price, product.currency) : String(product.price));

        const modal = document.createElement('falak-modal');
        modal.setAttribute('width', 'md');
        modal.setAttribute('modal-title', this.trans('product.choose_options'));
        modal.className = 'f-quick-add';
        modal.innerHTML = `
            <div class="f-quick-add__product">
                ${product.image
                    ? `<img class="f-quick-add__image" src="${this.escape(product.image)}" alt="" loading="lazy">`
                    : `<span class="f-quick-add__image f-quick-add__image--empty" aria-hidden="true"></span>`}
                <div class="f-quick-add__meta">
                    <a class="f-quick-add__name" href="/product/${this.escape(productId)}">${this.escape(product.name || '')}</a>
                    <b class="f-quick-add__price" data-quick-add-price>${this.escape(price)}</b>
                </div>
            </div>
            <form class="f-quick-add__form" data-quick-add-form>
                <falak-product-options product-id="${this.escape(productId)}" fetch></falak-product-options>
                <div class="f-quick-add__actions">
                    <falak-quantity-input product-id="${this.escape(productId)}" value="1" min="1"></falak-quantity-input>
                    <falak-add-product-button product-id="${this.escape(productId)}"
                                              quantity-selector="falak-quantity-input"
                                              options-selector="falak-product-options"
                                              width="wide"
                                              source="quick-add"></falak-add-product-button>
                </div>
            </form>`;

        this.appendChild(modal);
        this._modal = modal;

        // The variant's price replaces the card's while one is chosen.
        modal.addEventListener('changed', event => {
            const el = modal.querySelector('[data-quick-add-price]');
            if (!el || !event.target.matches('falak-product-options')) return;
            el.textContent = event.detail?.price !== null && event.detail?.price !== undefined
                ? this.money(event.detail.price, product.currency)
                : price;
        });

        // Added: the shopper is done here — or, for quick-buy, not done at
        // all yet, just past the part only this dialog could collect.
        modal.addEventListener('success', event => {
            if (!event.target.matches('falak-add-product-button')) return;

            if (options.redirect) {
                const FalakLoading = customElements.get('falak-loading');
                FalakLoading?.showPage(this.trans('checkout.title'));
                window.location.href = options.redirect;
                return;
            }

            window.setTimeout(() => modal.close(), 350);
        });

        // Let the modal render before opening so its transition plays.
        await Promise.resolve();
        modal.open();

        this.emitBus('quick-add::opened', { productId });

        return modal;
    }

    close() {
        this._modal?.close();
    }
}
