import FalakElement from '../base.js';

/**
 * <falak-product-card product='{"id":1,"name":"...","price_cents":"90.00"}'>
 * <falak-product-card product-id="12" fetch>
 *
 * Component #4: composition and formatting. It owns no commerce logic — it
 * normalises one product record into markup and hosts other components inside
 * itself (the rating stars), which is the pattern every card-shaped component
 * on the storefront will follow.
 *
 * | attribute   | role                                                      |
 * | hide-offer  | suppress the special-offer ribbon on this card            |
 */
export default class FalakProductCard extends FalakElement {
    static observedAttributes = ['product', 'product-id', 'hide-offer'];

    get product() {
        return this._product || this.jsonAttr('product', null);
    }

    async setup() {
        await this.loadProduct();

        // Deliberately NOT awaited — see loadOffer().
        this.loadOffer();
    }

    async loadProduct() {
        if (this.product || !this.boolAttr('fetch')) return;

        const id = this.attr('product-id');
        if (!id) return;

        this.setBusy(true);

        try {
            this._product = await this.sdk.product.show(id);
        } catch (error) {
            this.sdk.logger.warn('product-card: fetch failed', error);
        } finally {
            this.setBusy(false);
        }
    }

    /** Themes that do not want the ribbon opt out per card or per list. */
    get hideOffer() { return this.boolAttr('hide-offer'); }

    /** The dashboard master switch gates every offers surface. */
    get offersEnabled() {
        return !!(this.sdk.config.get('store.settings.marketing', {}) || {}).enable_special_offers;
    }

    /**
     * The special-offer ribbon.
     *
     * It names the offer and NEVER quotes its value. A "cart" scoped offer —
     * which is what most of them are — only pays out once the whole cart
     * qualifies (`min_cart_amount`), so printing "50%" beside a card price
     * promises a number checkout will not honour. A per-item price cut already
     * has its own display: `discount_price_cents` renders as the struck-through
     * "was" price above. This says "there is an offer on this one" and lets the
     * product page state the terms.
     *
     * Resolved WITHOUT blocking first paint: connectedCallback awaits setup()
     * before rendering, so awaiting the offers request here would hold up every
     * card on a listing behind one round trip. Instead the card paints now and
     * only the cards that actually carry an offer repaint once. falak.offer
     * .fetch() memoises its promise, so forty cards cost one request.
     */
    loadOffer() {
        if (this.hideOffer || !this.offersEnabled) return;

        this.sdk.offer.fetch().then(offers => {
            if (this._offer) return;

            const id = Number(this.product?.id ?? this.attr('product-id'));
            if (!Number.isFinite(id)) return;

            /*
             * The same rule <falak-offers below-product> applies: an offer
             * belongs to a product only when it names it. An empty product_ids
             * means "not shown here", not "applies to everything".
             */
            const offer = (offers || []).find(row =>
                Array.isArray(row.product_ids) && row.product_ids.map(Number).includes(id));

            if (!offer) return;

            this._offer = offer;
            if (this.ready) this.render();
        });
    }

