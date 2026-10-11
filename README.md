# FalakCart Storefront SDK

The client-side runtime injected into every storefront render. Two packages,
one dependency direction:

```
falak-sdk         window.falak — config, events, API, formatting.  No UI.
falak-components  <falak-*> custom elements + their stylesheet.
```

`falak-components` never imports `falak-sdk`. It reaches it through
`window.falak`, which is what keeps the direction enforceable rather than merely
documented — an import cycle is impossible, not just discouraged.

---

## Why this exists

A theme can already do everything these packages do, inline, in Twig. What it
cannot do is share the result. The SDK exists so that:

- **State has one owner.** One store identity, one set of credentials, one
  locale, one currency formatter — however many scripts are on the page.
- **Producers and consumers stay decoupled.** A component announces on the bus;
  a header badge, an analytics listener and a merchant's app all react without
  any of them knowing the others exist.
- **The server can drive the client.** Any API response may carry an `events`
  object; the client dispatches it automatically.
- **Fixes ship without theme rebuilds.** The bundle is injected by the platform
  at `body:end`, not compiled into the theme.

---

## Build

This repo holds the sources only. The bundles are served by the platform:
in production from the published npm packages through the CDN, and while
developing from `public/sdk` of a falakcart checkout. Clone the two repos
side by side (`…/falakcart` and `…/falakcart-sdk`), or point
`FALAK_PLATFORM_DIR` at the falakcart checkout.

```bash
npm install              # once, at this repo's root (workspaces: falak-sdk, falak-components)
npm run sdk:build        # -> <falakcart>/public/sdk/{falak-sdk,falak-components}.js + .css
npm run platform:watch   # rebuild on change while developing (writes sourcemaps too)
npm run sdk:test         # vitest, falak-sdk
```

Then, in the falakcart `.env`:

```dotenv
FALAK_SDK_SOURCE=local
```

