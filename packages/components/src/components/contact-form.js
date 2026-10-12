import FalakElement from '../base.js';

const ICONS = {
    user: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>`,
    mail: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>`,
    phone: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.8a2 2 0 0 1 1.7 2Z"/></svg>`,
    bubble: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`,
    hash: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>`,
    clip: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.1 12.3 20a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/></svg>`,
    send: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/></svg>`,
    check: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
};

/**
 * <falak-contact-form></falak-contact-form>
 * <falak-contact-form show-subject show-phone></falak-contact-form>
 * <falak-contact-form show-attachment require-subject></falak-contact-form>
 *
 * The store's "send us a message" form.
 *
 * Posts to POST /api/storefront/contact through `falak.contact.send()`. The
 * endpoint is public — a shopper writing to a shop has not signed in — so
 * unlike the review and question forms there is no sign-in gate here.
 *
 * WHICH FIELDS APPEAR IS THE THEME'S CHOICE, not this component's. Name, email
 * and message are the server's required three and are always rendered; every
 * other field the endpoint accepts is opt-in, so a theme composes the form its
 * design calls for without a second component. Defaults are the three required
 * fields plus phone and subject, which is the common shape.
 *
 * SO IS THE MARKUP. A theme that needs a different design writes its own form
 * as this element's children, and the component wires that up instead of
 * rendering anything — the same bargain <falak-add-product-button> strikes
 * with its label and <falak-slider> with its `items` slot:
 *
 *     <falak-contact-form>
 *         <form class="my-form">
 *             <input name="name" required>
 *             <input name="email" type="email" required>
 *             <textarea name="message" required></textarea>
 *             <p data-error hidden></p>
 *             <button type="submit">Send</button>
 *             <div data-success hidden>Thanks — we'll be in touch.</div>
 *         </form>
 *     </falak-contact-form>
 *
 * Only three hooks are reserved, and every one of them is optional:
 *
 *     [name="…"]     any field the endpoint accepts; the rest is the theme's
 *     [data-error]   where the validation and failure message is written
 *     [data-success] unhidden after a successful send. The form STAYS and is
 *                    reset; nothing is removed, so put this wherever the
 *                    confirmation belongs in the design
 *
 * The attributes above (show-*, require-subject, button-text…) describe the
 * BUILT-IN form and are ignored when the theme supplies its own — the markup
 * already says what it contains.
 *
 * | Attribute        | Description                                              |
 * | show-phone       | mobile number field (default on; use hide-phone to drop) |
 * | hide-phone       | remove the phone field                                   |
 * | show-subject     | subject field (default on; use hide-subject to drop)     |
 * | hide-subject     | remove the subject field                                 |
 * | require-subject  | mark subject required in the browser (server allows it   |
 * |                  | empty, so this is a merchant policy, not a server rule)  |
 * | show-order       | order-number field, for support enquiries                |
 * | show-attachment  | file input; jpg/jpeg/png/pdf up to 5MB                   |
 * | category         | fixed category sent with every message (hidden field)    |
 * | country          | fixed 2-letter country code sent with every message      |
 * | button-text      | overrides the submit label                               |
 * | success-text     | overrides the confirmation message                       |
 *
 * Events: `sent` / `failed` on the element, and the SDK bus carries
 * `contact::sent` / `contact::send.failed` from the domain.
 */
export default class FalakContactForm extends FalakElement {
    static observedAttributes = ['show-subject', 'hide-subject', 'show-phone', 'hide-phone', 'show-attachment', 'show-order'];

    /*
     * Opt-out beats opt-in for the two fields that are on by default: a theme
     * that says nothing gets the common form, one that says hide-phone loses
     * it, and the older `show-subject` markup that predates this default keeps
     * working rather than turning the field off by omission.
     */
    get showPhone() { return !this.boolAttr('hide-phone'); }
    get showSubject() { return !this.boolAttr('hide-subject'); }
    get requireSubject() { return this.boolAttr('require-subject'); }
    get showOrder() { return this.boolAttr('show-order'); }
    get showAttachment() { return this.boolAttr('show-attachment'); }

    setup() {
        this.sent = false;

        /*
         * The theme's own form, captured once - before the first render can
         * replace it, and after the parser has certainly filled these children
         * in.
         *
         * CAPTURED HERE, NOT IN connectedCallback. The SDK defines its elements
         * from a blocking script, so an element already in the document can
         * upgrade while the parser is still inside it, and innerHTML read at
         * that moment is empty. setup() runs after `await sdk.onReady()`, and
         * the platform calls falak.init() at body:end - so by this point the
         * body, children included, is parsed.
         *
         * The test is a DOM query rather than a pattern over the HTML string:
         * "does this element actually contain a control" is the real question,
         * and asking the parser is both cheaper to read and immune to whatever
         * markup shape a theme happens to use.
         */
        if (this._authored === undefined) {
            const hasControls = !!this.querySelector('form, input, textarea, select, button');
            this._authored = hasControls ? this.innerHTML.trim() : null;
        }
    }

