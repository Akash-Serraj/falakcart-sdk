import FalakElement from '../base.js';

/**
 * <falak-reviews-summary product-id="12"></falak-reviews-summary>
 *
 * The reviews at a glance — mirroring <salla-reviews-summary>: the average
 * as a big number with stars, the review count, and one bar per star
 * (5 → 1) showing how the ratings spread. Reads the store's reviews
 * endpoint through falak.review.summary(); hidden when the merchant has
 * reviews switched off, and says "no reviews yet" when there are none.
 *
 * | attribute  | role                                                     |
 * | product-id | required                                                 |
 * | hide-empty | render nothing instead of "no reviews yet"               |
 */
export default class FalakReviewsSummary extends FalakElement {
    static observedAttributes = ['product-id', 'hide-empty'];

    get productId() { return this.attr('product-id'); }
    get hideEmpty() { return this.boolAttr('hide-empty'); }

    get enabled() {
        return this.sdk.config.get('store.settings.reviews_enabled', true) !== false;
    }

    render() {
        this.classList.add('f-reviews-summary');

        if (!this.productId || !this.enabled) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        const s = this._summary;

        if (!s) {
            this.removeAttribute('hidden');
            this.innerHTML = `<div class="f-reviews-summary__loading"><span class="f-modal__spinner" aria-hidden="true"></span></div>`;
            return;
        }

        if (!s.total) {
            if (this.hideEmpty) { this.innerHTML = ''; this.setAttribute('hidden', ''); return; }
            this.removeAttribute('hidden');
            this.innerHTML = `<p class="f-reviews-summary__empty">${this.escape(this.trans('reviews.none_yet'))}</p>`;
            return;
        }

        this.removeAttribute('hidden');

        const bars = [5, 4, 3, 2, 1].map(star => {
            const count = Number(s.distribution[star] || 0);
            const pct = s.total ? Math.round((count / s.total) * 100) : 0;

            return `
                <li class="f-reviews-summary__row" data-star="${star}">
                    <span class="f-reviews-summary__row-label">${star} <span class="f-reviews-summary__star" aria-hidden="true">★</span></span>
                    <span class="f-reviews-summary__bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${star}: ${count}">
                        <span class="f-reviews-summary__fill" style="inline-size:${pct}%"></span>
                    </span>
                    <span class="f-reviews-summary__count">${count}</span>
                </li>`;
        }).join('');

        this.innerHTML = `
            <div class="f-reviews-summary__score">
                <b class="f-reviews-summary__average">${this.escape(s.average.toFixed(1))}</b>
                <falak-rating-stars value="${s.average}"></falak-rating-stars>
                <span class="f-reviews-summary__total">${this.escape(this.trans('reviews.count', { count: s.total }))}</span>
            </div>
            <ul class="f-reviews-summary__bars">${bars}</ul>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        // A newly posted review changes the picture.
        this._off = this.sdk.event.on('review::added', () => this.load());

        if (!this._summary) this.load();
    }

    disconnectedCallback() {
        if (typeof this._off === 'function') this._off();
        super.disconnectedCallback();
    }

    async load() {
        try {
            this._summary = await this.sdk.api.withoutNotifier(() => this.sdk.review.summary(this.productId));
        } catch (error) {
            this._summary = { average: 0, total: 0, distribution: {} };
        }

        this.render();
    }
}
