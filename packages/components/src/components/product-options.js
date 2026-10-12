import FalakElement from '../base.js';

/**
 * <falak-product-options product-id="17" variations='[…]'></falak-product-options>
 * <falak-product-options product-id="17" fetch></falak-product-options>
 * <falak-product-options product-id="17" variations='[…]' selected="9"></falak-product-options>
 *
 * The variant chooser, mirroring what <salla-product-options> does for
 * this platform's product model: a product's variations each carry an
 * `attributes` map ({ Color: "Black", Size: "M" }), a price, a stock
 * quantity and a SKU. The component turns the maps into one group of pills
 * per attribute, resolves the exact variation once every group has a
 * choice, and tells the page.
 *
 * Availability is computed per pill against the OTHER groups' current
 * choices, the way Salla's SKU map works: a value no variation has with the
 * current combination is impossible; one whose matching variations are all
 * out of stock is out of stock. Both are disabled, so a shopper can only
 * pick something that can actually be bought.
 *
 * <falak-add-product-button> asks this element before adding (see its
 * `options-selector`): reportValidity() flags the first missing group and
 * returns false, so an incomplete choice never reaches the cart.
 *
 * `options` carries the merchant's DEFINITIONS for those groups — order,
 * label, how to draw them, and per-value swatch data:
 *
 *     options='[{"key":"Color","label":"Colour","type":"color","values":[
 *         {"value":"Black","label":"Black","display":"#111111"}]}]'
 *
 * The division of labour matters: `variations` decides which groups and
 * values EXIST and whether each can be bought, `options` only decides how
 * they are drawn. A definition for a key or value no variation uses is
 * ignored rather than rendered, so a stale definition cannot produce a group
 * in which every pill is impossible; a group with no definition falls back
 * to text pills in attribute order, which is what this element did before
 * definitions existed. Omitting the attribute entirely is therefore a no-op.
 *
 * | attribute   | role                                                    |
 * | product-id  | required                                                |
 * | variations  | JSON array of variations (server-rendered: first paint)  |
 * | options     | JSON array of option definitions (optional, display only) |
 * | fetch       | load the variations AND definitions from the product API |
 * | selected    | variation id to pre-select                              |
 *
 * Events: DOM `changed` on the element and `product::options.changed` on
 * the bus, both with { productId, variationId, sku, price, comparePrice,
 * inStock, complete, selected }.
 */
export default class FalakProductOptions extends FalakElement {
    static observedAttributes = ['product-id', 'variations', 'options', 'fetch', 'selected'];

    /** Display types this element knows how to draw; anything else is pills. */
    static TYPES = ['pills', 'dropdown', 'color', 'image'];

    get productId() { return this.attr('product-id'); }

    /** Normalised variations, whatever shape the server used. */
    get variations() {
        if (this._variations) return this._variations;

        const raw = this.jsonAttr('variations', null);
        this._variations = Array.isArray(raw) ? raw.map(v => this.normalise(v)).filter(Boolean) : [];

        return this._variations;
    }

    /** Normalised option definitions, whatever shape the server used. */
    get definitions() {
        if (this._definitions) return this._definitions;

        const raw = this.jsonAttr('options', null);
        this._definitions = Array.isArray(raw) ? raw.map(o => this.normaliseOption(o)).filter(Boolean) : [];

        return this._definitions;
    }

    /**
     * One group per attribute key, in the merchant's order when they defined
     * one and in order of first appearance otherwise.
     *
     * `key` and `values` keep the exact shape they had before definitions
     * existed — a string and an array of strings — because resolution and
     * availability are computed from them, and a theme may read them. The
     * presentation fields are additions: `label`, `type` and a `meta` map
     * from value string to { label, display }.
     */
    get groups() {
        const groups = [];

        for (const variation of this.variations) {
            for (const [key, value] of Object.entries(variation.attributes)) {
                let group = groups.find(g => g.key === key);
                if (!group) { group = { key, values: [] }; groups.push(group); }
                if (!group.values.includes(value)) group.values.push(value);
            }
        }

        return this.decorate(groups);
    }

