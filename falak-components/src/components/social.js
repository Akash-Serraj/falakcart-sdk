import FalakElement from '../base.js';

/**
 * <falak-social>                       the store's own profiles (footer)
 * <falak-social mode="share">          share the current page (product page)
 *
 * Salla splits these into <salla-social> and <salla-social-share>. They are one
 * component here because the markup, the icon set and the styling are identical
 * — only the href changes — and two tags would mean two places to add the next
 * network to.
 *
 * Profile links come from the store settings the platform puts in config, so
 * the footer needs no server-rendered markup and no fetch.
 */
export default class FalakSocial extends FalakElement {
    static observedAttributes = ['mode', 'networks', 'share-url', 'share-text'];

    /** Slug -> [config key, label, brand path]. Order here is display order. */
    static NETWORKS = {
        instagram: 'Instagram',
        facebook:  'Facebook',
        x_account: 'X',
        snapchat:  'Snapchat',
        tiktok:    'TikTok',
        youtube:   'YouTube',
        linkedin:  'LinkedIn',
        whatsapp:  'WhatsApp',
        telegram:  'Telegram',
    };

    /** Networks that can receive a shared URL, in share order. */
    static SHARERS = ['whatsapp', 'x_account', 'facebook', 'telegram'];

    get mode() { return this.attr('mode', 'links'); }
    get shareUrl() { return this.attr('share-url') || window.location.href; }
    get shareText() { return this.attr('share-text') || document.title; }

