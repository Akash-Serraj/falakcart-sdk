import FalakElement from '../base.js';

/**
 * <falak-apps-icons>            store's mobile apps, from config
 * <falak-apps-icons vertical>   stacked rather than in a row
 *
 * Renders nothing at all when the merchant has no apps — a footer column with a
 * heading and no content below it looks like a rendering bug.
 */
export default class FalakAppsIcons extends FalakElement {
    static observedAttributes = ['vertical', 'hide-title'];

    /** Only these two are recognised; an unknown key would have no badge to draw. */
    static STORES = {
        ios: { label: 'App Store', sub: 'Download on the' },
        android: { label: 'Google Play', sub: 'Get it on' },
    };

    get apps() {
        const configured = this.jsonAttr('apps', null) || this.sdk.config.get('store.apps', {});

        return Object.entries(configured || {})
            .filter(([store, url]) => url && FalakAppsIcons.STORES[store])
            .map(([store, url]) => ({ store, url, ...FalakAppsIcons.STORES[store] }));
    }

    render() {
        const apps = this.apps;

        if (!apps.length) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.classList.add('f-apps');
        this.classList.toggle('f-apps--vertical', this.boolAttr('vertical'));

        const title = this.boolAttr('hide-title')
            ? ''
            : (this.attr('apps-title') || this.trans('footer.download_apps'));

        this.innerHTML = `
            ${title ? `<h3 class="f-apps__title">${this.escape(title)}</h3>` : ''}
            <div class="f-apps__list">
                ${apps.map(app => `
                    <a class="f-apps__item f-apps__item--${app.store}"
                       href="${this.escape(app.url)}" target="_blank" rel="noopener noreferrer"
                       aria-label="${this.escape(app.sub)} ${this.escape(app.label)}">
                        <span class="f-apps__glyph" aria-hidden="true">${GLYPHS[app.store]}</span>
                        <span class="f-apps__text">
                            <span class="f-apps__sub">${this.escape(app.sub)}</span>
                            <span class="f-apps__store">${this.escape(app.label)}</span>
                        </span>
                    </a>`).join('')}
            </div>`;
    }
}

const GLYPHS = {
    ios: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M16.1 12.7c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.8-2-1.6-.2-3.1.9-3.9.9s-2.1-.9-3.4-.9c-1.8 0-3.4 1-4.3 2.6-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3-.05 1.8-.8 3.4-.8s2 .8 3.4.8 2.3-1.3 3.1-2.6c1-1.5 1.4-2.9 1.4-3-.03-.02-2.6-1-2.6-4.2M13.6 4.9c.7-.9 1.2-2.1 1.1-3.3-1 .04-2.3.7-3 1.6-.6.8-1.2 2-1.1 3.2 1.1.1 2.3-.6 3-1.5"/></svg>',
    android: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3.6 2.3a1 1 0 0 0-.5.9v17.6a1 1 0 0 0 .5.9l9.3-9.7zM14.2 10.4 4.9 1.6l10.6 6.1zM4.9 22.4l9.3-8.8 1.3 2.7zM17.2 9l3 1.7c.9.5.9 1.8 0 2.3l-3 1.7-2.1-2.9z"/></svg>',
};
