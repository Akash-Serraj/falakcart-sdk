import FalakElement from '../base.js';

/**
 * <falak-categories></falak-categories>
 * <falak-categories limit="8" layout="grid" show-count></falak-categories>
 * <falak-categories parent="12" layout="circles"></falak-categories>
 *
 * The store's real categories, fetched from the catalogue.
 *
 * A home block cannot loop them in Twig — `pages/index.twig` receives no page
 * data and the sandbox exposes no categories function — so a block that wants
 * them has to fetch, which is what this is for. Each tile links to
 * /category/{id}, the storefront's own route.
 *
 * Renders its own empty state rather than an empty band: a store with no
 * categories yet should say so, not leave a heading floating over nothing.
 *
 * | attribute   | role                                                     |
 * | limit       | how many to show (default: all)                          |
 * | layout      | grid (default) | circles | list                          |
 * | parent      | only the children of this category id                    |
 * | roots-only  | only top-level categories                                |
 * | show-count  | render each category's product count when the API gives one |
 */
export default class FalakCategories extends FalakElement {
    static observedAttributes = ['limit', 'layout', 'parent', 'roots-only', 'show-count'];

    get limit() { return this.numAttr('limit', 0); }
    get layout() { return this.attr('layout', 'grid'); }
    get parent() { return this.attr('parent', ''); }

    async setup() {
        await this.load();
    }

    onAttributeChange(name) {
        // Only the server-side filters need a refetch; the rest just repaint.
        if (name === 'parent') this.load().then(() => this.queueRender());
    }

    async load() {
        this.setBusy(true);

        try {
            /* withoutNotifier: a storefront that has not set up categories yet
               is an ordinary state, not something to toast the shopper about. */
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.product.categories());
            const list = response?.data ?? response;

            this._categories = Array.isArray(list) ? list : [];
            this._failed = false;
        } catch (error) {
            this._categories = [];
            this._failed = true;
        }

        this.setBusy(false);
    }

    /** The categories this element should show, after its filters. */
    get visible() {
        let list = this._categories ?? [];

        if (this.parent) {
            const parent = String(this.parent);
            list = list.filter(row => String(row.parent_id ?? '') === parent);
        } else if (this.boolAttr('roots-only')) {
            list = list.filter(row => row.parent_id === null || row.parent_id === undefined);
        }

        return this.limit > 0 ? list.slice(0, this.limit) : list;
    }

    render() {
        this.classList.add('f-categories');
        this.classList.toggle('f-categories--circles', this.layout === 'circles');
        this.classList.toggle('f-categories--list', this.layout === 'list');

        if (this._categories === undefined) {
            this.innerHTML = `<p class="f-categories__note">${this.escape(this.trans('common.loading'))}</p>`;
            return;
        }

        const categories = this.visible;

        if (!categories.length) {
            this.innerHTML = `<p class="f-categories__note">${this.escape(
                this._failed ? this.trans('common.load_failed') : this.trans('categories.none'),
            )}</p>`;
            return;
        }

        this.innerHTML = `
            <ul class="f-categories__list">
                ${categories.map(row => this.tile(row)).join('')}
            </ul>`;
    }

    tile(row) {
        const name = this.name(row);
        const image = row.image_url || row.image || '';
        const count = this.boolAttr('show-count') ? this.count(row) : null;

        return `
            <li class="f-categories__item">
                <a class="f-categories__link" href="/category/${this.escape(row.id)}">
                    ${image
                        ? `<img class="f-categories__image" src="${this.escape(image)}" alt="" loading="lazy">`
                        : '<span class="f-categories__image f-categories__image--empty" aria-hidden="true"></span>'}
                    <span class="f-categories__name">${this.escape(name)}</span>
                    ${count !== null ? `<span class="f-categories__count">${this.escape(count)}</span>` : ''}
                </a>
            </li>`;
    }

    /** Arabic name when the shopper is reading Arabic and the store has one. */
    name(row) {
        const arabic = this.sdk.lang.locale === 'ar' && row.name_ar;
        return String(arabic || row.name || '').trim() || `#${row.id}`;
    }

    /**
     * The count is whatever the endpoint happens to expose. It is absent on
     * this platform's categories payload today, so `show-count` is a no-op
     * rather than a "0 products" label on every tile.
     */
    count(row) {
        const value = row.products_count ?? row.product_count ?? null;
        if (value === null || value === undefined) return null;

        return this.trans('common.products_count', { count: value }) || String(value);
    }
}
