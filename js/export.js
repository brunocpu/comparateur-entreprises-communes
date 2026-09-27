import { SECTOR_LABELS, A10_SECTORS } from './insee-api.js';
import { scopeLabel } from './format.js';

// Formattage fr-FR pour le CSV (Excel parse correctement avec ; comme séparateur
// et virgule décimale).
function fmtNum(v, decimals = 0) {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toFixed(decimals).replace('.', ',');
}
function fmtPct(v, decimals = 1) {
  if (v == null || !Number.isFinite(v)) return '';
  return (v * 100).toFixed(decimals).replace('.', ',') + ' %';
}

// Échappe les guillemets pour Excel/LibreOffice (même si nos valeurs n'en
// contiennent normalement pas, c'est défensif sur les noms de communes).
function csvEscape(s) {
  const str = String(s ?? '');
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

const SEP = ';';
const SOURCES = `# Sources : Insee Side (démographie d'entreprises), populations légales du Recensement (LOV2). geo.api.gouv.fr.`;
const todayFr = () => new Date().toLocaleDateString('fr-FR');

// En-tête avec accents + colonne Type pour distinguer cible / comparables / quartiles
const HEADERS = [
  'Type', 'Commune', 'Code Insee', 'Département', 'Population',
  'Entreprises actives', 'Entreprises pour 1 000 habitants',
  'Croissance 2014→2024', "Créations d'entreprises (annuel)",
  ...A10_SECTORS.map(s => `Part ${SECTOR_LABELS[s]} (A10)`)
];

const communeRow = (c, type) => [
  type,
  c.name,
  c.code,
  c.dept || '',
  fmtNum(c.population),
  fmtNum(c.stock),
  fmtNum(c.density, 1),
  fmtPct(c.growth10y, 1),
  fmtNum(c.creations),
  ...c.sectorShares.map(v => fmtPct(v, 1))
].map(csvEscape).join(SEP);

// Contenu du CSV « Une commune » : cible, comparables et quartiles du panel.
// Fonction pure (sans DOM) pour être testable hors navigateur.
// `regionsByCode` / `deptsByCode` : pour nommer la zone comme à l'écran.
export function buildComparablesCsv(target, comparables, summary, scope,
                                    { today = todayFr(), regionsByCode, deptsByCode } = {}) {
  const rows = [];

  // Bandeau de métadonnées (lecteur humain en haut du fichier)
  rows.push(`# Démographie des entreprises entre communes comparables`);
  rows.push(`# Cible : ${target.name} (${target.code})`);
  rows.push(`# Zone de comparaison : ${scopeLabel(scope, regionsByCode, deptsByCode)}`);
  rows.push(`# Sélection : ${comparables.length} commune(s) comparable(s)`);
  rows.push(SOURCES);
  rows.push(`# Export : ${today}`);
  rows.push(``);

  rows.push(HEADERS.map(csvEscape).join(SEP));
  rows.push(communeRow(target, 'CIBLE'));
  for (const { commune } of comparables) rows.push(communeRow(commune, 'Comparable'));

  // Quartiles du panel
  const s = summary.summary;
  rows.push(``);
  const qRow = (label, q) => rows.push([
    `${label} (n=${s.n})`, '', '', '',
    fmtNum(s.population[q]),
    fmtNum(s.stock[q]),
    fmtNum(s.density[q], 1),
    fmtPct(s.growth10y[q], 1),
    fmtNum(s.creations[q]),
    ...(q === 'median' && s.sectorMedianShares
        ? s.sectorMedianShares.map(v => fmtPct(v, 1))
        : A10_SECTORS.map(_ => ''))
  ].map(csvEscape).join(SEP));
  qRow('Quart inférieur (Q1)', 'q1');
  qRow('Médiane', 'median');
  qRow('Quart supérieur (Q3)', 'q3');

  return rows.join('\r\n');
}

// Contenu du CSV « Plusieurs communes » : les communes choisies, dans l'ordre
// de la sélection, sans quartiles (le tableau à l'écran n'en a pas).
export function buildMultiCsv(communes, { today = todayFr() } = {}) {
  const rows = [
    `# Démographie des entreprises — comparaison libre de communes`,
    `# Communes : ${communes.length}`,
    SOURCES,
    `# Export : ${today}`,
    ``,
    HEADERS.map(csvEscape).join(SEP),
    ...communes.map(c => communeRow(c, 'Commune'))
  ];
  return rows.join('\r\n');
}

export const multiCsvFilename = communes =>
  `comparateur-selection-${communes.map(c => c.code).join('-')}.csv`;

// BOM UTF-8 + CRLF pour Excel
function downloadCsv(content, filename) {
  const blob = new Blob(['﻿' + content], {
    type: 'text/csv;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(target, comparables, summary, scope, refs = {}) {
  const safeName = target.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-');
  downloadCsv(buildComparablesCsv(target, comparables, summary, scope, refs), `comparateur-${target.code}-${safeName}.csv`);
}

export function exportMultiCsv(communes) {
  downloadCsv(buildMultiCsv(communes), multiCsvFilename(communes));
}
