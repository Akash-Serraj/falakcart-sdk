/**
 * Stages and publishes @<scope>/sdk and @<scope>/components to npm.
 *
 *   npm run sdk:pack    -- --scope=test_falakcart            build + stage + .tgz, nothing uploaded
 *   npm run sdk:publish -- --scope=test_falakcart --dry-run  everything except the upload
 *   npm run sdk:publish -- --scope=test_falakcart            publish to the test org
 *   npm run sdk:publish -- --scope=falakcart                 publish for production
 *
 * Options:  --scope=<org>   npm org without the @ (default: falakcart)
 *           --tag=<tag>     dist-tag (default: latest; "next" for prereleases)
 *           --otp=<code>    2FA code, passed through to npm publish
 *           --skip-build    reuse the bundles already in public/sdk
 *
 * Why stage rather than `npm publish` from the package folder:
 *
 *   - The SOURCE packages are named @falakcart/* and stay `private: true`, so
 *     an accidental `npm publish` in the folder is refused. The scope is a
 *     publish-time choice, which is what lets the same commit go to the test
 *     org and then to production without editing a file.
 *   - dist/ is the exact bundle the platform serves from public/sdk, copied in,
 *     so npm and the storefront never disagree about what 1.2.0 is.
 *   - The components' manifest and tag types are generated here from source.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, relative } from 'node:path';

const packages = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(packages, '..');
const publicSdk = resolve(repo, 'public/sdk');

/* ---------------------------------------------------------------- options */

const [command = 'pack', ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.map(arg => {
    const [key, value = true] = arg.replace(/^--/, '').split('=');
    return [key, value];
}));

const scope = String(flags.scope || 'falakcart').replace(/^@/, '');
const dryRun = !!flags['dry-run'];

if (!['pack', 'publish'].includes(command)) fail(`Unknown command "${command}" — use pack or publish.`);
if (!/^[a-z0-9][a-z0-9._-]*$/.test(scope)) fail(`"${scope}" is not a valid npm scope.`);

/* --------------------------------------------------------------- packages */

const SOURCE_SCOPE = '@falakcart/';

const PACKAGES = [
    {
        dir: 'falak-sdk',
        dist: ['falak-sdk.js'],
    },
    {
        dir: 'falak-components',
        dist: ['falak-components.js', 'falak-components.css'],
        generate: out => run('node', [resolve(packages, 'falak-components/scripts/build-manifest.mjs'), out]),
        // generated into the stage, not copied from source
        generated: ['types', 'custom-elements.json', 'html-custom-data.json'],
    },
];

/* ---------------------------------------------------------------- helpers */

function fail(message) {
    console.error(`\n✖ ${message}`);
    process.exit(1);
}

function run(cmd, args, options = {}) {
    // shell: npm is npm.cmd on Windows and cannot be spawned directly.
    const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', cwd: repo, ...options });
    if (result.status !== 0) fail(`${cmd} ${args.join(' ')} exited with ${result.status}`);
}

function capture(cmd, args) {
    const result = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', cwd: repo });
    return { ok: result.status === 0, out: (result.stdout || '').trim() };
}

