/**
 * Builds both bundles straight into a FalakCart platform checkout, for working
 * on the SDK against a real storefront before anything is published.
 *
 *   npm run platform:build                                 -> ../falakcart/public/sdk
 *   npm run platform:watch                                 rebuild on save (with sourcemaps)
 *   npm run platform:watch -- --platform=D:/work/falakcart another checkout
 *
 * The platform must be in local mode to load these files instead of the CDN:
 * FALAK_SDK_SOURCE=local in its .env (then php artisan config:clear). The
 * files written there are gitignored by the platform — they are a dev loop,
 * never what production serves.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const [command = 'build', ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.map(arg => {
    const [key, value = true] = arg.replace(/^--/, '').split('=');
    return [key, value];
}));

if (!['build', 'watch'].includes(command)) {
    console.error('usage: node scripts/platform.mjs <build|watch> [--platform=<path to falakcart>]');
    process.exit(1);
}

const platform = resolve(repo, String(flags.platform || process.env.FALAK_PLATFORM_DIR || '../falakcart'));

if (!existsSync(resolve(platform, 'artisan'))) {
    console.error(`✖ ${platform} does not look like a FalakCart checkout (no artisan). Pass --platform=<path>.`);
    process.exit(1);
}

const env = { ...process.env, FALAK_SDK_OUT_DIR: resolve(platform, 'public/sdk') };
const vite = resolve(repo, 'node_modules/vite/bin/vite.js');
const args = config => ['build', '--config', resolve(repo, config), ...(command === 'watch' ? ['--watch', '--mode', 'development'] : [])];

console.log(`${command === 'watch' ? 'Watching' : 'Building'} into ${env.FALAK_SDK_OUT_DIR}`);

function run(config) {
    return new Promise((done, fail) => {
        spawn(process.execPath, [vite, ...args(config)], { env, stdio: 'inherit', cwd: repo })
            .on('exit', code => (code === 0 ? done() : fail(new Error(`${config} exited with ${code}`))));
    });
}

const configs = ['packages/sdk/vite.config.js', 'packages/components/vite.config.js'];

try {
    // A build runs in order (the SDK first, as the platform loads it); a watch runs both at once.
    if (command === 'build') {
        for (const config of configs) await run(config);
    } else {
        await Promise.all(configs.map(run));
    }
} catch (error) {
    console.error(`✖ ${error.message}`);
    process.exit(1);
}
