import FalakElement from '../base.js';

/**
 * <falak-contact-links></falak-contact-links>
 * <falak-contact-links only="phone,email"></falak-contact-links>
 * <falak-contact-links labels="false"></falak-contact-links>
 *
 * How to reach the shop: the footer's row of contact chips.
 *
 * The sibling of <falak-social>, and deliberately a separate component rather
 * than a mode of it — following a shop and phoning it are different acts, they
 * carry different labels, and a store commonly has one without the other. The
 * split also lets a theme put them in different rows, which is what the
 * reference footer does.
 *
 * Values come from `store.contact`, which the platform puts in config from
 * BasicSettings, so this costs no request and renders with the page. A channel
 * the merchant left empty is absent from that object and therefore from the
 * row; when every one of them is empty the element removes itself rather than
 * leaving an empty strip in the footer.
 *
 * | Attribute | Description                                                    |
 * | only      | comma-separated channels, in the order given; default is all   |
 * | labels    | "false" renders icon-only chips                                |
 */
export default class FalakContactLinks extends FalakElement {
    static observedAttributes = ['only', 'labels'];

    /**
     * Channel -> how to turn a stored value into an href.
     *
     * Order here is the default rendering order, and it runs from the most
     * direct to the least: a shopper looking for help wants the phone before
     * the Telegram handle.
     */
    static CHANNELS = {
        mobile: { label: 'footer.mobile', href: value => `tel:${digits(value)}` },
        phone: { label: 'footer.phone', href: value => `tel:${digits(value)}` },
        email: { label: 'footer.email', href: value => `mailto:${value}` },
        whatsapp: { label: 'footer.whatsapp', href: value => `https://wa.me/${digits(value)}` },
        telegram: { label: 'footer.telegram', href: value => `https://t.me/${String(value).replace(/^@/, '')}` },
    };

    get showLabels() { return this.attr('labels') !== 'false'; }

    get links() {
        const contact = this.sdk.config.get('store.contact', {}) || {};

        const only = this.attr('only');
        const order = only
            ? only.split(',').map(name => name.trim()).filter(Boolean)
            : Object.keys(FalakContactLinks.CHANNELS);

        return order
            .filter(name => FalakContactLinks.CHANNELS[name])
            .map(name => ({
                name,
                value: String(contact[name] ?? '').trim(),
                label: this.trans(FalakContactLinks.CHANNELS[name].label),
            }))
            .filter(link => link.value !== '');
    }

    render() {
        const links = this.links;

        /*
         * Nothing to show removes the element from the layout entirely. A
         * footer row that collapses to a bare rule is the rendering bug this
         * guard exists to avoid — the same rule <falak-apps-icons> follows.
         */
        if (!links.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.classList.add('f-contact-links');

        this.innerHTML = `
            <ul class="f-contact-links__list">
                ${links.map(link => `
                    <li>
                        <a class="f-contact-links__chip" href="${this.escape(FalakContactLinks.CHANNELS[link.name].href(link.value))}"
                           ${EXTERNAL.includes(link.name) ? 'target="_blank" rel="noopener"' : ''}
                           title="${this.escape(link.value)}">
                            <span class="f-contact-links__icon">${ICONS[link.name]}</span>
                            ${this.showLabels
                                ? `<span class="f-contact-links__label">${this.escape(link.label)}</span>`
                                /* Icon-only still needs a name for anyone not
                                   looking at it. */
                                : `<span class="sr-only">${this.escape(link.label)}</span>`}
                        </a>
                    </li>`).join('')}
            </ul>`;
    }
}

/** Phone numbers are stored however the merchant typed them; tel:/wa.me want digits. */
function digits(value) {
    return String(value).replace(/\D/g, '');
}

/** The two that leave the site. tel: and mailto: hand off to the OS instead. */
const EXTERNAL = ['whatsapp', 'telegram'];

/*
 * Inline SVG rather than an icon font or a CDN image, for the reason
 * <falak-social> gives: the CSP on a merchant page is not ours to widen, and a
 * missing icon in a footer is a support ticket. currentColor throughout so a
 * dark footer needs no second set.
 */
const ICONS = {
    mobile: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.8a2 2 0 0 1 1.7 2Z"/></svg>',
    email: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2a9.9 9.9 0 0 0-8.5 15L2 22l5.2-1.4A9.9 9.9 0 1 0 12 2m0 1.8a8.1 8.1 0 1 1-4.1 15.1l-.3-.2-3.1.8.8-3-.2-.3A8.1 8.1 0 0 1 12 3.8m-3.1 4c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.7 4.2 3.7 2 .8 2.4.7 2.9.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.2.1-1.3l-.6-.3-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.8 6.8 0 0 1-2-1.2 7.5 7.5 0 0 1-1.4-1.7c-.1-.2 0-.4.1-.5l.4-.5.3-.4v-.5l-.7-1.6c-.2-.4-.4-.4-.5-.4z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M21.7 4.3 2.9 11.6c-.9.4-.9 1.1-.2 1.3l4.8 1.5 1.8 5.5c.2.6.4.6.9.2l2.6-2.5 4.6 3.4c.8.5 1.4.2 1.6-.8l3-13.9c.3-1.2-.5-1.7-1.3-1.4M8.8 14l9.4-5.9c.4-.3.8-.1.5.2l-8 7.2-.3 3z"/></svg>',
};
