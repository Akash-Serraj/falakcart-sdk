import FalakElement from '../base.js';

/**
 * <falak-custom-fields fields='[
 *     {"key":"engraving","type":"text","label":"Engraving text","required":true},
 *     {"key":"gift_message","type":"textarea","label":"Gift message"},
 *     {"key":"size","type":"select","label":"Size","options":["S","M","L"],"required":true},
 *     {"key":"gift_wrap","type":"checkbox","label":"Gift wrap this order"},
 *     {"key":"reference","type":"file","label":"Reference photo","accept":"image/*"}
 * ]'></falak-custom-fields>
 *
 * Merchant-defined extra form fields — mirroring <salla-custom-fields>: a
 * personalization question on a product, an extra checkout question, any
 * field a merchant configures rather than one this platform hard-codes.
 * It only renders a `fields` schema and collects the answers — the same
 * "no opinion about where this goes" contract as <falak-file-upload>: read
 * `.values` or listen for `change`.
 *
 * | attribute | role                                                          |
 * | fields    | JSON array of { key, type, label, required, placeholder,      |
 * |           | options } — type: text | textarea | number | select | radio |  |
 * |           | checkbox | date | file (delegates to <falak-file-upload>)       |
 * | values    | JSON: pre-fill values keyed by field `key`                     |
 *
 * Events: DOM `change` on the element (detail: `{ values, valid }`), where
 * `valid` is true once every `required` field has a non-empty answer.
 */
export default class FalakCustomFields extends FalakElement {
    static observedAttributes = ['fields', 'values'];

    get fields() { return this.jsonAttr('fields', []) || []; }
    get values() { return { ...this._values }; }

    connectedCallback() {
        if (this._values === undefined) this._values = this.jsonAttr('values', {}) || {};

        return super.connectedCallback();
    }

    render() {
        this.classList.add('f-custom-fields');

        this.innerHTML = this.fields.map(field => this.fieldHtml(field)).join('');
    }

    fieldHtml(field) {
        const { key, type = 'text', label = '', required = false, placeholder = '', options = [] } = field;
        const value = this._values[key] ?? '';
        const error = this._errors?.[key];
        const control = this.controlHtml(key, type, value, { required, placeholder, options, field });

        // A checkbox and a file picker carry their own label/content; every
        // other type shares one label wrapper around a bare input.
        if (type === 'checkbox') {
            return `<div class="f-custom-fields__field" data-field-key="${this.escape(key)}">${control}${error ? `<span class="f-field__error">${this.escape(error)}</span>` : ''}</div>`;
        }

        return `
            <label class="f-field f-custom-fields__field" data-field-key="${this.escape(key)}">
                <span class="f-field__label">${this.escape(label)}${required ? ' *' : ''}</span>
                ${control}
                ${error ? `<span class="f-field__error">${this.escape(error)}</span>` : ''}
            </label>`;
    }

    controlHtml(key, type, value, { required, placeholder, options, field }) {
        const req = required ? 'required' : '';
        const k = this.escape(key);

        switch (type) {
            case 'textarea':
                return `<textarea class="f-input" data-field="${k}" rows="3" placeholder="${this.escape(placeholder)}" ${req}>${this.escape(value)}</textarea>`;
            case 'select':
                return `
                    <select class="f-input" data-field="${k}" ${req}>
                        <option value=""></option>
                        ${options.map(opt => `<option value="${this.escape(opt)}" ${value === opt ? 'selected' : ''}>${this.escape(opt)}</option>`).join('')}
                    </select>`;
            case 'radio':
                return `
                    <div class="f-custom-fields__options">
                        ${options.map(opt => `
                            <label class="f-custom-fields__option">
                                <input type="radio" name="${k}" value="${this.escape(opt)}" data-field="${k}" ${value === opt ? 'checked' : ''} ${req}>
                                <span>${this.escape(opt)}</span>
                            </label>`).join('')}
                    </div>`;
            case 'checkbox':
                return `
                    <label class="f-custom-fields__option">
                        <input type="checkbox" data-field="${k}" ${value ? 'checked' : ''}>
                        <span>${this.escape(field.label || '')}</span>
                    </label>`;
            case 'file':
                return `<falak-file-upload data-field="${k}" ${field.accept ? `accept="${this.escape(field.accept)}"` : ''} ${field.maxSize ? `max-size="${this.escape(field.maxSize)}"` : ''}></falak-file-upload>`;
            case 'date':
                return `<input class="f-input" type="date" data-field="${k}" value="${this.escape(value)}" ${req}>`;
            case 'number':
                return `<input class="f-input" type="number" data-field="${k}" value="${this.escape(value)}" placeholder="${this.escape(placeholder)}" ${req}>`;
            default:
                return `<input class="f-input" type="text" data-field="${k}" value="${this.escape(value)}" placeholder="${this.escape(placeholder)}" ${req}>`;
        }
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        /*
         * A native `<select>`/checkbox 'change' or `<input>`/`<textarea>`
         * 'input' inside a field would otherwise bubble straight past this
         * element to whatever listens for OUR OWN 'change' — mixed in with
         * the clean one from notify(), and impossible to tell apart from
         * the outside. Stopped here so the only 'change' anyone sees on
         * <falak-custom-fields> itself is the one this component means.
         */
        this.listen(this, 'input', event => {
            if (!event.target.matches('[data-field]')) return;

            event.stopImmediatePropagation();
            this.handleInput(event.target);
        });

        this.listen(this, 'change', event => {
            const fileField = event.target.matches?.('falak-file-upload[data-field]') ? event.target : null;

            if (fileField) {
                event.stopImmediatePropagation();
                this._values[fileField.getAttribute('data-field')] = event.detail?.files || [];
                this.notify();
                return;
            }

            if (!event.target.matches('[data-field]')) return;

            event.stopImmediatePropagation();
            this.handleInput(event.target);
        });
    }

    handleInput(input) {
        const key = input.getAttribute('data-field');
        if (!key) return;

        this._values[key] = input.type === 'checkbox' ? input.checked : input.value;
        this.notify();
    }

    notify() {
        this._errors = null;
        this.emit('change', { values: this.values, valid: this.validate() });
    }

    /** True once every `required` field has a non-empty answer. */
    validate() {
        return this.fields.every(field => {
            if (!field.required) return true;

            const value = this._values[field.key];

            return value !== undefined && value !== null && value !== '' && value !== false
                && !(Array.isArray(value) && value.length === 0);
        });
    }
}
