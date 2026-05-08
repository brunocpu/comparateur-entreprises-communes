const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const pf1 = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero'
});

export const fmtInt = v => v == null || !Number.isFinite(v) ? '—' : nf0.format(v);
export const fmtDec1 = v => v == null || !Number.isFinite(v) ? '—' : nf1.format(v);
export const fmtDec2 = v => v == null || !Number.isFinite(v) ? '—' : nf2.format(v);
export const fmtPctSigned = v => v == null || !Number.isFinite(v) ? '—' : pf1.format(v);
export const fmtPct = v => {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: 1
  }).format(v);
};

export function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}
