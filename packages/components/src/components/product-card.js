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
 * | show-offer  | draw the special-offer ribbon (off by default, see below) |
 * | hide-offer  | kept for older markup; the ribbon is already off without it |
 */
export default class FalakProductCard extends FalakElement {
    static observedAttributes = ['product', 'product-id', 'hide-offer', 'show-offer'];

    /**
     * Stock read off a raw API row, for a payload that carries no resolved
     * `in_stock`. Mirrors the server's StockPolicy::inStock(): a product WITH
     * variants is decided by its variants alone — checkout stock-checks the
     * chosen variant, and the product-level number may hold anything (a
     * product at 10 whose variants were all sold out used to read "in
     * stock"). A null/absent quantity is unlimited, not zero.
     */
    static rawInStock(product) {
        if (product.allow_backorders) return true;

        const variations = Array.isArray(product.variations) ? product.variations : [];
        const unlimitedOrSome = q => q === null || q === undefined || Number(q) > 0;

        return variations.length
            ? variations.some(v => unlimitedOrSome(v.quantity))
            : unlimitedOrSome(product.quantity);
    }

    /**
     * Units left, for the special card's "X left" line: the variants' total
     * on a variant product (never its product-level number), the product's
     * own count otherwise. Null whenever it is not a finite count — unlimited,
     * or a variant product whose variations were not sent.
     */
    static remainingStock(product) {
        const finite = q => q !== null && q !== undefined && Number.isFinite(Number(q));
        const variations = Array.isArray(product.variations) ? product.variations : [];

        if (variations.length) {
            if (!variations.every(v => finite(v.quantity))) return null;
            return variations.reduce((sum, v) => sum + Math.max(0, Number(v.quantity)), 0);
        }

        if (product.has_variations) return null;

        return finite(product.quantity) ? Number(product.quantity) : null;
    }

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

    /*
     * The special-offer ribbon is OPT-IN. The legacy storefront never put an
     * offer on a product card: a card carried only what the product row
     * itself says — the markdown percentage, "hot", free shipping — and
     * offers were met in the header popup, under the buy box and in the
     * cart tracker, all of which these themes also have. Drawn by default,
     * the ribbon put an offer NAMED "50% off" beside a product's own
     * "40% sale" and read as two discounts. `hide-offer` still parses so
     * older markup keeps working; it simply no longer has anything to hide.
     */
    get showOffer() { return this.boolAttr('show-offer') && !this.boolAttr('hide-offer'); }
    get hideOffer() { return !this.showOffer; }

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
        if (!this.showOffer || !this.offersEnabled) return;

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

        /*
         * The server-rendered shape prices differently, and reading it as the
         * raw one put 0.00 on every card: mapProduct has ALREADY resolved the
         * sale, so it sends `price_amount` (the effective price) and
         * `compare_at_amount` (the original) and carries no price_cents at
         * all. Unfolding it back into list/discount lets the one rule below
         * decide for both shapes. Nothing about the fetched path changes —
         * this only runs when price_cents is absent.
         */
        const mapped = product.price_cents === undefined && product.price_amount !== undefined;

        const price = mapped
            ? Number(product.compare_at_amount ?? product.price_amount ?? 0)
            : Number(product.price_cents ?? 0);

        const wasPrice = mapped
            ? (product.compare_at_amount ? Number(product.price_amount ?? 0) : 0)
            : Number(product.discount_price_cents ?? 0);

        // A discount column that is set and lower than list price is the sale
        // price; the original then becomes the struck-through "was".
        const onSale = wasPrice > 0 && wasPrice < price;

        /*
         * `image` is the server-rendered shape's key — the same page_data
         * product whose resolved `in_stock` / `has_variations` are read
         * below. It was missing here, so a theme that renders this component
         * from page_data (rather than from a fetched API row, which carries
         * `image_path`) got a placeholder on every card: the listing pages of
         * any theme using <falak-product-card> were a grid of empty boxes.
         *
         * A listing's `images` array is empty by design — the relation is only
         * loaded on the product page — so it cannot stand in for this.
         */
        const image = product.image_path
            || product.image
            || product.images?.[0]?.url
            || product.images?.[0]?.image_path
            // The platform's stand-in for a product with no photograph, so a
            // card never renders as an empty box (store.placeholders.product).
            || this.sdk.config.get('store.placeholders.product')
            || null;

