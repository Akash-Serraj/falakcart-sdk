import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/*
 * dist/ by default — what npm publishes. FALAK_SDK_OUT_DIR redirects the build
 * into a platform checkout's public/sdk (scripts/platform.mjs sets it) for
 * working on the SDK against a real storefront. The SDK and components share
 * that folder, so it is never emptied; dist/ is this package's alone.
 */
const outDir = process.env.FALAK_SDK_OUT_DIR
    ? resolve(process.env.FALAK_SDK_OUT_DIR)
    : fileURLToPath(new URL('dist', import.meta.url));

/**
 * Builds the SDK as a classic IIFE bundle, not an ES module.
 *
 * The script is injected into arbitrary merchant themes at body:end, where a
 * `type="module"` tag would be deferred until after the document parses — so a
 * theme's own inline script calling falak.onReady() would run first and find
 * nothing. An IIFE executes in place, which is the whole contract.
 *
 * Sourcemaps are written only in development mode (`watch`). The output is
 * served as-is by the platform and the CDN, so a map emitted by a production
 * build would publish the full source to anyone who asked for falak-sdk.js.map.
 */
export default defineConfig(({ mode }) => ({
    root: fileURLToPath(new URL('.', import.meta.url)),
    define: {
        __FALAK_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
        outDir,
        emptyOutDir: !process.env.FALAK_SDK_OUT_DIR,
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
