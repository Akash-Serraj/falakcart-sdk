import FalakElement from '../base.js';

/**
 * <falak-modal id="size-guide" modal-title="Size guide" width="md">…</falak-modal>
 *
 * The base every dialog in the set builds on — login, offer and localization all
 * extend or compose it rather than reimplementing focus handling and dismissal.
 *
 * Two ways to drive it, matching Salla:
 *   element.open() / .close()                     when you hold a reference
 *   falak.event.dispatch('modal::open', 'id')     when you do not
 *
 * The bus form is what makes a modal reachable from a Twig page or a merchant
 * script that has no way to query for the element.
 */
export default class FalakModal extends FalakElement {
    static observedAttributes = ['visible', 'modal-title', 'sub-title', 'width', 'position', 'is-loading'];

    get isClosable() { return this.attr('is-closable', 'true') !== 'false'; }
    get width() { return this.attr('width', 'md'); }
    get position() { return this.attr('position', 'middle'); }
    get visible() { return this.hasAttribute('visible'); }
    get isLoading() { return this.boolAttr('is-loading'); }
    get centered() { return this.boolAttr('centered'); }
    get noPadding() { return this.boolAttr('no-padding'); }
    get subTitleFirst() { return this.boolAttr('sub-title-first'); }

    /* ------------------------------------------------------ imperative API */

    open() {
        this.setAttribute('visible', '');
        return this;
    }

    close() {
        this.removeAttribute('visible');
        return this;
    }

    toggle() {
        return this.visible ? this.close() : this.open();
    }

    setTitle(title) {
        this.setAttribute('modal-title', title);
        return this;
    }

    loading() {
        this.setAttribute('is-loading', '');
        return this;
    }

    stopLoading() {
        this.removeAttribute('is-loading');
        return this;
    }

    /* -------------------------------------------------------------- setup */

    setup() {
        this.id = this.id || 'falak-modal';

        // Targeted by id so several modals can share the bus without a
        // dispatch opening all of them.
        this._offOpen = this.sdk.event.on('modal::open', target => {
            if (this.matchesTarget(target)) this.open();
        });

        this._offClose = this.sdk.event.on('modal::close', target => {
            if (this.matchesTarget(target)) this.close();
        });

        this.listen(document, 'keydown', event => {
            if (event.key === 'Escape' && this.visible) this.dismiss('escape');
        });
    }

    /** Accepts a bare id or `{ id }`; a dispatch with no target closes nothing. */
    matchesTarget(target) {
        if (target === null || target === undefined) return false;
        const id = typeof target === 'object' ? target.id : target;
        return String(id) === this.id;
    }

    disconnectedCallback() {
        this._offOpen?.();
        this._offClose?.();
        this.releaseScroll();
        super.disconnectedCallback();
    }

    /* ------------------------------------------------------------- render */

    render() {
        if (this._contentHtml === undefined) this._contentHtml = this.innerHTML;

        const title = this.attr('modal-title', '');
        const subTitle = this.attr('sub-title', '');
        const hasHeader = !!(title || subTitle);

        this.classList.add('f-modal');
        this.setAttribute('role', 'dialog');
        this.setAttribute('aria-modal', 'true');

        const body = this.isLoading
            ? `<div class="f-modal__loading"><span class="f-modal__spinner" aria-hidden="true"></span></div>
               <div class="f-hidden">${this._contentHtml}</div>`
            : `
                <div class="f-modal__header${this.centered ? ' f-modal__header--center' : ''}">
                    ${this.isClosable
                        ? `<button type="button" class="f-modal__close" data-modal-close
                                   aria-label="${this.escape(this.trans('common.close'))}">&times;</button>`
                        : ''}
                    ${hasHeader
                        ? `<div class="f-modal__heading${this.subTitleFirst ? ' f-modal__heading--reverse' : ''}">
                               ${title ? `<h2 class="f-modal__title">${this.escape(title)}</h2>` : ''}
                               ${subTitle ? `<p class="f-modal__subtitle">${this.escape(subTitle)}</p>` : ''}
                           </div>`
                        : ''}
                </div>
                ${this._contentHtml}`;

        this.innerHTML = `
            <div class="f-modal__overlay" data-modal-close></div>
            <div class="f-modal__wrapper f-modal__wrapper--${this.position}">
                <div class="f-modal__body f-modal__body--${this.isLoading ? 'xs' : this.width}${this.noPadding ? ' f-modal__body--flush' : ''}">
                    ${body}
                </div>
            </div>`;

        this.setAttribute('data-visible', String(this.visible));
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-modal-close]')) {
                this.dismiss(event.target.closest('.f-modal__overlay') ? 'backdrop' : 'close-button');
            }
        });
    }

    /* -------------------------------------------------------- visibility */

    onAttributeChange(name) {
        if (name !== 'visible') return;

        this.setAttribute('data-visible', String(this.visible));

        if (this.visible) {
            this.lockScroll();
            this.emit('modal-open', { id: this.id });
            this.emitBus('modal::opened', { id: this.id });
            this.focusFirst();
        } else {
            this.releaseScroll();
            this.emit('modal-close', { id: this.id });
            this.emitBus('modal::closed', { id: this.id });
            this._opener?.focus?.();
        }
    }

    dismiss(reason) {
        if (!this.isClosable) return;
        this._dismissReason = reason;
        this.close();
    }

    /**
     * Focus moves into the dialog on open and returns to whatever opened it on
     * close, so keyboard users are not dropped at the top of the document.
     */
    focusFirst() {
        this._opener = document.activeElement;

        setTimeout(() => {
            const target = this.querySelector('input, textarea, select, [autofocus]')
                || this.querySelector('.f-modal__close');
            target?.focus?.();
        }, 60);
    }

    /*
     * Scroll lock is reference-counted on the document rather than a boolean:
     * a modal opened from inside another modal must not release the lock for
     * both when only the inner one closes.
     */
    lockScroll() {
        const depth = Number(document.body.dataset.falakModalDepth || 0) + 1;
        document.body.dataset.falakModalDepth = String(depth);
        document.body.classList.add('f-modal-open');
    }

    releaseScroll() {
        const depth = Math.max(0, Number(document.body.dataset.falakModalDepth || 0) - 1);

        if (depth === 0) {
            delete document.body.dataset.falakModalDepth;
            document.body.classList.remove('f-modal-open');
            return;
        }

        document.body.dataset.falakModalDepth = String(depth);
    }
}
