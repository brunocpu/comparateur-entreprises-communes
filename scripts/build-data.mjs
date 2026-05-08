// Build script — exécute le pull Insee complet et écrit l'artefact compact
// `data/communes-2023.json` que le front-end charge en un seul fetch (au lieu
// de pré-télécharger 67 MB de ZIP CSV pour finalement n'en garder que ~5 MB).
//
// Usage : node scripts/build-data.mjs
// Régénération annuelle prévue via .github/workflows/build-data.yml

import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { pullAll } from '../js/insee-api.js';

const t0 = Date.now();
let lastLog = 0;
function onProgress({ ratio, label }) {
  const now = Date.now();
  if (now - lastLog < 500 && ratio < 1) return;
  lastLog = now;
  const pct = (ratio * 100).toFixed(1).padStart(5, ' ');
  const elapsed = ((now - t0) / 1000).toFixed(1) + 's';
  process.stderr.write(`\r[${pct}%] ${elapsed.padStart(7)} — ${label.slice(0, 80).padEnd(80)}`);
}

try {
  const { records, warnings, regions, departements } = await pullAll(onProgress);
  process.stderr.write('\n');

  mkdirSync('data', { recursive: true });
  const out = {
    builtAt: new Date().toISOString(),
    millesime: 2023,
    warnings,
    regions,
    departements,
    records
  };
  const json = JSON.stringify(out);
  const path = 'data/communes-2023.json';
  writeFileSync(path, json);

  const rawMb = (json.length / 1024 / 1024).toFixed(2);
  const gzMb  = (gzipSync(json).length / 1024 / 1024).toFixed(2);
  process.stderr.write(`\n✓ Écrit ${path}\n`);
  process.stderr.write(`  ${records.length.toLocaleString('fr-FR')} communes\n`);
  process.stderr.write(`  ${rawMb} MB brut · ~${gzMb} MB gzip wire\n`);
  process.stderr.write(`  Total : ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  if (warnings.length) {
    process.stderr.write(`  ${warnings.length} avertissement(s) :\n`);
    warnings.forEach(w => process.stderr.write('    - ' + w + '\n'));
  }
} catch (err) {
  process.stderr.write('\n✗ Build a échoué : ' + err.message + '\n');
  console.error(err.stack);
  process.exit(1);
}
