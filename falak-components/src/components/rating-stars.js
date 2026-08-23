import FalakElement from '../base.js';

/**
 * <falak-rating-stars value="4.2" total="18">              read-only summary
 * <falak-rating-stars product-id="12" fetch>               fetches its own data
 * <falak-rating-stars product-id="12" interactive>         lets a customer rate
 *
 * Component #3: the first one that talks to the SDK. It shows the split every
 * display component eventually needs — render from attributes when the server
 * already knew the answer, fetch only when it did not.
 */
export default class FalakRatingStars extends FalakElement {
    static observedAttributes = ['value', 'total', 'interactive'];

    get value() { return Number(this.attr('value', 0)) || 0; }
    get total() { return this.numAttr('total', 0); }
    get interactive() { return this.boolAttr('interactive'); }
    get productId() { return this.attr('product-id'); }

    /**
     * `fetch` is opt-in rather than automatic. A listing page with 40 cards
     * must not fire 40 review requests because a component could.
     */
    async setup() {
        if (!this.boolAttr('fetch') || !this.productId) return;

        this.setBusy(true);

        try {
            // Silent: a store with reviews disabled answers with zeroes, and
            // that is not something to toast at the shopper.
            const summary = await this.sdk.api.withoutNotifier(
                () => this.sdk.review.fetch(this.productId, { perPage: 1 }),
            );

            this.setAttribute('value', String(summary.average_rating ?? 0));
            this.setAttribute('total', String(summary.total ?? 0));
        } catch (error) {
            this.sdk.logger.warn('rating-stars: fetch failed', error);
        } finally {
            this.setBusy(false);
        }
    }

    render() {
        const value = this.value;
        const max = this.numAttr('max', 5);
        const selectable = this.interactive;

        const stars = Array.from({ length: max }, (_, index) => {
            const position = index + 1;
            const fill = Math.max(0, Math.min(1, value - index));   // 0 → 1 per star

            return `
                <span class="f-stars__star" data-position="${position}"
                      ${selectable ? `role="radio" tabindex="0" aria-checked="${position === Math.round(value)}"` : ''}
                      aria-label="${position}">
                    <i class="f-stars__fill" style="--f-star-fill:${(fill * 100).toFixed(0)}%"></i>
                </span>`;
        }).join('');

        const label = this.total
            ? this.trans('product.review_count', { count: this.sdk.number(this.total) })
            : '';

        this.innerHTML = `
            <div class="f-stars" ${selectable ? 'role="radiogroup"' : 'role="img"'}
                 aria-label="${this.escape(this.trans('product.rating'))}: ${value}">
                <span class="f-stars__set">${stars}</span>
                ${this.boolAttr('show-value') ? `<span class="f-stars__value">${this.escape(value.toFixed(1))}</span>` : ''}
                ${label ? `<span class="f-stars__count">${this.escape(label)}</span>` : ''}
            </div>`;

        this.setState('rating', value);
    }

    afterRender() {
        if (!this.interactive || this._wired) return;

        this._wired = true;

        this.listen(this, 'click', event => {
            const star = event.target.closest('.f-stars__star');
            if (star) this.select(Number(star.dataset.position));
        });

        this.listen(this, 'keydown', event => {
            const star = event.target.closest('.f-stars__star');
            if (!star || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            this.select(Number(star.dataset.position));
        });
    }

    async select(rating) {
        this.setAttribute('value', String(rating));

        this.emit('rate', { rating, productId: this.productId });
        this.emitBus('review::rating.selected', { rating, productId: this.productId });

        if (!this.boolAttr('submit')) return;   // display-only: the host page posts it

        this.setBusy(true);

        try {
            await this.sdk.review.add(this.productId, { rating });
        } catch (error) {
            /*
             * Writing a review needs an authenticated customer. Rather than
             * surface a raw 401, hand the page a named event so the theme can
             * open whatever login flow it has.
             */
            if (error.message === 'AUTH_REQUIRED') {
                this.emitBus('auth::required', { intent: 'review', productId: this.productId });
            }

            this.emit('rate-failed', { error });
        } finally {
            this.setBusy(false);
        }
    }
}
