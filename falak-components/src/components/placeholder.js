import FalakElement from '../base.js';

/**
 * <falak-placeholder icon="🛒" text="Your cart is empty" action-text="Start shopping" action-href="/products"></falak-placeholder>
 * <falak-placeholder icon="🔍" text="No results found"></falak-placeholder>
 * <falak-placeholder text="Nothing here yet"><button slot="action" type="button">Retry</button></falak-placeholder>
 *
 * The "nothing here" block — mirroring <salla-placeholder>: an empty cart,
 * no search results, no orders yet. One consistent look wherever a page has
 * nothing to show, instead of every template hand-rolling its own icon,
 * message and button.
 *
 * | attribute    | role                                                     |
 * | icon         | an emoji or short glyph (optional)                       |
 * | text         | the message                                              |
 * | action-text / action-href | a link shown below the message            |
 * | action-style | primary (default) | outline                             |
 * | action-class | class(es) for the link, replacing action-style entirely — |
 * |              | so a theme's own `.btn` skin applies instead of the SDK's |
 *
 * A `slot="action"` child (any markup — a button, a form) replaces the
 * generated link entirely, for a case the two attributes can't cover.
 */
export default class FalakPlaceholder extends FalakElement {
    static observedAttributes = ['icon', 'text', 'action-text', 'action-href', 'action-style', 'action-class'];

    get icon() { return this.attr('icon', ''); }
    get text() { return this.attr('text', ''); }

    connectedCallback() {
        // Author markup is the action. Captured before the first render
        // replaces it — and only once, so re-renders keep it.
        if (this._action === undefined) {
            const slotted = this.querySelector('[slot="action"]');
            this._action = slotted ? slotted.outerHTML : null;
        }

        return super.connectedCallback();
    }

    render() {
        this.classList.add('f-placeholder');

        const actionText = this.attr('action-text', '');
        const actionHref = this.attr('action-href', '');
        const actionClass = this.attr('action-class', '');
        const outline = this.attr('action-style', 'primary') === 'outline';
        const classes = actionClass || `f-btn ${outline ? 'f-btn--light-outline' : 'f-btn--primary'}`;

        const action = this._action
            ?? (actionText && actionHref
                ? `<a class="${classes} f-placeholder__action" href="${this.escape(actionHref)}">${this.escape(actionText)}</a>`
                : '');

        this.innerHTML = `
            ${this.icon ? `<div class="f-placeholder__icon" aria-hidden="true">${this.escape(this.icon)}</div>` : ''}
            ${this.text ? `<p class="f-placeholder__text">${this.escape(this.text)}</p>` : ''}
            ${action}`;
    }
}
