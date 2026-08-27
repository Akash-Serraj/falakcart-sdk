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
 * | attribute   | role                                                    |
 * | product-id  | required                                                |
 * | variations  | JSON array of variations (server-rendered: first paint)  |
 * | fetch       | load the variations from the product API instead        |
 * | selected    | variation id to pre-select                              |
 *
 * Events: DOM `changed` on the element and `product::options.changed` on
 * the bus, both with { productId, variationId, sku, price, comparePrice,
 * inStock, complete, selected }.
 */
export default class FalakProductOptions extends FalakElement {
    static observedAttributes = ['product-id', 'variations', 'fetch', 'selected'];

    get productId() { return this.attr('product-id'); }

    /** Normalised variations, whatever shape the server used. */
    get variations() {
        if (this._variations) return this._variations;

        const raw = this.jsonAttr('variations', null);
        this._variations = Array.isArray(raw) ? raw.map(v => this.normalise(v)).filter(Boolean) : [];

        return this._variations;
    }

    /** Attribute keys in order of first appearance, each with its values. */
    get groups() {
        const groups = [];

        for (const variation of this.variations) {
            for (const [key, value] of Object.entries(variation.attributes)) {
                let group = groups.find(g => g.key === key);
                if (!group) { group = { key, values: [] }; groups.push(group); }
                if (!group.values.includes(value)) group.values.push(value);
            }
        }

        return groups;
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

    groupHtml(group) {
        const chosen = this.selected[group.key];
        const missing = this._error && chosen === undefined;

        return `
            <div class="f-options__group${missing ? ' f-options__group--invalid' : ''}" data-option-group="${this.escape(group.key)}">
                <div class="f-options__label">
                    <span class="f-options__name">${this.escape(group.key)}</span>
                    ${chosen !== undefined ? `<b class="f-options__chosen">${this.escape(chosen)}</b>` : `<span class="f-options__hint">${this.escape(this.trans('product.choose_option', { name: group.key }))}</span>`}
                </div>
                <div class="f-options__pills" role="radiogroup" aria-label="${this.escape(group.key)}">
                    ${group.values.map(value => this.pillHtml(group.key, value, chosen === value)).join('')}
                </div>
            </div>`;
    }

    pillHtml(key, value, isSelected) {
        const status = this.status(key, value);
        const disabled = status !== 'available';

        return `
            <button type="button" role="radio"
                    class="f-options__pill f-options__pill--${status}${isSelected ? ' is-selected' : ''}"
                    data-option-key="${this.escape(key)}" data-option-value="${this.escape(value)}" data-status="${status}"
                    aria-checked="${isSelected ? 'true' : 'false'}" ${disabled ? 'aria-disabled="true" disabled' : ''}
                    ${status === 'out_of_stock' ? `title="${this.escape(this.trans('product.out_of_stock'))}"` : ''}>
                <span>${this.escape(value)}</span>
            </button>`;
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

        if (!this.variations.length && this.boolAttr('fetch') && this.productId) this.load();
    }

    attributeChangedCallback(name, previous, next) {
        if (name === 'variations') this._variations = null;
        if (name === 'variations' || name === 'selected') this._selected = undefined;

        super.attributeChangedCallback(name, previous, next);
    }

    async load() {
        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.product.show(this.productId));
            const product = response?.data ?? response;
            const list = Array.isArray(product?.variations) ? product.variations : [];

            this._variations = list.map(v => this.normalise(v)).filter(Boolean);
            this._selected = undefined;
            this.render();
            this.announce();
        } catch (error) {
            this._variations = [];
            this.render();
        }
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
        this._error = this.trans('product.choose_option', { name: missing?.key ?? '' });
        this.render();
        this.scrollIntoView({ behavior: 'smooth', block: 'center' });

        return false;
    }
}
