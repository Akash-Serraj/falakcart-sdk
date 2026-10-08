import FalakElement from '../base.js';
import { COUNTRIES, countryForPhone, countryName } from '../lib/countries.js';

/**
 * <falak-login-modal></falak-login-modal>
 *
 * Placed once, usually in the layout. Opens itself on `auth::required`, which
 * is what `falak.auth.requireLoginThen()` dispatches — so a gated action never
 * needs a reference to this element.
 *
 * Two steps, because the platform authenticates by one-time password: a phone
 * number, then a six-digit code. There is no password and no separate register
 * screen — `send-otp` creates the customer if the number is new.
 *
 * The phone step offers every country the platform knows (lib/countries.js,
 * mirrored from the admin's list), KSA first as the home market and the OTP
 * gateway's primary route, then the GCC, the Arab League and the rest.
 */
const DEFAULT_DIAL = '+966';

/** Flag bitmaps, the same source the admin's phone fields use. */
const flagUrl = (code, width) => `https://flagcdn.com/w${width}/${String(code).toLowerCase()}.png`;

export default class FalakLoginModal extends FalakElement {
    static observedAttributes = ['visible'];
    static RESEND_SECONDS = 45;

    get step() { return this.attr('data-step', 'phone'); }
    get visible() { return this.hasAttribute('visible'); }

    /* ------------------------------------------------------ imperative API */

    open() { this.setAttribute('visible', ''); return this; }
    close() { this.removeAttribute('visible'); return this; }

    setup() {
        this.phone = this.sdk.storage.getWithTTL('auth.pending_phone') || '';

        // A restored pending number splits back into dial + local so the
        // selector shows what was actually chosen, not the default.
        const known = countryForPhone(this.phone);
        this.country = known || COUNTRIES[0];
        this.dial = this.country.dial;
        this.local = known ? this.phone.slice(known.dial.length) : this.phone;

        this.setState('step', 'phone');

        // The gated-action primitive announces here; nothing else has to know
        // this element exists.
        this._off = this.sdk.event.on('auth::required', () => this.open());
        this._offOpen = this.sdk.event.on('login::open', () => this.open());
        // A sign-in completed anywhere (another modal, a script) ends this one.
        this._offIn = this.sdk.event.on('auth::logged.in', () => this.close());
    }

    disconnectedCallback() {
        this._off?.();
        this._offOpen?.();
        this.stopCountdown();
        super.disconnectedCallback();
    }

    render() {
        const step = this.step;

        this.classList.add('f-login');

        this.innerHTML = `
            <falak-modal id="falak-login" width="sm" static ${this.visible ? 'visible' : ''}
                         modal-title="${this.escape(this.trans('auth.sign_in'))}"
                         sub-title="${this.escape(step === 'phone' ? this.trans('auth.phone_hint') : this.trans('auth.code_hint', { phone: this.phone }))}">
                ${step === 'phone' ? this.phoneStep() : this.codeStep()}
            </falak-modal>`;

        this._modal = this.querySelector('falak-modal');
    }

    /**
     * The country picker: a flag-and-code button that opens a searchable list
     * of every country — a native <select> cannot show flags, and 215 rows
     * want a search box. The hidden "dial" input is what the form submits,
     * so submitPhone() reads it exactly as it read the old <select>.
     */
    dialPicker() {
        const locale = this.sdk.lang.locale;
        const options = COUNTRIES.map(country => `
            <li class="f-login__dial-option" role="option" tabindex="-1"
                data-dial-option="${country.dial}" data-code="${country.code}"
                aria-selected="${country.code === this.country.code ? 'true' : 'false'}"
                data-search="${this.escape(`${country.code} ${country.dial} ${country.nameEn} ${country.nameAr}`.toLowerCase())}">
                ${this.flag(country.code)}
                <span class="f-login__dial-option-code">${country.dial}</span>
                <span class="f-login__dial-option-name">${this.escape(countryName(country, locale))}</span>
            </li>`).join('');

        return `
            <div class="f-login__dial" data-dial>
                <input type="hidden" name="dial" value="${this.dial}">
                <button type="button" class="f-login__dial-toggle" data-dial-toggle dir="ltr"
                        aria-haspopup="listbox" aria-expanded="false"
                        aria-label="${this.escape(this.trans('auth.dial_code'))}">
                    ${this.flag(this.country.code)}
                    <span class="f-login__dial-code" data-dial-code>${this.dial}</span>
                    <span class="f-login__dial-chevron" aria-hidden="true"></span>
                </button>
                <div class="f-login__dial-menu" data-dial-menu hidden>
                    <div class="f-login__dial-search">
                        <input type="search" class="f-login__dial-search-input" data-dial-search
                               placeholder="${this.escape(this.searchPlaceholder())}" autocomplete="off"
                               aria-label="${this.escape(this.searchPlaceholder())}">
                    </div>
                    <ul class="f-login__dial-list" role="listbox" data-dial-list>${options}</ul>
                </div>
            </div>`;
    }