    render() {
        const items = this.mode === 'share' ? this.shareItems() : this.profileItems();

        // Rendering an empty list would leave a stray heading and a border in
        // the footer, so the whole component stands down instead.
        if (!items.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        const isShare = this.mode === 'share';

        this.removeAttribute('hidden');
        this.classList.add('f-social');
        this.classList.toggle('f-social--share', isShare);

        const title = this.attr('title-text')
            || this.trans(isShare ? 'footer.share' : 'footer.follow_us');

        /*
         * Share mode labels inline rather than with a heading. A bare row of
         * icon circles under a divider reads as leftover UI — naming it costs
         * one word and makes the row look intended.
         */
        const heading = this.boolAttr('hide-title')
            ? ''
            : isShare
                ? `<span class="f-social__label">${this.escape(title)}</span>`
                : `<h3 class="f-social__title">${this.escape(title)}</h3>`;

        this.innerHTML = `
            ${heading}
            <ul class="f-social__list">
                ${items.map(item => `
                    <li class="f-social__item">
                        <a class="f-social__link f-social__link--${item.slug}"
                           href="${this.escape(item.url)}"
                           target="_blank" rel="noopener noreferrer"
                           aria-label="${this.escape(item.label)}">
                            ${ICONS[item.slug] || ICONS.link}
                        </a>
                    </li>`).join('')}
            </ul>`;
    }

    /**
     * The store's own accounts. A bare handle is expanded to a full profile URL.
     *
     * Two sources, because there are genuinely two: a theme may collect social
     * links as customizer settings, while the platform holds them on the store
     * record. An explicit `links` attribute lets the theme stay authoritative
     * where it has them, and the store settings fill in where it does not.
     */
    /**
     * Two sources, most specific first.
     *
     * A theme may hold social links as customizer settings while the platform
     * holds them on the store record, so `link-<network>` lets the theme stay
     * authoritative and config fills in the rest. One attribute per network
     * rather than a JSON blob because the theme Twig sandbox permits no
     * json_encode filter — a template could not express the blob.
     */
    profileItems() {
        const only = this.jsonAttr('networks', null);

        return Object.entries(FalakSocial.NETWORKS)
            .filter(([slug]) => !only || only.includes(slug))
            .map(([slug, label]) => {
                const value = this.attr(`link-${slug}`)
                    ?? this.sdk.config.get(`store.social.${slug}`);

                return value ? { slug, label, url: profileUrl(slug, String(value)) } : null;
            })
            .filter(Boolean);
    }

    shareItems() {
        const url = encodeURIComponent(this.shareUrl);
        const text = encodeURIComponent(this.shareText);

        return FalakSocial.SHARERS.map(slug => ({
            slug,
            label: FalakSocial.NETWORKS[slug],
            url: SHARE_URLS[slug](url, text),
        }));
    }

    afterRender() {
        if (this._wired || this.mode !== 'share') return;
        this._wired = true;

        this.listen(this, 'click', event => {
            const link = event.target.closest('.f-social__link');
            if (!link) return;

            this.emitBus('share::clicked', {
                network: link.className.match(/f-social__link--([a-z_]+)/)?.[1],
                url: this.shareUrl,
            });
        });
    }
}

/** Merchants paste either a handle or a full URL; both have to work. */
function profileUrl(slug, value) {
    if (/^https?:\/\//i.test(value)) return value;

    const handle = value.replace(/^@/, '').trim();

    switch (slug) {
        case 'instagram': return `https://instagram.com/${handle}`;
        case 'facebook':  return `https://facebook.com/${handle}`;
        case 'x_account': return `https://x.com/${handle}`;
        case 'snapchat':  return `https://snapchat.com/add/${handle}`;
        case 'tiktok':    return `https://tiktok.com/@${handle}`;
        case 'youtube':   return `https://youtube.com/${handle.startsWith('@') ? handle : '@' + handle}`;
        case 'linkedin':  return `https://linkedin.com/company/${handle}`;
        // Contact channels take a number, not a handle — strip formatting.
        case 'whatsapp':  return `https://wa.me/${handle.replace(/\D/g, '')}`;
        case 'telegram':  return `https://t.me/${handle}`;
        default:          return value;
    }
}

const SHARE_URLS = {
    whatsapp:  (url, text) => `https://wa.me/?text=${text}%20${url}`,
    x_account: (url, text) => `https://x.com/intent/tweet?url=${url}&text=${text}`,
    facebook:  url => `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    telegram:  (url, text) => `https://t.me/share/url?url=${url}&text=${text}`,
};

/*
 * Inline SVG rather than icon-font or CDN images: the CSP on a merchant page is
 * not ours to widen, and a missing icon in a footer is a support ticket.
 * currentColor throughout so a dark footer needs no second icon set.
 */
const ICONS = {
    instagram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none"/></svg>',
    facebook:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H16.7V3.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.3V13h2.7v8z"/></svg>',
    x_account: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M17.3 3h3.3l-7.2 8.2L21.8 21h-6.6l-5.2-6.7L4.1 21H.8l7.7-8.8L.5 3h6.8l4.7 6.2zm-1.2 16h1.8L7.9 4.8H6z"/></svg>',
    snapchat:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2.2c2.7 0 4.6 2 4.7 4.7 0 .8-.1 1.6-.1 2.1.4.2.9.1 1.4-.1.6-.2 1.1.5.7 1-.4.5-1.3.8-1.8 1-.3.1-.4.4-.3.7.5 1.4 1.7 2.7 3 3 .5.1.5.8 0 1-.6.2-1.4.3-1.7.5-.2.2-.1.7-.4.9-.3.2-.9 0-1.6 0-.9 0-1.6.2-2.3.8-.6.5-1.2 1-2.6 1s-2-.5-2.6-1c-.7-.6-1.4-.8-2.3-.8-.7 0-1.3.2-1.6 0-.3-.2-.2-.7-.4-.9-.3-.2-1.1-.3-1.7-.5-.5-.2-.5-.9 0-1 1.3-.3 2.5-1.6 3-3 .1-.3 0-.6-.3-.7-.5-.2-1.4-.5-1.8-1-.4-.5.1-1.2.7-1 .5.2 1 .3 1.4.1 0-.5-.1-1.3-.1-2.1C7.4 4.2 9.3 2.2 12 2.2z"/></svg>',
    tiktok:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16.3 2h-3v13.1a2.6 2.6 0 1 1-2.2-2.6V9.4a5.7 5.7 0 1 0 5.2 5.7V8.6a6.6 6.6 0 0 0 3.9 1.3V6.8a3.7 3.7 0 0 1-3.9-3.6z"/></svg>',
    youtube:   '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8M10 15.1V8.9l5.2 3.1z"/></svg>',
    whatsapp:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a9.9 9.9 0 0 0-8.5 15L2 22l5.2-1.4A9.9 9.9 0 1 0 12 2m0 1.8a8.1 8.1 0 1 1-4.1 15.1l-.3-.2-3.1.8.8-3-.2-.3A8.1 8.1 0 0 1 12 3.8m-3.1 4c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.7 4.2 3.7 2 .8 2.4.7 2.9.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.2.1-1.3l-.6-.3-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.8 6.8 0 0 1-2-1.2 7.5 7.5 0 0 1-1.4-1.7c-.1-.2 0-.4.1-.5l.4-.5.3-.4v-.5l-.7-1.6c-.2-.4-.4-.4-.5-.4z"/></svg>',
    telegram:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21.7 4.3 2.9 11.6c-.9.4-.9 1.1-.2 1.3l4.8 1.5 1.8 5.5c.2.6.4.6.9.2l2.6-2.5 4.6 3.4c.8.5 1.4.2 1.6-.8l3-13.9c.3-1.2-.5-1.7-1.3-1.4M8.8 14l9.4-5.9c.4-.3.8-.1.5.2l-8 7.2-.3 3z"/></svg>',
    linkedin:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5M3 9h4v12H3zm7 0h3.8v1.7h.05a4.2 4.2 0 0 1 3.75-2c4 0 4.75 2.6 4.75 6V21h-4v-5.6c0-1.35-.02-3.1-1.9-3.1s-2.2 1.5-2.2 3v5.7h-4z"/></svg>',
    link:      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3A5 5 0 0 0 13.5 3.5l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3A5 5 0 0 0 10.5 20.5l1.7-1.7"/></svg>',
};
