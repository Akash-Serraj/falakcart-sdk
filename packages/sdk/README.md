# @falakcart/sdk

Typed access to `window.falak`, the storefront runtime FalakCart injects into
every store.

**This package does not contain a second copy of the SDK.** The platform
already loads it on every storefront page. If a theme bundled its own copy, the
page would end up with two event buses, two sets of credentials and two carts.
What you install here is the type definitions plus a small accessor that hands
you the platform's instance.

```bash
npm i -D @falakcart/sdk
```

## Use

```js
import falak, { ready } from '@falakcart/sdk';

// Wait until the platform has called falak.init(); config and strings are loaded.
await ready();

falak.cart.add(42, { quantity: 2 });
falak.money(149);                                  // formatted in the store currency + locale
falak.event.cart.onAdded(({ lines }) => { /* … */ });
falak.event.on('auth::logged.in', user => { /* … */ });
```

`falak` is a live reference to `window.falak`, so importing it at module scope
is safe. Using it before the platform script has run throws an error that tells
you to wrap the call in `ready()`.

| Export | What it does |
|---|---|
| `default` (`falak`) | Live, typed reference to `window.falak` |
| `ready(opts?)` | Resolves after `falak.init()` |
| `loaded(opts?)` | Resolves as soon as `window.falak` exists |
| `getFalak()` | `window.falak` or `undefined`, without waiting |

`ready()` and `loaded()` reject after `timeout` ms (default 10000; `0` waits
forever). That happens when the SDK is disabled for the store.

### Types without importing anything

For theme scripts that only use the global:

```ts
/// <reference types="@falakcart/sdk" />
window.falak.lang.get('cart.empty');
```

Or in `jsconfig.json` / `tsconfig.json`: `"compilerOptions": { "types": ["@falakcart/sdk"] }`.

## The bundle itself

`dist/falak-sdk.js` is the exact file the platform serves, for local
prototyping outside a store (`https://unpkg.com/@falakcart/sdk/dist/falak-sdk.js`).
On a real storefront, do not include it: the platform already has.

## Versioning

`@falakcart/sdk` and `@falakcart/components` are released together and always
share a version number. A storefront always runs the latest platform release, so
your package version decides only which types you compile against.

## License

Proprietary (UNLICENSED). For use in FalakCart themes and apps.
