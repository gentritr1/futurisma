// Exact initial-shell bytes, measured the way scripts/validate-build.mjs does,
// for a given dist directory: raw JS, gzip JS, gzip shell, plus the lazy
// garage-bay chunk. Usage: node measure-shell.mjs <dist>
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
const dist = process.argv[2];
const html = readFileSync(`${dist}/index.html`);
const names = [...html.toString().matchAll(/(?:src|href)="\/([^"?]+\.(?:js|css))"/g)].map((m) => m[1]);
let raw = 0, jsGz = 0, cssGz = 0;
for (const n of names) { const b = readFileSync(`${dist}/${n}`); if (n.endsWith(".js")) { raw += b.length; jsGz += gzipSync(b).length; } else cssGz += gzipSync(b).length; }
const shell = gzipSync(html).length + jsGz + cssGz;
const bay = readdirSync(`${dist}/assets`).filter((n) => /^garage-bay-.*\.js$/.test(n)).map((n) => readFileSync(`${dist}/assets/${n}`));
const kib = (v) => (v / 1024).toFixed(3);
console.log(JSON.stringify({ files: names.filter((n) => n.endsWith(".js")).length, rawKiB: kib(raw), rawHeadroomB: 997 * 1024 - raw, jsGzipKiB: kib(jsGz), jsGzipHeadroomB: Math.round(276.6 * 1024 - jsGz), shellGzipKiB: kib(shell), shellHeadroomB: 289 * 1024 - shell, garageBayRawKiB: kib(bay.reduce((s, b) => s + b.length, 0)), garageBayGzipKiB: kib(bay.reduce((s, b) => s + gzipSync(b).length, 0)) }));
