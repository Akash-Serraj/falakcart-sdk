import FalakElement from '../base.js';

/**
 * <falak-notifications></falak-notifications>          (once per page)
 * <falak-notifications position="bottom-center"></falak-notifications>
 *
 * The platform's own toast stack, mirroring <salla-notifications>. Every
 * falak.notify.success() / .error() / .info() call — including the ones
 * fired internally by API responses — renders here as a dismissible,
 * auto-closing card, stacked with the newest last.
 *
 * It listens on the bus (`notify::fired`) rather than claiming Notify's one
 * `setNotifier()` handler slot, so it can sit ALONGSIDE a theme's own
 * bridge without either side knowing about the other. A theme that mounts
 * this element should stop routing its own bridge to it too, or a message
 * shows twice — see the guard in this theme's app.js.
 *
 * | attribute | role                                                         |
 * | position  | top-end (default) | top-start | top-center |                |
 * |           | bottom-end | bottom-start | bottom-center                  |
 *
 * Events: `falak::toast.shown` / `falak::toast.dismissed` on the bus, each
 * with `{ id, type }`.
 */
export default class FalakNotifications extends FalakElement {
    static observedAttributes = ['position'];

    static TYPES = ['success', 'error', 'info', 'warning'];

    static _seq = 0;

    static ICON = {
        success: '<svg class="f-toast__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
        error: '<svg class="f-toast__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 16.5h.01"/></svg>',
        warning: '<svg class="f-toast__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 21.5 20h-19L12 3.5Z"/><path d="M12 9.5v4M12 16.5h.01"/></svg>',
        info: '<svg class="f-toast__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 15.5v-5M12 8h.01"/></svg>',
    };

    get position() { return this.attr('position', 'top-end'); }

    render() {
        this.classList.add('f-notifications', `f-notifications--${this.position}`);
        this.setAttribute('aria-live', 'polite');

        const toasts = this._toasts || [];

        this.innerHTML = toasts.map(toast => `
            <div class="f-toast f-toast--${toast.type}" data-toast-id="${toast.id}" role="${toast.type === 'error' ? 'alert' : 'status'}">
                ${FalakNotifications.ICON[toast.type]}
                <p class="f-toast__message">${this.escape(toast.message)}</p>
                <button type="button" class="f-toast__close" data-toast-close="${toast.id}" aria-label="${this.escape(this.trans('common.close'))}">&times;</button>
            </div>`).join('');

        // Every render rebuilds the list from scratch, so any card just
        // written in — new, or a survivor after another one closed — starts
        // without .is-in and gets it next frame, playing its entrance.
        requestAnimationFrame(() => this.querySelectorAll('.f-toast').forEach(node => node.classList.add('is-in')));
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this._toasts = [];
        this._off = this.sdk.event.on('notify::fired', payload => this.push(payload?.message, payload?.type));

        this.listen(this, 'click', event => {
            const close = event.target.closest('[data-toast-close]');
            if (close) this.dismiss(Number(close.getAttribute('data-toast-close')));
        });
    }

    disconnectedCallback() {
        if (typeof this._off === 'function') this._off();
        (this._toasts || []).forEach(toast => clearTimeout(toast.timer));
        super.disconnectedCallback();
    }

    /** Also callable directly — falak.event.dispatch('notify::fired', {...}) is not the only way in. */
    push(message, type = 'info') {
        if (!message) return null;

        const id = ++FalakNotifications._seq;
        const kind = FalakNotifications.TYPES.includes(type) ? type : 'info';
        const toast = { id, message: String(message), type: kind };

        toast.timer = setTimeout(() => this.dismiss(id), kind === 'error' ? 5000 : 3200);

        this._toasts = [...this._toasts, toast];
        this.render();

        this.emitBus('toast.shown', { id, type: kind });

        return id;
    }

    dismiss(id) {
        const toast = this._toasts.find(item => item.id === id);
        if (!toast) return;

        clearTimeout(toast.timer);

        const node = this.querySelector(`[data-toast-id="${id}"]`);

        if (!node) {
            this._toasts = this._toasts.filter(item => item.id !== id);
            this.render();
        } else {
            // Let the exit transition play before the card actually leaves.
            node.classList.remove('is-in');
            node.classList.add('is-out');
            setTimeout(() => {
                this._toasts = this._toasts.filter(item => item.id !== id);
                this.render();
            }, 200);
        }

        this.emitBus('toast.dismissed', { id });
    }
}