    /**
     * Applies the definitions to the groups the variations produced: the
     * merchant's order, labels and display type, with every group and value
     * they did not define left exactly as derived and appended after the ones
     * they did. Nothing is added or removed here — a definition the
     * variations do not back has no group to attach to and simply does not
     * appear.
     */
    decorate(groups) {
        const definitions = this.definitions;

        if (!definitions.length) return groups;

        const ordered = [
            ...definitions.map(d => groups.find(g => g.key === d.key)).filter(Boolean),
            ...groups.filter(g => !definitions.some(d => d.key === g.key)),
        ];

        return ordered.map(group => {
            const definition = definitions.find(d => d.key === group.key);

            if (!definition) return group;

            const defined = definition.values.filter(v => group.values.includes(v.value));
            const meta = {};

            for (const value of defined) meta[value.value] = { label: value.label, display: value.display };

            return {
                ...group,
                label: definition.label,
                type: definition.type,
                required: definition.required,
                // The merchant's value order first, then anything a variation
                // uses that they never defined — never dropped, or a shopper
                // could not reach a variant that exists.
                values: [
                    ...defined.map(v => v.value),
                    ...group.values.filter(v => !meta[v]),
                ],
                meta,
            };
        });
    }

    get selected() { return this._selected || {}; }

    get isComplete() {
        return this.groups.length > 0 && this.groups.every(g => this.selected[g.key] !== undefined);
    }

    /** The one variation matching every choice, once the choice is complete. */
    get variation() {
        if (!this.isComplete) return null;

        return this.variations.find(v => this.groups.every(g => v.attributes[g.key] === this.selected[g.key])) || null;
    }

    get variationId() { return this.variation?.id ?? null; }

    normalise(raw) {
        if (!raw || typeof raw !== 'object') return null;

        let attributes = raw.attributes ?? {};
        if (typeof attributes === 'string') {
            try { attributes = JSON.parse(attributes); } catch (e) { attributes = {}; }
        }
        if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return null;

        const list = Number(raw.price ?? raw.price_cents ?? 0);
        const discount = Number(raw.compare_at !== undefined ? raw.price : (raw.discount_price_cents ?? 0));
        const onSale = raw.compare_at !== undefined
            ? !!raw.compare_at
            : (discount > 0 && discount < list);

        const quantity = raw.quantity === undefined || raw.quantity === null ? null : Number(raw.quantity);

        return {
            id: raw.id,
            sku: raw.sku ?? null,
            attributes: Object.fromEntries(Object.entries(attributes).map(([k, v]) => [String(k), String(v)])),
            price: onSale ? (raw.compare_at !== undefined ? Number(raw.price) : discount) : list,
            comparePrice: onSale ? (raw.compare_at !== undefined ? Number(raw.compare_at) : list) : null,
            quantity,
            inStock: raw.in_stock !== undefined ? !!raw.in_stock : (quantity === null || quantity > 0),
        };
    }

    /**
     * One option definition, from either shape the platform serves: the
     * storefront payload, whose labels are already resolved to the page's
     * locale (`key`, `label`, `values[].display`), or the raw model rows the
     * product API returns for `fetch`, which carry both languages
     * (`attribute_key`, `label_ar`, `values[].display_value`).
     */
    normaliseOption(raw) {
        if (!raw || typeof raw !== 'object') return null;

        const key = this.joinText(raw.key ?? raw.attribute_key);
        if (key === null) return null;

        const type = this.text(raw.type) ?? 'pills';
        const list = Array.isArray(raw.values) ? raw.values : [];

        const values = list
            .map(value => this.normaliseOptionValue(value))
            .filter(Boolean);

        return {
            key,
            label: this.label(raw) ?? key,
            type: FalakProductOptions.TYPES.includes(type) ? type : 'pills',
            // Carried for the non-variant options of a later phase. A group
            // that takes part in resolving a variant is required whatever
            // this says — the variant cannot be identified without it — so
            // isComplete() does not consult it yet.
            required: raw.required ?? raw.is_required ?? true,
            values,
        };
    }

