import FalakElement from '../base.js';

/**
 * <falak-search></falak-search>
 *
 * A header search trigger — mirroring <salla-search>: a magnifier icon opens
 * a dropdown near the top of the page; typing shows matching products right
 * there, each with its image and price, no navigation needed. Enter (or the
 * "view all results" link) goes to the full `/search?q=` results page, which
 * runs the same query server-side.
 *
 * Deliberately not `<falak-searchable-dropdown>` (Salla's generic combobox
 * primitive backing several pickers, not just search) — nothing else on this
 * storefront needs that generality yet, and building it unused would just be
 * dead code to keep in sync.
 *
 * | attribute | role                                                        |
 * | limit     | live results shown before "view all" (default 6)          |
 *
 * Events: bus `search::submitted` with `{ query }` when Enter or "view all"
 * navigates to the results page.
 */
export default class FalakSearch extends FalakElement {
    static MIN_CHARS = 2;
    static DEBOUNCE_MS = 400;

    get limit() { return this.numAttr('limit', 6); }

    render() {
        this.classList.add('f-search');

        this.innerHTML = `
            <button type="button" class="f-search__trigger" data-search-open aria-label="${this.escape(this.trans('search.title'))}">
                ${FalakSearch.ICON}
            </button>
            <falak-modal id="falak-search" width="lg" position="top" no-padding>
                <div class="f-search__panel">
                    <form class="f-search__form" data-search-form novalidate>
                        <span class="f-search__icon" aria-hidden="true">${FalakSearch.ICON}</span>
                        <input class="f-search__input" type="search" name="q" data-search-input
                               placeholder="${this.escape(this.trans('search.placeholder'))}"
                               autocomplete="off" spellcheck="false">
                    </form>
                    <div class="f-search__results" data-search-results hidden></div>
                </div>
            </falak-modal>`;

        this._modal = this.querySelector('falak-modal');
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-search-open]')) this._modal?.open?.();

            const result = event.target.closest('[data-search-result]');
            if (result) this.emitBus('search::submitted', { query: this.currentQuery() });

            if (event.target.closest('[data-search-view-all]')) this.goToResults();
        });

        this.listen(this, 'input', event => {
            if (event.target.matches('[data-search-input]')) this.onInput(event.target.value);
        });

        this.listen(this, 'submit', event => {
            if (!event.target.matches('[data-search-form]')) return;
            event.preventDefault();
            this.goToResults();
        });

        // A closed dropdown must not show yesterday's results the next time
        // it opens — same reason <falak-login-modal> resets its step on close.
        this.listen(this, 'modal-close', () => this.reset());
    }

    currentQuery() {
        return (this.querySelector('[data-search-input]')?.value || '').trim();
    }

    onInput(value) {
        clearTimeout(this._debounce);
        const query = value.trim();

        if (query.length < FalakSearch.MIN_CHARS) {
            this.showResults(null);
            return;
        }

        this._debounce = setTimeout(() => this.runSearch(query), FalakSearch.DEBOUNCE_MS);
    }

    async runSearch(query) {
        // <falak-modal>'s own is-loading swaps its whole body for a spinner,
        // which would hide the input the shopper is still typing in — a
        // plain busy flag on this element (and CSS on the results box) instead.
        this.setState('busy', true);

        try {
            const result = await this.sdk.api.withoutNotifier(() =>
                this.sdk.product.fetch({ search: query, limit: this.limit }));

            // A slower, earlier request landing after a newer one was already
            // shown must not overwrite it — same guard <falak-price-range>-
            // style debounced inputs need.
            if (this.currentQuery() !== query) return;

            this.showResults(result.products || []);
        } catch (error) {
            if (this.currentQuery() === query) this.showResults([]);
        } finally {
            this.removeAttribute('data-busy');
        }
    }

    showResults(products) {
        const host = this.querySelector('[data-search-results]');
        if (!host) return;

        if (products === null) {
            host.hidden = true;
            host.innerHTML = '';
            return;
        }

        host.hidden = false;
        host.innerHTML = products.length
            ? `<ul class="f-search__list">${products.map(p => this.resultHtml(p)).join('')}</ul>
               <a class="f-search__view-all" href="${this.escape(this.sdk.url.search(this.currentQuery()))}" data-search-view-all>
                   ${this.escape(this.trans('search.view_all'))}
               </a>`
            : `<p class="f-search__empty">${this.escape(this.trans('search.no_results'))}</p>`;
    }

    resultHtml(product) {
        const locale = this.sdk.lang.locale;
        const name = (locale === 'ar' && product.name_ar) ? product.name_ar : product.name;

        const list = Number(product.price_cents ?? 0);
        const discount = Number(product.discount_price_cents ?? 0);
        const onSale = discount > 0 && discount < list;
        const price = onSale ? discount : list;

        const image = product.images?.[0]?.url || product.images?.[0]?.image_path || null;
        const url = this.sdk.url.product(product.id);

        return `
            <li class="f-search__item">
                <a class="f-search__link" href="${this.escape(url)}" data-search-result>
                    <span class="f-search__thumb">
                        ${image
                            ? `<img src="${this.escape(image)}" alt="" loading="lazy" decoding="async">`
                            : `<span class="f-search__thumb-placeholder"></span>`}
                    </span>
                    <span class="f-search__info">
                        <span class="f-search__name">${this.escape(name || '')}</span>
                        <span class="f-search__price">
                            <span class="f-search__price-now">${this.escape(this.money(price, product.currency))}</span>
                            ${onSale ? `<del class="f-search__price-was">${this.escape(this.money(list, product.currency))}</del>` : ''}
                        </span>
                    </span>
                </a>
            </li>`;
    }

    goToResults() {
        const query = this.currentQuery();
        if (!query) return;

        this.emitBus('search::submitted', { query });
        window.location.href = this.sdk.url.search(query);
    }

    reset() {
        clearTimeout(this._debounce);
        const input = this.querySelector('[data-search-input]');
        if (input) input.value = '';
        this.showResults(null);
    }
}

FalakSearch.ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
