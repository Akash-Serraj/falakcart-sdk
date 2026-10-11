#!/usr/bin/env node
/**
 * Copies the SDK component stylesheet into a theme's app.css so a theme
 * developer finds every component class in the file they already edit.
 *
 *   node packages/falak-components/scripts/sync-theme-css.mjs <path/to/app.css>   (in this repo)
 *   npx falak-sync-theme-css <path/to/app.css>                                   (from npm)
 *
 * The copy lives between two marker comments and is replaced wholesale on
 * every run, so re-running after an SDK release refreshes it. It is written
 * UNLAYERED and ahead of the theme's own "platform components" section: the
 * copy therefore beats the SDK's layered defaults (same rules, so no visible
 * change), and the theme's overrides below it beat the copy on source order.
 *
 * Edit inside the block if you like — but a re-run discards those edits, so
 * durable changes belong in the overrides section below the block.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
if (!target) { console.error('usage: falak-sync-theme-css <path/to/app.css>'); process.exit(1); }

const SOURCES = ['components.css', 'components.chrome.css', 'components.account.css'];
const START = '/* ==== SDK COMPONENT CLASSES — generated, do not edit (see sync-theme-css.mjs) ==== */';
const END = '/* ==== END SDK COMPONENT CLASSES ==== */';
const ANCHOR = '/* ------------------------------------------------ platform components */';

const body = SOURCES.map(f => {
    const css = readFileSync(resolve(here, '../src', f), 'utf8').replace(/\r\n/g, '\n').trim();
    return `/* ---- from packages/falak-components/src/${f} ---- */\n\n${css}`;
}).join('\n\n');

const block = `${START}
/*
    Every class the SDK components render, copied from the SDK source so it is
    searchable here. The SDK ships the same rules inside @layer falak; this
    unlayered copy takes precedence but is identical, so nothing changes until
    you override a rule in the "platform components" section that follows.
    Because this copy is unlayered, an override must match the copied rule's
    specificity (e.g. two classes beat one) — unlike the SDK's layered sheet.
    Regenerate after an SDK update:
      npx falak-sync-theme-css <this file>
*/

${body}

${END}`;

let css = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
const s = css.indexOf(START), e = css.indexOf(END);

if (s !== -1 && e !== -1) {
    css = css.slice(0, s) + block + css.slice(e + END.length);
} else if (css.includes(ANCHOR)) {
    css = css.replace(ANCHOR, `${block}\n\n${ANCHOR}`);
} else {
    css = `${css.trimEnd()}\n\n${block}\n`;
}

writeFileSync(target, css, 'utf8');
console.log(`${s !== -1 ? 'refreshed' : 'inserted'} SDK class block (${block.split('\n').length} lines) in ${target}`);
