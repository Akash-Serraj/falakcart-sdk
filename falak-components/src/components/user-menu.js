import FalakElement from '../base.js';

/**
 * <falak-user-menu show-trigger avatar-only>   header dropdown
 * <falak-user-menu inline>                     flat list, for an account sidebar
 *
 * Mirrors <salla-user-menu>'s attribute vocabulary — inline, avatar-only,
 * show-header, show-trigger — so the same markup shape carries over.
 *
 * A guest sees a sign-in trigger rather than an empty dropdown: the component
 * is the entry point to authentication, not just a display of it.
 */
export default class FalakUserMenu extends FalakElement {
    static observedAttributes = ['inline', 'avatar-only', 'show-trigger', 'show-header'];

    /**
     * Account links, in menu order. Icons are keyed by the same names.
     *
     * /customer/* — the URL space the platform's storefront routes and the
     * theme's own account sidebar use. (/account/* was Salla's convention and
     * 404'd here.)
     */
    static ITEMS = [
        { key: 'orders', href: '/customer/orders' },
        { key: 'wishlist', href: '/customer/wishlist', feature: 'wishlist_enabled' },
        { key: 'notifications', href: '/customer/notifications' },
        { key: 'profile', href: '/customer/profile' },
    ];

    get inline() { return this.boolAttr('inline'); }
    get avatarOnly() { return this.boolAttr('avatar-only'); }
    get showTrigger() { return this.boolAttr('show-trigger'); }
    get showHeader() { return this.boolAttr('show-header'); }

    get user() { return this.sdk.auth.user || null; }
    get isLoggedIn() { return this.sdk.auth.isLoggedIn(); }

    setup() {
        // Auth state changes anywhere — a login modal, a token expiring
        // mid-request — and this redraws without either side holding a
        // reference to the other.
        this._offIn = this.sdk.event.on('auth::logged.in', () => this.queueRender());
        this._offOut = this.sdk.event.on('auth::logged.out', () => this.queueRender());
        this._offInvalid = this.sdk.event.on('auth::token.invalid', () => this.queueRender());
        // The name/email shown here comes from the stored customer, which a
        // profile edit (<falak-user-profile>) changes without a re-login.
        this._offFetched = this.sdk.event.on('auth::user.fetched', () => this.queueRender());
    }

    disconnectedCallback() {
        this._offIn?.();
        this._offOut?.();
        this._offInvalid?.();
        this._offFetched?.();
        super.disconnectedCallback();
    }

    /* ------------------------------------------------------------- render */

    render() {
        this.classList.add('f-user');
        this.classList.toggle('f-user--inline', this.inline);

        this.innerHTML = this.isLoggedIn ? this.signedIn() : this.guest();
    }

    guest() {
        // No dropdown for a guest — there is exactly one thing to do.
        return `
            <button type="button" class="f-user__trigger f-user__trigger--guest" data-login>
                <span class="f-user__avatar" aria-hidden="true">${ICONS.user}</span>
                ${this.avatarOnly ? '' : `<span class="f-user__name">${this.escape(this.trans('auth.sign_in'))}</span>`}
            </button>`;
    }

    signedIn() {
        const user = this.user || {};
        const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
            || user.name
            || user.phone
            || this.trans('account.title');

        const items = this.items();

        const list = `
            <ul class="f-user__list">
                ${items.map(item => `
                    <li class="f-user__item">
                        <a class="f-user__link" href="${this.escape(item.href)}">
                            <span class="f-user__icon" aria-hidden="true">${ICONS[item.key] || ICONS.user}</span>
                            <span>${this.escape(this.trans(`account.${item.key}`))}</span>
                        </a>
                    </li>`).join('')}
                <li class="f-user__item f-user__item--logout">
                    <button type="button" class="f-user__link" data-logout>
                        <span class="f-user__icon" aria-hidden="true">${ICONS.logout}</span>
                        <span>${this.escape(this.trans('account.logout'))}</span>
                    </button>
                </li>
            </ul>`;

        // Inline drops the trigger and the panel: it is a sidebar, not a menu.
        if (this.inline) return list;

        return `
            <div class="f-user__wrap">
                ${this.showTrigger === false ? '' : `
                    <button type="button" class="f-user__trigger" data-toggle
                            aria-expanded="false" aria-haspopup="true">
                        <span class="f-user__avatar" aria-hidden="true">${this.initials(name)}</span>
                        ${this.avatarOnly ? '' : `<span class="f-user__name">${this.escape(name)}</span>`}
                    </button>`}
                <div class="f-user__panel" hidden>
                    ${this.showHeader ? `
                        <div class="f-user__header">
                            <span class="f-user__avatar f-user__avatar--lg" aria-hidden="true">${this.initials(name)}</span>
                            <span class="f-user__greeting">
                                <small>${this.escape(this.trans('account.hello'))}</small>
                                <strong>${this.escape(name)}</strong>
                            </span>
                        </div>` : ''}
                    ${list}
                </div>
            </div>`;
    }

    /** Feature-gated entries drop out rather than 404 when the store disables them. */
    items() {
        return FalakUserMenu.ITEMS.filter(item =>
            !item.feature || this.sdk.config.get(`store.settings.${item.feature}`, true));
    }

    /** Avatar is initials, not an uploaded image — there is no avatar column. */
    initials(name) {
        const letters = String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('');
        return this.escape(letters.toUpperCase() || '?');
    }

    /* ------------------------------------------------------------ behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-login]')) {
                // Goes through the SDK rather than opening the modal directly,
                // so a theme that swapped in its own login flow still works.
                this.sdk.event.dispatch('auth::required');
                return;
            }

            if (event.target.closest('[data-toggle]')) {
                this.toggle();
                return;
            }

            if (event.target.closest('[data-logout]')) this.logout();
        });

        this.listen(document, 'click', event => {
            if (!this.contains(event.target)) this.toggle(false);
        });

        this.listen(this, 'keydown', event => {
            if (event.key === 'Escape') this.toggle(false);
        });
    }

    toggle(force) {
        const panel = this.querySelector('.f-user__panel');
        if (!panel) return;

        const open = force === undefined ? panel.hidden : force;

        panel.hidden = !open;
        this.querySelector('[data-toggle]')?.setAttribute('aria-expanded', String(open));
        this.setState('open', open);
    }

    async logout() {
        this.setBusy(true);

        try {
            await this.sdk.auth.logout();
        } finally {
            this.setBusy(false);
            // Server-rendered account markup is still on the page.
            window.location.reload();
        }
    }
}

const ICONS = {
    user: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" stroke-linecap="round"/></svg>',
    orders: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16v13H4z"/><path d="M8 7V5a4 4 0 0 1 8 0v2" stroke-linecap="round"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.3A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.7c0 4.9-7 9.3-7 9.3z" stroke-linejoin="round"/></svg>',
    notifications: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7z" stroke-linejoin="round"/><path d="M10.5 20a2 2 0 0 0 3 0" stroke-linecap="round"/></svg>',
    profile: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 19a6 6 0 0 1 11 0" stroke-linecap="round"/></svg>',
    logout: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" stroke-linecap="round"/><path d="M10 16l-4-4 4-4M6 12h9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
