import FalakElement from '../base.js';

/**
 * <falak-products-list limit="8" columns="4">
 * <falak-products-list category="3" limit="12" search="shirt">
 * <falak-products-list sort="top_rated" product-card-component="my-card">
 *
 * Component #5, and the one that closes the loop: it is the only component in
 * the starter set that owns a request lifecycle (loading -> loaded | empty |
 * error) and the only one that publishes data other components consume.
 *
 * It renders <falak-product-card> children rather than markup of its own, so
 * the card stays the single definition of what a product looks like.
 */
export default class FalakProductsList extends FalakElement {
    static observedAttributes = ['limit', 'category', 'search', 'columns', 'page', 'sort'];

    get limit() { return this.numAttr('limit', 8); }
    get page() { return this.numAttr('page', 1); }

    /**
     * Which element renders each product. Same opt-in <falak-products-slider>
     * already offers, so the two list components share one vocabulary: a theme
     * with its own card names it here, and everything that does not pass the
     * attribute keeps rendering <falak-product-card> exactly as before.
     */
    get cardTag() { return this.attr('product-card-component', 'falak-product-card'); }

    query() {
        return {
            limit: this.limit,
            page: this.page,
            category: this.attr('category'),
            search: this.attr('search'),
            // Understood by the product API: best_selling | top_rated | on_offer.
            // Absent means the endpoint's own order, which is what every
            // existing caller gets today.
            sort: this.attr('sort') || null,
        };
    }

    async setup() {
        await this.load();
    }

    /**
     * Re-queries when a filter attribute changes, but not for `columns`, which
     * is presentation only — a layout tweak must not cost a round trip.
     */
    onAttributeChange(name) {
        if (name !== 'columns') this.load();
    }

    async load() {
        // An in-flight request for stale criteria is abandoned rather than
        // awaited: typing in a search box would otherwise render the results
        // of whichever request happened to finish last.
        this._controller?.abort();
        this._controller = new AbortController();

        const controller = this._controller;

        this.setState('state', 'loading');
        this.setBusy(true);
        this.render();

        try {
            const result = await this.sdk.product.fetch(this.query());

            if (controller.signal.aborted) return;

            this.items = result.products;
            this.totalCount = result.total;
            this.setState('state', this.items.length ? 'loaded' : 'empty');

            this.emit('fetched', result);
            this.emitBus('product::list.fetched', {
                ...result,
                source: this.attr('source') || 'products-list',
            });
        } catch (error) {
            if (controller.signal.aborted) return;

            this.items = [];
            this.error = error;
            this.setState('state', 'error');

            this.emit('fetch-failed', { error });
        } finally {
            if (!controller.signal.aborted) {
                this.setBusy(false);
                this.render();
            }
        }
    }

    render() {
        const state = this.attr('data-state', 'loading');

        this.classList.add('f-list');
        this.style.setProperty('--f-list-columns', this.attr('columns', '4'));

        if (state === 'loading') {
            // Placeholders match the requested count so the grid does not
            // reflow when the real cards arrive.
            this.innerHTML = `
                <div class="f-list__grid">
                    ${Array.from({ length: this.limit }, () =>
                        `<div class="f-card f-card--skeleton" aria-hidden="true"></div>`).join('')}
                </div>`;
            return;
        }

        if (state === 'error') {
            this.innerHTML = `
                <div class="f-list__message f-list__message--error" role="alert">
                    <p>${this.escape(this.trans('common.load_failed'))}</p>
                    <button type="button" class="f-list__retry">${this.escape(this.trans('common.retry'))}</button>
                </div>`;
            return;
        }

        if (!this.items?.length) {
            this.innerHTML = `
                <div class="f-list__message f-list__message--empty">
                    <p>${this.escape(this.trans('product.none_found'))}</p>
                </div>`;
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'f-list__grid';

        /*
         * Cards are created as elements and handed their record as a property
         * rather than a JSON attribute: a product name with a quote in it would
         * otherwise have to survive two rounds of escaping.
         */
        this.items.forEach(product => {
            const card = document.createElement(this.cardTag);
            card._product = product;
            card.setAttribute('product-id', product.id);
            card.setAttribute('source', this.attr('source') || 'products-list');
            // `card-button` / `card-wishlist` on the list put the standard
            // actions on every card it renders.
            if (this.boolAttr('card-button')) card.setAttribute('show-add-button', '');
            if (this.boolAttr('card-wishlist')) card.setAttribute('show-wishlist', '');
            grid.appendChild(card);
        });

        this.innerHTML = '';
        this.appendChild(grid);

        if (this.boolAttr('show-count')) {
            const count = document.createElement('p');
            count.className = 'f-list__count';
            count.textContent = this.trans('product.showing_count', {
                shown: this.sdk.number(this.items.length),
                total: this.sdk.number(this.totalCount),
            });
            this.prepend(count);
        }
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('.f-list__retry')) this.load();
        });
    }

    disconnectedCallback() {
        this._controller?.abort();
        super.disconnectedCallback();
    }
}
