// Helpers pures réutilisés côté UI et côté tests offline.
// Pas de DOM, pas de fetch, pas d'IDB — directement importables en Node.

// Normalisation d'une chaîne pour la recherche : minuscule, sans accent,
// ponctuation → espace, trim. Utilisé par l'autocomplete de communes.
export function normalize(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
}

// Échappement HTML minimal (anti-XSS sur innerHTML).
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}