and the storefront injects `/sdk/falak-sdk.js` and `/sdk/falak-components.js`
from that folder instead of the CDN, with a cache-buster that changes on
every rebuild (the bundles' mtime). Those files are gitignored in falakcart;
nothing there needs committing when the SDK changes. Remove the line (or
set `npm`) to go back to the published version pinned by
`FALAK_SDK_NPM_VERSION`.

After editing any `components*.css`, re-embed the component styles into
each theme stylesheet that carries a copy (the unlayered block that lets a
theme override `@layer falak`):

```bash
npm run sync:theme-css -- <falakcart>/storage/themes/<theme>/1.0.0/src/assets/styles/app.css
```

The `?v=` cache-buster is read from `FALAK_SDK_NPM_VERSION` plus the bundles'
mtime, so a rebuild without a version bump still produces a new URL.

### Versions

There is **one** version number, in `falak-sdk/package.json`, and the
components always carry the same one. Everything else reads it:

| Reader | How |
|---|---|
| `falak.version`, `falak.componentsVersion` | Vite `define` at build time |
| The `?v=` cache-buster on the injected tags | `ThemeSystemServiceProvider::sdkVersion()` reads the package.json, plus the bundles' mtime |
| npm | the staged package.json |

```bash
npm run sdk:version -- patch     # or minor | major | 1.2.0-beta.1 — bumps both + lockfile
```

`FALAK_SDK_VERSION` still overrides the cache-buster. Leave it unset unless the
bundles are built somewhere else.

---

## How it reaches the browser

`ThemeSystemServiceProvider` registers two platform hooks:

| Hook | Emits |
|---|---|
| `head:end` | `<link>` to `falak-components.css`, before the theme's own styles |
| `body:end` | boot marker → `falak-sdk.js` → `falak.init({…})` → `falak-components.js` |

That order is the contract, not a preference:

- The tags are **not deferred**. `defer` postpones execution past document
  parse, so a theme's own inline script calling `falak.onReady()` would run
  first and find nothing on `window`.
- **`init()` before components**, because element upgrade fires
  `connectedCallback` immediately and every component reads config on the way
  through.
- **CSS at `head:end`**, so it is applied before first paint and a theme still
  wins a specificity tie.

Config for `init()` is built by `ThemeSystemServiceProvider::sdkConfig()` and
includes the merged translation map, so components render translated on first
paint rather than fetching strings.

Turn the whole thing off with `FALAK_SDK_ENABLED=false`; components only with
`FALAK_SDK_COMPONENTS=false`.

---

## The SDK

```js
falak.config.get('store.settings.x', false)   // dotted paths, with fallbacks
falak.lang.get('product.review_count', { count: 7 })
falak.money(149)                               // respects store currency + locale
falak.storage.setWithTTL('key', value, 30)
falak.onReady(() => { /* config and strings are in hand */ })
```

### Events — two spellings, one listener list

Domains declare a name map; the dispatcher and listener methods are generated
from it at boot (`core/emitter.js`):

```js
this.namespace = 'product';
this.events = { fetched: 'fetched', quantityChanged: 'quantity.changed' };
```

gives you both of these, addressing the same subscription:

```js
falak.event.product.onFetched(cb);
falak.event.on('product::fetched', cb);
```

Adding an event to a domain is a one-line change in `src/events.js`.

**`emitAsync` awaits every listener, sequentially.** That is what makes a
`before.*` event a real interception point rather than a notification — a
listener can mutate the payload and the caller will not proceed until it has.
It is the property to preserve above all others when extending this: it is what
lets future features (coupons, subscriptions, order options) attach to an
action without editing that action.

### Domain façades

```js
falak.product.fetch({ limit: 8 })   // forwards to the API
falak.product.api                   // the API object
falak.product.event                 // the event namespace
```

One `Proxy` (`src/index.js`), no third implementation.

### The API client

Every call goes through `api/client.js`, which attaches ambient context
(locale, currency, store id, bearer token, CSRF), dispatches server-sent
events, and applies one notification policy. Opt out of the last one:

```js
await falak.api.withoutNotifier(() => falak.review.fetch(id));
```

Suppression is ref-counted, so nested silent calls behave.

Endpoints live in a table per domain (`api/base.js`), so an API version bump is
a one-file change:

```js
this.endpoints = { reviews: 'products/{product}/reviews' };
this.call(['reviews', 12], { params: { per_page: 5 } });
```

---

## The components

**Primitives** — other components compose these.

| Tag | SDK surface | Notes |
|---|---|---|
| `<falak-button>` | none | Salla's attribute vocabulary; `load()`/`stop()`/`disable()`/`setText()`. |
| `<falak-modal>` | none | `open()`/`close()` or `modal::open` by id. Ref-counted scroll lock. |
| `<falak-slider>` | none | Native scroll-snap, not Swiper. RTL-normalised geometry. |

**Product surface**

| Tag | SDK surface | Notes |
|---|---|---|
| `<falak-quantity-input>` | none | Renders a hidden input so plain form posts still work. |
| `<falak-rating-stars>` | `lang` | `fetch` is opt-in — a 40-card grid must not fire 40 requests. |
| `<falak-product-card>` | `money`, `url` | Normalises the raw Eloquent shape in one place. |
| `<falak-products-list>` | `api.product` | Owns a request lifecycle; renders cards. |
| `<falak-products-slider>` | `api.product` | Composes slider + cards; `source`/`source-value`. |

**Layout & chrome**

| Tag | SDK surface | Notes |
|---|---|---|
| `<falak-accordion>` + `-head` + `-body` | none | Parent/child family; state is `data-collapsed`. |
| `<falak-menu>` | `config.menus` | **Enhances** server-rendered markup by default — see below. |
| `<falak-breadcrumb>` | `config.page` | Session trail, capped and de-duplicated. |

**Footer & trust**

| Tag | SDK surface | Notes |
|---|---|---|
| `<falak-social>` | `config.store.social` | Profiles and share mode in one tag. |
| `<falak-payments>` | `config.store.settings.payments` | Expands gateway codes into card brands. |
| `<falak-apps-icons>` | `config.store.apps` | Renders nothing until an app-links column exists. |
| `<falak-trust-badges>` | `config.store.settings.documents` | Commercial register / freelance / VAT. |

**Account & customer**

| Tag | SDK surface | Notes |
|---|---|---|
| `<falak-login-modal>` | `auth` | OTP, two steps. Opens itself on `auth::required`. |
| `<falak-user-menu>` | `auth` | Sign-in trigger for guests, dropdown for customers. |
| `<falak-localization-modal>` | `localization` | Language + currency; rates fetched on first open. |
| `<falak-offer-modal>` | `offer` | Dismissal has a TTL, not forever. |
| `<falak-comments>` | `review`, `auth` | Public read, gated write. |

### The menu enhances rather than renders

Salla fetches menus because theirs live behind an API. `MenuResolver` already
hands ours to Twig at render time, so the theme loops them server-side — in the
initial HTML, crawlable, no skeleton — and `<falak-menu>` wraps that markup and
adds only what needs JavaScript: dropdown state, keyboard handling, the drawer
and viewport-edge flipping.

Structure is discovered (`<li>` containing a `<ul>`, its direct `<a>`, its direct
`<ul>`), so it works against whatever class names a theme already uses and the
theme's own CSS keeps styling them. Passing no markup falls back to rendering
from `config.menus.<source>`.

### Conventions (enforced in `src/base.js`)

1. **Light DOM only.** Nothing calls `attachShadow`. The theme's CSS styles
   every component with no piercing and no `!important`.
2. **Render is gated on `falak.onReady()`.** Script order on a merchant page is
   not ours to control.
3. **State is `data-*`, never inline style.** CSS decides what `collapsed` or
   `busy` looks like. This is why the components ship no styles of their own.
4. **Announce twice** — a bubbling DOM event for the theme author, a bus event
   for other components. Neither audience should have to know about the other.

### Parent/child families

`accordion.js` re-syncs its children on every render even though the head sets
its own attributes. That redundancy is deliberate: slotted light-DOM children
upgrade whenever their definition happens to register, so the parent cannot
assume they existed when it first rendered. Any component family you add will
need the same defensive re-sync — skipping it produces the classic "works on
refresh, breaks on navigation" bug.

---

## Styling

Components ship no CSS in their JavaScript. `falak-components.css` is emitted by
the components build (Vite's `build.lib.cssFileName`) and injected at
`head:end`, before the theme's own stylesheet, so a theme always wins a
specificity tie.

Every value derives from the brand tokens `master.twig` already emits
(`--color-primary`, `--color-text`, …), which is what carries a merchant's
palette into platform components. Tailwind themes need nothing extra — custom
properties reach them the same way.

Two rules worth knowing before adding styles:

- **State selectors carry an extra class.** A theme may put its own class on a
  host (the reference theme uses `class="main-menu"`), and a descendant rule
  like `.main-menu ul` (0,0,1,1) outranks a single-class `.f-menu__list--sub`
  (0,0,1,0). Two classes win without `!important`.
- **The pre-upgrade visibility guard is a deliberate list**, not every
  `falak-*` element. It names only components whose pre-upgrade DOM is wrong.
  Adding an enhancer to it would hide correct server-rendered markup.

## Testing

**`public/sdk/playground.html`** — open it on a tenant host. Stubs the API,
logs every bus and DOM event, and toggles RTL and forced failures. Build
components here; the loop is a browser refresh instead of a full storefront
render.

**Real storefront** — the reference theme's product page renders four of the
five. Tenants resolve by `Host`, so test on a subdomain or custom domain, never
bare `localhost`.

---

## Known gaps

- **No cart module.** The cart endpoints are behind `auth:sanctum` +
  `tenant.customer`, so there is no guest cart to build against yet. Deciding
  between a guest-cart endpoint and a login-gated cart is a prerequisite, not a
  detail — it shapes cart identity, storage, and every component that would add
  an item.
- **`product.fetch` pages client-side.** `GET /api/storefront/products` returns
  every active product as a bare array, so `limit` and `page` are applied after
  the response. It becomes a query string the day the endpoint supports one,
  without `<falak-products-list>` changing.

---

## npm packages

The runtime is **never** installed from npm. The platform injects it, and a
theme that bundled its own copy would put a second `window.falak` on the page.
npm carries the developer tooling around that runtime, which is the same split
Salla uses for Twilight:

| Package | Contains |
|---|---|
| `@falakcart/sdk` | `types/index.d.ts` (hand-written: add a public SDK method, add it there), an accessor entry (`npm/index.js`) that returns the platform's `window.falak` (`ready()`, `loaded()`, a live `falak` proxy), and `dist/falak-sdk.js` |
| `@falakcart/components` | Tag types, `custom-elements.json` and VS Code `html-custom-data.json` (all generated by `scripts/build-manifest.mjs` from `REGISTRY` + `observedAttributes`), the CSS source, `npx falak-sync-theme-css`, and `dist/` |

There are two packages because they serve different users: an app or merchant
script needs the SDK types, not 500 KB of component CSS and tooling. The two are
versioned in lockstep, and components depend on the SDK at the exact same
version.

### Publishing

The source packages are named `@falakcart/*` and are `private: true`, so a
stray `npm publish` in either folder is refused. `scripts/release.mjs`
builds, stages a copy in `.release/<scope>/` under the scope you pass,
and publishes the copy. The same commit can therefore go to the test org first
and to production after.

```bash
npm run sdk:pack    -- --scope=test_falakcart             # build + .tgz to inspect, no upload
npm run sdk:publish -- --scope=test_falakcart --dry-run   # everything but the upload
npm run sdk:publish -- --scope=test_falakcart             # test org
npm run sdk:publish -- --scope=falakcart                  # production
```

Other flags: `--tag=next` (the default for prerelease versions), `--otp=123456`
for 2FA, and `--skip-build`. The script refuses to run when the two versions
differ, when a bundle wasn't built from the current version, or when that
version is already on the registry.
