/**
 * Bumps @falakcart/sdk and @falakcart/components together.
 *
 *   npm run version:bump -- patch          1.0.0 -> 1.0.1
 *   npm run version:bump -- minor          1.0.0 -> 1.1.0
 *   npm run version:bump -- 2.0.0-beta.1   explicit
 *
 * The two packages ship in the same platform deploy and talk to each other at
 * runtime, so they share ONE version number: "components 1.3 on SDK 1.2" is a
 * state that should not be expressible. package.json is the only place a
 * version is written — the bundles get it through Vite `define`, npm from
 * the staged package.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = {
    sdk: resolve(repo, 'packages/sdk/package.json'),
    components: resolve(repo, 'packages/components/package.json'),
};

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, 4) + '\n');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

function next(current, bump) {
    if (SEMVER.test(bump)) return bump;

    const [, major, minor, patch, pre] = current.match(SEMVER) || [];
    if (major === undefined) throw new Error(`Current version "${current}" is not semver.`);

    switch (bump) {
        // 1.1.0-beta.2 + patch -> 1.1.0: finishing a prerelease, like `npm version`.
        case 'patch': return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${+patch + 1}`;
        case 'minor': return `${major}.${+minor + 1}.0`;
        case 'major': return `${+major + 1}.0.0`;
        default: throw new Error(`Expected patch, minor, major or an explicit x.y.z — got "${bump}".`);
    }
}

const bump = process.argv[2];

if (!bump) {
    console.error('usage: npm run version:bump -- <patch|minor|major|x.y.z>');
    process.exit(1);
}

const sdk = read(files.sdk);
const components = read(files.components);

if (sdk.version !== components.version) {
    console.warn(`Versions had drifted (sdk ${sdk.version}, components ${components.version}); realigning from the SDK's.`);
}

const version = next(sdk.version, bump);

sdk.version = version;
components.version = version;
components.dependencies = { ...components.dependencies, [sdk.name]: version };

write(files.sdk, sdk);
write(files.components, components);

// Keep the workspace entries in package-lock.json in step.
execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { cwd: repo, stdio: 'inherit' });

console.log(`\n@falakcart/sdk + @falakcart/components -> ${version}`);
console.log('Next: commit, then npm run release:publish -- --scope=<scope> (see README: Releasing)');