    flag(code) {
        return `<img class="f-login__dial-flag" src="${flagUrl(code, 40)}" srcset="${flagUrl(code, 80)} 2x"
                     width="24" height="18" alt="" loading="lazy" decoding="async"
                     onerror="this.style.visibility='hidden'">`;
    }

    /**
     * Themes own the strings; one shipped before this key existed still gets
     * a sensible placeholder rather than the raw key.
     */
    searchPlaceholder() {
        const text = this.trans('auth.search_country');
        if (text !== 'auth.search_country') return text;
        return this.sdk.lang.locale === 'ar' ? 'ابحث عن دولة' : 'Search country';
    }

    /* ------------------------------------------------------ country picker */

    toggleDial(open) {
        const menu = this.querySelector('[data-dial-menu]');
        const toggle = this.querySelector('[data-dial-toggle]');
        if (!menu || !toggle) return;

        const show = open ?? menu.hidden;
        if (show === !menu.hidden) return;
        menu.hidden = !show;
        toggle.setAttribute('aria-expanded', show ? 'true' : 'false');

        if (show) {
            const search = menu.querySelector('[data-dial-search]');
            if (search) { search.value = ''; this.filterDial(''); search.focus(); }
            menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
        }
    }

    filterDial(query) {
        const needle = String(query || '').trim().toLowerCase();
        this.querySelectorAll('[data-dial-option]').forEach(option => {
            option.hidden = Boolean(needle) && !option.dataset.search.includes(needle);
        });
        this.querySelector('[data-active]')?.removeAttribute('data-active');
    }

    chooseDial(option) {
        const country = COUNTRIES.find(entry => entry.code === option.dataset.code);
        if (!country) return;

        this.country = country;
        this.dial = country.dial;

        const toggle = this.querySelector('[data-dial-toggle]');
        this.querySelector('input[name="dial"]').value = country.dial;
        toggle.querySelector('[data-dial-code]').textContent = country.dial;
        toggle.querySelector('.f-login__dial-flag').outerHTML = this.flag(country.code);
        this.querySelectorAll('[data-dial-option]').forEach(entry => {
            entry.setAttribute('aria-selected', entry === option ? 'true' : 'false');
        });

        this.toggleDial(false);
        this.querySelector('#falak-login-phone')?.focus();
    }

    /** Arrow keys walk the visible rows; Enter picks the highlighted one. */
    moveDial(delta) {
        const visible = [...this.querySelectorAll('[data-dial-option]')].filter(option => !option.hidden);
        if (!visible.length) return;

        const current = this.querySelector('[data-active]');
        const index = current ? visible.indexOf(current) : -1;
        const next = visible[Math.min(visible.length - 1, Math.max(0, index + delta))];

        current?.removeAttribute('data-active');
        next.setAttribute('data-active', '');
        next.scrollIntoView({ block: 'nearest' });
    }

    phoneStep() {
        return `
            <form class="f-login__form" data-step="phone" novalidate>
                <label class="f-login__label" for="falak-login-phone">${this.escape(this.trans('auth.phone'))}</label>
                <div class="f-login__phone-row">
                    ${this.dialPicker()}
                    <input class="f-login__input" id="falak-login-phone" name="phone"
                           type="tel" inputmode="tel" autocomplete="tel" dir="ltr" data-digits="phone"
                           value="${this.escape(this.local)}"
                           placeholder="5xxxxxxxx" required>
                </div>
                <p class="f-login__error" data-error hidden></p>
                <falak-button type="submit" color="primary" width="wide" loader-position="center">
                    ${this.escape(this.trans('auth.send_code'))}
                </falak-button>
            </form>`;
    }

