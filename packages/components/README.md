# @falakcart/components

Developer tooling for the `<falak-*>` web components that FalakCart injects
into every storefront: tag types, editor autocompletion, and the component
stylesheet as source.

**The components themselves are already on every storefront page.** Don't
bundle `dist/falak-components.js` into a theme; the platform loads it after the
SDK, in the order the components depend on.

```bash
npm i -D @falakcart/components
```

This package depends on `@falakcart/sdk` (same version) for the `window.falak`
types.

## Editor autocompletion for Twig and HTML

VS Code, in `.vscode/settings.json`:

```json
{
    "html.customData": ["./node_modules/@falakcart/components/html-custom-data.json"],
    "files.associations": { "*.twig": "html" }
}
```

Every `<falak-*>` tag then autocompletes with its attributes and documentation.
Other editors and tools can read `custom-elements.json` (the standard Custom
Elements Manifest; also referenced from `package.json#customElements`).

## Types

```ts
import { defined, type FalakTagName } from '@falakcart/components';

await defined();                                    // every tag is registered
const menu = document.querySelector('falak-menu');  // typed as FalakMenuElement
menu?.sdk.cart.count();
```

`defined({ timeout })` rejects when components are disabled for the store.

## Styling: keep the component classes in your theme's CSS

```bash
npx falak-sync-theme-css src/assets/css/app.css
```

This copies every component rule into your `app.css` between two marker
comments, so the classes are searchable where you already work. Run it again
after updating this package: the block is replaced in full. Put your overrides
**below** the block, because edits inside it are discarded on the next run.

The platform ships the same rules inside `@layer falak`, so any unlayered rule
in your theme wins without `!important`. To import the layered source sheet
into a bundled theme instead:

```css
@import '@falakcart/components/css/styles.css';
```

## Versioning

Released together with `@falakcart/sdk`, always the same version number.

## License

Proprietary (UNLICENSED). For use in FalakCart themes and apps.