function read(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function walk(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = resolve(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

const rescope = text => text.split(SOURCE_SCOPE).join(`@${scope}/`);

/* ------------------------------------------------------------ preflight */

const manifests = PACKAGES.map(p => ({ ...p, pkg: read(resolve(packages, p.dir, 'package.json')) }));
const version = manifests[0].pkg.version;

for (const { pkg } of manifests) {
    if (pkg.version !== version) fail(`${pkg.name} is ${pkg.version} but ${manifests[0].pkg.name} is ${version}. Run npm run sdk:version.`);

    for (const [dep, range] of Object.entries(pkg.dependencies || {})) {
        if (dep.startsWith(SOURCE_SCOPE) && range !== version) {
            fail(`${pkg.name} depends on ${dep}@${range}, expected ${version}. Run npm run sdk:version -- ${version}.`);
        }
    }
}

const tag = String(flags.tag || (version.includes('-') ? 'next' : 'latest'));

console.log(`\nFalak packages ${version} -> @${scope}/*  (tag: ${tag}${dryRun ? ', dry run' : ''})\n`);

if (command === 'publish' && !dryRun) {
    const who = capture('npm', ['whoami']);
    if (!who.ok) fail('Not logged in to npm. Run `npm login` first.');
    console.log(`npm user: ${who.out}`);

    /*
     * A package already on the registry at this version is skipped, not fatal:
     * a 2FA code can expire between the two publishes, and the re-run must be
     * able to finish the second one. Both already published is the real error.
     */
    for (const manifest of manifests) {
        const name = rescope(manifest.pkg.name);
        const existing = capture('npm', ['view', `${name}@${version}`, 'version']);
        manifest.published = existing.ok && existing.out === version;
        if (manifest.published) console.log(`${name}@${version} is already on the registry — skipping it.`);
    }

    if (manifests.every(m => m.published)) fail(`Both packages are already published at ${version}. Bump with npm run sdk:version.`);
}

/* ------------------------------------------------------------------ build */

if (!flags['skip-build']) {
    run('npm', ['run', 'sdk:build']);
}

for (const { dist } of manifests) {
    for (const file of dist) {
        const path = resolve(publicSdk, file);
        if (!existsSync(path)) fail(`public/sdk/${file} is missing — run npm run sdk:build.`);
        if (file.endsWith('.js') && !readFileSync(path, 'utf8').includes(JSON.stringify(version))) {
            fail(`public/sdk/${file} was not built from ${version}. Rebuild, or drop --skip-build.`);
        }
    }
}

/* ------------------------------------------------------------------ stage */

const releaseRoot = resolve(packages, '.release', scope);

// Empty it rather than delete it: Windows refuses to remove a directory that
// is any shell's working directory — e.g. one opened to inspect the tarballs.
mkdirSync(releaseRoot, { recursive: true });
readdirSync(releaseRoot).forEach(name => rmSync(resolve(releaseRoot, name), { recursive: true, force: true }));

const staged = manifests.map(({ dir, pkg, dist, generate, generated = [] }) => {
    const source = resolve(packages, dir);
    const out = resolve(releaseRoot, dir);
    mkdirSync(out, { recursive: true });

    for (const entry of pkg.files || []) {
        if (entry === 'dist' || generated.includes(entry)) continue;

        const from = resolve(source, entry);
        if (!existsSync(from)) fail(`${pkg.name} lists "${entry}" in files, but it does not exist.`);

        cpSync(from, resolve(out, entry), { recursive: true });
    }

    mkdirSync(resolve(out, 'dist'), { recursive: true });
    dist.forEach(file => cpSync(resolve(publicSdk, file), resolve(out, 'dist', file)));

    generate?.(out);

    const published = { ...pkg, name: rescope(pkg.name) };
    delete published.private;
    delete published.scripts;
    delete published.devDependencies;

    if (published.dependencies) {
        published.dependencies = Object.fromEntries(
            Object.entries(published.dependencies).map(([name, range]) => [rescope(name), range]),
        );
    }

    published.publishConfig = { access: 'public', tag };
    writeFileSync(resolve(out, 'package.json'), JSON.stringify(published, null, 4) + '\n');

    // Docs, types and the npm entry name the package; the bundles and CSS do not.
    for (const file of walk(out)) {
        if (file.startsWith(resolve(out, 'dist'))) continue;
        if (!['.md', '.ts', '.js', '.mjs', '.json'].includes(extname(file))) continue;

        const text = readFileSync(file, 'utf8');
        const next = rescope(text);
        if (next !== text) writeFileSync(file, next);
    }

    console.log(`staged ${published.name}@${version} -> ${relative(repo, out)}`);

    return { name: published.name, out, skip: !!manifests.find(m => m.dir === dir)?.published };
});

/* -------------------------------------------------------- pack / publish */

for (const { name, out, skip } of staged) {
    if (skip) continue;

    if (command === 'pack') {
        run('npm', ['pack', '--pack-destination', releaseRoot], { cwd: out });
        continue;
    }

    // Order matters: components depend on the SDK, so the SDK goes first.
    const args = ['publish', '--access', 'public', '--tag', tag];
    if (dryRun) args.push('--dry-run');
    if (flags.otp) args.push(`--otp=${flags.otp}`);

    console.log(`\n${dryRun ? 'dry-run publishing' : 'publishing'} ${name}@${version}`);
    run('npm', args, { cwd: out });
}

console.log(command === 'pack'
    ? `\nTarballs in ${relative(repo, releaseRoot)}. Inspect them, then npm run sdk:publish -- --scope=${scope}`
    : `\n${dryRun ? 'Dry run complete — nothing was uploaded.' : `Published @${scope}/sdk and @${scope}/components ${version}.`}`);