    /**
     * The storefront API returns raw Eloquent models, so the shape is the
     * database's, not a presenter's. Normalising here means one place to change
     * when the platform grows a proper resource — every card keeps working.
     */
    normalise(product) {
        const locale = this.sdk.lang.locale;

        const name = locale === 'ar' && product.name_ar ? product.name_ar : product.name;

        const price = Number(product.price_cents ?? 0);
        const wasPrice = Number(product.discount_price_cents ?? 0);

        // A discount column that is set and lower than list price is the sale
        // price; the original then becomes the struck-through "was".
        const onSale = wasPrice > 0 && wasPrice < price;

        const image = product.image_path
            || product.images?.[0]?.url
            || product.images?.[0]?.image_path
            || null;

        return {
            id: product.id,
            name: name || '',
            url: this.sdk.url.product(product.id),
            image,
            price: onSale ? wasPrice : price,
            compareAt: onSale ? price : null,
            currency: product.currency || null,
            /*
             * `in_stock` / `has_variations` are the platform's own resolved
             * answers, sent by the server-rendered product shape a theme gets
             * in page_data. They are checked FIRST because the raw API row
             * carries neither, so nothing about the fetched path changes — but
             * a theme that passes a server product straight into this card no
             * longer reads "out of stock, no options" from columns that shape
             * never had. In particular `variations` arrives as [] on a listing
             * (the relation is only loaded on the product page) while
             * has_variations is true, so the array must not get the last word.
             */
            // In stock while the product OR any of its variants is (checkout
            // stock-checks the chosen variant, not the product-level number).
            inStock: product.in_stock !== undefined
                ? !!product.in_stock
                : (product.quantity === null || Number(product.quantity) > 0 || !!product.allow_backorders
                    || (Array.isArray(product.variations) && product.variations.some(v => v.quantity === null || v.quantity === undefined || Number(v.quantity) > 0))),
            hasVariations: product.has_variations !== undefined
                ? !!product.has_variations
                : (Array.isArray(product.variations) && product.variations.length > 0),
            rating: product.average_rating ?? null,
            reviews: product.reviews_count ?? 0,
        };
    }

    /*
     * Display variants — the port of theme-raed's custom-salla-product-card
     * vocabulary. All layout, no data: the same normalised product renders in
     * four treatments, chosen by the section that places the card.
     *
     *   (default)     vertical card: image, title, rating, price
     *   minimal       image + title + price only — dense grids
     *   full-image    the image IS the card; title and price overlay its foot
     *   special       featured treatment + remaining-stock urgency line
     *   horizontal    image beside content — search results, small lists
     */
    get isMinimal() { return this.boolAttr('minimal'); }
    get isFullImage() { return this.boolAttr('full-image'); }
    get isSpecial() { return this.boolAttr('special'); }
    get isHorizontal() { return this.boolAttr('horizontal'); }

    /**
     * Opt-in standard buy button (`show-add-button`). Themes that slot their
     * own control keep doing that; this exists so list-rendered cards — which
     * have no slot — can still carry the action. Clicking emits `cart::add`
     * on the bus; the button also carries data-add-to-cart, the attribute
     * themes already delegate on.
     */
    get showAddButton() { return this.boolAttr('show-add-button'); }

    /**
     * The wishlist heart (`show-wishlist`, and always beside the buy button) —
     * buy button. Emits `wishlist::toggle` and carries data-wishlist for
     * theme-level delegates, mirroring the buy button's contract.
     */
    get showWishlist() { return this.boolAttr('show-wishlist'); }

