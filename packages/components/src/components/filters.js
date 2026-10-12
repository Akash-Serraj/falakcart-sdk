import FalakElement from '../base.js';

/**
 * <falak-filters filters='[…]'>                         options rendered by the server
 * <falak-filters fetch category-id="12">               asks the API for this category's options
 * <falak-filters filters='[…]' mode="event">           emits only — no navigation
 * <falak-filters filters='[…]' manual>                 an Apply button instead of apply-on-change
 *
 * The listing sidebar: categories, price, rating, availability — the
 * <salla-filters> role, with the same option shape so a filter payload built
 * for one works for the other.
 *
 * Option shape (one entry per widget):
 *   { key: 'category_id', label: 'Categories', type: 'values',  values: [{ key: 3, value: 'Men', count: 12 }] }
 *   { key: 'price',       label: 'Price',      type: 'range',   values: { min: 0, max: 900, step: 5 } }
 *   { key: 'rating',      label: 'Rating',     type: 'minimum', values: [5, 4, 3, 2, 1] }
 *   { key: 'in_stock',    label: 'In stock',   type: 'boolean' }
 *
 *   values  → checkboxes, any number selected (OR within the group)
 *   minimum → radios, one selected (stars only; "& up" is screen-reader text)
 *   range   → <falak-price-range>
 *   boolean → one checkbox
 *
 * Selection lives in the query string, in the names the listing controller
 * already reads — category_id[], min_price, max_price, rating, in_stock —
 * so a filtered URL is shareable and the first paint is already filtered.
 * Any other key is written as filters[key][] for a controller to pick up.
 *
 * | Attribute     | Description                                                      |
 * | filters       | JSON array of options (see above)                                |
 * | fetch         | load options from the API instead (with category-id)             |
 * | category-id   | the listing's category — scopes fetched options                  |
 * | mode          | reload (default): navigate with the new query; event: emit only   |
 * | manual        | collect changes and apply on the Apply button                    |
 * | initial-count | values shown before "show more" (default 10)                      |
 * | collapsed     | start with every widget closed                                   |
 *
 * Events: `changed` (DOM, detail = selection — named as <salla-filters>
 * names it, and distinct from the native `change` the inputs inside bubble)
 * and `filters::changed` (bus) whenever a selection is applied;
 * `filters::reset` on reset.
 * Methods: getFilters(), applyFilters(), resetFilters().
 */
export default class FalakFilters extends FalakElement {
    static observedAttributes = ['filters', 'mode', 'manual', 'collapsed', 'initial-count'];

    /* Keys the platform's listing reads by name; everything else nests under filters[]. */
    static FLAT_KEYS = ['category_id', 'rating', 'in_stock', 'brand_id'];

    static FALLBACKS = {
        'filters.title': { ar: 'تصفية', en: 'Filters' },
        'filters.selected': { ar: 'لقد اخترت', en: 'Selected' },
        'filters.reset': { ar: 'مسح الكل', en: 'Reset' },
        'filters.apply': { ar: 'تطبيق', en: 'Apply' },
        'filters.show_more': { ar: 'عرض المزيد', en: 'Show more' },
        'filters.show_less': { ar: 'عرض أقل', en: 'Show less' },
        'filters.search': { ar: 'بحث…', en: 'Search…' },
        'filters.no_results': { ar: 'لا توجد نتائج', en: 'No results' },
        'filters.rating_up': { ar: 'فأكثر', en: '& up' },
        'filters.remove': { ar: 'إزالة', en: 'Remove' },
        'filters.categories': { ar: 'التصنيفات', en: 'Categories' },
        'filters.price': { ar: 'السعر', en: 'Price' },
        'filters.rating': { ar: 'التقييم', en: 'Rating' },
        'filters.availability': { ar: 'التوفر', en: 'Availability' },
        'filters.in_stock': { ar: 'متوفر فقط', en: 'In stock only' },
        'filters.brands': { ar: 'الماركات', en: 'Brands' },
    };

    /* Group labels the server may leave blank — resolved from the key. */
    static KEY_LABELS = {
        category_id: 'filters.categories',
        price: 'filters.price',
        rating: 'filters.rating',
        in_stock: 'filters.availability',
        brand_id: 'filters.brands',
    };

