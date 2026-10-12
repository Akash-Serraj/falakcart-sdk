import FalakElement from '../base.js';

/**
 * <falak-wishlist-drawer show-trigger></falak-wishlist-drawer>
 * <falak-wishlist-drawer></falak-wishlist-drawer>   + falak.event.dispatch('wishlist::open')
 *
 * The saved-products panel: a heart in the header with a count, and a
 * drawer that slides in from the inline end listing every saved product
 * with its picture, name, price, an add-to-cart button (variant products
 * open quick-add) and a heart to unsave. Guest or customer — it reads
 * falak.wishlist, the same list every <falak-wishlist-button> toggles, so
 * saving a product anywhere on the page updates the count and the list.
 *
 * | attribute    | role                                                  |
 * | show-trigger | render the header heart + count that opens the drawer |
 * | href         | "view all" link (default /customer/wishlist)          |
 * | side         | start | end (default end) — which edge it slides from |
 *
 * Opens on the trigger, on `wishlist::open` from the bus, or open()/close().
 * Escape and the backdrop close it; the page behind stops scrolling.
 */
export default class FalakWishlistDrawer extends FalakElement {
    static observedAttributes = ['show-trigger', 'href', 'side'];

    static ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';

    get showTrigger() { return this.boolAttr('show-trigger'); }
    get href() { return this.attr('href', '/customer/wishlist'); }
    get side() { return this.attr('side', 'end'); }
    get isOpen() { return this.hasAttribute('open'); }

    get enabled() {
        return this.sdk.config.get('store.settings.wishlist_enabled', true) !== false;
    }

    /* --------------------------------------------------------- imperative */

    open() {
        if (!this.enabled) return this;

        this.setAttribute('open', '');
        document.body.classList.add('f-drawer-open');
        this.load();
        this.emitBus('wishlist::drawer.opened', {});

        window.requestAnimationFrame(() => this.querySelector('[data-drawer-close]')?.focus());

        return this;
    }

    close() {
        this.removeAttribute('open');
        document.body.classList.remove('f-drawer-open');
        this.emitBus('wishlist::drawer.closed', {});

        return this;
    }

    toggle() { return this.isOpen ? this.close() : this.open(); }

    disconnectedCallback() {
        (this._offs || []).forEach(off => typeof off === 'function' && off());
        this._offs = [];
        document.body.classList.remove('f-drawer-open');

        super.disconnectedCallback();
    }

    /* ------------------------------------------------------------ render */

    render() {
        this.classList.add('f-wishlist-drawer');
        this.classList.toggle('f-wishlist-drawer--start', this.side === 'start');

        if (!this.enabled) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');

        const count = this.sdk.wishlist?.count?.() ?? 0;
        const title = this.trans('account.wishlist');

        this.innerHTML = `
            ${this.showTrigger ? `
            <button type="button" class="f-wishlist-drawer__trigger" data-drawer-toggle
                    aria-haspopup="dialog" aria-expanded="${this.isOpen ? 'true' : 'false'}" aria-label="${this.escape(title)}">
                ${FalakWishlistDrawer.ICON}
                <span class="f-wishlist-drawer__count" data-wishlist-count${count < 1 ? ' hidden' : ''}>${count}</span>
            </button>` : ''}
            <div class="f-drawer__backdrop" data-drawer-close></div>
            <aside class="f-drawer" role="dialog" aria-modal="true" aria-label="${this.escape(title)}">
                <header class="f-drawer__head">
                    <h2 class="f-drawer__title">${this.escape(title)} <span class="f-drawer__badge" data-wishlist-count-title>${count}</span></h2>
                    <button type="button" class="f-drawer__close" data-drawer-close aria-label="${this.escape(this.trans('common.close'))}">&times;</button>
                </header>
                <div class="f-drawer__body" data-drawer-body>
                    ${this.bodyHtml()}
                </div>
                <footer class="f-drawer__foot">
                    <a class="f-btn f-btn--solid f-btn--primary f-btn--wide f-wishlist-drawer__all" href="${this.escape(this.href)}">${this.escape(this.trans('wishlist.view_all'))}</a>
                </footer>
            </aside>`;
    }

    bodyHtml() {
        if (this._loading && !this._items) {
            return `<div class="f-drawer__loading"><span class="f-modal__spinner" aria-hidden="true"></span></div>`;
        }

        const items = this._items || [];

        if (!items.length) {
            return `
                <div class="f-drawer__empty">
                    <span class="f-drawer__empty-icon" aria-hidden="true">${FalakWishlistDrawer.ICON}</span>
                    <p>${this.escape(this.trans('account.no_wishlist'))}</p>
                </div>`;
        }

        return `<ul class="f-wishlist-drawer__list">${items.map(item => this.itemHtml(item)).join('')}</ul>`;
    }

