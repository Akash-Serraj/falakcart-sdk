import FalakElement from '../base.js';

/**
 * <falak-user-profile></falak-user-profile>
 * <falak-user-profile fields="name,email,phone" hide-stats></falak-user-profile>
 *
 * The customer's own details, editable — mirroring <salla-user-profile>.
 * A guest sees a sign-in prompt; a customer sees their name, email, phone
 * and address in a form, with their order counts above it. Saving goes
 * through falak.auth.updateProfile(), so the header's user menu picks up
 * a new name at once.
 *
 * Below the standard fields, any merchant-defined profile questions render
 * automatically via <falak-custom-fields> (the storefront profile endpoint
 * returns them as `custom_fields_schema` — see ProfileCustomField on the
 * admin side, mirroring Salla's <salla-custom-fields>) and are saved in the
 * same request. A `photo`-type question renders but is not yet sent on
 * save: this platform has no generic upload endpoint to resolve a picked
 * file to a URL first, unlike Salla's instant-upload version.
 *
 * | attribute  | role                                                          |
 * | fields     | comma list of name,email,phone,address (default: all four)    |
 * | hide-stats | leave out the order counts                                    |
 *
 * Events: DOM `updated` on the element (detail: user);
 *         `auth::profile.updated` on the bus (fired by the SDK).
 */
export default class FalakUserProfile extends FalakElement {
    static observedAttributes = ['fields', 'hide-stats'];

    static ALL_FIELDS = ['name', 'email', 'phone', 'address'];

    get fields() {
        const list = this.attr('fields', '').split(',').map(f => f.trim()).filter(f => FalakUserProfile.ALL_FIELDS.includes(f));

        return list.length ? list : FalakUserProfile.ALL_FIELDS;
    }

    get user() { return this._user || this.sdk.auth.user || {}; }

    render() {
        this.classList.add('f-profile');

        if (!this.sdk.auth.isLoggedIn()) {
            this.innerHTML = `
                <div class="f-profile__guest">
                    ${FalakUserProfile.ICON}
                    <p>${this.escape(this.trans('account.sign_in_prompt'))}</p>
                    <button type="button" class="f-btn f-btn--primary" data-profile-login>${this.escape(this.trans('auth.sign_in'))}</button>
                </div>`;
            return;
        }

        const user = this.user;
        const errors = this._errors || {};
        const stats = this.boolAttr('hide-stats') ? null : this._stats;

        const statsHtml = stats ? `
            <ul class="f-profile__stats">
                ${['total_orders', 'pending_orders', 'completed_orders', 'delivered_orders']
                    .filter(key => stats[key] !== undefined)
                    .map(key => `<li class="f-profile__stat">
                        <strong class="f-profile__stat-value">${this.escape(String(stats[key]))}</strong>
                        <span class="f-profile__stat-label">${this.escape(this.trans(`account.stats.${key}`))}</span>
                    </li>`).join('')}
            </ul>` : '';

        const field = (name, type, extra = '') => `
            <label class="f-field f-profile__field f-profile__field--${name}">
                <span class="f-field__label">${this.escape(this.trans(`account.${name}`))}</span>
                ${name === 'address'
                    ? `<textarea class="f-input f-profile__input" name="address" rows="2" autocomplete="street-address">${this.escape(user.address || '')}</textarea>`
                    : `<input class="f-input f-profile__input" type="${type}" name="${name}" value="${this.escape(user[name] || '')}" ${extra}>`}
                ${errors[name] ? `<span class="f-field__error">${this.escape(errors[name])}</span>` : ''}
            </label>`;

        const types = { name: ['text', 'autocomplete="name"'], email: ['email', 'dir="ltr" autocomplete="email"'], phone: ['tel', 'dir="ltr" autocomplete="tel"'], address: ['text', ''] };

        // The merchant's own extra questions — mirrors <salla-custom-fields>.
        // Kept out of `values` until the customer types (see save()'s error
        // path), so a re-render from an unrelated field's error doesn't wipe
        // an in-progress answer here.
        const schema = this.customFieldsSchema;
        const customFieldsHtml = schema.length ? `
            <div class="f-profile__custom-fields">
                <falak-custom-fields fields='${this.escape(JSON.stringify(schema))}'
                                      values='${this.escape(JSON.stringify(this._customFieldValues || {}))}'></falak-custom-fields>
                ${errors.custom_fields ? `<span class="f-field__error">${this.escape(errors.custom_fields)}</span>` : ''}
            </div>` : '';

        this.innerHTML = `
            ${statsHtml}
            <form class="f-profile__form" data-profile-form novalidate>
                <div class="f-profile__grid">
                    ${this.fields.map(name => field(name, types[name][0], types[name][1])).join('')}
                </div>
                ${customFieldsHtml}
                ${errors._ ? `<p class="f-profile__error" role="alert">${this.escape(errors._)}</p>` : ''}
                <div class="f-profile__actions">
                    <button type="submit" class="f-btn f-btn--primary f-profile__save" data-profile-save>${this.escape(this.trans(this._saving ? 'account.saving' : 'account.save'))}</button>
                </div>
            </form>`;
    }

