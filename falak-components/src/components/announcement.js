import FalakElement from '../base.js';

/**
 * <falak-announcement enabled text="Free shipping over 200" dismissible></falak-announcement>
 * <falak-announcement enabled declarations></falak-announcement>
 *
 * The strip above the header — the legacy storefront's top bar, made a
 * platform component so every theme gets the same behaviour.
 *
 * What it shows, first match wins:
 *   1. `declarations` — the merchant's active dashboard announcements (ads)
 *      for this page, joined into one strip that scrolls. This is exactly
 *      the old HeaderTopBar algorithm: active + targeted at the page, joined
 *      with a wide " | " separator, marquee in the page's direction.
 *   2. `text` — the customizer message (optionally a `link`), shown only when
 *      `enabled`. Scrolls only if it is wider than the bar.
 *   3. "Welcome to {store}" — the old fallback, shown only when `enabled`.
 *   Nothing matching → the element hides itself, so a theme can always
 *   render it and let the data decide.
 *
 * `dismissible` adds a close button; the dismissal is remembered PER TEXT,
 * so a new message reappears for everyone.
 *
 * | attribute    | role                                                      |
 * | enabled      | the merchant switched the bar on (customizer)             |
 * | text / link  | the customizer message                                    |
 * | declarations | also load dashboard announcements for this page           |
 * | page         | override the page key used to target declarations         |
 * | dismissible  | show a close button; dismissal remembered per message     |
 * | speed        | marquee speed in px/s (default 60)                        |
 */
const SEPARATOR = '     |     ';

export default class FalakAnnouncement extends FalakElement {
    static observedAttributes = ['enabled', 'text', 'link', 'declarations', 'page', 'dismissible', 'speed'];

    get enabled() { return this.boolAttr('enabled'); }
    get text() { return String(this.attr('text', '') || '').trim(); }
    get link() { return String(this.attr('link', '') || '').trim(); }
    get dismissible() { return this.boolAttr('dismissible'); }
    get wantsDeclarations() { return this.boolAttr('declarations'); }
    get speed() { return Math.max(20, this.numAttr('speed', 60)); }

    /** Declarations target pages by key; the home page's slug is "index". */
    get pageKey() {
        const slug = this.attr('page') || this.sdk.config.get('page.slug') || 'home';

        return slug === 'index' ? 'home' : slug;
    }

    async setup() {
        this.ads = this.wantsDeclarations ? await this.loadDeclarations() : [];
    }

    /**
     * Active declarations aimed at this page. An empty `ad_pages` means
     * everywhere. Quiet on failure: an announcement bar must never surface an
     * error toast, and the fallbacks below still have something to say.
     */
    async loadDeclarations() {
        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.api.request('declarations'));
            const rows = Array.isArray(response)
                ? response
                : (response?.declarations ?? response?.data ?? []);

            return (Array.isArray(rows) ? rows : [])
                .filter(ad => String(ad?.status ?? 'active') === 'active')
                .filter(ad => {
                    const pages = Array.isArray(ad?.ad_pages) ? ad.ad_pages : [];

                    return !pages.length || pages.includes(this.pageKey) || pages.includes('all');
                })
                .map(ad => String(ad?.ad_content ?? '').trim())
                .filter(Boolean);
        } catch (error) {
            return [];
        }
    }

    /* ------------------------------------------------------------- render */

    message() {
        if (this.ads?.length) {
            return { text: this.ads.join(SEPARATOR), link: null, scroll: true };
        }

        if (!this.enabled) return null;

        if (this.text) return { text: this.text, link: this.link || null, scroll: false };

        const store = this.sdk.config.get('store.name', '');

        return { text: this.trans('announcement.welcome', { store }), link: null, scroll: false };
    }

    dismissKey(text) {
        return `announce.dismissed.${text.replace(/\s+/g, ' ').trim().slice(0, 160)}`;
    }

    render() {
        this.classList.add('f-announce');

        const message = this.message();
        const dismissed = message && this.dismissible && !!this.sdk.storage.get(this.dismissKey(message.text));

        if (!message || dismissed) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.setAttribute('dir', this.sdk.lang.isRtl ? 'rtl' : 'ltr');
        this.classList.toggle('f-announce--scroll', message.scroll);

        /*
         * dir="auto" on the text, not just on the host.
         *
         * The bar's direction follows the page's language, which is right for
         * the layout. The message itself may not be in that language though —
         * a declaration is stored once and shown on every locale — and Arabic
         * text laid out left-to-right puts its trailing punctuation and emoji
         * at the wrong end and reads as broken. "auto" lets the browser take
         * the direction from the text's own first strong character, so a
         * message renders correctly whatever page it lands on.
         */
        const content = message.link
            ? `<a class="f-announce__link" dir="auto" href="${this.escape(message.link)}">${this.escape(message.text)}</a>`
            : `<span class="f-announce__text" dir="auto">${this.escape(message.text)}</span>`;

        this.innerHTML = `
            <div class="f-announce__inner">
                ${message.scroll
                    ? `<div class="f-announce__track" aria-live="off">${content}${content}</div>`
                    : content}
                ${this.dismissible
                    ? `<button type="button" class="f-announce__close" data-dismiss
                               aria-label="${this.escape(this.trans('common.close'))}">&times;</button>`
                    : ''}
            </div>`;

        this._message = message;
    }

    afterRender() {
        this.fitMarquee();

        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (!event.target.closest('[data-dismiss]')) return;

            if (this._message) this.sdk.storage.set(this.dismissKey(this._message.text), 1);

            this.setAttribute('hidden', '');
            this.emit('dismissed', { text: this._message?.text });
        });

        // A message that fits on desktop may overflow on a phone.
        this._resize = () => this.fitMarquee();
        window.addEventListener('resize', this._resize);
    }

    disconnectedCallback() {
        window.removeEventListener('resize', this._resize);
        super.disconnectedCallback();
    }

    /**
     * Declarations always scroll (their text is long by construction). A
     * plain message scrolls only when it does not fit, and the loop's
     * duration comes from its width so long and short texts move at the
     * same speed instead of the same period.
     */
    fitMarquee() {
        if (!this._message || this.hasAttribute('hidden')) return;

        const inner = this.querySelector('.f-announce__inner');
        if (!inner) return;

        let track = this.querySelector('.f-announce__track');

        if (!track && !this._message.scroll) {
            const content = inner.querySelector('.f-announce__text, .f-announce__link');

            if (content && content.scrollWidth > inner.clientWidth) {
                track = document.createElement('div');
                track.className = 'f-announce__track';
                track.setAttribute('aria-live', 'off');
                track.append(content.cloneNode(true), content.cloneNode(true));
                content.replaceWith(track);
                this.classList.add('f-announce--scroll');
            }
        }

        if (!track) return;

        // Half the track is one copy of the message; that is the distance one
        // loop travels.
        const distance = track.scrollWidth / 2;
        this.style.setProperty('--f-announce-duration', `${Math.max(6, distance / this.speed)}s`);
    }
}
