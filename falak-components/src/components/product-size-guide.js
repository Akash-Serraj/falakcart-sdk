import FalakElement from '../base.js';

/**
 * <falak-product-size-guide product-id="12" fetch></falak-product-size-guide>
 * <falak-product-size-guide product-id="12" content="&lt;table&gt;…" image="/storage/size.png"></falak-product-size-guide>
 *
 * The "Size guide" link that opens the product's size chart in a dialog —
 * mirroring <salla-product-size-guide>. The guide is the product's
 * `size_guide` (rich text, per language) and/or `size_guide_image`, set
 * by the merchant on the product. Nothing set → the element renders
 * nothing, so a theme can place it unconditionally.
 *
 * | attribute  | role                                                     |
 * | product-id | required                                                 |
 * | content    | the guide's HTML, when the theme has it server-side      |
 * | image      | the chart image URL, likewise                            |
 * | fetch      | read both from the product API instead                   |
 * | link-class | class(es) for the trigger link                           |
 */
export default class FalakProductSizeGuide extends FalakElement {
    static observedAttributes = ['product-id', 'content', 'image', 'fetch', 'link-class'];

    get productId() { return this.attr('product-id'); }
    get linkClass() { return this.attr('link-class', 'f-size-guide__link'); }

    get content() { return this._content ?? this.attr('content', ''); }
    get image() { return this._image ?? this.attr('image', ''); }
    get hasGuide() { return !!(String(this.content).trim() || this.image); }

    render() {
        this.classList.add('f-size-guide');

        if (!this.hasGuide) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.innerHTML = `
            <button type="button" class="${this.escape(this.linkClass)}" data-size-guide-open>
                ${FalakProductSizeGuide.ICON}
                <span>${this.escape(this.trans('product.size_guide'))}</span>
            </button>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-size-guide-open]')) this.open();
        });

        if (this.boolAttr('fetch') && !this.hasGuide && this.productId) this.load();
    }

    disconnectedCallback() {
        this._modal?.remove();
        super.disconnectedCallback();
    }

    async load() {
        try {
            const response = await this.sdk.api.withoutNotifier(() => this.sdk.product.show(this.productId));
            const product = response?.data ?? response;
            const locale = this.sdk.lang.locale;

            this._content = (locale === 'ar' && product?.size_guide_ar) || product?.size_guide || '';
            this._image = product?.size_guide_image_url || product?.size_guide_image || '';
        } catch (error) {
            this._content = '';
            this._image = '';
        }

        this.render();
    }

    open() {
        this._modal?.remove();

        const modal = document.createElement('falak-modal');
        modal.setAttribute('width', 'lg');
        modal.setAttribute('modal-title', this.trans('product.size_guide'));
        modal.className = 'f-size-guide__modal';
        modal.innerHTML = `
            <div class="f-size-guide__body">
                ${this.image ? `<img class="f-size-guide__image" src="${this.escape(this.image)}" alt="${this.escape(this.trans('product.size_guide'))}">` : ''}
                ${String(this.content).trim() ? `<div class="f-size-guide__content">${this.sanitize(this.content)}</div>` : ''}
            </div>`;

        this.appendChild(modal);
        this._modal = modal;
        Promise.resolve().then(() => modal.open());
        this.emitBus('product::size-guide.opened', { productId: this.productId });
    }

    /** Merchant-authored HTML: tables, lists and text — never scripts or handlers. */
    sanitize(html) {
        const doc = new DOMParser().parseFromString(String(html), 'text/html');

        doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(el => el.remove());
        doc.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on') || (name === 'href' && /^\s*javascript:/i.test(attr.value)) || name === 'srcdoc') el.removeAttribute(attr.name);
            });
        });

        return doc.body.innerHTML;
    }

    static ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17 17 3l4 4L7 21H3v-4Z"/><path d="m14 6 2 2M11 9l2 2M8 12l2 2"/></svg>';
}
