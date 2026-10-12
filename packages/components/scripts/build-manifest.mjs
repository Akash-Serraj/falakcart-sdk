/**
 * Describes every <falak-*> tag for editors and type checkers.
 *
 *   node packages/components/scripts/build-manifest.mjs <outDir>   (npm run manifest writes into the package)
 *
 * Writes three files into <outDir>, all derived from the source so they cannot
 * drift from it:
 *
 *   custom-elements.json    the community Custom Elements Manifest (schema 2.1)
 *   html-custom-data.json   VS Code HTML custom data — tag + attribute completion
 *                           in .html and .twig files
 *   types/index.d.ts        HTMLElementTagNameMap entries and attribute unions
 *
 * The source is read as text, not imported: the components need a DOM and the
 * entry imports CSS, neither of which Node has. The conventions it relies on
 * are the ones every component already follows — a REGISTRY of `'tag': Class`
 * in src/index.js and `static observedAttributes = [...]` on the class.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'src');
const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'dist');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function walk(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = resolve(dir, name);
        return statSync(path).isDirectory() ? walk(path) : path.endsWith('.js') ? [path] : [];
    });
}

/** The JSDoc block that ends right before `index`, cleaned to plain text. */
function docBefore(source, index) {
    const head = source.slice(0, index).trimEnd();
    if (!head.endsWith('*/')) return '';

    const start = head.lastIndexOf('/**');
    if (start === -1) return '';

    return head.slice(start + 3, -2)
        .split('\n')
        .map(line => line.replace(/^\s*\* ?/, ''))
        .join('\n')
        .trim();
}

/* ------------------------------------------------------------ every class */

const classes = new Map();   // name -> { name, parent, attributes|null, description, file }

for (const file of walk(src)) {
    const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const pattern = /(?:export\s+(?:default\s+)?)?class\s+(\w+)\s+extends\s+(\w+)\s*\{/g;
    const found = [...source.matchAll(pattern)];

    found.forEach((match, i) => {
        const body = source.slice(match.index, found[i + 1]?.index ?? source.length);
        const observed = body.match(/static\s+observedAttributes\s*=\s*\[([\s\S]*?)\]/);

        classes.set(match[1], {
            name: match[1],
            parent: match[2],
            attributes: observed ? [...observed[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]) : null,
            // `[...FalakAddProductButton.observedAttributes, 'checkout-url']`
            spreads: observed ? [...observed[1].matchAll(/\.\.\.\s*(\w+)\.observedAttributes/g)].map(m => m[1]) : [],
            description: docBefore(source, match.index),
            file: relative(root, file).replace(/\\/g, '/'),
        });
    });
}

/** Own attributes, or the nearest ancestor's — a subclass inherits observedAttributes. */
function attributesOf(name, seen = new Set()) {
    const entry = classes.get(name);
    if (!entry || seen.has(name)) return [];

    seen.add(name);

    if (!entry.attributes) return attributesOf(entry.parent, seen);

    return [...new Set([...entry.spreads.flatMap(spread => attributesOf(spread, seen)), ...entry.attributes])];
}

/* --------------------------------------------------------------- registry */

const entry = readFileSync(resolve(src, 'index.js'), 'utf8');
const block = entry.match(/const REGISTRY = \{([\s\S]*?)\n\};/);
if (!block) throw new Error('REGISTRY not found in src/index.js');

const tags = [...block[1].matchAll(/^\s*'([a-z0-9-]+)'\s*:\s*(\w+)\s*,/gm)].map(([, tag, className]) => {
    const info = classes.get(className);
    if (!info) throw new Error(`<${tag}> maps to ${className}, which was not found under src/`);

    return {
        tag,
        className,
        attributes: attributesOf(className),
        description: info.description || classes.get(info.parent)?.description || '',
        file: info.file,
    };
});

if (!tags.length) throw new Error('REGISTRY parsed to zero tags');

/* ------------------------------------------------------------------ write */

const MAX_DESCRIPTION = 2000;
const short = text => (text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION).trimEnd() + ' …' : text);
const interfaceName = className => `${className}Element`;

mkdirSync(resolve(outDir, 'types'), { recursive: true });

// Custom Elements Manifest — https://github.com/webcomponents/custom-elements-manifest
writeFileSync(resolve(outDir, 'custom-elements.json'), JSON.stringify({
    schemaVersion: '2.1.0',
    readme: '',
    modules: tags.map(t => ({
        kind: 'javascript-module',
        path: t.file,
        declarations: [{
            kind: 'class',
            name: t.className,
            tagName: t.tag,
            customElement: true,
            description: short(t.description),
            attributes: t.attributes.map(name => ({ name })),
        }],
        exports: [{ kind: 'custom-element-definition', name: t.tag, declaration: { name: t.className, module: t.file } }],
    })),
}, null, 2) + '\n');

// VS Code: "html.customData": ["./node_modules/@falakcart/components/html-custom-data.json"]
writeFileSync(resolve(outDir, 'html-custom-data.json'), JSON.stringify({
    version: 1.1,
    tags: tags.map(t => ({
        name: t.tag,
        description: { kind: 'markdown', value: short(t.description) || `\`<${t.tag}>\`` },
        attributes: t.attributes.map(name => ({ name })),
    })),
}, null, 2) + '\n');

const lines = [
    `// Generated by scripts/build-manifest.mjs from @falakcart/components ${pkg.version}. Do not edit.`,
    `import type { Falak } from '@falakcart/sdk';`,
    '',
    '/** Base of every <falak-*> element: light DOM, rendered after falak.onReady(). */',
    'export interface FalakElement extends HTMLElement {',
    '    readonly sdk: Falak;',
    '    readonly ready: boolean;',
    '    render(): void;',
    '}',
    '',
    ...[...new Set(tags.map(t => t.className))].map(name => `export interface ${interfaceName(name)} extends FalakElement {}`),
    '',
    '/** Every tag the components bundle registers. */',
    `export type FalakTagName =\n${tags.map(t => `    | '${t.tag}'`).join('\n')};`,
    '',
    '/** The attributes each tag observes (re-renders on change). */',
    'export interface FalakTagAttributes {',
    ...tags.map(t => `    '${t.tag}': ${t.attributes.length ? t.attributes.map(a => `'${a}'`).join(' | ') : 'never'};`),
    '}',
    '',
    'export interface DefineOptions {',
    '    /** Milliseconds to wait for the platform bundle; 0 waits forever. Default 10000. */',
    '    timeout?: number;',
    '}',
    '',
    '/** Resolves with the registered tag names once the components bundle has run. */',
    'export function defined(options?: DefineOptions): Promise<FalakTagName[]>;',
    '',
    'declare global {',
    '    interface HTMLElementTagNameMap {',
    ...tags.map(t => `        '${t.tag}': ${interfaceName(t.className)};`),
    '    }',
    '',
    '    interface DocumentEventMap {',
    "        'falak:components-defined': CustomEvent<FalakTagName[]>;",
    '    }',
    '}',
    '',
];

writeFileSync(resolve(outDir, 'types/index.d.ts'), lines.join('\n'));

console.log(`build-manifest: ${tags.length} tags -> ${relative(process.cwd(), outDir) || '.'}`);
