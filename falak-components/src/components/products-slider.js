import FalakElement from '../base.js';

/**
 * <falak-products-slider source="latest" limit="10" block-title="New arrivals">
 * <falak-products-slider source="category" source-value="3" slides-per-view="5">
 * <falak-products-slider source="json" source-value='[{...}]'>
 *
 * Composition rather than reimplementation: this fetches products and hands them
 * to <falak-slider>, which hands each one to a product card. None of the three
 * knows how the others work.
 *
 * The source / source-value vocabulary follows <salla-products-slider>, including
 * `json` for products the server already had — a home page section that received
 * its products from Twig should not pay for a round trip.
 */
export default class FalakProductsSlider extends FalakElement {
    static observedAttributes = ['source', 'source-value', 'limit', 'slides-per-view', 'block-title'];

    /** Sources that are meaningful without a value. */
    static VALUELESS = ['latest', 'offers', 'sales', 'top-rated'];

    get source() { return this.attr('source', 'latest'); }
    get sourceValue() { return this.attr('source-value'); }
    get limit() { return this.numAttr('limit', 10); }
    get cardTag() { return this.attr('product-card-component', 'falak-product-card'); }

    async setup() {
        if (!this.isSourceValid()) {
            this.sdk.logger.warn(`falak-products-slider: source-value is required for source "${this.source}"`);
            this.products = [];
            return;
        }

        // Products already in hand — render immediately, no request.
        if (this.source === 'json') {
            this.products = this.jsonAttr('source-value', []) || [];
            return;
        }

        this.setState('state', 'loading');
        this.setBusy(true);

        try {
            const result = await this.sdk.api.withoutNotifier(() => this.sdk.product.fetch({
                limit: this.limit,
                category: this.source === 'category' ? this.sourceValue : null,
            }));

            this.products = result.products;

            this.emit('fetched', result);
            this.emitBus('product::slider.fetched', { ...result, source: this.source });
        } catch (error) {
            this.sdk.logger.warn('falak-products-slider: fetch failed', error);
            this.products = [];
            this.error = error;
        } finally {
            this.setBusy(false);
        }
    }

    isSourceValid() {
        return FalakProductsSlider.VALUELESS.includes(this.source) || !!this.sourceValue;
    }

    onAttributeChange(name) {
        // Presentation-only attributes are handled by the nested slider; a
        // re-fetch for a column count change would be pure waste.
        if (['source', 'source-value', 'limit'].includes(name)) this.reload();
    }

    async reload() {
        await this.setup();
        this.render();
    }

    render() {
        this.classList.add('f-products-slider');

        if (!this.products) {
            this.setState('state', 'loading');
            this.innerHTML = `
                <div class="f-products-slider__skeleton" aria-hidden="true">
                    ${Array.from({ length: Math.min(this.limit, 5) }, () =>
                        '<div class="f-card f-card--skeleton"></div>').join('')}
                </div>`;
            return;
        }

        // An empty carousel is worse than no carousel — a merchant section with
        // no products should collapse, not leave a titled empty band.
        if (!this.products.length) {
            this.setState('state', 'empty');
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.setState('state', 'loaded');

        const slider = document.createElement('falak-slider');

        // Forwarded rather than duplicated: every presentation attribute is the
        // slider's to interpret, so this component owns none of them.
        ['block-title', 'block-subtitle', 'display-all-url', 'display-all-title',
         'slides-per-view', 'show-controls', 'controls-outer', 'pagination',
         'auto-play', 'auto-play-delay', 'loop', 'arrows-centered', 'static-when-single']
            .forEach(name => {
                if (this.hasAttribute(name)) slider.setAttribute(name, this.getAttribute(name));
            });

        if (!this.hasAttribute('show-controls')) slider.setAttribute('show-controls', '');

        this.products.forEach(product => {
            const card = document.createElement(this.cardTag);

            // Handed as a property, not a JSON attribute: a product name
            // containing a quote would otherwise need two rounds of escaping.
            card._product = product;
            card.setAttribute('product-id', product.id);
            card.setAttribute('source', this.attr('source-label') || `slider.${this.source}`);

            // Same opt-in vocabulary as <falak-products-list>: the section
            // decides whether its cards carry buy/wishlist actions.
            if (this.boolAttr('card-button')) card.setAttribute('show-add-button', '');
            if (this.boolAttr('card-wishlist')) card.setAttribute('show-wishlist', '');

            slider.appendChild(card);
        });

        this.innerHTML = '';
        this.appendChild(slider);
    }
}
