import FalakElement from '../base.js';

/**
 * <falak-maintenance-alert enabled title="We'll be back soon"
 *                          message="The store is undergoing scheduled maintenance."></falak-maintenance-alert>
 *
 * A prominent, store-wide notice — mirroring <salla-maintenance-alert>:
 * scheduled maintenance, a temporary pause on orders, anything every
 * visitor needs to see regardless of which page they land on. Unlike
 * <falak-announcement> (a promotional strip that can scroll and is
 * dismissible by default), this is plain and static, and — by default —
 * NOT dismissible: a maintenance notice a visitor can wave away defeats
 * the point of showing it.
 *
 * | attribute   | role                                                      |
 * | enabled     | the merchant switched it on; hides itself otherwise       |
 * | title       | short heading (optional)                                  |
 * | message     | the notice itself — hides itself if this is empty too     |
 * | dismissible | let a visitor close it for their own session               |
 */
export default class FalakMaintenanceAlert extends FalakElement {
    static observedAttributes = ['enabled', 'title', 'message', 'dismissible'];

    static ICON = '<svg class="f-maintenance__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 16.5h.01"/></svg>';

    get message() { return this.attr('message', ''); }
    get dismissible() { return this.boolAttr('dismissible'); }

    render() {
        this.classList.add('f-maintenance');

        if (!this.boolAttr('enabled') || !this.message || this.dismissed()) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.setAttribute('role', 'alert');

        const title = this.attr('title', '');

        this.innerHTML = `
            ${FalakMaintenanceAlert.ICON}
            <div class="f-maintenance__text">
                ${title ? `<strong class="f-maintenance__title">${this.escape(title)}</strong>` : ''}
                <span class="f-maintenance__message">${this.escape(this.message)}</span>
            </div>
            ${this.dismissible ? `<button type="button" class="f-maintenance__close" data-maintenance-close aria-label="${this.escape(this.trans('common.close'))}">&times;</button>` : ''}`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-maintenance-close]')) this.dismiss();
        });
    }

    /** Dismissal is remembered per message — like <falak-announcement> — so a new notice reappears for everyone. */
    dismissKey() {
        return `maintenance.dismissed.${this.message.replace(/\s+/g, ' ').trim().slice(0, 160)}`;
    }

    dismissed() {
        return this.dismissible && !!this.sdk.storage.get(this.dismissKey());
    }

    dismiss() {
        this.sdk.storage.set(this.dismissKey(), 1);
        this.render();
    }
}