    codeStep() {
        return `
            <form class="f-login__form" data-step="code" novalidate>
                <label class="f-login__label" for="falak-login-code">${this.escape(this.trans('auth.code'))}</label>
                <input class="f-login__input f-login__input--code" id="falak-login-code" name="otp"
                       type="text" inputmode="numeric" autocomplete="one-time-code" dir="ltr" data-digits="code"
                       maxlength="6" pattern="\\d{6}" placeholder="------" required>
                ${this.devHint()}
                <p class="f-login__error" data-error hidden></p>
                <falak-button type="submit" color="primary" width="wide" loader-position="center">
                    ${this.escape(this.trans('auth.verify'))}
                </falak-button>
                <div class="f-login__actions">
                    <button type="button" class="f-login__link" data-back>${this.escape(this.trans('auth.change_number'))}</button>
                    <button type="button" class="f-login__link" data-resend disabled>${this.escape(this.trans('auth.resend'))}</button>
                </div>
            </form>`;
    }

    afterRender() {
        if (this.step === 'code') {
            this.startCountdown();
            setTimeout(() => this.querySelector('#falak-login-code')?.focus(), 80);
        }

        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'submit', event => {
            event.preventDefault();
            const step = event.target.dataset.step;
            step === 'phone' ? this.submitPhone(event.target) : this.submitCode(event.target);
        });

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-back]')) this.toPhoneStep();
            if (event.target.closest('[data-resend]')) this.resend();
            if (event.target.closest('[data-dial-toggle]')) this.toggleDial();
            const option = event.target.closest('[data-dial-option]');
            if (option) this.chooseDial(option);
        });

        this.listen(this, 'input', event => {
            if (event.target.matches('[data-dial-search]')) this.filterDial(event.target.value);
            if (event.target.matches('[data-digits]')) this.keepDigits(event.target);
        });

        this.listen(this, 'keydown', event => {
            if (!event.target.closest('[data-dial]')) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.toggleDial(false);
                this.querySelector('[data-dial-toggle]')?.focus();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (this.querySelector('[data-dial-menu]')?.hidden) this.toggleDial(true);
                this.moveDial(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter' && event.target.matches('[data-dial-search]')) {
                event.preventDefault();
                const pick = this.querySelector('[data-active]')
                    || [...this.querySelectorAll('[data-dial-option]')].find(option => !option.hidden);
                if (pick) this.chooseDial(pick);
            }
        });

        // A click anywhere else — the number field, the modal backdrop — closes
        // the list, the way a native select's popup would.
        this.listen(document, 'pointerdown', event => {
            if (!event.target.closest?.('[data-dial]')) this.toggleDial(false);
        });

        // A closed modal must not leave a half-finished code step behind for
        // the next time it opens. Dropping our own `visible` first is what
        // actually lets it close: toPhoneStep re-renders, and a wrapper still
        // marked visible would re-create the inner modal open again.
        this.listen(this, 'modal-close', () => {
            this.removeAttribute('visible');
            this.toPhoneStep();
        });
    }

    /* --------------------------------------------------------------- steps */

    async submitPhone(form) {
        const data = new FormData(form);
        const dial = String(data.get('dial') || this.dial || DEFAULT_DIAL);
        let local = String(data.get('phone') || '').trim().replace(/[\s-]/g, '');

        if (!local) return this.showError(form, this.trans('auth.phone_required'));

        /*
         * Shoppers type what they dial: 05xxxxxxxx locally, or a full +966…
         * pasted from somewhere. Compose one E.164-ish number either way —
         * a number that already carries a country code wins over the select.
         */
        const phone = local.startsWith('+') || local.startsWith('00')
            ? local
            : dial + local.replace(/^0+/, '');

        await this.withButton(form, async () => {
            const response = await this.sdk.auth.sendOtp(phone);

            this.phone = phone;
            this.dial = dial;
            this.local = local.startsWith('+') || local.startsWith('00') ? local : local.replace(/^0+/, '');

            // Local development returns the code in the body so nobody has to
            // read an SMS log; production omits it.
            this._devOtp = response?.otp || null;

            this.setState('step', 'code');
            this.render();
            this.afterRender();
        });
    }

    async submitCode(form) {
        const otp = String(new FormData(form).get('otp') || '').trim();

        if (!/^\d{6}$/.test(otp)) return this.showError(form, this.trans('auth.code_invalid'));

        await this.withButton(form, async () => {
            await this.sdk.auth.verifyOtp(this.phone, otp);

            this.close();
            this.toPhoneStep();

            // Server-rendered markup still says "guest" — the header, the
            // account links, any gated price. A reload is the honest way to
            // catch all of it up.
            window.location.reload();
        });
    }

    toPhoneStep() {
        this.stopCountdown();
        this._devOtp = null;
        this.setState('step', 'phone');
        this.render();
    }

    async resend() {
        const button = this.querySelector('[data-resend]');
        if (!button || button.disabled) return;

        button.disabled = true;

        try {
            const response = await this.sdk.auth.sendOtp(this.phone);
            this._devOtp = response?.otp || null;
            this.refreshDevHint();
            this.startCountdown();
        } catch (error) {
            button.disabled = false;
        }
    }

    /**
     * The development-only code hint. Shown when the server put the OTP in
     * its response (local environments do; production never does), and
     * refreshed in place on resend so the hint names the code that is now
     * valid — the half-typed input and the countdown are left alone.
     */
    devHint() {
        if (!this._devOtp) return '';
        return `<p class="f-login__hint" data-dev-code>${this.escape(this.trans('auth.dev_code', { code: this._devOtp }))}</p>`;
    }

    refreshDevHint() {
        const form = this.querySelector('form[data-step="code"]');
        if (!form) return;

        const current = form.querySelector('[data-dev-code]');
        const markup = this.devHint();

        if (current && markup) current.outerHTML = markup;
        else if (current) current.remove();
        else if (markup) form.querySelector('[data-error]')?.insertAdjacentHTML('beforebegin', markup);
    }

    /* ------------------------------------------------------------- helpers */

    /**
     * Phone and code fields take digits only, whatever the keyboard offers.
     * `inputmode` only suggests a keypad; a desktop keyboard, a paste, or
     * autofill can still drop letters in, so the value is scrubbed on every
     * input. The phone field keeps one leading "+" so a pasted +966… still
     * works the way submitPhone() expects; spaces and dashes go.
     */
    keepDigits(field) {
        const raw = field.value;
        const plus = field.dataset.digits === 'phone' && raw.trimStart().startsWith('+') ? '+' : '';
        // Arabic-Indic and Eastern Arabic-Indic digits become ASCII, so an
        // Arabic keyboard is not silently blanked.
        const ascii = raw.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, ch => String(ch.charCodeAt(0) % 16 % 10));
        const clean = plus + ascii.replace(/\D/g, '');
        if (clean === raw) return;

        const caret = Math.max(0, (field.selectionStart ?? clean.length) - (raw.length - clean.length));
        field.value = clean;
        try { field.setSelectionRange(caret, caret); } catch { /* type=tel supports it; be safe anyway */ }
    }

    /**
     * Runs an async submit with the form's button in its loading state and any
     * failure rendered inline rather than as a toast — a form error belongs
     * next to the field that caused it.
     */
    async withButton(form, work) {
        const button = form.querySelector('falak-button');

        this.clearError(form);
        button?.load?.();
        button?.disable?.();

        try {
            await this.sdk.api.withoutNotifier(work);
        } catch (error) {
            this.showError(form, error.message || this.trans('common.load_failed'));
        } finally {
            button?.stop?.();
            button?.enable?.();
        }
    }

    showError(form, message) {
        const box = form.querySelector('[data-error]');
        if (!box) return;

        box.textContent = message;
        box.hidden = false;
    }

    clearError(form) {
        const box = form.querySelector('[data-error]');
        if (box) box.hidden = true;
    }

    /** Resend stays disabled for a spell so a stuck SMS is not retried in a loop. */
    startCountdown() {
        this.stopCountdown();

        if (!this.querySelector('[data-resend]')) return;

        let left = FalakLoginModal.RESEND_SECONDS;
        const label = this.trans('auth.resend');

        /*
         * The button is looked up on every tick, never captured: <falak-modal>
         * re-creates its children from markup when it renders, so a node held
         * from before that rebuild is detached — the timer would count down on
         * an element nobody can see while the visible button sat frozen.
         */
        const tick = () => {
            const button = this.querySelector('[data-resend]');
            if (!button) { this.stopCountdown(); return; }

            if (left <= 0) {
                button.disabled = false;
                button.textContent = label;
                this.stopCountdown();
                return;
            }

            button.disabled = true;
            button.textContent = `${label} (${this.sdk.number(left)})`;
            left--;
        };

        tick();
        this._timer = setInterval(tick, 1000);
    }

    stopCountdown() {
        clearInterval(this._timer);
        this._timer = null;
    }

    onAttributeChange(name) {
        if (name !== 'visible') return;
        this.visible ? this._modal?.open?.() : this._modal?.close?.();
    }
}
