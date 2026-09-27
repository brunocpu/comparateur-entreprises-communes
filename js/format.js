const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const pf1 = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero'
});

export const fmtInt = v => v == null || !Number.isFinite(v) ? '—' : nf0.format(v);
export const fmtDec1 = v => v == null || !Number.isFinite(v) ? '—' : nf1.format(v);
export const fmtPct = v => {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: 1
  }).format(v);
};

// Écarts à la médiane des comparables, affichés sous les indicateurs.
// Écart relatif pour les niveaux ; écart en points pour la croissance, qui
// est déjà un pourcentage (une différence de taux ne s'exprime pas en %).
export const fmtDeltaVsMedian = v =>
  v == null || !Number.isFinite(v) ? '' : `${pf1.format(v)} par rapport à la médiane des comparables`;

const pt1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
export function fmtPointsVsMedian(v) {
  if (v == null || !Number.isFinite(v)) return '';
  const pts = Math.round(v * 1000) / 10;
  return `${pt1.format(pts)} ${Math.abs(pts) >= 2 ? 'points' : 'point'} d'écart avec la médiane`;
}

// Désignation de la zone de comparaison, identique partout où elle s'affiche
// (barre récapitulative, bandeau, titre du tableau, export CSV). Repli sur le
// code quand les référentiels régions/départements ne sont pas disponibles.
export function scopeLabel(scope, regionsByCode, deptsByCode) {
  if (!scope || scope.kind === 'national') return 'Toute la France';
  if (scope.kind === 'region') {
    const r = regionsByCode?.get?.(scope.value);
    return `Région ${r?.nom || scope.value}`;
  }
  if (scope.kind === 'departement') {
    const d = deptsByCode?.get?.(scope.value);
    return d?.nom ? `Département ${d.nom} (${scope.value})` : `Département ${scope.value}`;
  }
  if (scope.kind === 'distance') return `Rayon ${scope.value} km`;
  return '';
}

export const fmtCommunesComparables = n =>
  n > 1 ? `${n} communes comparables` : `${n} commune comparable`;

export function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}
