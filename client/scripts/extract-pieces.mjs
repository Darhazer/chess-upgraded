// One-off: render react-chessboard's default piece SVGs to static markup
// and emit them as a TS/JS map we can inline into the app. The package
// doesn't export defaultPieces, so we evaluate the runtime jsx calls
// against react/jsx-runtime ourselves.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = readFileSync(
  join(__dirname, '..', 'node_modules', 'react-chessboard', 'dist', 'index.esm.js'),
  'utf8'
);

// Find the defaultPieces literal and extract its body.
const start = dist.indexOf('const defaultPieces = {');
const end = dist.indexOf('\n};\n', start);
if (start === -1 || end === -1) throw new Error('defaultPieces not found');
const body = dist.slice(start + 'const defaultPieces = '.length, end + 2);

// Evaluate the literal in a sandbox where jsx/jsxs/Fragment are available.
const evalFn = new Function('jsx', 'jsxs', 'Fragment', `return ${body};`);
const defaultPieces = evalFn(jsx, jsxs, Fragment);

const out = {};
for (const [code, element] of Object.entries(defaultPieces)) {
  out[code] = renderToStaticMarkup(element);
}

const target = join(__dirname, '..', 'src', 'piece-svgs.js');
writeFileSync(
  target,
  `// Auto-generated from react-chessboard's default pieces (Cburnett, public domain).\n` +
    `// Run \`pnpm extract-pieces\` to regenerate.\n` +
    `export const PIECE_SVGS = ${JSON.stringify(out, null, 2)};\n`
);
console.log('Wrote', target);