    get mode() { return this.attr('mode', 'reload'); }
    get manual() { return this.boolAttr('manual'); }
    get initialCount() { return Math.max(1, this.numAttr('initial-count', 10)); }
    get categoryId() { return this.attr('category-id'); }

    /* ------------------------------------------------------------ lifecycle */

    async setup() {
        this._selected = this.readUrl();
        this._open = {};
        this._expanded = {};
        this._search = {};
        this._filters = this.normalise(this.jsonAttr('filters', []) || []);

        if (this.boolAttr('fetch') && !this._filters.length) await this.load();
    }

    onAttributeChange(name) {
        if (name === 'filters') this._filters = this.normalise(this.jsonAttr('filters', []) || []);
    }

    async load() {
        this.setBusy(true);

        try {
            const list = await this.sdk.api.withoutNotifier(
                () => this.sdk.product.filters({ category: this.categoryId }),
            );
            this._filters = this.normalise(list);
        } catch (error) {
            this.sdk.logger.warn('filters: fetch failed', error);
            this._filters = [];
        } finally {
            this.setBusy(false);
        }
    }

    /** Fills in labels, drops empty groups, keeps the order the server chose. */
    normalise(list) {
        if (!Array.isArray(list)) return [];

        return list
            .filter(option => option && option.key && option.type)
            .map(option => {
                const out = { ...option };

                if (!out.label) {
                    const key = FalakFilters.KEY_LABELS[out.key];
                    out.label = key ? this.label(key) : out.key;
                }

                if (out.key === 'rating' && !Array.isArray(out.values)) {
                    const { min = 1, max = 5 } = out.values || {};
                    out.values = [5, 4, 3, 2, 1].filter(stars => stars >= min && stars <= max);
                }

                if (['values', 'minimum'].includes(out.type)) {
                    out.values = (Array.isArray(out.values) ? out.values : []).map(item =>
                        (typeof item === 'object' && item !== null)
                            ? { key: item.key ?? item.id ?? item.value, value: item.value ?? item.name ?? String(item.key), count: item.count }
                            : { key: item, value: String(item) });
                }

                return out;
            })
            .filter(option => option.type === 'range' || option.type === 'boolean' || (Array.isArray(option.values) && option.values.length > 0));
    }

    /* ---------------------------------------------------------------- state */

    /**
     * The URL is the state: reading it back means a reload, a shared link
     * and the back button all show the selection that produced the page.
     */
    readUrl() {
        const params = new URLSearchParams(window.location.search);
        const selected = {};

        FalakFilters.FLAT_KEYS.forEach(key => {
            const many = params.getAll(`${key}[]`);
            const one = params.get(key);
            if (many.length) selected[key] = many;
            else if (one !== null && one !== '') selected[key] = key === 'in_stock' ? true : one;
        });

        if (params.get('min_price') !== null || params.get('max_price') !== null) {
            selected.price = {
                min: params.get('min_price') !== null ? Number(params.get('min_price')) : null,
                max: params.get('max_price') !== null ? Number(params.get('max_price')) : null,
            };
        }

        for (const [name, value] of params.entries()) {
            const m = name.match(/^filters\[([^\]]+)\](\[\])?$/);
            if (!m) continue;
            const key = m[1];
            if (m[2]) (selected[key] ||= []).push(value);
            else selected[key] = value;
        }

