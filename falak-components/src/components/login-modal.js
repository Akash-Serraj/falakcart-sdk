import FalakElement from '../base.js';

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
 */
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
        this.setState('step', 'phone');

        // The gated-action primitive announces here; nothing else has to know
        // this element exists.
        this._off = this.sdk.event.on('auth::required', () => this.open());
        this._offOpen = this.sdk.event.on('login::open', () => this.open());
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
            <falak-modal id="falak-login" width="sm" ${this.visible ? 'visible' : ''}
                         modal-title="${this.escape(this.trans('auth.sign_in'))}"
                         sub-title="${this.escape(step === 'phone' ? this.trans('auth.phone_hint') : this.trans('auth.code_hint', { phone: this.phone }))}">
                ${step === 'phone' ? this.phoneStep() : this.codeStep()}
            </falak-modal>`;

        this._modal = this.querySelector('falak-modal');
    }

    phoneStep() {
        return `
            <form class="f-login__form" data-step="phone" novalidate>
                <label class="f-login__label" for="falak-login-phone">${this.escape(this.trans('auth.phone'))}</label>
                <input class="f-login__input" id="falak-login-phone" name="phone"
                       type="tel" inputmode="tel" autocomplete="tel" dir="ltr"
                       value="${this.escape(this.phone)}"
                       placeholder="05xxxxxxxx" required>
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
                       type="text" inputmode="numeric" autocomplete="one-time-code" dir="ltr"
                       maxlength="6" pattern="\\d{6}" placeholder="------" required>
                ${this._devOtp ? `<p class="f-login__hint">${this.escape(this.trans('auth.dev_code', { code: this._devOtp }))}</p>` : ''}
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
        });

        // A closed modal must not leave a half-finished code step behind for
        // the next time it opens.
        this.listen(this, 'modal-close', () => this.toPhoneStep());
    }

    /* --------------------------------------------------------------- steps */

    async submitPhone(form) {
        const phone = String(new FormData(form).get('phone') || '').trim();

        if (!phone) return this.showError(form, this.trans('auth.phone_required'));

        await this.withButton(form, async () => {
            const response = await this.sdk.auth.sendOtp(phone);

            this.phone = phone;

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
            this.startCountdown();
        } catch (error) {
            button.disabled = false;
        }
    }

    /* ------------------------------------------------------------- helpers */

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

        const button = this.querySelector('[data-resend]');
        if (!button) return;

        let left = FalakLoginModal.RESEND_SECONDS;
        const label = this.trans('auth.resend');

        const tick = () => {
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
