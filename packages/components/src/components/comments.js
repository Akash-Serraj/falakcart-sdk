import FalakElement from '../base.js';

/**
 * <falak-comments product-id="12"></falak-comments>
 * <falak-comments product-id="12" per-page="5" hide-form></falak-comments>
 *
 * Approved reviews for a product, plus a form for signed-in customers.
 *
 * Reading is public; writing needs an authenticated customer, so a guest gets a
 * sign-in prompt rather than a form that fails on submit. The whole component
 * stands down when the merchant has reviews switched off — the platform reports
 * that as `store.settings.reviews_enabled`, and the endpoint answers with
 * zeroes in that case anyway.
 */
export default class FalakComments extends FalakElement {
    static observedAttributes = ['product-id', 'per-page'];

    get productId() { return this.attr('product-id'); }
    get perPage() { return this.numAttr('per-page', 10); }
    get hideForm() { return this.boolAttr('hide-form'); }
    get enabled() { return this.sdk.config.get('store.settings.reviews_enabled', true); }

    async setup() {
        if (!this.productId || !this.enabled) return;

        this.page = 1;
        await this.load();

        /*
         * Whether this customer may review at all. The platform only accepts a
         * review tied to a delivered order containing the product, so the form
         * is offered on that basis rather than on being signed in — otherwise
         * it collects a rating and then fails at submit with a rule the shopper
         * had no way to know about.
         */
        this.orderId = await this.sdk.review.eligibleOrderFor(this.productId);

        // A review posted from anywhere — this form, a rating widget — refreshes
        // the list without either side holding a reference to the other.
        this._off = this.sdk.event.on('review::added', payload => {
            if (String(payload?.productId ?? this.productId) !== String(this.productId)) return;
            this.page = 1;
            this.load().then(() => this.render());
        });
    }

    disconnectedCallback() {
        this._off?.();
        super.disconnectedCallback();
    }

    async load() {
        this.setBusy(true);

        try {
            const response = await this.sdk.api.withoutNotifier(
                () => this.sdk.review.fetch(this.productId, { perPage: this.perPage, page: this.page }),
            );

            this.reviews = response.reviews || [];
            this.average = Number(response.average_rating || 0);
            this.total = Number(response.total || 0);
            this.pagination = response.pagination || {};
        } catch (error) {
            this.sdk.logger.warn('falak-comments: fetch failed', error);
            this.reviews = [];
            this.total = 0;
        } finally {
            this.setBusy(false);
        }
    }

    render() {
        if (!this.productId || !this.enabled) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.classList.add('f-comments');

        this.innerHTML = `
            <div class="f-comments__head">
                <h2 class="f-comments__title">${this.escape(this.trans('product.reviews'))}</h2>
                ${this.total
                    ? `<div class="f-comments__summary">
                           <falak-rating-stars value="${this.average}" total="${this.total}" show-value></falak-rating-stars>
                       </div>`
                    : ''}
            </div>

            ${this.hideForm ? '' : this.formHtml()}

            ${this.pendingNoteHtml()}

            ${this.reviews?.length
                ? `<ul class="f-comments__list">${this.reviews.map(review => this.reviewHtml(review)).join('')}</ul>
                   ${this.moreHtml()}`
                : `<p class="f-comments__empty">${this.escape(this.trans('product.no_reviews'))}</p>`}`;
    }

    /**
     * "Your review is awaiting approval."
     *
     * Reviews are moderated, so a fresh submission is invisible in the public
     * list — without this note the shopper watches their review disappear into
     * "No reviews yet. Be the first.", which reads as data loss. The flag lives
     * in storage with a TTL and clears itself the moment the customer's own
     * review shows up approved.
     */
    pendingNoteHtml() {
        const key = `review.pending.${this.productId}`;
        const me = this.sdk.auth.user?.id;

        const mineVisible = me !== undefined && me !== null
            && (this.reviews || []).some(review => String(review.tenant_user_id ?? '') === String(me));

        if (mineVisible) {
            this.sdk.storage.remove(key);
            return '';
        }

        if (!this.sdk.storage.getWithTTL(key)) return '';

        return `<p class="f-comments__pending">${this.escape(this.trans('product.review_pending'))}</p>`;
    }

