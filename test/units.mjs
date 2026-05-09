// Tests unitaires offline — pas de réseau, pas d'IndexedDB, pas de DOM.
// Lance via `npm test` ou `node --test test/units.mjs`.
//
// Couvrent les helpers pures qui forment le cœur de la méthodo et de la
// pipeline data : matching (quantile, cosine, haversine, summarize, find),
// parsing CSV (parseCsvLine, headerIndex), formatage fr-FR, normalisation
// de chaîne, échappement HTML.
//
// Le harness bout-en-bout (test-pull.mjs) couvre la pipeline réseau Insee
// complète mais prend ~35 s ; ces tests-ci tournent en quelques ms.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  quantile, median, cosine, haversine, relDelta,
  summarizeComparables, countInRadius, findComparables
} from '../js/matching.js';
import { parseCsvLine, headerIndex } from '../js/zip-csv.js';
import { fmtInt, fmtDec1, fmtPct, fmtPctSigned } from '../js/format.js';
import { normalize, escapeHtml } from '../js/util.js';

// ---------- quantile (R type-7 linear interpolation) ----------

describe('quantile', () => {
  test('médiane d\'une liste impaire', () => assert.equal(quantile([1, 2, 3], 0.5), 2));
  test('médiane d\'une liste paire (interpolation)', () => assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5));
  test('Q1 sur 5 valeurs', () => assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2));
  test('Q3 sur 5 valeurs', () => assert.equal(quantile([1, 2, 3, 4, 5], 0.75), 4));
  test('singleton', () => assert.equal(quantile([42], 0.5), 42));
  test('liste vide → null', () => assert.equal(quantile([], 0.5), null));
  test('null et undefined filtrés', () => assert.equal(quantile([1, null, 3, undefined, 5], 0.5), 3));
  test('NaN filtrés', () => assert.equal(quantile([1, NaN, 3], 0.5), 2));
  test('valeurs non triées', () => assert.equal(quantile([5, 1, 4, 2, 3], 0.5), 3));
});

describe('median (alias quantile 0.5)', () => {
  test('cohérent avec quantile', () => assert.equal(median([1, 2, 3, 4, 5]), 3));
});

// ---------- cosine ----------

describe('cosine', () => {
  test('vecteurs identiques → 1', () => assert.equal(cosine([1, 0, 0], [1, 0, 0]), 1));
  test('vecteurs orthogonaux → 0', () => assert.equal(cosine([1, 0], [0, 1]), 0));
  test('vecteurs proportionnels → 1', () => assert.ok(Math.abs(cosine([1, 2, 3], [2, 4, 6]) - 1) < 1e-10));
  test('vecteur nul → 0 (évite NaN)', () => assert.equal(cosine([0, 0, 0], [1, 1, 1]), 0));
});

// ---------- haversine ----------

describe('haversine (km)', () => {
  test('même point → 0', () => assert.equal(haversine(45, 4, 45, 4), 0));
  test('Paris ↔ Marseille ≈ 660 km', () => {
    const d = haversine(48.8566, 2.3522, 43.2965, 5.3698);
    assert.ok(Math.abs(d - 660) < 5, `attendu ~660, obtenu ${d.toFixed(1)}`);
  });
  test('Paris ↔ Lyon ≈ 392 km', () => {
    const d = haversine(48.8566, 2.3522, 45.7640, 4.8357);
    assert.ok(Math.abs(d - 392) < 5, `attendu ~392, obtenu ${d.toFixed(1)}`);
  });
});

// ---------- relDelta ----------

describe('relDelta', () => {
  test('+10 % vs 100', () => assert.equal(relDelta(110, 100), 0.1));
  test('-50 %', () => assert.equal(relDelta(50, 100), -0.5));
  test('null si ref = 0 (évite division par zéro)', () => assert.equal(relDelta(10, 0), null));
  test('null si target null', () => assert.equal(relDelta(null, 100), null));
  test('null si ref null', () => assert.equal(relDelta(100, null), null));
});

// ---------- parseCsvLine ----------

describe('parseCsvLine (CSV Insee Side, séparateur ;)', () => {
  test('ligne basique 3 champs', () => {
    assert.deepEqual(parseCsvLine('A;B;C'), ['A', 'B', 'C']);
  });
  test('strip guillemets autour des chaînes', () => {
    assert.deepEqual(parseCsvLine('"A";"B";C'), ['A', 'B', 'C']);
  });
  test('chaîne vide → un seul champ vide', () => {
    assert.deepEqual(parseCsvLine(''), ['']);
  });
  test('champs vides intermédiaires', () => {
    assert.deepEqual(parseCsvLine(';;'), ['', '', '']);
  });
  test('mélange chaînes et nombres (pattern Insee Side)', () => {
    assert.deepEqual(
      parseCsvLine('"COM";"75056";"_T";"BURE";2024;58473'),
      ['COM', '75056', '_T', 'BURE', '2024', '58473']
    );
  });
});

// ---------- headerIndex ----------

