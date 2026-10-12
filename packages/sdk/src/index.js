/**
 * FalakCart Storefront SDK — assembly point.
 *
 * `window.falak` is a plain object built up in dependency order, not a class
 * anyone instantiates. Themes, components and merchant scripts all reach the
 * same instance, which is the entire reason it exists: one cart identity, one
 * event bus, one set of credentials, however many scripts are on the page.
 *
 * Boot sequence:
 *   1. this file runs           -> window.falak exists, status 'loading'
 *   2. body:end calls init()    -> config merged, status 'ready'
 *   3. 'falak::initiated' fires -> onReady() callbacks run
 */
import Config from './core/config.js';
import Logger from './core/logger.js';
import Storage from './core/storage.js';
import Helpers from './core/helpers.js';
import { Emitter } from './core/emitter.js';
import registerEvents from './events.js';
import ApiClient from './api/client.js';
import ProductApi from './api/product.js';
import ReviewApi from './api/review.js';
import QuestionApi from './api/question.js';
import CartApi from './api/cart.js';
import WishlistApi from './api/wishlist.js';
import CheckoutApi from './api/checkout.js';
import BuyNowApi from './api/buyNow.js';
import AuthApi from './api/auth.js';
import LocalizationApi from './api/localization.js';
import OfferApi from './api/offer.js';
import ContactApi from './api/contact.js';
import NewsletterApi from './api/newsletter.js';
import Lang from './lang.js';
import Notify from './notify.js';

/*
 * Injected at build time from this package's package.json — the one place a
 * version is written down. Falls back for code paths that import the source
 * directly without Vite (tests).
 */
const VERSION = typeof __FALAK_VERSION__ !== 'undefined' ? __FALAK_VERSION__ : '0.0.0-dev';

/**
 * Merges a domain's API and events into one addressable object.
 *
 * `falak.product.fetch()` reads better than `falak.api.product.fetch()` at a
 * call site, but `falak.product.event.onFetched()` still has to work — so this
 * forwards unknown keys to the API while reserving `.api` and `.event`.
 * There is no third implementation; they are the same two objects.
 */
function domain(api, event) {
    return new Proxy({ api, event }, {
        get(target, key) {
            if (key === 'api') return api;
            if (key === 'event') return event;

            const value = api?.[key];

            return typeof value === 'function' ? value.bind(api) : (value ?? target[key]);
        },
        has(target, key) {
            return key in target || key in api;
        },
        /*
         * Writes land on the API instance when it owns the key. Without this
         * `falak.cart.loaded = false` set a property on the proxy's own
         * target while every read kept coming from the instance — a silent
         * no-op that looked like it worked.
         */
        set(target, key, value) {
            if (api && key in api) api[key] = value;
            else target[key] = value;

            return true;
        },
    });
}

