import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Components build to their own bundle, separate from the SDK.
 *
 * Two files rather than one so an SDK fix ships without re-serving the whole
 * component set, and so the dependency direction stays enforceable: components
 * reach the SDK through `window.falak` at call time, never by importing it.
 */
export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    build: {
        outDir: fileURLToPath(new URL('../../public/sdk', import.meta.url)),
        emptyOutDir: false,
        target: 'es2020',
        sourcemap: 'hidden',
        lib: {
            entry: fileURLToPath(new URL('src/index.js', import.meta.url)),
            name: 'falakComponents',
            formats: ['iife'],
            fileName: () => 'falak-components.js',

            /*
             * src/components.css is imported by the entry; library mode
             * extracts it here instead of injecting it at runtime, so the
             * platform can <link> it at head:end and have it applied before
             * first paint. Without this it would be emitted as "style.css".
             */
            cssFileName: 'falak-components',
        },
    },
});
