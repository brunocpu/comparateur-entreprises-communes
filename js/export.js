import { SECTOR_LABELS, A10_SECTORS } from './insee-api.js';

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

export function exportCsv(target, comparables, summary, scope) {
  const sep = ';';
  const rows = [];

  const today = new Date().toLocaleDateString('fr-FR');
  let scopeLabel = '';
  if (!scope || scope.kind === 'national') scopeLabel = 'Toute la France';
  else if (scope.kind === 'region')        scopeLabel = `Région (code ${scope.value})`;
  else if (scope.kind === 'departement')   scopeLabel = `Département ${scope.value}`;
  else if (scope.kind === 'distance')      scopeLabel = `Rayon ${scope.value} km`;

  // Bandeau de métadonnées (lecteur humain en haut du fichier)
  rows.push(`# Démographie des entreprises entre communes comparables`);
  rows.push(`# Cible : ${target.name} (${target.code})`);
  rows.push(`# Zone de comparaison : ${scopeLabel}`);
  rows.push(`# Sélection : ${comparables.length} commune(s) comparable(s)`);
  rows.push(`# Sources : Insee Side (démographie d'entreprises), populations légales du Recensement (LOV2). geo.api.gouv.fr.`);
  rows.push(`# Export : ${today}`);
  rows.push(``);

  // En-tête avec accents + colonne Type pour distinguer cible / comparables / quartiles
  const headers = [
    'Type', 'Commune', 'Code Insee', 'Département', 'Population',
    'Entreprises actives', 'Entreprises pour 1 000 habitants',
    'Croissance 2014→2023', "Créations d'entreprises (annuel)",
    ...A10_SECTORS.map(s => `Part ${SECTOR_LABELS[s]} (A10)`)
  ];
  rows.push(headers.map(csvEscape).join(sep));

  const writeCommune = (c, type) => {
    rows.push([
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
    ].map(csvEscape).join(sep));
  };

  writeCommune(target, 'CIBLE');
  for (const { commune } of comparables) writeCommune(commune, 'Comparable');

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
  ].map(csvEscape).join(sep));
  qRow('Quart inférieur (Q1)', 'q1');
  qRow('Médiane', 'median');
  qRow('Quart supérieur (Q3)', 'q3');

  // BOM UTF-8 + CRLF pour Excel
  const blob = new Blob(['﻿' + rows.join('\r\n')], {
    type: 'text/csv;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = target.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-');
  a.download = `comparateur-${target.code}-${safeName}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