    /** True when the theme supplied its own markup and owns the design. */
    get themed() { return !!this._authored; }

    /** One labelled control. `icon` is optional; `required` drives both the
     *  asterisk and the browser's own validation. */
    field({ name, type = 'text', icon = null, required = false, placeholder = '', rows = 0, half = false, accept = null }) {
        const label = this.trans(`contact.${name}`);
        const id = `falak-contact-${name}`;

        const control = rows
            ? `<textarea id="${id}" name="${name}" rows="${rows}" class="f-contact__input f-contact__input--area"
                   placeholder="${this.escape(placeholder)}" ${required ? 'required' : ''}></textarea>`
            : `<input id="${id}" name="${name}" type="${type}" class="f-contact__input"
                   placeholder="${this.escape(placeholder)}" ${accept ? `accept="${accept}"` : ''} ${required ? 'required' : ''}>`;

        return `
            <div class="f-contact__field${half ? ' f-contact__field--half' : ''}">
                <label class="f-contact__label" for="${id}">
                    ${icon ? `<span class="f-contact__label-icon">${icon}</span>` : ''}
                    ${this.escape(label)}
                    ${required ? '<span class="f-contact__required" aria-hidden="true">*</span>' : ''}
                </label>
                ${control}
            </div>`;
    }

    render() {
        /*
         * A theme-supplied form is put back verbatim on every render — the
         * component never rewrites markup it did not author. The success state
         * is handled inside it by revealing [data-success], not by replacing
         * it, so the theme's DOM survives the send.
         */
        if (this.themed) {
            this.innerHTML = this._authored;
            return;
        }

        const phone = this.showPhone
            ? this.field({ name: 'phone', type: 'tel', icon: ICONS.phone, placeholder: this.trans('contact.phone_placeholder'), half: true })
            : '';

        this.innerHTML = `
            <form class="f-contact" novalidate>
                ${this.field({
                    name: 'name', icon: ICONS.user, required: true,
                    placeholder: this.trans('contact.name_placeholder'),
                })}

                <div class="f-contact__row">
                    ${this.field({
                        name: 'email', type: 'email', icon: ICONS.mail, required: true,
                        placeholder: this.trans('contact.email_placeholder'), half: true,
                    })}
                    ${phone}
                </div>

                ${this.showOrder ? this.field({
                    name: 'order_number', icon: ICONS.hash,
                    placeholder: this.trans('contact.order_placeholder'),
                }) : ''}

                ${this.showSubject ? this.field({
                    name: 'subject', icon: ICONS.bubble, required: this.requireSubject,
                    placeholder: this.trans('contact.subject_placeholder'),
                }) : ''}

                ${this.field({
                    name: 'message', required: true, rows: 5,
                    placeholder: this.trans('contact.message_placeholder'),
                })}

                ${this.showAttachment ? this.field({
                    name: 'attachment', type: 'file', icon: ICONS.clip,
                    accept: '.jpg,.jpeg,.png,.pdf',
                }) : ''}

                <p class="f-contact__error" data-error role="alert" hidden></p>

                <falak-button type="submit" color="primary" width="wide" loader-position="center">
                    ${ICONS.send} ${this.escape(this.attr('button-text') || this.trans('contact.send'))}
                </falak-button>

                <!--
                    The confirmation sits WITH the form, not in place of it.

                    It is rendered up front and merely unhidden on success, so
                    the send never re-renders and the form the shopper is
                    looking at keeps its DOM, its listeners and its scroll
                    position. It sits beside the button because that is where
                    the eye already is after a click.

                    A second send is guarded by resetting the fields instead of
                    removing them: the form is empty afterwards, so an
                    accidental re-submit meets validation rather than posting
                    the same message twice.
                -->
                <div class="f-contact__done" data-success role="status" hidden>
                    <span class="f-contact__done-icon">${ICONS.check}</span>
                    <p>${this.escape(this.attr('success-text') || this.trans('contact.sent'))}</p>
                </div>
            </form>`;
    }

    afterRender() {
        /*
         * A themed form gets `novalidate` too, whether or not its author wrote
         * it.
         *
         * Not a liberty: this component reports validation itself, in the
         * shopper's language, through [data-error]. Left to the browser, a
         * `required` field blocks submit with a bubble that cannot be
         * translated or styled — on an Arabic-first storefront that bubble is
         * English — and, worse, the block happens before this element's submit
         * handler runs at all, so the theme's own error line would sit there
         * empty while the browser talked over it.
         *
         * The `required` attributes stay exactly as the theme wrote them:
         * assistive technology reads them, and submit() enforces them.
         */
        this.querySelector('form')?.setAttribute('novalidate', '');

        this.listen(this, 'submit', event => {
            event.preventDefault();
            this.submit(event.target);
        });
    }

