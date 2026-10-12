/**
 * Turns a special_offers row into displayable sentences.
 *
 * Shared by the offer popup and the offers list so the two can never describe
 * the same offer differently. Deliberately NOT a third implementation of the
 * discount rules — the server's SpecialOfferService owns whether an offer
 * applies and for how much; these functions only phrase what the merchant
 * configured.
 *
 * Every function takes the component (`host`) for trans()/money()/number(),
 * because wording and currency belong to the page's locale, not to the data.
 */

/** "خصم 20٪" / "خصم 50 ر.س" / "شحن مجاني" / "اشترِ 2 واحصل على 1 مجاناً" */
export function benefitLine(host, offer) {
    if (offer.offer_type === 'free_shipping_threshold' || offer.shipping_benefit === 'free') {
        return host.trans('offer.free_shipping');
    }

    if (offer.offer_type === 'buy_x_get_y' && offer.buy_x_quantity && offer.get_y_quantity) {
        return host.trans('offer.buy_x_get_y', {
            x: host.sdk.number(offer.buy_x_quantity),
            y: host.sdk.number(offer.get_y_quantity),
        });
    }

    const value = Number(offer.discount_value);

    if (!Number.isFinite(value) || value <= 0) return '';

    return offer.discount_type === 'percentage'
        ? host.trans('offer.percent_off', { value: host.sdk.number(value) })
        : host.trans('offer.amount_off', { value: host.money(value) });
}

/** The fine print — a benefit with conditions must show them. */
export function conditionLine(host, offer) {
    const parts = [];

    const minimumAmount = Number(offer.min_cart_amount);

    if (Number.isFinite(minimumAmount) && minimumAmount > 0) {
        parts.push(host.trans('offer.min_cart', { value: host.money(minimumAmount) }));
    }

    // quantity_based offers condition on item count, not cart value.
    const minimumItems = Number(offer.min_item_quantity);

    if (Number.isFinite(minimumItems) && minimumItems > 0) {
        parts.push(host.trans('offer.min_items', { count: host.sdk.number(minimumItems) }));
    }

    return parts.join(' · ');
}

/** "العرض ساري حتى …" from end_date, or nothing when open-ended. */
export function untilLine(host, offer) {
    if (!offer.end_date) return '';

    const date = new Date(offer.end_date);

    if (Number.isNaN(date.getTime())) return '';

    try {
        return host.trans('offer.valid_until', {
            date: new Intl.DateTimeFormat(host.sdk.lang.locale, { dateStyle: 'medium' }).format(date),
        });
    } catch (error) {
        return '';
    }
}
