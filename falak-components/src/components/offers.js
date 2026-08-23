import FalakElement from '../base.js';
import { benefitLine, conditionLine, untilLine } from '../lib/offer-lines.js';

/**
 * <falak-offers></falak-offers>
 * <falak-offers block-title="العروض" limit="4"></falak-offers>
 *
 * All of the store's active offers as cards — the Twig port of the React
 * storefront's SpecialOffersModal, laid inline as a section rather than behind
 * a header trigger, because a Twig page can give offers real estate instead of
 * hiding them behind a click.
 *
 * Display only, on purpose: offers apply themselves server-side on every cart
 * evaluation (SpecialOfferService), so there is no code to copy and no button
 * to press. This component says what the deals are; the cart does the math.
 */
export default class FalakOffers extends FalakElement {
    static observedAttributes = ['limit', 'block-title', 'product-id'];

    get limit() { return this.numAttr('limit', 6); }

    get productId() { return this.attr('product-id'); }
    get belowProduct() { return this.boolAttr('below-product'); }

    /** The dashboard master switch gates every offers surface, not just the popup. */
    get enabled() {
        const marketing = this.sdk.config.get('store.settings.marketing', {}) || {};

        if (!marketing.enable_special_offers) return false;

        // Below-product placement has its own dashboard switch, as in the
        // legacy ProductSpecialOffers component.
        return this.belowProduct ? !!marketing.show_special_offers_below_product : true;
    }

    /**
     * Legacy rule, ported exactly: below a product, an offer shows only when
     * it EXPLICITLY targets that product — product_ids must contain it, and
     * an empty list means "not shown here", not "applies to everything".
     */
    appliesToProduct(offer) {
        const ids = offer.product_ids;

        if (!Array.isArray(ids) || !ids.length) return false;

        return ids.map(Number).includes(Number(this.productId));
    }

    async setup() {
        if (!this.enabled) { this.offers = []; return; }

        const offers = await this.sdk.offer.fetch();

        this.offers = (this.belowProduct && this.productId
            ? offers.filter(offer => this.appliesToProduct(offer))
            : offers
        ).slice(0, this.limit);
    }

    render() {
        this.classList.add('f-offers');

        // A merchant with no active offers gets nothing — not an empty band
        // with a heading promising deals that do not exist.
        if (!this.offers?.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');

        const title = this.attr('block-title');

        this.innerHTML = `
            ${title ? `<h2 class="f-offers__title">${this.escape(title)}</h2>` : ''}
            <ul class="f-offers__grid">
                ${this.offers.map(offer => this.cardHtml(offer)).join('')}
            </ul>`;
    }

    cardHtml(offer) {
        const benefit = benefitLine(this, offer);
        const condition = conditionLine(this, offer);
        const until = untilLine(this, offer);

        // Same rule as React's modal: skip the description when it merely
        // repeats the title.
        const description = offer.description && offer.description !== offer.offer_title
            ? offer.description
            : '';

        return `
            <li class="f-offers__card">
                ${benefit ? `<span class="f-offers__benefit">${this.escape(benefit)}</span>` : ''}
                <h3 class="f-offers__name">${this.escape(offer.offer_title || this.trans('offer.title'))}</h3>
                ${description ? `<p class="f-offers__text">${this.escape(description)}</p>` : ''}
                <div class="f-offers__meta">
                    ${condition ? `<span>${this.escape(condition)}</span>` : ''}
                    ${until ? `<span>${this.escape(until)}</span>` : ''}
                </div>
            </li>`;
    }
}
