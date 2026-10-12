# falakcart-sdk

The storefront runtime of FalakCart: the `window.falak` SDK and the `<falak-*>`
web components that every store page loads. This repository builds both,
publishes them to npm, and nothing else. The platform
([falakcart](https://github.com/Akash-Serraj/falakcart)) loads the published
files from a CDN at a version it pins.

```
packages/
  sdk/          @falakcart/sdk          window.falak — cart, auth, events, API, money. No UI.
  components/   @falakcart/components   <falak-*> elements + their stylesheet. Uses the SDK via window.falak.
scripts/        build-into-platform, version bump, release
docs/           ARCHITECTURE.md — how the runtime works
```

Both packages always carry **the same version number** and are released
together.

## Setup

```bash
npm install
npm test             # unit tests
npm run build        # -> packages/*/dist
```

Node 20 or newer.

## Working on the SDK against a real storefront

The platform normally loads the published files from the CDN. To see your
local changes in a store instead:

1. In the platform's `.env`, set `FALAK_SDK_SOURCE=local`, then run
   `php artisan config:clear`.
2. Here, run:
   ```bash
   npm run platform:watch          # builds into ../falakcart/public/sdk and rebuilds on save
   ```
   Use `-- --platform=<path>` if the platform checkout lives somewhere other
   than `../falakcart`.
3. Refresh a storefront. When you're done, set the platform back to
   `FALAK_SDK_SOURCE=npm`.

## Releasing

```bash
npm run version:bump -- patch                               # or minor | major | 1.2.0-beta.1 (both packages)
git commit -am "release: v1.0.2" && git tag v1.0.2
npm run release:publish -- --scope=test_falakcart --otp=…   # test org first
npm run release:publish -- --scope=falakcart --otp=…        # production
git push --follow-tags
```

Then, in the platform, raise the pinned version (`FALAK_SDK_NPM_VERSION`, or
the default in `config/theme-context.php`) and deploy. **Stores only change
when the platform's pin changes**, never just because something was published.

The source packages are named `@falakcart/*` and are `private: true`, so an
`npm publish` inside a package folder is refused. `scripts/release.mjs` builds,
stages a copy in `.release/<scope>/` under the scope you pass, and publishes
that copy. The same commit can therefore go to the test org first and to
production after. It refuses to run when the two versions differ, when a
bundle wasn't built from the current version, or when both packages are
already published at that version. A package that is already published is
skipped, so you can rerun after an expired 2FA code.

| Flag | |
|---|---|
| `--scope=<org>` | npm org without the `@`. Default `falakcart` |
| `--dry-run` | everything except the upload |
| `--otp=<code>` | 2FA code from your authenticator app |
| `--tag=<tag>` | dist-tag. Default `latest`, or `next` for a prerelease |
| `--skip-build` | reuse the existing `dist/` |

`npm run release:pack -- --scope=…` writes the `.tgz` files without
uploading, so you can inspect them.

### Releasing from GitHub Actions

`.github/workflows/release.yml` publishes when a `v*` tag is pushed. It needs
two settings in the GitHub repository:

- the secret **`NPM_TOKEN`**: an npm *granular access token* with read and
  write access to the scope and **"bypass two-factor authentication"** ticked
- the variable **`NPM_SCOPE`**: `test_falakcart` or `falakcart`

## What is on npm, and why

The runtime is **never** installed from npm into a theme. The platform injects
it into every store, and a theme that bundled its own copy would put a second
`window.falak` on the page. npm carries what a theme developer needs around
that runtime:

| Package | Contains |
|---|---|
| `@falakcart/sdk` | Types for all of `window.falak` (`types/index.d.ts`, hand-written: **when you add a public SDK method, add it there**), an entry point that returns the platform's instance (`ready()`, `loaded()`, a live `falak` reference), and `dist/falak-sdk.js` |
| `@falakcart/components` | Tag types, `custom-elements.json` and VS Code `html-custom-data.json` (generated from the source by `scripts/build-manifest.mjs`), the CSS source, `npx falak-sync-theme-css`, and `dist/` |

There are two packages because they serve different users: an app needs the
SDK types but not 500 KB of component CSS. Each package's README is what npm
shows to theme developers.

## Rules worth knowing before you change anything

- Components never `import` the SDK; they use `window.falak`. That keeps the
  dependency one-way.
- Add a component by registering it in `REGISTRY` in
  `packages/components/src/index.js` and declaring `static observedAttributes`.
  The manifest, types and editor autocompletion are generated from those two.
- Production builds write no sourcemaps. The files are served as-is.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the event bus, the
component conventions and the styling contract.
