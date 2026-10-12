/**
 * The npm entry point of @falakcart/components.
 *
 * Like @falakcart/sdk, it ships no runtime: the platform injects
 * falak-components.js into every storefront, and a theme that bundled its own
 * copy would download the whole component set twice for no gain. What this
 * package gives a theme developer instead:
 *
 *   - types for every <falak-*> tag          (types/index.d.ts)
 *   - editor autocompletion for the tags     (html-custom-data.json, custom-elements.json)
 *   - the component stylesheet as source     (src/*.css, `npx falak-sync-theme-css`)
 *   - this tiny helper
 *
 *   import { defined } from '@falakcart/components';
 *   await defined();   // every <falak-*> element is registered
 */

function registered() {
    const tags = typeof window !== 'undefined' && window.falak && window.falak.components;

    return Array.isArray(tags) ? tags : null;
}

/** Resolves with the registered tag names once the components bundle has run. */
export function defined({ timeout = 10000 } = {}) {
    const tags = registered();

    if (tags) return Promise.resolve(tags);

    if (typeof document === 'undefined') {
        return Promise.reject(new Error('[falak] components are only available in a browser.'));
    }

    return new Promise((resolve, reject) => {
        const timer = timeout > 0 && setTimeout(() => {
            document.removeEventListener('falak:components-defined', onDefined);
            reject(new Error('[falak] components did not load. Are storefront components enabled for this store?'));
        }, timeout);

        function onDefined(event) {
            if (timer) clearTimeout(timer);
            resolve(event.detail || registered() || []);
        }

        document.addEventListener('falak:components-defined', onDefined, { once: true });
    });
}