    /**
     * Validates what the server requires, then sends.
     *
     * `novalidate` is on the form because the browser's own bubbles cannot be
     * translated or styled, and this component already has a message line the
     * theme skins. The `required` attributes stay for assistive tech.
     */
    async submit(form) {
        const data = new FormData(form);
        /*
         * Every hook is looked up rather than assumed, because a themed form
         * is markup this component did not write: it may carry a plain
         * <button> instead of <falak-button>, and it may omit the error line
         * entirely.
         */
        const error = form.querySelector('[data-error]');
        const success = form.querySelector('[data-success]');
        const button = form.querySelector('falak-button, [type="submit"]');

        const fail = message => {
            if (error) {
                error.textContent = message;
                error.hidden = false;
            } else {
                // A themed form with no [data-error] would otherwise swallow
                // its own validation in silence.
                this.sdk.logger?.warn?.(`<falak-contact-form> has no [data-error]: ${message}`);
            }
        };

        if (error) error.hidden = true;

        // Last send's confirmation goes away the moment a new one starts, so
        // it can never be read as applying to the message being written now.
        if (success) success.hidden = true;

        const value = name => String(data.get(name) || '').trim();

        /*
         * The server's three, plus subject when the merchant made it a rule.
         * A required field the themed markup does not carry at all is an
         * author mistake, not a shopper one — it is named in the console and
         * left to the server's 422 rather than shown as "please fill in the
         * required fields", which would point at nothing on screen.
         */
        const required = ['name', 'email', 'message']
            .concat(this.requireSubject ? ['subject'] : []);

        const absent = required.filter(name => !form.querySelector(`[name="${name}"]`));
        if (absent.length) {
            this.sdk.logger?.warn?.(
                `<falak-contact-form> is missing required field(s): ${absent.join(', ')}`);
        }

        const missing = required.find(name => form.querySelector(`[name="${name}"]`) && !value(name));

        if (missing) {
            fail(this.trans('contact.required'));
            form.querySelector(`[name="${missing}"]`)?.focus();
            return;
        }

        // Checked here because the server's rejection for it is a 422 whose
        // message names a field the shopper cannot see the rule for.
        if (form.querySelector('[name="email"]') && !/^\S+@\S+\.\S+$/.test(value('email'))) {
            fail(this.trans('contact.invalid_email'));
            form.querySelector('[name="email"]')?.focus();
            return;
        }

        /*
         * A file has to travel as FormData; everything else goes as JSON. The
         * file input is empty on most submissions even when rendered, so the
         * cheaper path is the default and multipart is used only when there is
         * genuinely something to upload.
         */
        const file = data.get('attachment');
        const hasFile = file && typeof File !== 'undefined' && file instanceof File && file.size > 0;

        let payload;

        if (hasFile) {
            payload = data;
        } else {
            data.delete('attachment');
            payload = Object.fromEntries(data.entries());
        }

        if (this.attr('category')) payload instanceof FormData
            ? payload.set('category', this.attr('category'))
            : (payload.category = this.attr('category'));

        if (this.attr('country')) payload instanceof FormData
            ? payload.set('country', this.attr('country'))
            : (payload.country = this.attr('country'));

        // <falak-button> has load()/stop(); a themed plain button gets the
        // same protection from a double submit through disabled + aria-busy.
        const busy = state => {
            if (!button) return;
            if (button.load && button.stop) return state ? button.load() : button.stop();
            button.disabled = state;
            button.setAttribute('aria-busy', String(state));
        };

        busy(true);

        try {
            /*
             * Silenced, because this component does its own reporting.
             *
             * The API client raises a toast for any `message` a 2xx carries and
             * for every failure. Both are already shown here — the confirmation
             * in [data-success], the failure in [data-error] — so leaving the
             * notifier on told the shopper twice, once in the form and once in
             * the corner of the screen.
             *
             * It is silenced at the CALL, not in the contact domain: a theme
             * calling falak.contact.send() from its own code has no banner of
             * its own and should keep the toast.
             */
            const result = await this.sdk.api.withoutNotifier(
                () => this.sdk.contact.send(payload)
            );

            this.emit('sent', result);

            this.sent = true;

            /*
             * THE FORM STAYS. One code path for both the built-in and a themed
             * form, because both now carry a hidden [data-success] that is
             * simply revealed — no re-render, so the DOM the shopper is
             * looking at keeps its listeners and the page keeps its scroll.
             *
             * Reset rather than removed: the fields are cleared so a stray
             * second click meets validation instead of posting the same
             * message twice, and someone with a second thing to say can just
             * type it.
             *
             * A themed form with no [data-success] gets the reset and nothing
             * else — fail() has already warned in the console that the hook is
             * missing.
             */
            form.reset();
            busy(false);

            if (success) success.hidden = false;
        } catch (sendError) {
            busy(false);

            fail(sendError?.messageLang || sendError?.message || this.trans('contact.failed'));

            this.emit('failed', { error: sendError });
        }
    }
}