    normaliseOptionValue(raw) {
        if (typeof raw === 'string' || typeof raw === 'number') raw = { value: String(raw) };
        if (!raw || typeof raw !== 'object') return null;

        const value = this.joinText(raw.value ?? raw.attribute_value);
        if (value === null) return null;

        return {
            value,
            slug: this.text(raw.slug),
            label: this.label(raw) ?? value,
            display: this.text(raw.display ?? raw.display_value),
        };
    }

    /**
     * The label for an option or a value. A payload that already resolved one
     * carries `label` alone; a raw model row carries `label` and `label_ar`,
     * so the locale decides and either may be blank.
     */
    label(raw) {
        const locale = this.sdk?.lang?.locale ?? 'ar';
        const arabic = this.text(raw.label_ar);
        const base = this.text(raw.label);

        return locale === 'ar' ? (arabic ?? base) : base;
    }

    /**
     * A string matched against a variation's `attributes` — an option's key or
     * a value's text. NOT trimmed: `groups` derives its keys and values
     * straight from those maps, so a trimmed definition would fail to find the
     * group it describes and the option would quietly render undecorated.
     */
    joinText(value) {
        if (value === null || value === undefined || typeof value === 'object') return null;

        const text = String(value);

        return text.trim() === '' ? null : text;
    }

    /** Display-only text: trimmed, or null when there is nothing left to show. */
    text(value) {
        if (value === null || value === undefined || typeof value === 'object') return null;

        const text = String(value).trim();

        return text === '' ? null : text;
    }

    /* ------------------------------------------------------ availability */

    /**
     * 'available' | 'out_of_stock' | 'impossible' for one value, given the
     * choices made in every OTHER group.
     */
    status(key, value) {
        const others = Object.entries(this.selected).filter(([k]) => k !== key);

        const candidates = this.variations.filter(v =>
            v.attributes[key] === value && others.every(([k, val]) => v.attributes[k] === val));

        if (!candidates.length) return 'impossible';

        return candidates.some(v => v.inStock) ? 'available' : 'out_of_stock';
    }

    /* ------------------------------------------------------------ render */

