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
 * Everything past productId is optional, and a row whose data the caller
 * did not pass is left out of the markup entirely — so a theme still
 * sending only the four original fields renders the dialog it always did:
 *
 * | productId        | required                                                  |
 * | name/image/price | the header: picture, title, current price                 |
 * | subtitle         | eyebrow above the name (brand, category, "Eau de parfum") |
 * | comparePrice     | the struck-through "was" — a number, or a formatted string |
 * | priceAmount      | the current price as a NUMBER, so "save X" can be worked out |
 * | currency         | currency for every amount this dialog formats itself      |
 * | url              | where the title and "view details" go (default /product/{id}) |
 * | inStock          | seeds the stock line before a variant is chosen            |
 * | note             | a reassurance line beside the details link (delivery, returns) |
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

    /* ------------------------------------------------------------- helpers */

    /**
     * A translation, or null when the theme has no string for the key.
     *
     * lang.get() answers a miss with the key itself, which is right for a
     * label the dialog cannot do without and wrong for the optional lines
     * below: those would read "product.in_stock" in a theme whose locale
     * file predates them. They ask here and leave themselves out instead.
     */
    transMaybe(key, replacements) {
        const value = this.trans(key, replacements);

        return value === key ? null : value;
    }

    /** A usable number, or null — '' and NaN both mean "not given". */
    static amount(value) {
        if (value === null || value === undefined || value === '') return null;

        const number = Number(value);

        return Number.isFinite(number) ? number : null;
    }

    /**
     * The three price cells for one price/compare pair: what it costs, what
     * it cost, and what that saves. A number is formatted here; a string is
     * taken as already formatted — that is what a card passes, and it is
     * shown verbatim so the dialog never quotes a differently-rounded price
     * than the card behind it.
     *
     * `nowAmount` is that same price as a number, for cards that can supply
     * one. Subtraction needs it: without it there is nothing to take the
     * compare price away from and the "save X" badge is left out.
     */
    priceCells(price, compare, currency, nowAmount) {
        const now = nowAmount === undefined ? FalakQuickAdd.amount(price) : FalakQuickAdd.amount(nowAmount);
        const was = FalakQuickAdd.amount(compare);
        const onSale = was !== null && (now === null || was > now);

        const saved = onSale && now !== null
            ? this.transMaybe('product.save_amount', { amount: this.money(was - now, currency) })
            : null;

        const format = value => (typeof value === 'number' ? this.money(value, currency) : String(value ?? ''));

        return {
            price: format(price),
            compare: onSale ? format(compare) : '',
            save: saved || '',
        };
    }

    /** Fills the header's price row in place — the variant's numbers replace the card's. */
    paint(cells) {
        const set = (selector, text) => {
            const el = this._modal?.querySelector(selector);
            if (!el) return;

            el.textContent = text || '';
            el.toggleAttribute('hidden', !text);
        };

        set('[data-quick-add-price]', cells.price);
        set('[data-quick-add-compare]', cells.compare);
        set('[data-quick-add-save]', cells.save);
    }

    /** The "in stock" / "out of stock" line; empty and hidden until something is known. */
    stockHtml(inStock) {
        const label = inStock === null ? null : this.transMaybe(inStock ? 'product.in_stock' : 'product.out_of_stock');
        const state = inStock === null ? '' : ` f-quick-add__stock--${inStock ? 'in' : 'out'}`;

        return `<p class="f-quick-add__stock${state}" data-quick-add-stock ${label ? '' : 'hidden'}>${this.escape(label || '')}</p>`;
    }

    /** Repaints that line once a complete variant choice answers the question properly. */
    paintStock(inStock) {
        const el = this._modal?.querySelector('[data-quick-add-stock]');
        if (!el) return;

        const label = inStock === null
            ? null
            : this.transMaybe(inStock ? 'product.in_stock' : 'product.out_of_stock');

        el.classList.toggle('f-quick-add__stock--in', inStock === true);
        el.classList.toggle('f-quick-add__stock--out', inStock === false);
        el.textContent = label || '';
        el.toggleAttribute('hidden', !label);
    }

    /* ------------------------------------------------------------- opening */

    /**
     * @param {{ productId: number|string, name?: string, image?: string, price?: string|number,
     *           currency?: string, subtitle?: string, comparePrice?: string|number,
     *           priceAmount?: number, url?: string, inStock?: boolean, note?: string }} product
     * @param {{ redirect?: string }} options  redirect: leave for this URL
     *   instead of just closing once the add succeeds — how <falak-quick-buy>
     *   reuses this same dialog to go straight to checkout.
     */
    async open(product, options = {}) {
        const productId = product?.productId ?? product?.id;
        if (!productId) return null;

        this._modal?.remove();

        const currency = product.currency;
        const url = product.url || `/product/${productId}`;
        const price = product.price === undefined || product.price === null ? '' : product.price;

        /*
         * `price` is what the card already printed — a formatted string, as a
         * rule — and `priceAmount` is the same money as a number. Only the
         * number can be subtracted from the compare price, so the "save X"
         * badge shows for a card that passes it and is quietly left out for
         * one that does not. Both fall back to the card's values when the
         * shopper clears a variant choice.
         */
        const baseAmount = FalakQuickAdd.amount(product.priceAmount);
        const baseCompare = product.comparePrice ?? null;

        const cells = this.priceCells(price, baseCompare, currency, baseAmount ?? undefined);
        const details = this.transMaybe('product.view_details');
        const inStock = product.inStock === undefined || product.inStock === null ? null : !!product.inStock;

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
                    ${product.subtitle ? `<span class="f-quick-add__eyebrow">${this.escape(product.subtitle)}</span>` : ''}
                    <a class="f-quick-add__name" href="${this.escape(url)}">${this.escape(product.name || '')}</a>
                    <span class="f-quick-add__prices">
                        <b class="f-quick-add__price" data-quick-add-price>${this.escape(cells.price)}</b>
                        <del class="f-quick-add__compare" data-quick-add-compare ${cells.compare ? '' : 'hidden'}>${this.escape(cells.compare)}</del>
                        <span class="f-quick-add__save" data-quick-add-save ${cells.save ? '' : 'hidden'}>${this.escape(cells.save)}</span>
                    </span>
                </div>
            </div>
            <form class="f-quick-add__form" data-quick-add-form>
                <falak-product-options product-id="${this.escape(productId)}" fetch></falak-product-options>
                ${this.stockHtml(inStock)}
                <div class="f-quick-add__actions">
                    <falak-quantity-input product-id="${this.escape(productId)}" value="1" min="1"></falak-quantity-input>
                    <falak-add-product-button product-id="${this.escape(productId)}"
                                              quantity-selector="falak-quantity-input"
                                              options-selector="falak-product-options"
                                              width="wide"
                                              source="quick-add"></falak-add-product-button>
                </div>
                ${product.note || details
                    ? `<div class="f-quick-add__footnote">
                           <span class="f-quick-add__note">${this.escape(product.note || '')}</span>
                           ${details ? `<a class="f-quick-add__details" href="${this.escape(url)}">${this.escape(details)}</a>` : ''}
                       </div>`
                    : ''}
            </form>`;

        this.appendChild(modal);
        this._modal = modal;

        // The variant's price, discount and stock replace the card's while one
        // is chosen, and give way to the card's again when the choice is cleared.
        modal.addEventListener('changed', event => {
            if (!event.target.matches('falak-product-options')) return;

            const detail = event.detail || {};
            const chosen = detail.price !== null && detail.price !== undefined;

            this.paint(chosen
                ? this.priceCells(detail.price, detail.comparePrice, currency)
                : this.priceCells(price, baseCompare, currency, baseAmount ?? undefined));

            this.paintStock(detail.complete ? !!detail.inStock : inStock);
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

        /*
         * Drop the modal once it closes, rather than leaving it parked in the
         * document until the next open().
         *
         * It carries a loaded <falak-product-options> for this product, and
         * <falak-add-product-button> looks for its options element across the
         * whole document. A closed dialog left in the tree was therefore found
         * by the CARD's button on the next click: it stopped opening the dialog
         * and added straight to the cart, using whatever variant happened to be
         * selected in the invisible copy. Escape and backdrop clicks close the
         * modal without telling this component, so the attribute is watched
         * rather than hooking close().
         */
        const watcher = new MutationObserver(() => {
            if (modal.hasAttribute('visible')) return;

            watcher.disconnect();

            // After the close transition, so the dialog is not yanked mid-fade.
            window.setTimeout(() => {
                if (this._modal === modal) this._modal = null;
                modal.remove();
            }, 400);
        });

        watcher.observe(modal, { attributes: true, attributeFilter: ['visible'] });

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