    render() {
        const raw = this.product;

        if (!raw) {
            this.innerHTML = `<div class="f-card f-card--empty" aria-hidden="true"></div>`;
            return;
        }

        const product = this.normalise(raw);

        this.classList.add('f-card');
        this.setState('product-id', product.id);
        this.classList.toggle('f-card--out-of-stock', !product.inStock);
        this.classList.toggle('f-card--minimal', this.isMinimal);
        this.classList.toggle('f-card--full-image', this.isFullImage);
        this.classList.toggle('f-card--special', this.isSpecial);
        this.classList.toggle('f-card--horizontal', this.isHorizontal);

        // Minimal and full-image strip the extras; the essentials remain.
        const showBadge = product.compareAt && !this.isMinimal && !this.isFullImage;
        const showRating = product.rating !== null && !this.isMinimal && !this.isFullImage;
        const showStock = !product.inStock && !this.isMinimal;

        // Minimal is the one variant with no room for it; a full-image card is
        // the most visual of them and carries a ribbon well.
        const offerLabel = this._offer && !this.isMinimal
            ? (this._offer.offer_title || this.trans('offer.title'))
            : '';

        /*
         * The special card's urgency line: remaining stock, only when it is a
         * real finite number. Raed draws a donut gauge; a plain counted line
         * says the same thing without inventing a "full stock" total to draw
         * the circle against.
         */
        const remaining = this.isSpecial && product.inStock
            && Number.isFinite(Number(raw.quantity)) && Number(raw.quantity) > 0
            ? this.trans('product.remaining', { count: this.sdk.number(raw.quantity) })
            : '';

        this.innerHTML = `
            <article class="f-card__inner">
                <a class="f-card__media" href="${this.escape(product.url)}" tabindex="-1" aria-hidden="true">
                    ${product.image
                        ? `<img src="${this.escape(product.image)}" alt="" loading="lazy" decoding="async">`
                        : `<span class="f-card__placeholder"></span>`}
                    ${showBadge ? `<span class="f-card__badge" data-discount="${Math.round(((product.compareAt - product.price) / product.compareAt) * 100)}">${this.escape(this.trans('product.sale'))}</span>` : ''}
                    ${offerLabel ? `<span class="f-card__offer">${this.escape(offerLabel)}</span>` : ''}
                </a>

                <div class="f-card__body">
                    ${remaining ? `<p class="f-card__remaining">${this.escape(remaining)}</p>` : ''}

                    <h3 class="f-card__title">
                        <a class="f-card__link" href="${this.escape(product.url)}">${this.escape(product.name)}</a>
                    </h3>

                    ${showRating
                        ? `<falak-rating-stars value="${product.rating}" total="${product.reviews}"></falak-rating-stars>`
                        : ''}

                    <p class="f-card__price">
                        <span class="f-card__price-now">${this.escape(this.money(product.price, product.currency))}</span>
                        ${product.compareAt
                            ? `<del class="f-card__price-was">${this.escape(this.money(product.compareAt, product.currency))}</del>`
                            : ''}
                    </p>

                    ${showStock
                        ? `<p class="f-card__stock">${this.escape(this.trans('product.out_of_stock'))}</p>`
                        : ''}
                </div>

                <div class="f-card__actions">
                    ${this.showAddButton ? `
                        <falak-add-product-button product-id="${product.id}"
                                                  product-status="${product.inStock ? 'sale' : 'out'}"
                                                  ${product.hasVariations ? 'has-options' : ''}
                                                  product-name="${this.escape(product.name)}"
                                                  product-image="${this.escape(product.image || '')}"
                                                  product-price="${this.escape(this.money(product.price, product.currency))}"
                                                  button-class="f-card__add"
                                                  source="${this.escape(this.attr('source') || 'card')}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                            <span>${this.escape(this.trans(!product.inStock ? 'product.out_of_stock' : (product.hasVariations ? 'product.choose_options' : 'product.add_to_cart')))}</span>
                        </falak-add-product-button>` : ''}
                    ${this.showWishlist || this.showAddButton ? `
                        <falak-wishlist-button product-id="${product.id}" button-class="f-card__wishlist"></falak-wishlist-button>` : ''}
                </div>
            </article>`;

        // Anything the author slotted into the element is moved into the
        // actions area rather than overwritten, so a theme can drop its own
        // button in without this component knowing what a button is.
        const slot = this._slotted;
        if (slot && slot.length) {
            this.querySelector('.f-card__actions').append(...slot.map(node => node.cloneNode(true)));
        }
    }

    connectedCallback() {
        // Capture author markup once, before the first render replaces it.
        if (!this._slotted) this._slotted = Array.from(this.children);
        return super.connectedCallback();
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            // The add action is <falak-add-product-button>, which performs the
            // add itself. It is deliberately NOT re-announced as `cart::add`
            // here: a theme answering that bus event would add a second time.
            if (event.target.closest('falak-add-product-button')) return;

            // The heart is <falak-wishlist-button>; it toggles itself.
            if (event.target.closest('falak-wishlist-button')) return;

            if (!event.target.closest('.f-card__link')) return;

            this.emitBus('product::viewed', {
                productId: this.product?.id,
                source: this.attr('source') || 'card',
            });
        });
    }
}