        return {
            id: product.id,
            name: name || '',
            url: this.sdk.url.product(product.id),
            image,
            price: onSale ? wasPrice : price,
            compareAt: onSale ? price : null,
            currency: product.currency || null,
            // The merchant's "ships free" flag on the product itself, as the legacy
            // card reads it. Tolerant of the 1 / "1" an older row serializes.
            freeShipping: product.free_shipment === true || product.free_shipment === 1 || product.free_shipment === '1',
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
            // A variant product is in stock while any VARIANT is — its own
            // product-level quantity is ignored. See rawInStock().
            inStock: product.in_stock !== undefined
                ? !!product.in_stock
                : FalakProductCard.rawInStock(product),
            hasVariations: product.has_variations !== undefined
                ? !!product.has_variations
                : (Array.isArray(product.variations) && product.variations.length > 0),
            rating: product.average_rating ?? null,
            reviews: product.reviews_count ?? 0,
            /*
             * The clip and its poster. Read for every card because reading is
             * free, but only ever RENDERED when the card was asked for video —
             * see wantsVideo(). A product that has one therefore changes no
             * card that was not built to show it.
             */
            // `*_url` are the model's accessors and are already absolute; the
            // bare `*_path` columns are the fallback for any payload without them.
            video: product.video_url || product.video_path || null,
            poster: product.video_thumbnail_url || product.video_thumbnail_path || null,
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

    /* ------------------------------------------------------------- video */

    /**
     * Video commerce, and ONLY where it was asked for.
     *
     * A product can carry a clip without every card that ever shows it turning
     * into a video wall — a listing grid of autoplaying videos is a different
     * component, not a side effect of a merchant uploading one. So the clip is
     * opt-in twice over: the card must be told to want video (its own `video`
     * attribute, or sitting inside a [data-video-commerce] section), AND the
     * product must actually have one. A card that is not asked renders exactly
     * the markup it rendered before this existed — same <img>, same classes.
     *
     * | attribute   | role                                                  |
     * | video       | a clip URL, overriding the product's own             |
     * | video-badge | text laid over the clip                               |
     * | playback    | hover (default); any other value plays on its own,    |
     * |             | which the browser already limits to while in view     |
     */
    get wantsVideo() {
        return this.hasAttribute('video') || !!this.closest('[data-video-commerce]');
    }

    get videoBadge() { return this.attr('video-badge', ''); }
    get playback() { return this.attr('playback', 'hover'); }

    /* Hover is the only mode that needs listeners; every other value (the
       themes say "inview") is the browser's own autoplay, which it suspends
       off-screen for a muted video. Written as "not hover" so a theme naming
       the mode differently still gets the sane behaviour. */
    get playsOnHover() { return this.playback === 'hover'; }

    /** The clip for this card, or null when there is nothing to play. */
    videoFor(product) {
        if (!this.wantsVideo) return null;

        return this.attr('video', null) || product.video || null;
    }

    /**
     * The media element. Unchanged for every card that is not showing a clip —
     * this is the old expression, lifted out so the video branch has somewhere
     * to live rather than growing the template literal.
     */
    mediaHtml(product) {
        const video = this.videoFor(product);

        if (video) {
            // Poster first so the card shows the product before a byte of
            // video is fetched, rather than whatever frame 0.1s happens to be.
            const poster = product.poster || product.image;

            /*
             * And preload ONLY when the preload IS the thumbnail.
             *
             * `preload="metadata"` was on every one of these, which undid the
             * line above: the poster was drawn and the clip was fetched anyway.
             * Browsers run media through a small per-host pool, so a wall of
             * four cards opened four of those slots and held them — measured on
             * a video-commerce home page as four clips at readyState 4 before
             * the shopper had touched anything, about 16MB nobody asked for.
             * Anything asking for media after that queued behind them, the
             * viewer opened on that wall's own clip included.
             *
             * With no poster the clip's first frame is the only picture the
             * card has, so it still has to be fetched. A card that autoplays
             * needs the bytes either way. Only the hover card with a poster
             * already has its picture, and that one now waits for the hover.
             */
            const preload = poster && this.playsOnHover ? 'none' : 'metadata';

            /*
             * The still is a LAZY <img> under the clip, not the <video>'s own
             * poster attribute.
             *
             * `poster` has no lazy form — the browser fetches it as soon as the
             * element is parsed. A video wall can be a scrolling row of dozens
             * of these, of which four are on screen, so eagerly meant dozens of
             * stills pulled for tiles nobody had scrolled to. `loading="lazy"`
             * is the native answer and needs no observer.
             *
             * The clip is transparent until it has frames (see the stylesheet),
             * so the still shows through and the video takes over the same box
             * when it is ready — which is also what a poster attribute would
             * have done.
             */
            return `
                ${poster ? `<img class="f-card__still" src="${this.escape(poster)}" alt=""
                       loading="lazy" decoding="async" aria-hidden="true">` : ''}
                <video class="f-card__video" muted loop playsinline preload="${preload}"
                       ${this.playsOnHover ? '' : 'autoplay'}
                       src="${this.escape(video)}"></video>
                ${this.videoBadge ? `<span class="f-card__video-badge">${this.escape(this.videoBadge)}</span>` : ''}`;
        }

        return product.image
            ? `<img src="${this.escape(product.image)}" alt="" loading="lazy" decoding="async">`
            : `<span class="f-card__placeholder"></span>`;
    }

    /**
     * Hover playback.
     *
     * Bound ONCE, to the card, and the <video> is looked up when the pointer
     * arrives rather than captured here: render() replaces innerHTML, so an
     * element captured at wiring time is detached by the next repaint, and
     * re-wiring per render would stack a listener each time (listen() only
     * tears down on disconnect).
     *
     * Any non-hover mode needs none of this — the element carries `autoplay`
     * and the browser pauses an off-screen muted video by itself.
     */
    wireVideo() {
        this.listen(this, 'pointerenter', () => {
            if (!this.playsOnHover) return;

            const video = this.querySelector('.f-card__video');
            if (!video) return;

            const played = video.play();
            // Autoplay policy can still refuse; nothing to do but keep the poster.
            if (played && played.catch) played.catch(() => {});
        });

        this.listen(this, 'pointerleave', () => {
            const video = this.querySelector('.f-card__video');
            if (!video || !this.playsOnHover) return;

            video.pause();
            video.currentTime = 0;
        });
    }

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
        // The saving as a whole percentage, the way the legacy card prints it
        // ("50% SALE"); 30% and up also earns its "hot" mark.
        const discountPct = showBadge ? Math.round(((product.compareAt - product.price) / product.compareAt) * 100) : 0;
        const showHot = showBadge && discountPct >= 30;
        // Free shipping is the product's own promise, so it shows on every
        // variant with room for a mark — the minimal card has none.
        const showShip = product.freeShipping && !this.isMinimal;
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
        const left = FalakProductCard.remainingStock(raw);
        const remaining = this.isSpecial && product.inStock && left !== null && left > 0
            ? this.trans('product.remaining', { count: this.sdk.number(left) })
            : '';

        this.innerHTML = `
            <article class="f-card__inner">
                <a class="f-card__media" href="${this.escape(product.url)}" tabindex="-1" aria-hidden="true">
                    ${this.mediaHtml(product)}
                    ${showBadge ? `<span class="f-card__marks">
                        <span class="f-card__badge" data-discount="${discountPct}"><b class="f-card__badge-pct">${discountPct}%</b> ${this.escape(this.trans('product.sale'))}</span>
                        ${showHot ? `<span class="f-card__hot">🔥 ${this.escape(this.trans('product.hot'))}</span>` : ''}
                    </span>` : ''}
                    ${offerLabel ? `<span class="f-card__offer">${this.escape(offerLabel)}</span>` : ''}
                    ${showShip ? `<span class="f-card__ship">${this.escape(this.trans('product.free_shipping'))}</span>` : ''}
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
                                                  product-price-amount="${this.escape(product.price)}"
                                                  ${product.compareAt ? `product-compare-price="${this.escape(product.compareAt)}"` : ''}
                                                  ${product.currency ? `product-currency="${this.escape(product.currency)}"` : ''}
                                                  product-url="${this.escape(product.url)}"
                                                  product-in-stock="${product.inStock ? 'true' : 'false'}"
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

        this.wireVideo();

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
