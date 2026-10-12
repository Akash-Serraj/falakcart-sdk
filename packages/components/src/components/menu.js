import FalakElement from '../base.js';

/**
 * <falak-menu>                        enhances the markup already inside it
 *   <nav>…server-rendered list…</nav>
 * </falak-menu>
 *
 * <falak-menu source="main_menu">      renders from config when given no markup
 *
 * Two modes, and the first is the one to reach for.
 *
 * Salla's menus live behind an API, so their components fetch and render: their
 * own reference theme shows a skeleton, calls getMenus(), then paints. FalakCart
 * is not in that position — MenuResolver already resolves menus server-side and
 * Twig has them in the `menus` global at render time. Rendering them again on
 * the client would pay for a round trip, a skeleton flash and navigation that
 * crawlers cannot see, in exchange for nothing.
 *
 * So when the template ships markup, this component leaves it exactly where it
 * is and only adds the behaviour that genuinely needs JavaScript: dropdown
 * state, keyboard handling, the mobile drawer, and viewport-edge flipping.
 *
 * `source` mode stays for themes that have no menu markup of their own, and for
 * a menu that genuinely is client-side (a merchant app injecting one).
 */
export default class FalakMenu extends FalakElement {
    static observedAttributes = ['menu', 'source', 'mobile'];

    /** Class toggled on an open item. Matches the convention themes already use. */
    static OPEN = 'is-open';

    get isMobile() { return this.boolAttr('mobile'); }

    /** Config data, for the render path only. */
    get items() {
        const declared = this.jsonAttr('menu', null);
        if (Array.isArray(declared)) return declared;

        const source = this.attr('source', 'main_menu');
        const fromConfig = this.sdk.config.get(`menus.${source}`, []);

        return Array.isArray(fromConfig) ? fromConfig : [];
    }

    /**
     * Markup the template rendered, if any.
     *
     * Read before the first render and never re-read: once this component has
     * enhanced a tree it must not mistake its own output for fresh server
     * markup on a later attribute change.
     */
    setup() {
        this.hydrating = !!this.querySelector('ul');
    }

    render() {
        this.classList.add('f-menu');
        this.classList.toggle('f-menu--mobile', this.isMobile);

        if (this.hydrating) {
            this.enhance();
            return;
        }

        this.renderFromData();
    }

    /* ===================================================== enhance (default) */

    /**
     * Wires the existing tree without rewriting a single node.
     *
     * Structure is discovered rather than assumed — an item is any list item
     * with a nested list, its toggle is the direct link, its submenu the direct
     * list. That means this works against whatever class names a theme already
     * uses, so no theme has to rename its markup to adopt the component.
     */
    enhance() {
        const items = Array.from(this.querySelectorAll('li'))
            .filter(item => item.querySelector(':scope > ul'));

        items.forEach((item, index) => {
            const link = item.querySelector(':scope > a');
            const submenu = item.querySelector(':scope > ul');

            if (!link || !submenu) return;

            item.dataset.falakMenuItem = '';
            item.dataset.depth = String(depthOf(item, this));

            if (!submenu.id) submenu.id = `${this.id || 'falak-menu'}-sub-${index}`;

            link.setAttribute('aria-expanded', 'false');
            link.setAttribute('aria-controls', submenu.id);
        });

        this.enhanced = items.length;
        this.setState('enhanced', this.enhanced);
    }

    /* ======================================================= render (fallback) */

