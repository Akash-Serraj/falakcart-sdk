/**
 * Translations.
 *
 * Themes ship src/locales/{locale}.json and the platform resolves merchant
 * overrides on top, so by the time this runs the strings are usually already
 * inlined by the render. `onLoaded()` exists for the case where they are not:
 * components render once with keys as placeholders and re-render when the
 * strings land, rather than blocking first paint on a fetch.
 */
export default class Lang {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.messages = {};
        this.loaded = false;
        this.waiting = [];
    }

    get locale() {
        return this.config.get('locale', 'ar');
    }

    get isRtl() {
        return !!this.config.get('theme.is_rtl', this.locale === 'ar');
    }

    setMessages(messages) {
        this.messages = messages || {};
        this.loaded = true;

        const waiting = this.waiting;
        this.waiting = [];
        waiting.forEach(resolve => resolve());

        return this;
    }

    /**
     * trans('product.add_to_cart') with {placeholder} interpolation.
     * A missing key returns the key itself — the same contract the platform's
     * TranslationResolver uses server-side, so a gap looks identical on both
     * sides instead of rendering as an empty string.
     */
    get(key, replacements = {}) {
        /*
         * Both shapes are accepted. The platform's TranslationResolver returns
         * a FLAT map keyed by the dotted string, while a theme's locale JSON is
         * usually nested — and the same key must work either way, or a string
         * would resolve in Twig and render as its own key in a component.
         */
        let value = this.messages[key];

        if (typeof value !== 'string') {
            value = key.split('.').reduce(
                (node, segment) => (node && typeof node === 'object' ? node[segment] : undefined),
                this.messages,
            );
        }

        if (typeof value !== 'string') {
            this.logger.log(`missing translation: ${key}`);
            return key;
        }

        return Object.entries(replacements).reduce(
            (text, [name, replacement]) => text.replace(new RegExp(`\{${name}\}`, 'g'), replacement),
            value,
        );
    }

    /** Resolves immediately when strings are already in hand. */
    onLoaded(callback) {
        const promise = this.loaded
            ? Promise.resolve()
            : new Promise(resolve => this.waiting.push(resolve));

        return callback ? promise.then(callback) : promise;
    }
}