describe('headerIndex', () => {
  test('mappe noms de colonnes → positions', () => {
    const h = headerIndex(['GEO', 'ACTIVITY', 'TIME_PERIOD', 'OBS_VALUE']);
    assert.equal(h.GEO, 0);
    assert.equal(h.ACTIVITY, 1);
    assert.equal(h.OBS_VALUE, 3);
  });
  test('header vide', () => {
    assert.deepEqual(headerIndex([]), {});
  });
});

// ---------- format ----------

describe('format', () => {
  test('fmtInt avec séparateur de milliers FR', () => {
    // L'espace insécable narrow utilisé par Intl peut être   ou ' '.
    assert.match(fmtInt(1234), /^1.234$/);
  });
  test('fmtInt null → tiret cadratin', () => assert.equal(fmtInt(null), '—'));
  test('fmtInt NaN → tiret cadratin', () => assert.equal(fmtInt(NaN), '—'));
  test('fmtInt Infinity → tiret', () => assert.equal(fmtInt(Infinity), '—'));
  test('fmtDec1 garde une décimale', () => assert.match(fmtDec1(3.14), /^3,1$/));
  test('fmtPct convertit ratio en %', () => assert.match(fmtPct(0.42), /42.%$/));
  test('fmtPctSigned positif explicite le +', () => assert.ok(fmtPctSigned(0.5).includes('+')));
  test('fmtPctSigned null → tiret', () => assert.equal(fmtPctSigned(null), '—'));
});

// ---------- normalize ----------

describe('normalize (recherche autocomplete)', () => {
  test('lowercases + retire accents FR', () => assert.equal(normalize('Romans-sur-Isère'), 'romans sur isere'));
  test('apostrophes & ponctuation → espace', () => assert.equal(normalize("L'Île-d'Aix"), 'l ile d aix'));
  test('chaîne vide', () => assert.equal(normalize(''), ''));
  test('trim final', () => assert.equal(normalize('  Paris  '), 'paris'));
  test('œ non couvert (Unicode hors latin de base) — comportement attendu', () => {
    // « Œillet » → « illet » (le Œ disparaît via [^a-z0-9])
    assert.equal(normalize('Œillet'), 'illet');
  });
});

// ---------- escapeHtml ----------