    itemHtml(raw) {
        const p = this.normalise(raw);

        return `
            <li class="f-wishlist-drawer__item" data-wishlist-item="${p.id}">
                <a class="f-wishlist-drawer__media" href="${this.escape(p.url)}" tabindex="-1" aria-hidden="true">
                    ${p.image ? `<img src="${this.escape(p.image)}" alt="" loading="lazy">` : '<span class="f-wishlist-drawer__placeholder"></span>'}
                </a>
                <div class="f-wishlist-drawer__info">
                    <a class="f-wishlist-drawer__name" href="${this.escape(p.url)}">${this.escape(p.name)}</a>
                    <p class="f-wishlist-drawer__price">
                        <span>${this.escape(this.money(p.price, p.currency))}</span>
                        ${p.compareAt ? `<del>${this.escape(this.money(p.compareAt, p.currency))}</del>` : ''}
                    </p>
                    <div class="f-wishlist-drawer__actions">
                        <falak-add-product-button product-id="${p.id}"
                                                  product-status="${p.inStock ? 'sale' : 'out'}"
                                                  ${p.hasVariations ? 'has-options' : ''}
                                                  product-name="${this.escape(p.name)}"
                                                  product-image="${this.escape(p.image || '')}"
                                                  product-price="${this.escape(this.money(p.price, p.currency))}"
                                                  size="small"
                                                  source="wishlist-drawer"></falak-add-product-button>
                        <falak-wishlist-button product-id="${p.id}"></falak-wishlist-button>
                    </div>
                </div>
            </li>`;
    }

    normalise(product) {
        const locale = this.sdk.lang.locale;
        const list = Number(product.price_cents ?? product.price ?? 0);
        const discount = Number(product.discount_price_cents ?? 0);
        const onSale = discount > 0 && discount < list;

        return {
            id: product.id,
            name: (locale === 'ar' && product.name_ar ? product.name_ar : product.name) || '',
            url: this.sdk.url?.product ? this.sdk.url.product(product.id) : `/product/${product.id}`,
            image: product.image_path || product.images?.[0]?.url || product.images?.[0]?.image_path || product.image
                || this.sdk.config.get('store.placeholders.product') || null,
            price: onSale ? discount : list,
            compareAt: onSale ? list : null,
            currency: product.currency || null,
            inStock: product.quantity === null || product.quantity === undefined || Number(product.quantity) > 0 || !!product.allow_backorders
                || (Array.isArray(product.variations) && product.variations.some(v => v.quantity === null || v.quantity === undefined || Number(v.quantity) > 0)),
            hasVariations: Array.isArray(product.variations) && product.variations.length > 0,
        };
    }

    /* --------------------------------------------------------- behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        const refreshCount = () => this.paintCount();
        const reload = () => {
            this._items = null;
            this.sdk.wishlist.reload().catch(() => {}).then(() => { this.paintCount(); if (this.isOpen) this.load(); });
        };

        this._offs = [
            this.sdk.event.on('wishlist::fetched', refreshCount),
            // A save or unsave anywhere: the cached records are stale. Refetch
            // now if the panel is open, else on the next open.
            this.sdk.event.on('wishlist::updated', () => {
                this.paintCount();
                if (this.isOpen) this.load(true);
                else this._items = null;
            }),
            this.sdk.event.on('wishlist::open', () => this.open()),
            this.sdk.event.on('auth::logged.in', reload),
            this.sdk.event.on('auth::logged.out', reload),
        ];

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-drawer-toggle]')) { this.toggle(); return; }
            if (event.target.closest('[data-drawer-close]')) { this.close(); }
        });

        this.listen(document, 'keydown', event => {
            if (event.key === 'Escape' && this.isOpen) this.close();
        });

        // The count needs the list; ids() is shared with every heart on the page.
        if (this.sdk.wishlist && !this.sdk.wishlist.loaded) this.sdk.wishlist.ids().catch(() => {});
    }

    /** Count badge + title, patched in place (no rebuild of an open drawer). */
    paintCount() {
        const count = this.sdk.wishlist?.count?.() ?? 0;

        const badge = this.querySelector('[data-wishlist-count]');
        if (badge) { badge.textContent = String(count); badge.hidden = count < 1; }

        const title = this.querySelector('[data-wishlist-count-title]');
        if (title) title.textContent = String(count);

        const trigger = this.querySelector('[data-drawer-toggle]');
        if (trigger) trigger.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
    }

    /** Loads the product records and paints the list; `force` refetches. */
    async load(force = false) {
        if (this._loading) return;

        // Cached records are only trusted when they still match the id set.
        const fresh = this._items && this._items.length === (this.sdk.wishlist?.count?.() ?? 0);
        if (fresh && !force) { this.paintBody(); return; }
        if (!fresh) force = true;

        this._loading = true;
        if (!this._items) this.paintBody();

        try {
            this._items = force
                ? (await this.sdk.wishlist.refresh()).items
                : await this.sdk.wishlist.items();
        } catch (error) {
            this._items = this._items || [];
        } finally {
            this._loading = false;
            this.paintBody();
            this.paintCount();
        }
    }

    paintBody() {
        const body = this.querySelector('[data-drawer-body]');
        if (body) body.innerHTML = this.bodyHtml();
    }
}
