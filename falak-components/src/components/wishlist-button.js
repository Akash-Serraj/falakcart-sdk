import FalakElement from '../base.js';

/**
 * <falak-wishlist-button product-id="12"></falak-wishlist-button>
 * <falak-wishlist-button product-id="12" button-class="btn btn--icon"></falak-wishlist-button>
 * <falak-wishlist-button product-id="12" show-label></falak-wishlist-button>
 *
 * The heart, mirroring Salla's wishlist button: it reflects whether the
 * product is in the shopper's wishlist (`is-added` on the host and the
 * button, aria-pressed), toggles it on click through falak.wishlist, and
 * follows every change the SDK sees — another button for the same product,
 * the wishlist page, sign-in (guest rows merge into the customer's),
 * sign-out.
 *
 * Works for guests as well as customers: the wishlist API keys guest rows
 * on the same browser token the cart uses. Hidden entirely when the store
 * has the wishlist feature switched off.
 *
 * | attribute    | role                                                      |
 * | product-id   | required                                                  |
 * | button-class | class(es) for the inner <button>, so a theme skin applies  |
 * | show-label   | print "Add to wishlist" / "In wishlist" beside the heart  |
 *
 * Events: DOM `added` / `removed` / `failed` on the element; the SDK's
 * `wishlist::added` / `wishlist::removed` / `wishlist::failed` on the bus.
 */
export default class FalakWishlistButton extends FalakElement {
    static observedAttributes = ['product-id', 'button-class', 'show-label'];

    static ICON = '<svg class="f-wishlist__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';

    get productId() { return this.attr('product-id'); }
    get buttonClass() { return this.attr('button-class', ''); }
    get showLabel() { return this.boolAttr('show-label'); }

    get enabled() {
        return this.sdk.config.get('store.settings.wishlist_enabled', true) !== false;
    }

    get isAdded() {
        return !!this.sdk.wishlist?.has?.(this.productId);
    }

    disconnectedCallback() {
        (this._offs || []).forEach(off => typeof off === 'function' && off());
        this._offs = [];

        super.disconnectedCallback();
    }

    /* ------------------------------------------------------------ render */

    render() {
        this.classList.add('f-wishlist');

        if (!this.productId || !this.enabled) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');

        const added = this.isAdded;
        const busy = !!this._busy;
        const label = this.trans(added ? 'product.in_wishlist' : 'product.add_to_wishlist');

        this.classList.toggle('is-added', added);

        const classes = ['f-wishlist__button'];
        if (this.buttonClass) classes.push(...this.buttonClass.split(/\s+/).filter(Boolean));
        else classes.push('f-btn', 'f-btn--outline', 'f-btn--light-outline', 'f-btn--icon');
        if (added) classes.push('is-added');

        // The button is rebuilt only when its state changes, so a running
        // heart animation is not cut short by unrelated re-renders.
        const existing = this.querySelector('button');
        if (existing && existing.dataset.state === `${added}|${busy}|${label}`) return;

        this.innerHTML = `
            <button type="button" class="${classes.join(' ')}"
                    data-wishlist="${this.escape(this.productId)}" data-state="${added}|${busy}|${this.escape(label)}"
                    aria-pressed="${added ? 'true' : 'false'}" aria-label="${this.escape(label)}"
                    title="${this.escape(label)}" ${busy ? 'disabled' : ''}>
                ${FalakWishlistButton.ICON}
                ${this.showLabel ? `<span class="f-wishlist__label">${this.escape(label)}</span>` : ''}
            </button>`;
    }

    /* --------------------------------------------------------- behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        const refresh = () => this.render();
        // Whose list this is just changed: drop the cached set and reload
        // (ids() shares one in-flight fetch, so many hearts cost one call).
        const reload = () => {
            this.sdk.wishlist.reload().catch(() => {});
            this.render();
        };
        this._offs = ['wishlist::fetched', 'wishlist::updated'].map(name => this.sdk.event.on(name, refresh));
        this._offs.push(this.sdk.event.on('auth::logged.in', reload));
        this._offs.push(this.sdk.event.on('auth::logged.out', reload));

        this.listen(this, 'click', event => {
            if (!event.target.closest('button')) return;

            event.preventDefault();
            event.stopPropagation();

            this.toggle();
        });

        // Whether this product is saved comes from the SDK's list; load it
        // once for the page (the SDK caches, every button shares it).
        if (this.sdk.wishlist && !this.sdk.wishlist.loaded) {
            this.sdk.wishlist.ids().catch(() => {});
        }
    }

    async toggle() {
        if (this._busy || !this.sdk.wishlist) return;

        const wasAdded = this.isAdded;

        this._busy = true;
        this.render();

        try {
            await this.sdk.api.withoutNotifier(() => this.sdk.wishlist.toggle(this.productId));

            this.sdk.notify.success(this.trans(wasAdded ? 'product.wishlist_removed' : 'product.wishlist_added'));
            this.emit(wasAdded ? 'removed' : 'added', { productId: this.productId });

            if (!wasAdded) this.pulse();
        } catch (error) {
            this.sdk.notify.error(error?.message || this.trans('common.load_failed'));
            this.emit('failed', { productId: this.productId, error });
        } finally {
            this._busy = false;
            this.render();
        }
    }

    pulse() {
        const button = this.querySelector('button');
        if (!button) return;

        button.classList.remove('is-pulsing');
        void button.offsetWidth;
        button.classList.add('is-pulsing');
    }
}
