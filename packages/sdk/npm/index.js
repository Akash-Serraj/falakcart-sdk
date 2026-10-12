/**
 * The npm entry point of @falakcart/sdk.
 *
 * It deliberately contains NO SDK. The runtime is injected into every
 * storefront by the platform; a theme that bundled its own copy would put a
 * second window.falak on the page — a second event bus, a second set of
 * credentials, a second cart — and quietly break every component listening to
 * the first. So this module only hands you the platform's instance, typed.
 *
 *   import falak, { ready } from '@falakcart/sdk';
 *
 *   falak.cart.add(42);                       // resolved at call time
 *   const sdk = await ready();                // after falak.init()
 */

function current() {
    return typeof window !== 'undefined' ? window.falak : undefined;
}

/** The platform instance, or undefined when it has not loaded (yet). */
export function getFalak() {
    return current();
}

/**
 * Resolves with window.falak once the platform script has run.
 *
 * Covers both orders a theme bundle can end up in: after the SDK (resolves
 * immediately) and before it (waits for the SDK's `falak:loaded` event). The
 * timeout turns "the SDK is disabled on this store" into an error instead of
 * a promise that never settles.
 */
export function loaded({ timeout = 10000 } = {}) {
    const sdk = current();

    if (sdk && typeof sdk.onReady === 'function') return Promise.resolve(sdk);

    if (typeof document === 'undefined') {
        return Promise.reject(new Error('[falak] window.falak is only available in a browser.'));
    }

    return new Promise((resolve, reject) => {
        const timer = timeout > 0 && setTimeout(() => {
            document.removeEventListener('falak:loaded', onLoaded);
            reject(new Error('[falak] window.falak did not load. Is the storefront SDK enabled for this store?'));
        }, timeout);

        function onLoaded(event) {
            if (timer) clearTimeout(timer);
            resolve(event.detail || current());
        }

        document.addEventListener('falak:loaded', onLoaded, { once: true });
    });
}

/** Resolves with window.falak after falak.init() — config and strings are in hand. */
export async function ready(options) {
    const sdk = await loaded(options);
    await sdk.onReady();

    return sdk;
}

/**
 * A live reference to window.falak.
 *
 * Every property read goes to the platform instance at that moment, so the
 * import is safe at module scope even when the bundle runs before the SDK —
 * only *using* it early throws, and it throws something actionable.
 */
const falak = new Proxy({}, {
    get(_target, key) {
        const sdk = current();

        if (!sdk) {
            throw new Error(`[falak] falak.${String(key)} was used before the storefront SDK loaded. Wrap the call in ready().`);
        }

        const value = sdk[key];

        return typeof value === 'function' ? value.bind(sdk) : value;
    },
    has(_target, key) {
        const sdk = current();

        return !!sdk && key in sdk;
    },
});

export default falak;
