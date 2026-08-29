import FalakElement from '../base.js';

/**
 * <falak-notification-item title="Your order shipped" body="On its way." created-at="2026-08-24T10:00:00Z" url="/customer/orders/ORD1" unread></falak-notification-item>
 * <falak-notification-item title="Price drop on a saved item" type="wishlist"></falak-notification-item>
 *
 * One row of a customer's notification history — mirroring
 * <salla-notification-item>. Deliberately separate from
 * <falak-notifications> (the toast stack): that one is an ephemeral alert
 * that disappears in seconds; this is a persisted item in a list a customer
 * can come back to and re-read.
 *
 * | attribute  | role                                                        |
 * | title      | required                                                    |
 * | body       | optional detail line                                        |
 * | url        | wraps the item in a link when given                          |
 * | created-at | an ISO date/time, shown as a relative "2 days ago"           |
 * | type       | order (default) | wishlist | account | promo — picks the icon |
 * | unread     | shows the unread dot; clicking marks it read                 |
 *
 * Events: DOM `read` on the element — the list this sits in owns actually
 * persisting that server-side; this only signals that a click happened.
 */
export default class FalakNotificationItem extends FalakElement {
    static observedAttributes = ['title', 'body', 'url', 'created-at', 'type', 'unread'];

    static ICON = {
        order: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16v13H4z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></svg>',
        wishlist: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.3A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.7c0 4.9-7 9.3-7 9.3z"/></svg>',
        account: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
        promo: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6M2 7h20v5H2zM12 22V7M12 7a2.5 2.5 0 1 1 2.5-2.5A2.5 2.5 0 0 1 12 7Zm0 0A2.5 2.5 0 1 0 9.5 4.5 2.5 2.5 0 0 0 12 7Z"/></svg>',
    };

    get unread() { return this.boolAttr('unread'); }

    render() {
        this.classList.add('f-notification-item');
        this.classList.toggle('is-unread', this.unread);

        const title = this.attr('title', '');
        const body = this.attr('body', '');
        const url = this.attr('url', '');
        const time = this.relativeTime(this.attr('created-at', ''));

        const content = `
            <span class="f-notification-item__icon" aria-hidden="true">${FalakNotificationItem.ICON[this.attr('type', 'order')] || FalakNotificationItem.ICON.order}</span>
            <span class="f-notification-item__text">
                <strong class="f-notification-item__title">${this.escape(title)}</strong>
                ${body ? `<span class="f-notification-item__body">${this.escape(body)}</span>` : ''}
                ${time ? `<time class="f-notification-item__time">${this.escape(time)}</time>` : ''}
            </span>
            ${this.unread ? '<span class="f-notification-item__dot" aria-hidden="true"></span>' : ''}`;

        this.innerHTML = url
            ? `<a class="f-notification-item__link" href="${this.escape(url)}">${content}</a>`
            : content;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', () => {
            if (!this.unread) return;

            this.removeAttribute('unread');
            this.emit('read');
        });
    }

    relativeTime(value) {
        if (!value) return '';

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';

        const seconds = Math.round((date.getTime() - Date.now()) / 1000);
        const units = [
            ['year', 31536000], ['month', 2592000], ['week', 604800],
            ['day', 86400], ['hour', 3600], ['minute', 60],
        ];

        try {
            const formatter = new Intl.RelativeTimeFormat(this.sdk.lang.locale, { numeric: 'auto' });

            for (const [unit, secondsInUnit] of units) {
                if (Math.abs(seconds) >= secondsInUnit) return formatter.format(Math.round(seconds / secondsInUnit), unit);
            }

            return formatter.format(seconds, 'second');
        } catch (error) {
            return date.toISOString().slice(0, 10);
        }
    }
}
