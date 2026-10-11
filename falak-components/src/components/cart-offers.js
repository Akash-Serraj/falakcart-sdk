import FalakElement from '../base.js';

/**
 * <falak-cart-offers></falak-cart-offers>
 *
 * The cart page's offer tracker — the Twig port of the React storefront's
 * OffersTracker. One card per special offer the cart is being measured
 * against: unlocked ones (the server applied them to this cart) with a tick
 * and what they gave; locked ones with how much is still missing and a
 * progress bar. A store with offers enabled shows a shopper, right above the
 * lines, that "new offer: 100% discount applied" or "add 2 more items to get
 * 10% off" — which is the whole reason a merchant runs the offer.
 *
 * Display only, on purpose: offers apply themselves server-side on every
 * cart evaluation (SpecialOfferService), which hands the SDK both lists in
 * `cart_summary` — `applied_special_offers` and `progress_offers`. There is
 * no arithmetic here, so this never disagrees with the totals beside it.
 *
 * Renders nothing when the dashboard's special-offers switch is off, when
 * the cart is empty, or when no offer is in reach.
 *
 * | attribute | role                                            |
 * | limit     | at most this many cards (default: all)          |
 */
export default class FalakCartOffers extends FalakElement {
    static observedAttributes = ['limit'];

    get limit() { return this.numAttr('limit', 0); }

    get enabled() {
        const marketing = this.sdk.config.get('store.settings.marketing', {}) || {};
        return !!marketing.enable_special_offers;
    }

    disconnectedCallback() {
        (this._offs || []).forEach(off => typeof off === 'function' && off());
        this._offs = [];
        this._wired = false;
        super.disconnectedCallback();
    }

    /* ------------------------------------------------------------ data */

    /** Applied first, then the ones still in reach — the legacy order. */
    entries() {
        const summary = this.sdk.cart?.summary || {};
        const applied = Array.isArray(summary.applied_special_offers) ? summary.applied_special_offers : [];
        const progress = Array.isArray(summary.progress_offers) ? summary.progress_offers : [];
        const all = [
            ...applied.map(offer => ({ offer, unlocked: true })),
            ...progress.map(offer => ({ offer, unlocked: false })),
        ];
        return this.limit > 0 ? all.slice(0, this.limit) : all;
    }

    /* The second line of a card — the legacy tracker's wording, per type. */
    subtitle(entry) {
        const o = entry.offer;
        const type = String(o.offer_type || '');
        const value = o.discount_value ?? '';

        if (entry.unlocked) {
            if (type === 'free_shipping_threshold') return this.trans('offers_tracker.free_shipping_unlocked');
            if (type === 'buy_x_get_y') return this.trans('offers_tracker.buy_x_get_y_unlocked', { x: o.buy_x_quantity ?? '', y: o.get_y_quantity ?? '' });
            if (type === 'generic_discount' || type === 'quantity_based') {
                return o.discount_type === 'fixed'
                    ? this.trans('offers_tracker.amount_unlocked', { value: this.money(Number(value) || 0) })
                    : this.trans('offers_tracker.discount_unlocked', { value });
            }
            return this.trans('offers_tracker.generic_unlocked');
        }

        const needed = Number(o.items_needed || 0);
        switch (type) {
            case 'quantity_based':
                return this.trans(needed === 1 ? 'offers_tracker.quantity_based' : 'offers_tracker.quantity_based_plural', { count: needed, value });
            case 'buy_x_get_y':
                return this.trans(needed === 1 ? 'offers_tracker.buy_x_get_y' : 'offers_tracker.buy_x_get_y_plural', { count: needed, x: o.buy_x_quantity ?? '', y: o.get_y_quantity ?? '' });
            case 'free_shipping_threshold':
                // money(): the threshold is a base-currency amount like every other
                // figure the API sends, so it reads in the shopper's currency.
                return this.trans('offers_tracker.free_shipping_threshold', { amount: this.money(Number(o.amount_needed) || 0) });
            case 'generic_discount':
                return this.trans('offers_tracker.generic_active', { value });
            default:
                return o.description || '';
        }
    }

    /* How far along a locked offer is, 0–100. Unlocked ones are full. */
    percent(entry) {
        if (entry.unlocked) return 100;
        const o = entry.offer;
        let have = 0, need = 0;
        if (o.min_cart_amount) { have = Number(o.current_subtotal || 0); need = Number(o.min_cart_amount); }
        else if (o.bundle_size) { have = Number(o.current_quantity || 0); need = Number(o.bundle_size); }
        else if (o.min_item_quantity) { have = Number(o.current_quantity || 0); need = Number(o.min_item_quantity); }
        if (!(need > 0)) return 0;
        return Math.max(0, Math.min(100, Math.round((have / need) * 100)));
    }

    /* ------------------------------------------------------------ render */

    render() {
        this.classList.add('f-cart-offers');

        if (!this.enabled) { this.innerHTML = ''; this.hidden = true; return; }

        const cart = this.sdk.cart;
        if (!cart?.loaded) {
            // First paint: the cart is being read by the page's other components;
            // show nothing rather than an empty frame, and render when it lands.
            this.innerHTML = '';
            this.hidden = true;
            cart?.items?.().then(() => this.render()).catch(() => {});
            return;
        }

        const entries = (cart.lines || []).length ? this.entries() : [];
        if (!entries.length) { this.innerHTML = ''; this.hidden = true; return; }

        this.hidden = false;
        this.innerHTML = `
            <ul class="f-offer-track" aria-label="${this.escape(this.trans('offer.title'))}">
                ${entries.map(entry => this.cardHtml(entry)).join('')}
            </ul>`;
    }

    cardHtml(entry) {
        const o = entry.offer;
        const type = String(o.offer_type || 'generic_discount');
        const pct = this.percent(entry);
        const icon = FalakCartOffers.ICONS[type] || FalakCartOffers.ICONS.generic_discount;

        return `
            <li class="f-offer-track__card ${entry.unlocked ? 'is-unlocked' : 'is-locked'} f-offer-track__card--${this.escape(type)}" data-offer-id="${this.escape(String(o.id ?? ''))}">
                <div class="f-offer-track__top">
                    <span class="f-offer-track__icon" aria-hidden="true">${icon}</span>
                    <span class="f-offer-track__text">
                        <b class="f-offer-track__title">${this.escape(o.offer_title || this.trans('offer.title'))}</b>
                        <small class="f-offer-track__sub">${this.escape(this.subtitle(entry))}</small>
                    </span>
                    <span class="f-offer-track__state" aria-label="${this.escape(this.trans(entry.unlocked ? 'offers_tracker.unlocked' : 'offers_tracker.locked'))}">${entry.unlocked ? FalakCartOffers.ICONS.check : FalakCartOffers.ICONS.lock}</span>
                </div>
                ${type !== 'generic_discount' && !entry.unlocked ? `
                <div class="f-offer-track__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
                    <span class="f-offer-track__fill" style="inline-size: ${pct}%"></span>
                </div>` : ''}
            </li>`;
    }

    /* --------------------------------------------------------- behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        const refresh = () => this.render();
        this._offs = ['cart::fetched', 'cart::updated', 'cart::coupon.applied', 'cart::coupon.removed']
            .map(name => this.sdk.event.on(name, refresh));
    }

    static ICONS = {
        quantity_based: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
        buy_x_get_y: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
        free_shipping_threshold: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/><path d="M5 18H3V6h11v12H9m6 0h1V11h4l2 3v4h-2"/></svg>',
        generic_discount: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
        check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>',
        lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    };
}
