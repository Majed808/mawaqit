// Production build → dist/ : bundle+minify JS/CSS, inline nothing heavy, version the service worker cache.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const js = await build({ entryPoints: [join(root, 'src/app.js')], bundle: true, minify: true, format: 'esm', target: ['es2020'], write: false, legalComments: 'none' });
const css = await build({ entryPoints: [join(root, 'src/app.css')], bundle: true, minify: true, write: false, target: ['chrome100', 'safari15'] });
const jsCode = js.outputFiles[0].text, cssCode = css.outputFiles[0].text;
const h = s => createHash('sha256').update(s).digest('hex').slice(0, 8);
const jsName = `app.${h(jsCode)}.js`, cssName = `app.${h(cssCode)}.css`;
writeFileSync(join(dist, jsName), jsCode);
writeFileSync(join(dist, cssName), cssCode);

let html = readFileSync(join(root, 'index.html'), 'utf8')
  .replace('src/app.css', cssName)
  .replace('src/app.js', jsName)
  .replace(/>\s+</g, '><');
writeFileSync(join(dist, 'index.html'), html);
cpSync(join(root, 'manifest.webmanifest'), join(dist, 'manifest.webmanifest'));
cpSync(join(root, 'icons'), join(dist, 'icons'), { recursive: true });

const files = ['./', 'index.html', 'manifest.webmanifest', jsName, cssName, ...readdirSync(join(dist, 'icons')).map(f => 'icons/' + f)];
const version = h(files.join() + jsCode + cssCode + html);
const sw = readFileSync(join(root, 'sw.js'), 'utf8')
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/const ASSETS = \[[\s\S]*?\];/, `const ASSETS = ${JSON.stringify(files)};`);
const swMin = (await build({ stdin: { contents: sw }, minify: true, write: false, target: ['es2020'] })).outputFiles[0].text;
writeFileSync(join(dist, 'sw.js'), swMin);
writeFileSync(join(dist, '.nojekyll'), '');

// size report
let total = 0, gz = 0;
const walk = d => readdirSync(d).forEach(f => { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else { const b = readFileSync(p); total += b.length; gz += gzipSync(b).length; } });
walk(dist);
console.log(`dist/ built — version ${version}`);
console.log(`JS ${(jsCode.length / 1024).toFixed(1)} KB (gzip ${(gzipSync(jsCode).length / 1024).toFixed(1)} KB), CSS ${(cssCode.length / 1024).toFixed(1)} KB`);
console.log(`total ${(total / 1024).toFixed(1)} KB, gzipped ≈ ${(gz / 1024).toFixed(1)} KB`);
