import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Builds the SDK as a classic IIFE bundle, not an ES module.
 *
 * The script is injected into arbitrary merchant themes at body:end, where a
 * `type="module"` tag would be deferred until after the document parses — so a
 * theme's own inline script calling falak.onReady() would run first and find
 * nothing. An IIFE executes in place, which is the whole contract.
 */
export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    build: {
        outDir: fileURLToPath(new URL('../../public/sdk', import.meta.url)),
        emptyOutDir: false,          // components build writes to the same folder
        target: 'es2020',
        sourcemap: true,
        lib: {
            entry: fileURLToPath(new URL('src/index.js', import.meta.url)),
            name: 'falak',
            formats: ['iife'],
            fileName: () => 'falak-sdk.js',
        },
    },
});
