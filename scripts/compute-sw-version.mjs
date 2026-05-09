// Recalcule le nom du cache du Service Worker à partir d'un hash SHA-256
// des fichiers listés dans le SHELL de sw.js. Idempotent : tant que les
// fichiers ne changent pas, le hash ne change pas.
//
// But : éliminer le bug futur classique « j'ai poussé un fix CSS, personne
// ne le voit » causé par un oubli de bumper manuellement « cec-shell-vNN ».
//
// Usage : node scripts/compute-sw-version.mjs
// Lancé automatiquement par .github/workflows/pages.yml avant le déploiement.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SW_PATH = 'sw.js';
const sw = readFileSync(SW_PATH, 'utf8');

// Extrait la liste SHELL = [...] et récupère les chemins entre quotes.
const shellMatch = sw.match(/const SHELL = \[([\s\S]*?)\];/);
if (!shellMatch) {
  process.stderr.write('✗ Bloc « const SHELL = [...] » introuvable dans sw.js\n');
  process.exit(1);
}
const files = [...shellMatch[1].matchAll(/'([^']+)'/g)]
  .map(m => m[1].replace(/^\.\//, ''))
  .map(p => p === '' ? 'index.html' : p);  // './' = racine = index.html

// Hash combiné : nom du fichier + contenu, tri alphabétique pour
// déterminisme indépendant de l'ordre dans le tableau SHELL.
const hash = createHash('sha256');
for (const f of [...files].sort()) {
  let buf;
  try {
    buf = readFileSync(f);
  } catch (err) {
    process.stderr.write(`✗ Fichier listé dans SHELL mais introuvable : ${f}\n`);
    process.exit(1);
  }
  hash.update(f);
  hash.update(buf);
}
const short = hash.digest('hex').slice(0, 8);
const next = `cec-shell-${short}`;

// Réécriture de la ligne CACHE dans sw.js.
const updated = sw.replace(/const CACHE = '[^']+';/, `const CACHE = '${next}';`);
if (updated === sw) {
  // Aucun changement (même hash que le précédent run). Pas d'écriture.
  process.stderr.write(`✓ SW cache inchangé : ${next} (${files.length} fichiers)\n`);
} else {
  writeFileSync(SW_PATH, updated);
  process.stderr.write(`✓ SW cache mis à jour : ${next} (${files.length} fichiers)\n`);
}
