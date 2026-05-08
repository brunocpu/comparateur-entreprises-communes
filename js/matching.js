// Matching algorithm — find communes comparables.
//
// Filtres durs :
//   - Population : bande ratio [target/1.25 ; target×1.25] (asymétrique mais
//     stable en log-échelle ; recommandation Insee statisticien).
//   - sectorialCoverage ≥ 95 % (sinon le profil sectoriel est trop lacunaire
//     pour porter une comparaison ; secret stat sur petites cellules).
//   - Plancher population cible : 2 000 hab. En dessous, l'analyse n'est pas
//     statistiquement honnête (siège unique = 30-50 % du stock UL).
//   - Scope : national / région / département / rayon haversine.
//
// Score (plus bas = plus proche) — pondération orientée "profil" :
//   30 % taille relative + 60 % distance sectorielle (1−cosinus) + 10 % géo.

export const POP_FLOOR_FOR_MATCHING = 2000;
export const POP_RATIO_TOLERANCE = 1.25;
export const COVERAGE_FLOOR = 0.95;
// Seuil purement informatif : en dessous de 5 comparables, l'UI affiche un
// avertissement « panel limité ». Pas de blocage — on montre ce qu'on a.
export const N_RECOMMENDED = 5;
const N_MAX = 10;

// `scope` peut être :
//   { kind: 'national' }
//   { kind: 'region',      value: '<codeRegion>' }
//   { kind: 'departement', value: '<codeDept>' }
//   { kind: 'distance',    value: <radiusKm> }
// Anciennes signatures (string) supportées pour rétro-compatibilité.
function normalizeScope(opts, target) {
  if (opts.scope && typeof opts.scope === 'object') return opts.scope;
  const kind = opts.scope || 'national';
  if (kind === 'distance')    return { kind: 'distance',    value: opts.radiusKm ?? 50 };
  if (kind === 'departement') return { kind: 'departement', value: target.dept };
  if (kind === 'region')      return { kind: 'region',      value: target.codeRegion };
  return { kind: 'national' };
}

export function findComparables(target, all, opts = {}) {
  const scope = normalizeScope(opts, target);

  if (target.population < POP_FLOOR_FOR_MATCHING) {
    return { reason: 'pop_floor', candidates: [], scope };
  }

  const popMin = target.population / POP_RATIO_TOLERANCE;
  const popMax = target.population * POP_RATIO_TOLERANCE;
  const radiusKm = scope.kind === 'distance' ? Number(scope.value) || 50 : null;

  const candidates = [];
  for (const c of all) {
    if (c.code === target.code) continue;
    if (c.population < popMin || c.population > popMax) continue;
    if (c.sectorialCoverage < COVERAGE_FLOOR) continue;

    if (scope.kind === 'departement' && c.dept !== scope.value) continue;
    if (scope.kind === 'region'      && c.codeRegion !== scope.value) continue;

    let dKm = null;
    if (target.lat != null && target.lon != null && c.lat != null && c.lon != null) {
      dKm = haversine(target.lat, target.lon, c.lat, c.lon);
    }
    if (scope.kind === 'distance') {
      if (dKm == null || dKm > radiusKm) continue;
    }

    const sizeDist = Math.abs(target.population - c.population) / target.population;
    const sectorDist = 1 - cosine(target.sectorShares, c.sectorShares);

    let score;
    if (scope.kind === 'distance') {
      const geoDist = (dKm ?? radiusKm) / radiusKm;
      score = 0.30 * sizeDist + 0.60 * sectorDist + 0.10 * geoDist;
    } else {
      score = 0.33 * sizeDist + 0.67 * sectorDist;
    }

    candidates.push({ commune: c, score, sizeDist, sectorDist, distanceKm: dKm });
  }

  candidates.sort((a, b) => a.score - b.score);
  if (candidates.length === 0) {
    return { reason: 'no_data', candidates: [], scope };
  }
  return { reason: 'ok', candidates: candidates.slice(0, N_MAX), scope };
}

// Compteur léger : nombre de communes éligibles (filtres pop + coverage)
// dans un rayon donné. Utilisé pour l'affichage live « ~430 communes dans
// ce rayon » sous l'input du mode « Autour de la commune ».
export function countInRadius(target, all, radiusKm) {
  if (target.population < POP_FLOOR_FOR_MATCHING) return 0;
  const popMin = target.population / POP_RATIO_TOLERANCE;
  const popMax = target.population * POP_RATIO_TOLERANCE;
  let n = 0;
  for (const c of all) {
    if (c.code === target.code) continue;
    if (c.population < popMin || c.population > popMax) continue;
    if (c.sectorialCoverage < COVERAGE_FLOOR) continue;
    if (target.lat == null || target.lon == null || c.lat == null || c.lon == null) continue;
    if (haversine(target.lat, target.lon, c.lat, c.lon) > radiusKm) continue;
    n++;
  }
  return n;
}

// Linear-interpolated quantile (R type-7). q ∈ [0, 1].
export function quantile(values, q) {
  const arr = values.filter(v => v != null && Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!arr.length) return null;
  if (arr.length === 1) return arr[0];
  const pos = (arr.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
}

export const median = values => quantile(values, 0.5);

export function summarizeComparables(target, comparables) {
  const list = comparables.map(c => c.commune);
  const stat = arr => ({
    median: quantile(arr, 0.5),
    q1:     quantile(arr, 0.25),
    q3:     quantile(arr, 0.75)
  });

  const summary = {
    n: list.length,
    population: stat(list.map(c => c.population)),
    stock:      stat(list.map(c => c.stock)),
    density:    stat(list.map(c => c.density)),
    growth10y:  stat(list.map(c => c.growth10y)),
    creations:  stat(list.map(c => c.creations)),
    sectorMedianShares: medianVector(list.map(c => c.sectorShares))
  };

  const delta = {
    stock:     relDelta(target.stock,     summary.stock.median),
    density:   relDelta(target.density,   summary.density.median),
    growth10y: target.growth10y != null && summary.growth10y.median != null
      ? target.growth10y - summary.growth10y.median // points de pourcentage
      : null,
    creations: relDelta(target.creations, summary.creations.median)
  };

  // Écart à la médiane des comparables exprimé en UL : ce N'EST PAS un
  // "potentiel théorique" — c'est l'écart à un échantillon de 10 voisins
  // construit par similarité sectorielle.
  const ulGapToMedian = summary.density.median != null
    ? Math.round((summary.density.median - target.density) * target.population / 1000)
    : null;

  return { summary, delta, ulGapToMedian };
}

function relDelta(target, ref) {
  if (target == null || ref == null || ref === 0) return null;
  return (target - ref) / ref;
}

function medianVector(vectors) {
  if (!vectors.length) return null;
  const len = vectors[0].length;
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = median(vectors.map(v => v[i]));
  }
  return out;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
