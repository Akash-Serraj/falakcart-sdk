import FalakElement from '../base.js';

/**
 * <falak-newsletter></falak-newsletter>
 * <falak-newsletter button-text="Join"></falak-newsletter>
 *
 * The mailing-list opt-in: one email field, one button, one status line.
 *
 * Posts through `falak.newsletter.subscribe()`, which owns the endpoint and
 * the events — this element owns only the form. Public, like the endpoint: a
 * guest subscribing is the whole point of a newsletter form.
 *
 * THE MARKUP IS THE THEME'S IF IT WANTS IT — the same bargain
 * <falak-contact-form> strikes. A theme that needs its own design writes a
 * form as this element's children and the component wires it up instead of
 * rendering anything:
 *
 *     <falak-newsletter>
 *         <form class="my-newsletter">
 *             <input name="email" type="email" required>
 *             <button type="submit">Subscribe</button>
 *             <p data-status hidden></p>
 *         </form>
 *     </falak-newsletter>
 *
 * Reserved hooks, all optional:
 *
 *     [name="email"]  the address field — the one hook that must exist
 *     [data-status]   where progress, success and failure lines are written.
 *                     aria-live, written by the component, so a screen reader
 *                     hears the outcome without focus moving
 *
 * Validation reads in the STORE'S language, not the browser's: the form is
 * novalidate and the component writes its own messages through the lang
 * table, because a Chrome-in-English tooltip on an Arabic storefront is
 * exactly the seam a theme exists to hide.
 *
 * | Attribute    | Description                                    |
 * | button-text  | overrides the submit label                     |
 * | placeholder  | overrides the field's placeholder              |
 *
 * Events: `subscribed` / `failed` on the element, and the SDK bus carries
 * `newsletter::subscribed` / `newsletter::subscribe.failed` from the domain.
 */
export default class FalakNewsletter extends FalakElement {
    static observedAttributes = ['button-text', 'placeholder'];

    /** Theme-supplied markup wins; the built-in form is the fallback. */
    get ownsMarkup() {
        return !this._adopted;
    }

    render() {
        this.classList.add('f-newsletter');

        // Adopt a theme-written form once, before the first paint would
        // otherwise replace it.
        if (this._adopted === undefined) {
            this._adopted = !!this.querySelector('form');
        }

        if (this._adopted) return;

        const placeholder = this.attr('placeholder')
            || this.trans('footer.newsletter_email');

        this.innerHTML = `
            <form class="f-newsletter__form" novalidate>
                <label class="f-newsletter__label" for="${this.fieldId()}">${this.escape(this.trans('footer.newsletter_email'))}</label>
                <div class="f-newsletter__row">
                    <input class="f-newsletter__input" id="${this.fieldId()}"
                           type="email" name="email" required
                           autocomplete="email" inputmode="email"
                           placeholder="${this.escape(placeholder)}">
                    <button class="f-newsletter__submit" type="submit">
                        ${this.escape(this.attr('button-text') || this.trans('footer.newsletter_submit'))}
                    </button>
                </div>
                <p class="f-newsletter__status" data-status role="status" aria-live="polite" hidden></p>
            </form>`;
    }

    /** Stable per-instance id, so two forms on one page keep separate labels. */
    fieldId() {
        this._fieldId ??= `f-newsletter-${Math.random().toString(36).slice(2, 8)}`;
        return this._fieldId;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'submit', event => {
            const form = event.target.closest('form');
            if (!form || !this.contains(form)) return;

            event.preventDefault();
            this.subscribe(form);
        });
    }

    say(form, message, ok) {
        const status = form.querySelector('[data-status]') || this.querySelector('[data-status]');
        if (!status) return;

        status.hidden = !message;
        status.textContent = message || '';
        status.classList.toggle('is-error', !ok);
    }

    async subscribe(form) {
        const field = form.querySelector('[name="email"]');
        const email = String(field?.value ?? '').trim();

        /*
         * The same shape the browser would enforce, checked here so the
         * message reads in the store's language. Loose on purpose — the
         * server's email:rfc is the real gate, this only catches "not an
         * address at all" before a round trip.
         */
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.say(form, this.trans('footer.newsletter_invalid'), false);
            field?.focus();
            return;
        }

        const button = form.querySelector('[type="submit"]');
        if (button) button.disabled = true;
        this.say(form, this.trans('footer.newsletter_sending'), true);

        try {
            /*
             * withoutNotifier: this form has its own status line, and the
             * global toast saying the same thing at the same moment would
             * announce one subscription twice.
             */
            const result = await this.sdk.api.withoutNotifier(
                () => this.sdk.newsletter.subscribe(email));

            this.say(form, this.trans('footer.newsletter_success'), true);
            form.reset();
            this.emit('subscribed', { email, ...result });
        } catch (error) {
            const message = error?.messageLang || error?.message
                || this.trans('footer.newsletter_failed');

            this.say(form, message, false);
            this.emit('failed', { error });
        } finally {
            if (button) button.disabled = false;
        }
    }
}
