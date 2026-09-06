// Contrôle des millésimes retenus — confronte l'artefact pré-bundlé à la source
// Insee, millésime par millésime.
//
// L'app ne conserve que deux bornes du fichier Side : l'année de référence
// (STOCK_BASELINE_YEAR) et l'année cible (STOCK_YEAR). Les millésimes
// intermédiaires sont lus puis écartés. Ce script reconstitue la série annuelle
// complète d'une commune depuis le ZIP CSV, vérifie que les deux bornes de
// l'artefact correspondent bien aux valeurs publiées, puis recalcule la
// croissance sur l'ensemble des communes.
//
// Usage : node scripts/check-millesimes.mjs [code commune] [--zip fichier.zip]
//   --zip réutilise un ZIP déjà téléchargé au lieu de reprendre les ~35 Mo.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { PRODUCTS, STOCK_YEAR, STOCK_BASELINE_YEAR } from '../js/insee-api.js';

const args = process.argv.slice(2);
const zipFlag = args.indexOf('--zip');
const zipPath = zipFlag >= 0 ? args[zipFlag + 1] : null;
const CIBLE = args.find(a => /^\d[\dAB]\d{3}$/.test(a)) || '26281';
const ARTEFACT = `data/communes-${STOCK_YEAR}.json`;

if (!existsSync(ARTEFACT)) {
  console.error(`✗ ${ARTEFACT} introuvable — lancer d'abord \`npm run build:data\`.`);
  process.exit(1);
}

// ---------- source Insee ----------

let zip;
if (zipPath && existsSync(zipPath)) {
  zip = readFileSync(zipPath);
  console.log(`ZIP réutilisé : ${zipPath}`);
} else {
  const { ds, product } = PRODUCTS.stocks;
  const url = `https://api.insee.fr/melodi/file/${ds}/${product}`;
  console.log(`Téléchargement de ${product} (~35 Mo)…`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status} sur ${url}`);
    process.exit(1);
  }
  zip = Buffer.from(await res.arrayBuffer());
  if (zipPath) writeFileSync(zipPath, zip);
}

// Première entrée du ZIP = le CSV de données (deflate brut, en-tête local standard).
const nameLen = zip.readUInt16LE(26);
const extraLen = zip.readUInt16LE(28);
const csv = Readable.from([zip.subarray(30 + nameLen + extraLen)]).pipe(createInflateRaw());

const serie = {};
let idx = null;
for await (const line of createInterface({ input: csv, crlfDelay: Infinity })) {
  if (!idx) {
    idx = {};
    line.replace(/^\uFEFF/, '').split(';').map(c => c.replace(/"/g, '')).forEach((c, i) => { idx[c] = i; });
    continue;
  }
  if (!line.includes(`"${CIBLE}"`)) continue;
  const p = line.split(';').map(c => c.replace(/"/g, ''));
  if (p[idx.GEO] !== CIBLE || p[idx.GEO_OBJECT] !== 'COM') continue;
  if (p[idx.SIDE_MEASURE] !== 'LEGAL_UNIT' || p[idx.ACTIVITY] !== '_T') continue;
  serie[p[idx.TIME_PERIOD]] = Number(p[idx.OBS_VALUE]);
}

const annees = Object.keys(serie).sort();
if (!annees.length) {
  console.error(`✗ Aucune observation pour la commune ${CIBLE} à la maille COM.`);
  process.exit(1);
}

const problemes = [];

console.log(`\nSource Insee — unités légales totales, commune ${CIBLE}`);
for (const a of annees) {
  const marque = a === STOCK_BASELINE_YEAR ? '  ← borne basse retenue'
               : a === STOCK_YEAR ? '  ← borne haute retenue' : '';
  console.log(`  ${a}  ${String(serie[a]).padStart(7)}${marque}`);
}
console.log(`  ${annees.length} millésimes publiés (${annees[0]}→${annees.at(-1)})`);

for (const an of [STOCK_BASELINE_YEAR, STOCK_YEAR]) {
  if (serie[an] === undefined) problemes.push(`millésime ${an} absent de la source pour ${CIBLE}`);
}

// ---------- artefact ----------

const artefact = JSON.parse(readFileSync(ARTEFACT, 'utf8'));
const cible = artefact.records.find(r => r.code === CIBLE);
if (!cible) {
  console.error(`✗ Commune ${CIBLE} absente de ${ARTEFACT}.`);
  process.exit(1);
}

console.log(`\n${ARTEFACT} — commune ${CIBLE}`);
const paires = [
  ['stockBaseline', cible.stockBaseline, serie[STOCK_BASELINE_YEAR], STOCK_BASELINE_YEAR],
  ['stock', cible.stock, serie[STOCK_YEAR], STOCK_YEAR]
];
for (const [champ, obtenu, attendu, an] of paires) {
  if (obtenu === attendu) {
    console.log(`  ${champ.padEnd(13)} = ${String(obtenu).padStart(7)}  ok  (= source ${an})`);
  } else {
    console.log(`  ${champ.padEnd(13)} = ${String(obtenu).padStart(7)}  ÉCART  (source ${an} = ${attendu})`);
    problemes.push(`${champ} = ${obtenu}, source ${an} = ${attendu}`);
  }
}

const attenduTaux = (serie[STOCK_YEAR] - serie[STOCK_BASELINE_YEAR]) / serie[STOCK_BASELINE_YEAR];
if (Math.abs(cible.growth10y - attenduTaux) < 1e-12) {
  console.log(`  growth10y     = ${(cible.growth10y * 100).toFixed(2).padStart(6)} %  ok  (= (${STOCK_YEAR}−${STOCK_BASELINE_YEAR})/${STOCK_BASELINE_YEAR})`);
} else {
  console.log(`  growth10y     = ${(cible.growth10y * 100).toFixed(2)} %  ÉCART  (attendu ${(attenduTaux * 100).toFixed(2)} %)`);
  problemes.push(`growth10y incohérent pour ${CIBLE}`);
}

// ---------- cohérence d'ensemble ----------

let calculees = 0, sansCroissance = 0, sansBase = 0, incoherences = 0;
for (const r of artefact.records) {
  if (!r.stockBaseline) sansBase++;
  if (r.growth10y === null) {
    sansCroissance++;
    // Une croissance nulle n'est légitime que sous le plancher de 20 UL.
    if (r.stockBaseline >= 20) incoherences++;
    continue;
  }
  calculees++;
  const taux = (r.stock - r.stockBaseline) / r.stockBaseline;
  if (r.stockBaseline < 20 || Math.abs(r.growth10y - taux) > 1e-9) incoherences++;
}

console.log(`\nCohérence sur ${artefact.records.length.toLocaleString('fr-FR')} communes`);
console.log(`  croissance calculée      : ${calculees.toLocaleString('fr-FR')}`);
console.log(`  non calculée (base < 20) : ${sansCroissance.toLocaleString('fr-FR')}`);
console.log(`  sans stock ${STOCK_BASELINE_YEAR}         : ${sansBase.toLocaleString('fr-FR')} (communes nouvelles pour l'essentiel)`);
console.log(`  incohérences arithmétiques : ${incoherences}`);
if (incoherences) problemes.push(`${incoherences} incohérence(s) arithmétique(s) sur growth10y`);

if (problemes.length) {
  console.error(`\n✗ ${problemes.length} anomalie(s) :`);
  problemes.forEach(p => console.error('  - ' + p));
  process.exit(1);
}
console.log(`\n✓ Bornes ${STOCK_BASELINE_YEAR} et ${STOCK_YEAR} conformes à la source, croissance cohérente partout.`);