    formHtml() {
        // A guest sees the reason and the way forward, not a disabled form.
        if (!this.sdk.auth.isLoggedIn()) {
            return `
                <div class="f-comments__gate">
                    <p>${this.escape(this.trans('product.review_sign_in'))}</p>
                    <falak-button color="primary" fill="outline" size="small" data-login>
                        ${this.escape(this.trans('auth.sign_in'))}
                    </falak-button>
                </div>`;
        }

        /*
         * Signed in but with nothing to review against. Saying so is the whole
         * point — a form that always appears and always fails teaches shoppers
         * that reviews are broken.
         */
        if (!this.orderId) {
            return `
                <div class="f-comments__gate f-comments__gate--quiet">
                    <p>${this.escape(this.trans('product.review_requires_purchase'))}</p>
                </div>`;
        }

        return `
            <form class="f-comments__form" novalidate>
                <div class="f-comments__rating">
                    <span class="f-comments__label">${this.escape(this.trans('product.your_rating'))}</span>
                    <falak-rating-stars interactive max="5" value="0" product-id="${this.escape(this.productId)}"></falak-rating-stars>
                </div>
                <textarea class="f-comments__textarea" name="comment" rows="3"
                          placeholder="${this.escape(this.trans('product.review_placeholder'))}"></textarea>
                <p class="f-comments__error" data-error hidden></p>
                <falak-button type="submit" color="primary" size="small" loader-position="center">
                    ${this.escape(this.trans('product.submit_review'))}
                </falak-button>
            </form>`;
    }

    reviewHtml(review) {
        const name = review.user?.name || review.name || this.trans('product.anonymous');
        const date = review.created_at ? new Date(review.created_at) : null;

        // The column is review_text; `comment` kept as a fallback because the
        // SDK's own submit payload uses that word. Rendering the wrong key made
        // every review body silently blank.
        const text = review.review_text ?? review.comment ?? '';

        return `
            <li class="f-comments__item">
                <div class="f-comments__meta">
                    <span class="f-comments__avatar" aria-hidden="true">${this.escape((name[0] || '?').toUpperCase())}</span>
                    <div>
                        <strong class="f-comments__author">${this.escape(name)}</strong>
                        ${date ? `<time class="f-comments__date" datetime="${date.toISOString()}">${this.escape(this.formatDate(date))}</time>` : ''}
                    </div>
                    <falak-rating-stars value="${Number(review.rating) || 0}"></falak-rating-stars>
                </div>
                ${review.title ? `<strong class="f-comments__heading">${this.escape(review.title)}</strong>` : ''}
                ${text ? `<p class="f-comments__text">${this.escape(text)}</p>` : ''}
            </li>`;
    }

    moreHtml() {
        const { current_page: current = 1, last_page: last = 1 } = this.pagination || {};

        if (current >= last) return '';

        return `
            <div class="f-comments__more">
                <falak-button color="light" fill="outline" size="small" data-more>
                    ${this.escape(this.trans('product.more_reviews'))}
                </falak-button>
            </div>`;
    }

    formatDate(date) {
        try {
            return new Intl.DateTimeFormat(this.sdk.lang.locale, { dateStyle: 'medium' }).format(date);
        } catch (error) {
            return date.toISOString().slice(0, 10);
        }
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-login]')) {
                this.sdk.event.dispatch('auth::required');
                return;
            }

            if (event.target.closest('[data-more]')) this.loadMore();
        });

        // The interactive stars announce the choice; the form holds onto it
        // until submit rather than posting a rating with no comment attached.
        this.listen(this, 'rate', event => {
            this._rating = event.detail?.rating || 0;
        });

        this.listen(this, 'submit', event => {
            event.preventDefault();
            this.submit(event.target);
        });
    }

    async loadMore() {
        const button = this.querySelector('[data-more]');
        button?.load?.();

        this.page += 1;
        const previous = this.reviews || [];

        await this.load();

        // Appended, not replaced: "load more" that scrolls you back to the top
        // of a fresh page is a different feature.
        this.reviews = [...previous, ...(this.reviews || [])];
        this.render();
    }

    async submit(form) {
        const comment = String(new FormData(form).get('comment') || '').trim();
        const error = form.querySelector('[data-error]');
        const button = form.querySelector('falak-button');

        if (!this._rating) {
            error.textContent = this.trans('product.rating_required');
            error.hidden = false;
            return;
        }

        error.hidden = true;
        button?.load?.();
        button?.disable?.();

        try {
            await this.sdk.review.add(this.productId, {
                rating: this._rating,
                comment,
                orderId: this.orderId,
            });

            this._rating = 0;
            this.orderId = null;   // one review per order; the form stands down

            // Remember the pending submission for a week — approval usually
            // lands well within that, and the note self-clears when it does.
            this.sdk.storage.setWithTTL(`review.pending.${this.productId}`, true, 7 * 24 * 60);

            this.page = 1;
            await this.load();
            this.render();
        } catch (err) {
            // Two outcomes the shopper can act on, and one they cannot.
            if (err.message === 'AUTH_REQUIRED') {
                this.sdk.event.dispatch('auth::required');
            } else if (err.message === 'ORDER_REQUIRED') {
                this.orderId = null;
                this.render();
            } else {
                error.textContent = err.message || this.trans('common.load_failed');
                error.hidden = false;
            }
        } finally {
            button?.stop?.();
            button?.enable?.();
        }
    }
}
