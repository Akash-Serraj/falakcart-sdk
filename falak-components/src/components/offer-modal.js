import FalakElement from '../base.js';

/**
 * <falak-offer-modal></falak-offer-modal>   — place once, in the header
 *
 * The Twig port of the legacy React pair OffersBanner + SpecialOffersModal,
 * with the SAME setup end to end:
 *
 *   - Gated by the dashboard's Marketing Settings, nothing theme-side:
 *     `enable_special_offers` AND `display_offers_in_popup` must both be on
 *     (ShopSetting rows the merchant already manages), and the store must have
 *     at least one active offer.
 *   - A persistent banner strip — no timer, no per-shopper dismissal; the
 *     merchant's switch is the only off button, exactly as in React.
 *   - "View offers" opens a modal listing every active offer, rendered by
 *     <falak-offers> so the list and the home section can never disagree.
 */
export default class FalakOfferModal extends FalakElement {
    get enabled() {
        const marketing = this.sdk.config.get('store.settings.marketing', {}) || {};
        return !!marketing.enable_special_offers && !!marketing.display_offers_in_popup;
    }

    async setup() {
        if (!this.enabled) {
            this.offers = [];
            return;
        }

        this.offers = await this.sdk.offer.fetch();
    }

    render() {
        if (!this.enabled || !this.offers?.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.classList.add('f-offer-banner');

        this.innerHTML = `
            <div class="f-offer-banner__strip">
                <span class="f-offer-banner__text">🎁 ${this.escape(this.trans('offer.banner_message'))}</span>
                <button type="button" class="f-offer-banner__more" data-open-offers>
                    ${this.escape(this.trans('offer.view_more'))}
                </button>
            </div>

            <falak-modal id="falak-offers-modal" width="md"
                         modal-title="${this.escape(this.trans('offer.modal_title'))}">
                <falak-offers hide-when-empty></falak-offers>
            </falak-modal>`;

        this._modal = this.querySelector('falak-modal');
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (!event.target.closest('[data-open-offers]')) return;

            this._modal?.open?.();
            this.sdk.offer.event.shown({ count: this.offers?.length ?? 0 });
        });
    }
}
