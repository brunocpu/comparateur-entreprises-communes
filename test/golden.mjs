// Golden master — fige les résultats du matching sur l'artefact réel.
//
// Le fixture est capturé une fois sur un code réputé correct. Toute
// modification ultérieure qui change une sélection de comparables, un score,
// un quartile ou un écart à la médiane fait échouer ce test : un changement
// de résultat doit être voulu, et le fixture recapturé explicitement.
//
//   npm test                     vérifie
//   npm run test:golden:update   recapture (après vérification du diff)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { findComparables, summarizeComparables } from '../js/matching.js';
import { ARTEFACT_PATH } from '../js/insee-api.js';

const ARTEFACT = new URL(`../${ARTEFACT_PATH}`, import.meta.url);
const FIXTURE = new URL('./fixtures/golden-matching.json', import.meta.url);

// Panel choisi pour couvrir les cas de figure du matching.
const PANEL = [
  '26281', // Romans-sur-Isère — commune de référence du projet
  '26362', // Valence — même département, taille différente
  '75056', // Paris — très grande commune, peu de pairs
  '75101', // Paris 1er — arrondissement municipal
  '13055', // Marseille
  '69381', // Lyon 1er — arrondissement municipal
  '35238', // Rennes
  '2A004', // Ajaccio — code département alphanumérique
  '97411', // Saint-Denis (La Réunion) — outre-mer
  '97209', // Fort-de-France — outre-mer
  '97357', // Grand-Santi — croissance non calculée (base < 20 UL)
  '26014'  // Arthémonay — sous le plancher de 2 000 habitants
];

const scopesFor = target => [
  { kind: 'national' },
  { kind: 'region', value: target.codeRegion },
  { kind: 'departement', value: target.dept },
  { kind: 'distance', value: 50 },
  { kind: 'distance', value: 200 }
];

// 12 chiffres significatifs : absorbe un éventuel écart d'arrondi flottant
// sans masquer un changement réel de calcul.
const round = v => (typeof v === 'number' && Number.isFinite(v)) ? Number(v.toPrecision(12)) : v;
const roundDeep = o => {
  if (Array.isArray(o)) return o.map(roundDeep);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, roundDeep(v)]));
  return round(o);
};

function capture(records) {
  const byCode = new Map(records.map(r => [r.code, r]));
  const cases = [];
  for (const code of PANEL) {
    const target = byCode.get(code);
    if (!target) throw new Error(`Commune ${code} absente de l'artefact`);
    for (const scope of scopesFor(target)) {
      const res = findComparables(target, records, { scope });
      const entry = {
        code,
        scope,
        reason: res.reason,
        candidates: res.candidates.map(c => ({
          code: c.commune.code,
          score: round(c.score),
          distanceKm: round(c.distanceKm)
        }))
      };
      if (res.candidates.length) {
        const { summary, delta } = summarizeComparables(target, res.candidates);
        entry.summary = roundDeep(summary);
        entry.delta = roundDeep(delta);
      }
      cases.push(entry);
    }
  }
  return cases;
}

const artefact = JSON.parse(readFileSync(ARTEFACT, 'utf8'));

if (process.argv.includes('--update')) {
  const fixture = {
    artefact: { dataVersion: artefact.dataVersion, builtAt: artefact.builtAt, count: artefact.records.length },
    cases: capture(artefact.records)
  };
  writeFileSync(FIXTURE, JSON.stringify(fixture, null, 1) + '\n');
  console.log(`Fixture recapturé : ${fixture.cases.length} cas.`);
  process.exit(0);
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

describe('golden master — matching sur l\'artefact réel', () => {
  test('artefact identique à celui de la capture', () => {
    assert.deepEqual(
      { dataVersion: artefact.dataVersion, builtAt: artefact.builtAt, count: artefact.records.length },
      fixture.artefact,
      'L\'artefact a été régénéré depuis la capture : vérifier les écarts, puis `npm run test:golden:update`.'
    );
  });

  const actual = capture(artefact.records);
  fixture.cases.forEach((expected, i) => {
    const label = `${expected.code} · ${expected.scope.kind}${expected.scope.value != null ? ' ' + expected.scope.value : ''}`;
    test(label, () => assert.deepEqual(actual[i], expected));
  });
});