describe('escapeHtml (anti-XSS)', () => {
  test('chars HTML basiques', () => assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;'));
  test('apostrophes', () => assert.equal(escapeHtml("a'b"), 'a&#39;b'));
  test('guillemets', () => assert.equal(escapeHtml('a"b'), 'a&quot;b'));
  test('ampersand', () => assert.equal(escapeHtml('a & b'), 'a &amp; b'));
  test('non-string coercé', () => assert.equal(escapeHtml(42), '42'));
  test('null coercé', () => assert.equal(escapeHtml(null), 'null'));
});

// ---------- summarizeComparables (fixtures) ----------

describe('summarizeComparables', () => {
  const target = {
    code: 'TARGET', name: 'Cible', dept: '13',
    population: 51811, stock: 5069, density: 97.8,
    growth10y: 0.426, creations: 950,
    sectorShares: [0.05, 0.11, 0.27, 0.04, 0.04, 0.08, 0.17, 0.14, 0.10],
    sectorialCoverage: 1
  };
  const comparables = [
    { commune: { code: 'A', stock: 3533, density: 80,  growth10y: 0.40, creations: 600, population: 48000, sectorShares: [0.05, 0.10, 0.27, 0.04, 0.04, 0.08, 0.17, 0.18, 0.07] } },
    { commune: { code: 'B', stock: 4038, density: 90,  growth10y: 0.42, creations: 750, population: 50000, sectorShares: [0.05, 0.11, 0.26, 0.04, 0.04, 0.08, 0.18, 0.17, 0.07] } },
    { commune: { code: 'C', stock: 4227, density: 100, growth10y: 0.45, creations: 900, population: 52000, sectorShares: [0.05, 0.12, 0.25, 0.04, 0.04, 0.08, 0.19, 0.16, 0.07] } }
  ];

  test('n = nombre de comparables', () => {
    const r = summarizeComparables(target, comparables);
    assert.equal(r.summary.n, 3);
  });
  test('médiane stock', () => {
    const r = summarizeComparables(target, comparables);
    assert.equal(r.summary.stock.median, 4038);
  });
  test('Q1 ≤ médiane ≤ Q3', () => {
    const { summary } = summarizeComparables(target, comparables);
    for (const key of ['stock', 'density', 'growth10y', 'creations']) {
      const s = summary[key];
      assert.ok(s.q1 <= s.median, `Q1 > médiane sur ${key}`);
      assert.ok(s.median <= s.q3, `médiane > Q3 sur ${key}`);
    }
  });
  test('delta.stock = (cible − médiane) / médiane', () => {
    const r = summarizeComparables(target, comparables);
    const expected = (5069 - 4038) / 4038;
    assert.ok(Math.abs(r.delta.stock - expected) < 1e-9);
  });
  test('delta.growth10y exprimé en points (différence brute)', () => {
    const r = summarizeComparables(target, comparables);
    const expected = 0.426 - 0.42;  // médiane = 0.42
    assert.ok(Math.abs(r.delta.growth10y - expected) < 1e-9);
  });
  test('sectorMedianShares vecteur de longueur 9', () => {
    const r = summarizeComparables(target, comparables);
    assert.equal(r.summary.sectorMedianShares.length, 9);
  });
});

// ---------- findComparables (fixtures) ----------

describe('findComparables', () => {
  const baseShares = [0.05, 0.10, 0.30, 0.05, 0.05, 0.05, 0.20, 0.15, 0.05];
  const all = [
    { code: 'A', dept: '13', codeRegion: '93', population: 50000, stock: 4000, density: 80,  growth10y: 0.4, creations: 500, sectorShares: baseShares,                                            sectorialCoverage: 1, lat: 43.5, lon: 5.0 },
    { code: 'B', dept: '13', codeRegion: '93', population: 60000, stock: 5000, density: 83,  growth10y: 0.4, creations: 600, sectorShares: [0.05, 0.10, 0.28, 0.05, 0.05, 0.05, 0.22, 0.15, 0.05], sectorialCoverage: 1, lat: 43.6, lon: 5.5 },
    { code: 'C', dept: '75', codeRegion: '11', population: 100,   stock: 10,   density: 100, growth10y: 0.1, creations: 5,   sectorShares: [0.10, 0.10, 0.30, 0,    0,    0,    0.20, 0.20, 0.10], sectorialCoverage: 1, lat: 48.8, lon: 2.3 },
    { code: 'D', dept: '13', codeRegion: '93', population: 55000, stock: 4500, density: 81,  growth10y: 0.4, creations: 550, sectorShares: baseShares,                                            sectorialCoverage: 0.5, lat: 43.4, lon: 4.9 }
  ];
  const target = {
    code: 'TARGET', dept: '13', codeRegion: '93',
    population: 55000, stock: 4500, density: 81, growth10y: 0.4, creations: 550,
    sectorShares: baseShares, sectorialCoverage: 1, lat: 43.4, lon: 4.9
  };

  test('scope national : retient A et B (pas C trop petit, pas D coverage trop faible)', () => {
    const r = findComparables(target, all, { scope: { kind: 'national' } });
    assert.equal(r.reason, 'ok');
    assert.equal(r.candidates.length, 2);
    const codes = r.candidates.map(c => c.commune.code).sort();
    assert.deepEqual(codes, ['A', 'B']);
  });
  test('scope département 13 : 2 comparables (A et B)', () => {
    const r = findComparables(target, all, { scope: { kind: 'departement', value: '13' } });
    assert.equal(r.reason, 'ok');
    assert.equal(r.candidates.length, 2);
  });
  test('scope département 75 : aucun comparable (C est trop petite)', () => {
    const r = findComparables(target, all, { scope: { kind: 'departement', value: '75' } });
    assert.equal(r.reason, 'no_data');
  });
  test('cible < 2 000 hab → reason = pop_floor', () => {
    const r = findComparables({ ...target, population: 1500 }, all, { scope: { kind: 'national' } });
    assert.equal(r.reason, 'pop_floor');
    assert.equal(r.candidates.length, 0);
  });
  test('coverage < 0.95 exclut systématiquement', () => {
    const noisy = all.map(c => ({ ...c, sectorialCoverage: 0.5 }));
    const r = findComparables(target, noisy, { scope: { kind: 'national' } });
    assert.equal(r.reason, 'no_data');
  });
  test('scope distance 50 km : C (Paris à 700 km) exclue', () => {
    const r = findComparables(target, all, { scope: { kind: 'distance', value: 50 } });
    assert.equal(r.reason, 'ok');
    const codes = r.candidates.map(c => c.commune.code).sort();
    assert.ok(!codes.includes('C'));
  });
});

// ---------- countInRadius ----------

describe('countInRadius', () => {
  const target = {
    code: 'TARGET', dept: '13', codeRegion: '93',
    population: 55000, stock: 4500, sectorShares: [], sectorialCoverage: 1,
    lat: 43.4, lon: 4.9
  };
  const all = [
    { code: 'NEAR',    population: 50000, sectorShares: [], sectorialCoverage: 1, lat: 43.5, lon: 5.0 },
    { code: 'FAR',     population: 50000, sectorShares: [], sectorialCoverage: 1, lat: 48.8, lon: 2.3 },
    { code: 'NOCOORD', population: 50000, sectorShares: [], sectorialCoverage: 1, lat: null, lon: null }
  ];

  test('rayon 50 km : compte 1 (NEAR)', () => {
    assert.equal(countInRadius(target, all, 50), 1);
  });
  test('rayon 1000 km : compte 2 (NEAR et FAR, pas NOCOORD)', () => {
    assert.equal(countInRadius(target, all, 1000), 2);
  });
  test('cible < 2 000 hab → 0', () => {
    assert.equal(countInRadius({ ...target, population: 1500 }, all, 1000), 0);
  });
  test('monotone : rayon plus large ≥ rayon plus étroit', () => {
    assert.ok(countInRadius(target, all, 1000) >= countInRadius(target, all, 50));
  });
});
