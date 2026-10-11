import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { publicSdkDir } from '../scripts/platform.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Builds the SDK as a classic IIFE bundle, not an ES module.
 *
 * The script is injected into arbitrary merchant themes at body:end, where a
 * `type="module"` tag would be deferred until after the document parses — so a
 * theme's own inline script calling falak.onReady() would run first and find
 * nothing. An IIFE executes in place, which is the whole contract.
 *
 * Sourcemaps are written only in development mode (`sdk:watch`). public/sdk is
 * served as-is, so a map emitted by a production build would publish the full
 * source to anyone who asked for falak-sdk.js.map — `hidden` only drops the
 * comment pointing at it, not the file.
 */
export default defineConfig(({ mode }) => ({
    root: fileURLToPath(new URL('.', import.meta.url)),
    define: {
        __FALAK_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
        // The platform checkout's public/sdk — see scripts/platform.mjs.
        outDir: publicSdkDir(),
        emptyOutDir: false,          // components build writes to the same folder
        target: 'es2020',
        sourcemap: mode === 'development',
        lib: {
            entry: fileURLToPath(new URL('src/index.js', import.meta.url)),
            name: 'falak',
            formats: ['iife'],
            fileName: () => 'falak-sdk.js',
        },
    },
}));