        return selected;
    }

    /** Writes the selection over the current query, leaving unrelated params alone. */
    buildUrl(selected) {
        const url = new URL(window.location.href);
        const params = url.searchParams;

        Array.from(params.keys()).forEach(name => {
            if (name.startsWith('filters[') || name === 'min_price' || name === 'max_price' || name === 'page'
                || FalakFilters.FLAT_KEYS.some(key => name === key || name === `${key}[]`)) {
                params.delete(name);
            }
        });

        Object.entries(selected).forEach(([key, value]) => {
            if (key === 'price' && value && typeof value === 'object') {
                if (value.min !== null && value.min !== undefined) params.set('min_price', String(value.min));
                if (value.max !== null && value.max !== undefined) params.set('max_price', String(value.max));
                return;
            }

            const flat = FalakFilters.FLAT_KEYS.includes(key);
            const name = flat ? key : `filters[${key}]`;

            if (Array.isArray(value)) value.forEach(item => params.append(`${name}[]`, String(item)));
            else if (value === true) params.set(name, '1');
            else if (value !== false && value !== null && value !== undefined && value !== '') params.set(name, String(value));
        });

        return url;
    }

    isSelected(option, value) {
        const current = this._selected[option.key];

        if (option.type === 'boolean') return current === true || current === '1' || current === 1;
        if (option.type === 'range') return false;
        if (Array.isArray(current)) return current.some(item => String(item) === String(value));

        return current !== undefined && current !== null && String(current) === String(value);
    }

    /** Public: the current selection, keyed by option. */
    async getFilters() {
        return { ...this._selected };
    }

    /* --------------------------------------------------------------- output */

    label(key) {
        const value = this.trans(key);
        if (value !== key) return value;

        const fallback = FalakFilters.FALLBACKS[key];
        return fallback ? (fallback[this.sdk.lang.locale] || fallback.en) : key;
    }

    number(value) {
        return this.sdk.helpers.number(value);
    }

    render() {
        this.classList.add('f-filters');

        if (!this._filters.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');

        this.innerHTML = `
            ${this.appliedHtml()}
            ${this._filters.map(option => this.widgetHtml(option)).join('')}
            ${this.manual ? `
                <div class="f-filters__footer">
                    <button type="button" class="f-btn f-btn--primary btn btn--primary" data-filters-apply>${this.escape(this.label('filters.apply'))}</button>
                </div>` : ''}`;
    }

    /** Chips for what is selected, resolved to the option's own label. */
    applied() {
        const chips = [];

        Object.entries(this._selected).forEach(([key, raw]) => {
            const group = this._filters.find(option => option.key === key);
            if (!group) return;

            if (group.type === 'range') {
                // One-sided selections (?min_price= only) read against the bounds.
                const bounds = group.values || {};
                const label = [raw?.min ?? bounds.min, raw?.max ?? bounds.max]
                    .map(v => (v === null || v === undefined) ? '…' : this.number(v)).join(' – ');
                chips.push({ key, value: raw, label: `${group.label}: ${label}` });
                return;
            }

            if (group.type === 'boolean') {
                if (this.isSelected(group, true)) chips.push({ key, value: true, label: group.label });
                return;
            }

            (Array.isArray(raw) ? raw : [raw]).forEach(value => {
                const option = group.values.find(item => String(item.key) === String(value));
                if (!option) return;
                const text = group.key === 'rating' ? `${this.number(option.key)} ★ ${this.label('filters.rating_up')}` : option.value;
                chips.push({ key, value, label: `${group.label}: ${text}` });
            });
        });

        return chips;
    }

    appliedHtml() {
        const chips = this.applied();
        if (!chips.length) return '';

        return `
            <div class="f-filters__widget f-filters__applied" data-widget="applied">
                <h3 class="f-filters__title">
                    <span>${this.escape(this.label('filters.selected'))}</span>
                </h3>
                <div class="f-filters__body">
                    <ul class="f-filters__chips">
                        ${chips.map(chip => `
                            <li class="f-filters__chip">
                                <span>${this.escape(chip.label)}</span>
                                <button type="button" class="f-filters__chip-remove" data-filters-remove="${this.escape(chip.key)}" data-value="${this.escape(String(chip.value === true ? '1' : (typeof chip.value === 'object' ? '' : chip.value)))}" aria-label="${this.escape(this.label('filters.remove'))} ${this.escape(chip.label)}">×</button>
                            </li>`).join('')}
                    </ul>
                    <button type="button" class="f-btn f-btn--outline btn btn--outline f-filters__reset" data-filters-reset>${this.escape(this.label('filters.reset'))}</button>
                </div>
            </div>`;
    }

    widgetHtml(option) {
        const open = this._open[option.key] ?? !this.boolAttr('collapsed');
        const values = Array.isArray(option.values) ? option.values : [];
        const searchable = values.length > 5 && option.key !== 'rating';
        const query = (this._search[option.key] || '').toLowerCase();
        const shown = query ? values.filter(item => String(item.value).toLowerCase().includes(query)) : values;
        const expanded = this._expanded[option.key] === true;
        const capped = (!query && !expanded) ? shown.slice(0, this.initialCount) : shown;
        const overflow = !query && shown.length > this.initialCount;

        return `
            <div class="f-filters__widget" data-widget="${this.escape(option.key)}" data-type="${this.escape(option.type)}" data-open="${open}">
                <h3 class="f-filters__title">
                    <button type="button" class="f-filters__toggle" data-filters-toggle="${this.escape(option.key)}" aria-expanded="${open}">
                        <span>${this.escape(option.label)}</span>
                        <span class="f-filters__plusminus" aria-hidden="true"></span>
                    </button>
                </h3>
                <div class="f-filters__body" ${open ? '' : 'hidden'}>
                    ${searchable ? `
                        <input type="search" class="f-input f-filters__search" data-filters-search="${this.escape(option.key)}"
                               value="${this.escape(this._search[option.key] || '')}" placeholder="${this.escape(this.label('filters.search'))}">` : ''}
                    <div class="f-filters__values">
                        ${option.type === 'range' ? this.rangeHtml(option) : ''}
                        ${option.type === 'boolean' ? this.booleanHtml(option) : ''}
                        ${['values', 'minimum'].includes(option.type)
                            ? (capped.length ? capped.map(item => this.optionHtml(option, item)).join('') : `<p class="f-filters__empty">${this.escape(this.label('filters.no_results'))}</p>`)
                            : ''}
                    </div>
                    ${overflow ? `
                        <button type="button" class="f-filters__more" data-filters-more="${this.escape(option.key)}">
                            ${this.escape(this.label(expanded ? 'filters.show_less' : 'filters.show_more'))}
                        </button>` : ''}
                </div>
            </div>`;
    }

    optionHtml(option, item) {
        const id = `f-filter-${option.key}-${String(item.key).replace(/[^a-z0-9_-]/gi, '')}`;
        const input = option.type === 'values' ? 'checkbox' : 'radio';
        const checked = this.isSelected(option, item.key);

        const text = option.key === 'rating'
            ? `<falak-rating-stars value="${this.escape(String(item.key))}"></falak-rating-stars><span class="f-filters__option-name f-filters__option-name--sr">${this.escape(this.label('filters.rating_up'))}</span>`
            : `<span class="f-filters__option-name">${this.escape(item.value)}</span>`;

        return `
            <label class="f-filters__option${checked ? ' is-selected' : ''}" for="${id}">
                <input id="${id}" type="${input}" name="${this.escape(option.key)}" value="${this.escape(String(item.key))}" ${checked ? 'checked' : ''}
                       class="f-filters__${input}" data-filters-input="${this.escape(option.key)}">
                ${text}
                ${item.count !== undefined && item.count !== null ? `<span class="f-filters__count">(${this.number(item.count)})</span>` : ''}
            </label>`;
    }

    booleanHtml(option) {
        const id = `f-filter-${option.key}`;
        const checked = this.isSelected(option, true);

        return `
            <label class="f-filters__option${checked ? ' is-selected' : ''}" for="${id}">
                <input id="${id}" type="checkbox" name="${this.escape(option.key)}" value="1" ${checked ? 'checked' : ''}
                       class="f-filters__checkbox" data-filters-input="${this.escape(option.key)}">
                <span class="f-filters__option-name">${this.escape(option.value_label || this.label('filters.in_stock'))}</span>
            </label>`;
    }

    rangeHtml(option) {
        const bounds = option.values || {};
        const min = Number(bounds.min ?? 0);
        const max = Number(bounds.max ?? 0);
        const current = this._selected[option.key] || {};
        const step = bounds.step ?? (max - min > 200 ? 5 : 1);

        if (!(max > min)) return '';

        return `
            <falak-price-range min="${min}" max="${max}" step="${step}"
                               value-min="${current.min ?? min}" value-max="${current.max ?? max}"
                               data-filters-range="${this.escape(option.key)}"></falak-price-range>`;
    }

    /* ------------------------------------------------------------- behaviour */

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            const toggle = event.target.closest('[data-filters-toggle]');
            if (toggle) {
                const key = toggle.getAttribute('data-filters-toggle');
                this._open[key] = !(this._open[key] ?? !this.boolAttr('collapsed'));
                this.render();
                return;
            }

            const more = event.target.closest('[data-filters-more]');
            if (more) {
                const key = more.getAttribute('data-filters-more');
                this._expanded[key] = !this._expanded[key];
                this.render();
                return;
            }

            const remove = event.target.closest('[data-filters-remove]');
            if (remove) {
                this.remove(remove.getAttribute('data-filters-remove'), remove.getAttribute('data-value'));
                return;
            }

            if (event.target.closest('[data-filters-reset]')) { this.resetFilters(); return; }
            if (event.target.closest('[data-filters-apply]')) this.applyFilters();
        });

        this.listen(this, 'input', event => {
            const search = event.target.closest('[data-filters-search]');
            if (!search) return;

            const key = search.getAttribute('data-filters-search');
            this._search[key] = search.value;

            // Re-render only the list: replacing the input would drop the caret.
            const widget = this.querySelector(`[data-widget="${CSS.escape(key)}"]`);
            const option = this._filters.find(item => item.key === key);
            if (!widget || !option) return;

            const fresh = document.createElement('div');
            fresh.innerHTML = this.widgetHtml(option);
            const values = fresh.querySelector('.f-filters__values');
            const more = fresh.querySelector('.f-filters__more');
            widget.querySelector('.f-filters__values')?.replaceWith(values);
            widget.querySelector('.f-filters__more')?.remove();
            if (more) widget.querySelector('.f-filters__body')?.append(more);
        });

        this.listen(this, 'change', event => {
            const range = event.target.closest('[data-filters-range]');
            if (range) {
                event.stopImmediatePropagation();
                const key = range.getAttribute('data-filters-range');
                const option = this._filters.find(item => item.key === key);
                const bounds = option?.values || {};
                const detail = event.detail || {};

                // At the full spread the filter is a no-op — drop it rather than
                // write the bounds into the URL.
                if (detail.min <= Number(bounds.min) && detail.max >= Number(bounds.max)) delete this._selected[key];
                else this._selected[key] = { min: detail.min, max: detail.max };

                this.changed();
                return;
            }

            const input = event.target.closest('[data-filters-input]');
            if (!input) return;

            event.stopImmediatePropagation();
            const key = input.getAttribute('data-filters-input');
            const option = this._filters.find(item => item.key === key);
            if (!option) return;

            this.select(option, input.value, input.checked);
            this.changed();
        });
    }

    select(option, value, checked) {
        if (option.type === 'boolean') {
            if (checked) this._selected[option.key] = true;
            else delete this._selected[option.key];
            return;
        }

        if (option.type === 'minimum') {
            if (checked) this._selected[option.key] = value;
            else delete this._selected[option.key];
            return;
        }

        const current = this._selected[option.key];
        const list = Array.isArray(current) ? [...current] : (current !== undefined && current !== null ? [current] : []);
        const next = checked ? [...list.filter(item => String(item) !== String(value)), value] : list.filter(item => String(item) !== String(value));

        if (next.length) this._selected[option.key] = next;
        else delete this._selected[option.key];
    }

    remove(key, value) {
        const option = this._filters.find(item => item.key === key);
        if (!option) return;

        if (option.type === 'range' || option.type === 'boolean' || option.type === 'minimum') delete this._selected[key];
        else this.select(option, value, false);

        this.changed(true);
    }

    /** A selection changed: apply now, or wait for the button in manual mode. */
    changed(force = false) {
        if (this.manual && !force) {
            this.render();
            return;
        }

        this.applyFilters();
    }

    /** Public: navigate (or emit) with the current selection. */
    async applyFilters() {
        const selection = { ...this._selected };

        this.emit('changed', selection);
        this.emitBus('filters::changed', selection);

        if (this.mode === 'event') {
            this.render();
            return;
        }

        this.setBusy(true);
        window.location.href = this.buildUrl(selection).toString();
    }

    /** Public: clear everything and apply. */
    async resetFilters() {
        this._selected = {};
        this.emitBus('filters::reset', {});

        return this.applyFilters();
    }
}