    renderFromData() {
        const items = this.items;

        if (!items.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');

        this.innerHTML = `
            <nav class="f-menu__nav" aria-label="${this.escape(this.attr('label') || this.trans('common.menu'))}">
                <ul class="f-menu__list f-menu__list--root">
                    ${items.map((item, index) => this.itemHtml(item, 0, String(index))).join('')}
                </ul>
            </nav>`;

        // Rendered markup goes through the same discovery as server markup, so
        // the behaviour below has exactly one code path to worry about.
        this.enhance();
    }

    /**
     * @param {number} depth  0 for root; only used to cap runaway nesting
     * @param {string} path   stable id fragment, e.g. "0-2-1"
     */
    itemHtml(item, depth, path) {
        const children = Array.isArray(item.children) ? item.children : [];
        const hasChildren = children.length > 0 && depth < 3;

        const label = this.escape(item.title || item.name || '');
        const url = item.url || item.link || '#';
        const newTab = item.is_new_tab ? ' target="_blank" rel="noopener"' : '';

        return `
            <li class="f-menu__item${hasChildren ? ' f-menu__item--has-children' : ''}">
                <a class="f-menu__link" href="${this.escape(url)}"${newTab}>
                    ${item.image ? `<img class="f-menu__image" src="${this.escape(item.image)}" alt="" loading="lazy">` : ''}
                    <span class="f-menu__label">${label}</span>
                    ${hasChildren ? '<span class="f-menu__caret" aria-hidden="true"></span>' : ''}
                </a>
                ${hasChildren
                    ? `<ul class="f-menu__list f-menu__list--sub" id="${this.escape(`${path}-sub`)}">
                           ${children.map((child, index) => this.itemHtml(child, depth + 1, `${path}-${index}`)).join('')}
                       </ul>`
                    : ''}
            </li>`;
    }

    /* ============================================================= behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            const link = event.target.closest('a');
            const item = link?.closest('[data-falak-menu-item]');

            if (!item || !this.contains(item)) return;

            // The link belongs to this item, not to a child of its submenu.
            if (item.querySelector(':scope > a') !== link) return;

            /*
             * On touch and in the drawer the first tap opens the submenu rather
             * than following the link — otherwise a parent category is
             * unreachable on a phone. A second tap navigates, which is what a
             * shopper expects.
             */
            const isOpen = item.classList.contains(FalakMenu.OPEN);

            if (this.isMobile || this.isTouch || !isOpen) {
                event.preventDefault();
                this.toggle(item, !isOpen);
            }
        });

        this.listen(this, 'keydown', event => {
            if (event.key !== 'Escape') return;
            this.closeAll();
            this.querySelector(`[data-falak-menu-item].${FalakMenu.OPEN} > a`)?.focus();
        });

        // Desktop dropdowns follow the pointer; the drawer does not.
        if (this.isMobile) return;

        this.listen(this, 'pointerover', event => {
            if (this.isTouch) return;

            const item = event.target.closest('[data-falak-menu-item]');
            if (item && item.dataset.depth === '0') this.toggle(item, true);
        });

        this.listen(this, 'pointerleave', () => !this.isTouch && this.closeAll());
        this.listen(document, 'click', event => {
            if (!this.contains(event.target)) this.closeAll();
        });
    }

    /** Hover is a lie on touch devices; a tap fires pointerover then click. */
    get isTouch() {
        return window.matchMedia('(hover: none)').matches;
    }

    toggle(item, open) {
        if (open) {
            // Siblings close, so two dropdowns are never open at once.
            Array.from(item.parentElement.children).forEach(sibling => {
                if (sibling !== item) this.setOpen(sibling, false);
            });
        }

        this.setOpen(item, open);

        if (open) this.keepInViewport(item);
    }

    setOpen(item, open) {
        /*
         * Checks the flag enhance() set, rather than re-deriving it with a
         * selector match. Same intent, but it states it directly and does not
         * hinge on an optional call that silently no-ops when the method is
         * missing — a guard that quietly does nothing is the worst kind.
         */
        if (!item || item.dataset?.falakMenuItem === undefined) return;

        item.classList.toggle(FalakMenu.OPEN, open);
        item.querySelector(':scope > a')?.setAttribute('aria-expanded', String(open));

        if (open) return;

        item.querySelectorAll(`[data-falak-menu-item].${FalakMenu.OPEN}`)
            .forEach(child => this.setOpen(child, false));
    }

    closeAll() {
        this.querySelectorAll(`[data-falak-menu-item].${FalakMenu.OPEN}`)
            .forEach(item => this.setOpen(item, false));
    }

    /**
     * A submenu near the edge of the window opens inward.
     *
     * Measured after the open class lands, because a hidden element has no
     * useful box. The flip class is removed first so a previous decision does
     * not survive a resize.
     */
    keepInViewport(item) {
        const submenu = item.querySelector(':scope > ul');
        if (!submenu) return;

        submenu.classList.remove('f-menu__list--flip');

        const box = submenu.getBoundingClientRect();

        if (box.right > window.innerWidth - 8 || box.left < 8) {
            submenu.classList.add('f-menu__list--flip');
        }
    }
}

/** Nesting depth of an item relative to the host, counting only list items. */
function depthOf(item, host) {
    let depth = 0;
    let node = item.parentElement;

    while (node && node !== host) {
        if (node.tagName === 'LI') depth++;
        node = node.parentElement;
    }

    return depth;
}