    get customFieldsSchema() { return this._customFieldsSchema || []; }

    /**
     * The profile save is a plain JSON PUT — a `photo`-type field's value is
     * an array of raw File objects (from <falak-file-upload>), which cannot
     * survive JSON.stringify (it silently becomes `{}`). Rather than send
     * that, drop it here: this platform has no generic upload endpoint yet
     * to resolve a picked file to a URL before saving, unlike Salla's own
     * instant-upload version of this field. Text-based answers are unaffected.
     */
    serializableCustomFieldValues(values) {
        const clean = {};

        for (const [key, value] of Object.entries(values || {})) {
            if (Array.isArray(value) && value[0] instanceof File) continue;
            clean[key] = value;
        }

        return clean;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-profile-login]')) {
                this.sdk.auth.requireLoginThen(() => this.load());
            }
        });

        this.listen(this, 'submit', event => {
            if (event.target.closest('[data-profile-form]')) {
                event.preventDefault();
                this.save(event.target);
            }
        });

        this._offIn = this.sdk.event.on('auth::logged.in', () => this.load());
        this._offOut = this.sdk.event.on('auth::logged.out', () => {
            this._user = null;
            this._stats = null;
            this.render();
        });

        if (this.sdk.auth.isLoggedIn()) this.load();
    }

    disconnectedCallback() {
        if (typeof this._offIn === 'function') this._offIn();
        if (typeof this._offOut === 'function') this._offOut();
        super.disconnectedCallback();
    }

    async load() {
        try {
            const profile = await this.sdk.auth.profile();
            if (!profile) return;

            this._user = profile.user || this._user;
            this._stats = profile.statistics || null;
            this._customFieldsSchema = profile.customFieldsSchema || [];
            this._customFieldValues = this._user?.custom_fields || {};
            this._errors = null;
            this.render();
        } catch (error) {
            // The stored customer still renders; the statistics simply stay hidden.
        }
    }

    async save(form) {
        if (this._saving) return;

        const data = {};
        for (const name of this.fields) {
            const input = form.elements[name];
            if (input) data[name] = input.value.trim();
        }

        const customFieldsEl = form.querySelector('falak-custom-fields');
        if (customFieldsEl) data.customFields = this.serializableCustomFieldValues(customFieldsEl.values);

        this._saving = true;
        this._errors = null;
        this.setBusy(true);
        this.render();

        try {
            const user = await this.sdk.auth.updateProfile(data);
            this._user = user;
            this._customFieldValues = user?.custom_fields || data.customFields || {};
            this.sdk.notify.success(this.trans('account.profile_saved'));
            this.emit('updated', { user });
        } catch (error) {
            const bag = error?.falak?.payload?.errors || {};
            const errors = {};
            Object.keys(bag).forEach(key => { errors[key] = Array.isArray(bag[key]) ? bag[key][0] : String(bag[key]); });
            if (!Object.keys(errors).length) errors._ = error?.message || this.trans('common.load_failed');
            this._errors = errors;
            // Keep what the shopper typed so they can fix one field, not retype all.
            this._user = { ...this.user, ...data };
            if (data.customFields) this._customFieldValues = data.customFields;
        } finally {
            this._saving = false;
            this.setBusy(false);
            this.render();
        }
    }

    static ICON = '<svg class="f-profile__icon" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
}