    render() {
        this.classList.add('f-options');

        if (!this.variations.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');

        if (this._selected === undefined) this.seed();

        const error = this._error || '';

        this.innerHTML = `
            ${this.groups.map(group => this.groupHtml(group)).join('')}
            <p class="f-options__error" role="alert" data-options-error ${error ? '' : 'hidden'}>${this.escape(error)}</p>
            <input type="hidden" name="product_variation_id" value="${this.escape(this.variationId ?? '')}" data-variation-input>`;
    }

    /** The merchant's label for a group, else the raw attribute key. */
    groupLabel(group) { return group.label ?? group.key; }

    /** The merchant's label for one value, else the raw value. */
    valueLabel(group, value) { return group.meta?.[value]?.label ?? value; }

    groupHtml(group) {
        const chosen = this.selected[group.key];
        const missing = this._error && chosen === undefined;
        const label = this.groupLabel(group);
        const type = group.type ?? 'pills';

        return `
            <div class="f-options__group f-options__group--${type}${missing ? ' f-options__group--invalid' : ''}" data-option-group="${this.escape(group.key)}" data-option-type="${this.escape(type)}">
                <div class="f-options__label">
                    <span class="f-options__name">${this.escape(label)}</span>
                    ${chosen !== undefined ? `<b class="f-options__chosen">${this.escape(this.valueLabel(group, chosen))}</b>` : `<span class="f-options__hint">${this.escape(this.trans('product.choose_option', { name: label }))}</span>`}
                </div>
                ${type === 'dropdown' ? this.selectHtml(group, chosen) : `
                <div class="f-options__pills" role="radiogroup" aria-label="${this.escape(label)}">
                    ${group.values.map(value => this.pillHtml(group, value, chosen === value)).join('')}
                </div>`}
            </div>`;
    }

    /**
     * A group too long for pills. The same three statuses apply: an option a
     * shopper cannot buy is `disabled`, which a <select> honours natively, so
     * the chooser stays as honest as the pills are.
     */
    selectHtml(group, chosen) {
        const label = this.groupLabel(group);

        return `
            <select class="f-options__select" data-option-select="${this.escape(group.key)}" aria-label="${this.escape(label)}">
                <option value="" ${chosen === undefined ? 'selected' : ''}>${this.escape(this.trans('product.choose_option', { name: label }))}</option>
                ${group.values.map(value => {
                    const status = this.status(group.key, value);

                    return `<option value="${this.escape(value)}" data-status="${status}" ${status !== 'available' ? 'disabled' : ''} ${chosen === value ? 'selected' : ''}>${this.escape(this.valueLabel(group, value))}${status === 'out_of_stock' ? ` — ${this.escape(this.trans('product.out_of_stock'))}` : ''}</option>`;
                }).join('')}
            </select>`;
    }

    pillHtml(group, value, isSelected) {
        const key = group.key;
        const status = this.status(key, value);
        const disabled = status !== 'available';
        const type = group.type ?? 'pills';
        const label = this.valueLabel(group, value);
        const display = group.meta?.[value]?.display ?? null;

        // A swatch's accessible name is its label, which its contents no
        // longer carry once the colour or image replaces the text.
        const swatch = (type === 'color' || type === 'image') && display;

        return `
            <button type="button" role="radio"
                    class="f-options__pill f-options__pill--${status}${swatch ? ` f-options__pill--swatch f-options__pill--${type}` : ''}${isSelected ? ' is-selected' : ''}"
                    data-option-key="${this.escape(key)}" data-option-value="${this.escape(value)}" data-status="${status}"
                    aria-checked="${isSelected ? 'true' : 'false'}" ${disabled ? 'aria-disabled="true" disabled' : ''}
                    ${swatch ? `aria-label="${this.escape(label)}"` : ''}
                    ${status === 'out_of_stock' ? `title="${this.escape(this.trans('product.out_of_stock'))}"` : (swatch ? `title="${this.escape(label)}"` : '')}>
                ${this.pillBodyHtml(type, label, display)}
            </button>`;
    }

    /**
     * What sits inside a pill. A `color` or `image` option whose value has no
     * display data of its own falls back to its text rather than rendering an
     * empty square — a merchant half-way through filling the swatches in
     * still gets a usable chooser.
     */
    pillBodyHtml(type, label, display) {
        if (type === 'color' && display) {
            const color = this.cssColor(display);

            return color
                ? `<span class="f-options__swatch" style="background:${color}"></span>`
                : `<span>${this.escape(label)}</span>`;
        }

        if (type === 'image' && display) {
            return `<img class="f-options__swatch f-options__swatch--image" src="${this.escape(display)}" alt="" loading="lazy">`;
        }

        return `<span>${this.escape(label)}</span>`;
    }

    /**
     * A merchant-supplied colour, or null. This value is the one thing on the
     * element that reaches a `style` attribute, where HTML-escaping alone
     * would still let "red;background-image:url(…)" through — so it is
     * matched against the shapes a colour can take instead of sanitised.
     * Anything else falls back to the value's text.
     */
    cssColor(value) {
        const color = String(value).trim();

        if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
        if (/^(?:rgb|hsl)a?\([0-9a-z%.,\s/+-]*\)$/i.test(color)) return color;
        if (/^[a-z]{3,30}$/i.test(color)) return color;

        return null;
    }

    /** Pre-selection: the `selected` variation, or the only one there is. */
    seed() {
        this._selected = {};

        const wanted = this.attr('selected');
        const target = wanted
            ? this.variations.find(v => String(v.id) === String(wanted))
            : (this.variations.length === 1 ? this.variations[0] : null);

        if (target) this._selected = { ...target.attributes };
    }

    /* --------------------------------------------------------- behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            const pill = event.target.closest('[data-option-key]');
            if (!pill || pill.disabled) return;

            this.choose(pill.getAttribute('data-option-key'), pill.getAttribute('data-option-value'));
        });

        // A `dropdown` group. Delegated like the pills, so a re-render needs
        // no rewiring; an empty value is the "choose…" row, which clears.
        this.listen(this, 'change', event => {
            const select = event.target.closest('[data-option-select]');
            if (!select) return;

            const key = select.getAttribute('data-option-select');
            const value = select.value;

            if (value === '') this.clear(key);
            else if (this.selected[key] !== value) this.choose(key, value);
        });

        if (!this.variations.length && this.boolAttr('fetch') && this.productId) this.load();
    }

    attributeChangedCallback(name, previous, next) {
        if (name === 'variations') this._variations = null;
        if (name === 'options') this._definitions = null;
        if (name === 'variations' || name === 'selected') this._selected = undefined;

        super.attributeChangedCallback(name, previous, next);
    }

    async load() {
        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.product.show(this.productId));
            const product = response?.data ?? response;
            const list = Array.isArray(product?.variations) ? product.variations : [];
            const definitions = Array.isArray(product?.options) ? product.options : [];

            this._variations = list.map(v => this.normalise(v)).filter(Boolean);
            // Raw model rows here, not the storefront payload — normaliseOption
            // reads both, so the dialog draws the same swatches the product
            // page does instead of falling back to plain pills.
            this._definitions = definitions.map(o => this.normaliseOption(o)).filter(Boolean);
            this._selected = undefined;
            this.render();
            this.announce();
        } catch (error) {
            this._variations = [];
            this.render();
        }
    }

    /** Drops one group's choice — the dropdown's "choose…" row. */
    clear(key) {
        if (this.selected[key] === undefined) return;

        this.choose(key, this.selected[key]);
    }

    choose(key, value) {
        const next = { ...this.selected };

        if (next[key] === value) delete next[key];
        else next[key] = value;

        this._selected = next;

        // A choice elsewhere can make an earlier one impossible: drop those
        // rather than leave the shopper with a combination nothing matches.
        for (const group of this.groups) {
            if (group.key === key || this._selected[group.key] === undefined) continue;
            if (this.status(group.key, this._selected[group.key]) === 'impossible') delete this._selected[group.key];
        }

        this._error = '';
        this.render();
        this.announce();
    }

    announce() {
        const variation = this.variation;
        const payload = {
            productId: this.productId,
            variationId: variation?.id ?? null,
            sku: variation?.sku ?? null,
            price: variation?.price ?? null,
            comparePrice: variation?.comparePrice ?? null,
            inStock: variation ? variation.inStock : null,
            quantity: variation ? variation.quantity : null,
            complete: this.isComplete,
            selected: { ...this.selected },
        };

        this.emit('changed', payload);
        this.emitBus('product::options.changed', payload);
    }

    /**
     * Flags the first group without a choice and returns false; true when
     * the choice is complete. The add button calls this before adding.
     */
    reportValidity() {
        if (this.isComplete) {
            this._error = '';
            this.render();
            return true;
        }

        const missing = this.groups.find(g => this.selected[g.key] === undefined);
        this._error = this.trans('product.choose_option', { name: missing ? this.groupLabel(missing) : '' });
        this.render();
        this.scrollIntoView({ behavior: 'smooth', block: 'center' });

        return false;
    }
}
