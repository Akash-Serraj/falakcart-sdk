import FalakElement from '../base.js';

/**
 * <falak-cart-summary></falak-cart-summary>
 * <falak-cart-summary show-cart-label href="/cart"></falak-cart-summary>
 * <falak-cart-summary>
 *     <svg ...></svg>                        <- author markup becomes the icon
 * </falak-cart-summary>
 *
 * The header's cart entry — icon, unit count and total — mirroring
 * <salla-cart-summary>. It is the ONE place a theme should show the cart
 * count: it is computed in the browser from the SDK's cart, so it is right
 * for a guest and for a signed-in customer alike, and it follows every
 * change the SDK makes (add, quantity, remove, coupon, sign-in, sign-out)
 * without the theme wiring anything.
 *
 * First paint uses the last known figures from storage so the number does
 * not flash from empty on every navigation; the live cart replaces them as
 * soon as it loads.
 *
 * | attribute       | role                                                  |
 * | href            | cart page URL (default /cart)                         |
 * | show-cart-label | print "Cart" next to the total                        |
 * | hide-total      | count only — for a compact header                     |
 *
 * Public: animateToCart(image) flies a product image into the icon; the
 * add button calls it after a successful add.
 */
export default class FalakCartSummary extends FalakElement {
    static observedAttributes = ['href', 'show-cart-label', 'hide-total'];

    static STORAGE_KEY = 'cart.summary';

    static ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';

    get href() { return this.attr('href', '/cart'); }
    get showLabel() { return this.boolAttr('show-cart-label'); }
    get hideTotal() { return this.boolAttr('hide-total'); }

    connectedCallback() {
        // Author markup is the icon. Captured once, before the first render
        // replaces it.
        if (this._icon === undefined) {
            const passed = this.innerHTML.trim();
            this._icon = passed || null;
        }

        return super.connectedCallback();
    }

    disconnectedCallback() {
        (this._offs || []).forEach(off => typeof off === 'function' && off());
        this._offs = [];

        super.disconnectedCallback();
    }

    /* ------------------------------------------------------------- state */

    /** Live figures when the cart is loaded, else the stored snapshot. */
    figures() {
        const cart = this.sdk.cart;

        if (cart?.loaded) {
            const fallback = cart.lines.reduce((sum, line) => sum + Number(line.total || 0), 0);
            const total = Number(cart.summary?.total ?? fallback);
            const figures = { count: cart.count(), total, currency: this.sdk.config.get('currency.code') };

            try { this.sdk.storage.set(FalakCartSummary.STORAGE_KEY, figures); } catch (e) { /* storage unavailable */ }

            return figures;
        }

        let stored = null;
        try { stored = this.sdk.storage.get(FalakCartSummary.STORAGE_KEY); } catch (e) { /* storage unavailable */ }

        return {
            count: Number(stored?.count || 0),
            total: Number(stored?.total || 0),
            currency: stored?.currency || undefined,
        };
    }

    /* ------------------------------------------------------------ render */

    render() {
        const { count, total, currency } = this.figures();
        const label = this.escape(this.trans('cart.title'));

        // Built once; later changes patch the numbers in place so a running
        // icon animation (and the author's icon markup) survive updates.
        if (this.querySelector('[data-cart-count]')) {
            this.patch(count, total, currency);
            return;
        }

        this.classList.add('f-cart-summary');
        this.classList.toggle('f-cart-summary--empty', count < 1);

        const content = this.hideTotal ? '' : `
            <span class="f-cart-summary__content">
                ${this.showLabel ? `<span class="f-cart-summary__label">${label}</span>` : ''}
                <b class="f-cart-summary__total" data-cart-total>${this.escape(this.money(total, currency))}</b>
            </span>`;

        this.innerHTML = `
            <a class="f-cart-summary__link" href="${this.escape(this.href)}" aria-label="${label}">
                <span class="f-cart-summary__icon" data-cart-icon>
                    ${this._icon || FalakCartSummary.ICON}
                    <span class="f-cart-summary__count" data-cart-count${count < 1 ? ' hidden' : ''}>${count}</span>
                </span>
                ${content}
            </a>`;
    }

    patch(count, total, currency) {
        this.classList.toggle('f-cart-summary--empty', count < 1);

        const badge = this.querySelector('[data-cart-count]');
        badge.textContent = String(count);
        badge.hidden = count < 1;

        const money = this.querySelector('[data-cart-total]');
        if (money) money.textContent = this.money(total, currency);
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        const refresh = () => this.render();

        // Whose cart this is just changed: drop the cache and fetch again.
        const reload = () => {
            this.sdk.cart.refresh().catch(() => this.queueRender());
        };

        this._offs = ['cart::fetched', 'cart::updated', 'cart::coupon.applied', 'cart::coupon.removed']
            .map(name => this.sdk.event.on(name, refresh));
        this._offs.push(this.sdk.event.on('auth::logged.in', reload));
        this._offs.push(this.sdk.event.on('auth::logged.out', reload));

        // The snapshot painted; now the truth. items() fetches at most once.
        if (!this.sdk.cart.loaded) {
            this.sdk.cart.items().catch(() => { /* stays on the snapshot */ });
        }
    }

    /* --------------------------------------------------------- animation */

    /**
     * Fly a product image into the cart icon, then bump the icon. Web
     * Animations API, no dependency; honours prefers-reduced-motion.
     *
     * @param {HTMLImageElement|null} image
     */
    animateToCart(image) {
        const icon = this.querySelector('[data-cart-icon]');
        if (!icon) return;

        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        if (!image?.src || reduced || typeof image.animate !== 'function') {
            this.bump(icon);
            return;
        }

        document.querySelectorAll('.f-cart-thumb').forEach(el => el.remove());

        const from = image.getBoundingClientRect();
        const to = icon.getBoundingClientRect();
        const size = Math.min(from.width, from.height, 150);

        const thumb = document.createElement('img');
        thumb.src = image.currentSrc || image.src;
        thumb.alt = '';
        thumb.className = 'f-cart-thumb';
        Object.assign(thumb.style, {
            top: `${from.top}px`,
            left: `${from.left}px`,
            width: `${from.width}px`,
            height: `${from.height}px`,
            objectFit: 'cover',
            borderRadius: '12%',
        });
        document.body.appendChild(thumb);

        const midX = to.left + to.width / 2 - size / 2;
        const midY = to.top + to.height / 2 - size / 2;

        const flight = thumb.animate([
            { top: `${from.top}px`, left: `${from.left}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: '12%', opacity: 1 },
            { top: `${midY}px`, left: `${midX}px`, width: `${size}px`, height: `${size}px`, borderRadius: '50%', opacity: 0.9, offset: 0.55 },
            { top: `${to.top + to.height / 2}px`, left: `${to.left + to.width / 2}px`, width: '0px', height: '0px', borderRadius: '50%', opacity: 0 },
        ], { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });

        flight.onfinish = () => {
            thumb.remove();
            this.bump(icon);
        };
    }

    bump(icon) {
        icon.classList.remove('is-bumped');
        void icon.offsetWidth; // restart the keyframes
        icon.classList.add('is-bumped');
    }
}
