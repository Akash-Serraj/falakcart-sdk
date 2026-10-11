/**
 * Where the platform checkout is, and therefore where dev builds go.
 *
 * The bundles are not served from this repo: the storefront injects them
 * from `public/sdk` of the falakcart checkout when FALAK_SDK_SOURCE=local,
 * and from the published npm packages otherwise. Every build and release
 * script resolves that folder through here so there is one rule:
 *
 *   FALAK_PLATFORM_DIR=/path/to/falakcart   explicit
 *   ../falakcart                             default: a sibling of this repo
 *
 * Fails loudly when neither exists — a bundle written into a folder nothing
 * serves is the kind of "my change did nothing" that costs an afternoon.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function platformDir() {
    const configured = process.env.FALAK_PLATFORM_DIR;
    const dir = configured ? resolve(configured) : resolve(repoRoot, '..', 'falakcart');

    if (!existsSync(resolve(dir, 'artisan'))) {
        throw new Error(
            `No falakcart checkout at ${dir}` +
            (configured ? ' (FALAK_PLATFORM_DIR).' : '. Clone it beside this repo, or set FALAK_PLATFORM_DIR.'),
        );
    }

    return dir;
}

export function publicSdkDir() {
    return resolve(platformDir(), 'public', 'sdk');
}