function createSdk() {
    const config = new Config();
    const logger = new Logger(config);
    const emitter = new Emitter(logger);
    const storage = new Storage();
    const helpers = new Helpers(config);
    const notify = new Notify(logger, emitter);
    const lang = new Lang(config, logger);

    // Namespaced event surfaces hang off the raw bus, so both
    // falak.event.on('product::fetched') and falak.event.product.onFetched()
    // address the same listener list.
    const events = registerEvents(emitter);
    Object.assign(emitter, events);

    const client = new ApiClient({ config, event: emitter, logger, notify, helpers });

    const api = {
        client,
        product: new ProductApi(client, events.product),
        review: new ReviewApi(client, events.review, config),
        question: new QuestionApi(client, events.question, config),
        cart: new CartApi(client, events.cart, config),
        wishlist: new WishlistApi(client, events.wishlist, config, storage),
        checkout: new CheckoutApi(client, events.checkout, config),
        buyNow: new BuyNowApi(client, events.buyNow),
        auth: new AuthApi(client, events.auth, config, storage),
        localization: new LocalizationApi(client, events.localization, config, storage),
        offer: new OfferApi(client, events.offer, storage),
        contact: new ContactApi(client, events.contact),
        newsletter: new NewsletterApi(client, events.newsletter),
        request: (path, options) => client.request(path, options),
        withoutNotifier: callback => client.withoutNotifier(callback),
    };

    const falak = {
        version: VERSION,
        status: 'loading',

        config,
        logger,
        log: (...args) => logger.log(...args),
        storage,
        helpers,
        event: emitter,
        lang,
        notify,
        api,

        url: helpers.url,
        money: (amount, currency, options) => helpers.money(amount, currency, options),
        convert: (amount, to, from) => helpers.convert(amount, to, from),
        number: value => helpers.number(value),

        product: domain(api.product, events.product),
        review: domain(api.review, events.review),
        question: domain(api.question, events.question),
        cart: domain(api.cart, events.cart),
        wishlist: domain(api.wishlist, events.wishlist),
        checkout: domain(api.checkout, events.checkout),
        buyNow: domain(api.buyNow, events.buyNow),
        auth: domain(api.auth, events.auth),
        localization: domain(api.localization, events.localization),
        offer: domain(api.offer, events.offer),
        contact: domain(api.contact, events.contact),
        newsletter: domain(api.newsletter, events.newsletter),
        ui: domain({}, events.ui),
    };

    /**
     * Called once by the platform at body:end with the server-rendered context.
     * Safe to call again (the customizer re-renders drafts in place); a second
     * call merges config and re-announces readiness without rebuilding state.
     */
    falak.init = function init(options = {}) {
        config.merge(options);

        if (options.translations) lang.setMessages(options.translations);

        /*
         * Restore the signed-in customer before anything reads config.
         *
         * The storefront renders as a guest — the page is cached and shared —
         * so the token only exists in this browser's storage. Reading it here
         * means every request after init carries it, and a component asking
         * `falak.auth.isLoggedIn()` during its first render gets the truth
         * rather than "guest" followed by a flicker.
         *
         * A token supplied in the config blob wins: that is the server telling
         * us about a session it already validated.
         */
        if (!config.get('token')) {
            const stored = storage.get('auth.token');
            if (stored) config.set('token', stored);
        }

        if (!config.get('user')) {
            const stored = storage.get('auth.user');
            if (stored) config.set('user', stored);
        }

        /*
         * Two sessions must agree: this storage token (what the API sees) and
         * the HttpOnly cookie (what server-rendered pages see). The cookie can
         * go missing on its own — expired, cleared, or issued for a domain the
         * browser refused — and then the header counts a cart the cart page
         * renders as empty. The server says whether it recognised a customer
         * (`auth.server`); if it did not but we hold a token, re-set the
         * cookie from here and reload once. Once per token: a token the server
         * rejects would otherwise loop.
         */
        if (config.get('token') && config.get('auth.server') === false) {
            api.auth.syncCookie({ reload: true });
        }

        // A theme that ships strings inline has nothing to wait for.
        if (!lang.loaded && config.get('theme.translations_inline', true)) {
            lang.setMessages(options.translations || window.falakTranslations || {});
        }

        document.documentElement.setAttribute('data-falak-ready', 'true');

        falak.status = 'ready';
        logger.log(`SDK ready (v${VERSION})`, config.all());

        emitter.emit('falak::initiated', config.all());

        return falak;
    };

    /**
     * The ordering gate every component sits behind. Idempotent by design:
     * script order on a merchant page is not something the SDK controls, so
     * this must behave identically whether it is called before or after init.
     */
    falak.onReady = function onReady(callback) {
        return new Promise(resolve => {
            if (falak.status === 'ready') {
                resolve(callback ? callback(config.all()) : config.all());
                return;
            }

            emitter.once('falak::initiated', () => {
                resolve(callback ? callback(config.all()) : config.all());
            });
        });
    };

    falak.onInitiated = callback => emitter.once('falak::initiated', callback);

    return falak;
}

/** A live SDK instance, as opposed to the platform's `{ boot }` placeholder. */
function isSdk(value) {
    return !!value && typeof value.onReady === 'function' && typeof value.init === 'function';
}

function install() {
    /*
     * The platform already writes `window.Falak = { boot: {...} }` before this
     * script loads. `boot` is folded into config as the initial context, and
     * any other key a merchant script parked on the placeholder is carried
     * over rather than silently dropped — unless it would shadow SDK API.
     */
    const existing = (typeof window !== 'undefined' && (window.falak || window.Falak)) || {};

    /*
     * Loaded twice (a theme that also includes the CDN build, a customizer
     * preview re-injecting it) keeps the FIRST instance. A second instance
     * would replace window.falak with an empty event bus and no credentials,
     * and every listener registered so far would stop firing — the one thing
     * this object exists to prevent.
     */
    if (isSdk(existing)) {
        if (existing.version !== VERSION) {
            console.warn(`[falak] SDK v${VERSION} loaded over v${existing.version}; keeping v${existing.version}.`);
        }

        return existing;
    }

    const sdk = createSdk();

    Object.keys(existing).forEach(key => {
        if (key !== 'boot' && !(key in sdk)) sdk[key] = existing[key];
    });

    if (existing.boot) {
        sdk.config.merge({
            store: { id: existing.boot.storeId },
            locale: existing.boot.locale,
            cart: { count: existing.boot.cartCount },
        });
        sdk.boot = existing.boot;
    }

    if (typeof window !== 'undefined') {
        window.falak = sdk;
        window.Falak = sdk;   // both spellings, one object

        // Lets code that loaded first (the npm accessor's `loaded()`) learn
        // the instance exists without polling for it.
        document.dispatchEvent(new CustomEvent('falak:loaded', { detail: sdk }));
    }

    return sdk;
}

const sdk = install();

export default sdk;
