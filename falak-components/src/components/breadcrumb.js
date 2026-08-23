import FalakElement from '../base.js';

/**
 * <falak-breadcrumb>                          derived from config.page
 * <falak-breadcrumb items='[{...}]'>          explicit trail from the server
 *
 * Salla's version rebuilds the trail from a sessionStorage snapshot so a product
 * reached from a category keeps that category in its path. The same idea is here,
 * because it is the only way to know which of several categories a shopper came
 * through — but the trail is only ever *extended* from the session, never
 * invented: an explicit `items` attribute always wins, so a server that knows
 * the real hierarchy stays authoritative.
 */
export default class FalakBreadcrumb extends FalakElement {
    static observedAttributes = ['items'];
    static STORAGE_KEY = 'breadcrumb.trail';

    setup() {
        this.trail = this.buildTrail();
    }

    buildTrail() {
        // 1. Explicit list from the template — the server knows best.
        const declared = this.jsonAttr('items', null);
        if (Array.isArray(declared) && declared.length) return this.mark(declared);

        // 2. Home page has no breadcrumb by definition.
        const page = this.sdk.config.get('page', {}) || {};
        if (!page.slug || page.slug === 'index') return [];

        const home = { title: this.trans('common.home'), url: this.sdk.url.get('') };

        /*
         * The current URL comes from the browser, not from config: `page.url`
         * is not part of the config blob, and comparing against `undefined`
         * made every "is this a new page?" test pass — so the trail grew by one
         * duplicate entry on every single load.
         */
        const current = { title: page.title || '', url: window.location.pathname };
        const session = this.readTrail();

        // A product reached from a listing continues that trail.
        if (page.slug === 'product' || page.slug === 'product.single') {
            const previous = session[session.length - 1];

            if (previous && !isSame(previous, current)) {
                const extended = this.capped([...session, current]);
                this.writeTrail(extended);
                return this.mark(extended);
            }

            if (session.length) return this.mark(session);
        }

        const generated = this.capped([home, ...this.fromPage(page, current)]);
        this.writeTrail(generated);

        return this.mark(generated);
    }

    /**
     * A trail is a path, not a history. Capping it keeps a shopper who browsed
     * twenty products from carrying all twenty in session storage, and bounds
     * the damage if a future page shape slips past the dedupe again.
     */
    capped(items) {
        const deduped = items.filter((item, index) => index === 0 || !isSame(items[index - 1], item));

        return deduped.slice(-4);
    }

    /** Category pages carry their own parent; everything else is home + self. */
    fromPage(page, current) {
        const trail = [];

        // A parent whose title matches the page is not a level — it is the same
        // thing named twice, which is how "Home / Guess / Guess" happened.
        if (page.parent && page.parent.title && page.parent.title !== page.title) {
            trail.push({ title: page.parent.title, url: page.parent.url || '' });
        }

        if (current.title) trail.push(current);

        return trail;
    }

    mark(items) {
        return items.map((item, index) => ({ ...item, isLast: index === items.length - 1 }));
    }

    readTrail() {
        // Arriving from search starts a fresh trail — the previous path is not
        // how this shopper got here.
        if (new URLSearchParams(window.location.search).get('from') === 'search') return [];

        const stored = this.sdk.storage.session.get(FalakBreadcrumb.STORAGE_KEY, []);
        return Array.isArray(stored) ? stored : [];
    }

    writeTrail(items) {
        this.sdk.storage.session.set(FalakBreadcrumb.STORAGE_KEY, items);
    }

    render() {
        if (!this.trail || this.trail.length < 2) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.classList.add('f-breadcrumb');

        this.innerHTML = `
            <nav aria-label="${this.escape(this.trans('common.breadcrumbs'))}">
                <ol class="f-breadcrumb__list">
                    ${this.trail.map(item => `
                        <li class="f-breadcrumb__item${item.isLast ? ' is-current' : ''}">
                            ${item.isLast || !item.url
                                ? `<span aria-current="page">${this.escape(item.title)}</span>`
                                : `<a href="${this.escape(item.url)}">${this.escape(item.title)}</a>`}
                        </li>`).join('')}
                </ol>
            </nav>`;
    }
}

/** Two entries are the same stop if either their path or their label matches. */
function isSame(a, b) {
    if (!a || !b) return false;
    if (a.url && b.url && a.url === b.url) return true;
    return !!a.title && a.title === b.title;
}
