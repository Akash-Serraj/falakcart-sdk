import FalakElement from '../base.js';

/**
 * <falak-trust-badges>          commercial register / freelance / VAT, from config
 * <falak-trust-badges dark>     light marks for a dark footer
 * <falak-trust-badges logo-vat_number="…/vat.png">   the real mark instead of the seal
 * <falak-trust-badges documents='{"vat_number":"3001…"}'>   theme-held numbers over the store's
 *
 * In Saudi Arabia a store must display its commercial register or freelance
 * certificate number, so this is a compliance surface rather than decoration.
 *
 * Salla's equivalent walks up the ancestor chain forcing `display: flex
 * !important` on anything that hides it. That is not reproduced here: fighting a
 * merchant's own stylesheet from JavaScript breaks layouts in ways nobody can
 * debug. The component instead reports a hidden badge through the bus, so the
 * platform can surface it to the merchant as an actual warning.
 */
export default class FalakTrustBadges extends FalakElement {
    static observedAttributes = [
        'dark', 'hide-title', 'documents',
        'logo-company_registration_number', 'logo-freelance_number',
        'logo-vat_number', 'logo-business_center_certificate',
    ];

    /**
     * The four fields of BasicSettings.documents_number, which the platform
     * puts in config as `store.settings.documents` with empty values already
     * stripped. A merchant fills in whichever apply to their entity type — an
     * individual has a freelance number, a company has a registration number —
     * so every one of them is optional and the component renders what is there.
     */
    static DOCUMENTS = {
        company_registration_number: 'footer.commercial_register',
        freelance_number: 'footer.freelance_licence',
        vat_number: 'footer.vat_number',
        business_center_certificate: 'footer.business_certificate',
    };

    get badges() {
        /*
         * Store record first, theme settings on top — a blank theme field must
         * not erase a number the merchant entered in Basic settings, so only
         * filled values from the attribute take effect.
         */
        const fromStore = this.sdk.config.get('store.settings.documents', {}) || {};
        const fromTheme = this.jsonAttr('documents', null) || {};
        const documents = { ...fromStore };

        Object.entries(fromTheme).forEach(([key, value]) => {
            if (value !== null && value !== undefined && String(value).trim() !== '') documents[key] = value;
        });

        return Object.entries(FalakTrustBadges.DOCUMENTS)
            .map(([key, translationKey]) => ({
                key,
                value: documents[key],
                label: this.trans(translationKey),
                // The official mark for this certificate, when the theme ships
                // one. Absent, the badge keeps the seal it always had.
                logo: this.attr(`logo-${key}`) || null,
            }))
            .filter(badge => badge.value !== null && badge.value !== undefined && badge.value !== '');
    }

    render() {
        const badges = this.badges;

        if (!badges.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.classList.add('f-trust');
        this.classList.toggle('f-trust--dark', this.boolAttr('dark'));

        this.innerHTML = `
            <ul class="f-trust__list">
                ${badges.map(badge => `
                    <li class="f-trust__item f-trust__item--${badge.key}">
                        ${badge.logo
                            ? `<img class="f-trust__logo" src="${this.escape(badge.logo)}" alt="" loading="lazy" data-trust-logo>`
                            : `<span class="f-trust__glyph" aria-hidden="true">${SEAL}</span>`}
                        <span class="f-trust__text">
                            <span class="f-trust__label">${this.escape(badge.label)}</span>
                            <span class="f-trust__value">${this.escape(badge.value)}</span>
                        </span>
                    </li>`).join('')}
            </ul>`;
    }

    afterRender() {
        /*
         * A logo that does not load — a file the theme has not shipped yet, a
         * CDN hiccup — gives way to the seal rather than the browser's broken
         * image glyph. Wired here rather than inline so no handler text goes
         * through innerHTML.
         */
        this.querySelectorAll('img[data-trust-logo]').forEach(img => {
            img.addEventListener('error', () => {
                const seal = document.createElement('span');
                seal.className = 'f-trust__glyph';
                seal.setAttribute('aria-hidden', 'true');
                seal.innerHTML = SEAL;
                img.replaceWith(seal);
            }, { once: true });
        });

        // Reported once, after layout has settled. A merchant hiding a required
        // badge is a compliance problem the platform should know about — but
        // that is the platform's call to make, not this component's.
        if (this._checked) return;
        this._checked = true;

        setTimeout(() => {
            if (!this.isConnected || this.hasAttribute('hidden')) return;

            const box = this.getBoundingClientRect();
            if (box.width > 0 && box.height > 0) return;

            this.sdk.logger.warn('falak-trust-badges: rendered but not visible — a required badge may be hidden by theme CSS.');
            this.emitBus('compliance::badge.hidden', { component: 'falak-trust-badges' });
        }, 800);
    }
}

const SEAL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 2.7l7.5 3v5.6c0 4.4-3.1 8.2-7.5 9.4-4.4-1.2-7.5-5-7.5-9.4V5.7z" stroke-linejoin="round"/><path d="m8.8 11.8 2.2 2.2 4.2-4.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
