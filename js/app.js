import * as cache from './cache.js';
import { pullAll } from './insee-api.js';
import { findComparables, summarizeComparables, countInRadius } from './matching.js';
import * as ui from './ui.js';
import { exportCsv } from './export.js';
import { fmtDate } from './format.js';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  communes: [],
  byCode: new Map(),
  byNorm: [],
  regions: [],
  regionsByCode: new Map(),
  departements: [],
  departementsByCode: new Map(),
  selected: null,
  comparables: null,
  summary: null,
  pulling: false,
  hasAnalyzed: false,
  customCommunes: []
};

let scopeApi;     // returned by ui.setupScopeRadio
let rayonDebounce = 0;
let uiInitialized = false;

// ---------- bootstrap ----------

(async function init() {
  registerSW();
  wireBootstrapButtons();
  wireAnalyze();
  wireExport();

  if (await cache.isReady()) {
    await loadFromCache();
    showSearch();
    return;
  }

  // Premier chargement : tente l'artefact pré-bundlé (~2-3 MB gzip) avant
  // de proposer le pull live (~67 MB de ZIP CSV séquentiels). Si l'artefact
  // est absent ou inaccessible, on retombe sur le bouton « Lancer le
  // chargement » classique.
  await tryLoadBundledData();
})();

async function tryLoadBundledData() {
  const btn = document.getElementById('btn-pull');
  const labelEl = document.getElementById('progress-label');
  if (!btn || !labelEl) return false;

  btn.hidden = true;
  ui.setProgress(0.02, 'Préparation des données…');

  try {
    const res = await fetch('./data/communes-2023.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Progression au fil du téléchargement (Content-Length, sinon barre indéterminée).
    const total = Number(res.headers.get('content-length')) || 0;
    let received = 0;
    const reader = res.body.getReader();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        const mb = (received / 1024 / 1024).toFixed(1);
        const totMb = (total / 1024 / 1024).toFixed(1);
        ui.setProgress(received / total * 0.85, `Téléchargement — ${mb} / ${totMb} MB`);
      }
    }

    ui.setProgress(0.9, 'Décodage…');
    const text = await new Blob(chunks).text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.records)) throw new Error('Artefact invalide');

    ui.setProgress(0.95, 'Indexation locale…');
    await cache.bulkPut(data.records);
    await cache.setMeta('lastPullAt', data.builtAt ? Date.parse(data.builtAt) : Date.now());
    await cache.setMeta('lastPullWarnings', data.warnings || []);
    await cache.setMeta('regions', data.regions || []);
    await cache.setMeta('departements', data.departements || []);
    ui.setProgress(1, `Terminé — ${data.records.length.toLocaleString('fr-FR')} communes chargées`);

    await loadFromCache();
    showSearch();
    return true;
  } catch (err) {
    console.warn('Artefact pré-bundlé indisponible, fallback API live :', err);
    btn.hidden = false;
    document.getElementById('progress').hidden = true;
    labelEl.textContent = 'Chargement automatique indisponible — téléchargement complet depuis l\'API Insee.';
    return false;
  }
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ---------- data load / refresh ----------

function wireBootstrapButtons() {
  document.getElementById('btn-pull').addEventListener('click', () => doPull(false));
  document.getElementById('btn-refresh').addEventListener('click', () => doPull(true));
}

async function doPull(refresh) {
  if (state.pulling) return;
  state.pulling = true;
  ui.hideError();
  // Refresh : ré-affiche temporairement la card bootstrap pour montrer la
  // progression. Sera de nouveau cachée par loadFromCache() à la fin.
  document.getElementById('bootstrap').hidden = false;

  // Reset complet de l'état utilisateur : toute analyse en cours devient
  // caduque (les communes vont être ré-importées, les références obsolètes).
  if (refresh) {
    state.selected = null;
    state.comparables = null;
    state.summary = null;
    state.hasAnalyzed = false;
    state.customCommunes = [];
    const input = document.getElementById('commune-input');
    if (input) input.value = '';
    const multiInput = document.getElementById('multi-input');
    if (multiInput) multiInput.value = '';
    document.getElementById('search-summary').hidden = true;
    document.getElementById('results').hidden = true;
    document.getElementById('tabs').hidden = true;
    ui.renderMultiCompare(state.customCommunes, removeMultiCommune);
  }

  const btnPull = document.getElementById('btn-pull');
  const btnRefresh = document.getElementById('btn-refresh');
  btnPull.disabled = true;
  btnRefresh.disabled = true;

  const ctrl = new AbortController();
  try {
    if (refresh) await cache.clearAll();
    const { records, warnings, regions, departements } = await pullAll(({ ratio, label }) => ui.setProgress(ratio, label), ctrl.signal);
    if (!records.length) throw new Error('Aucune donnée téléchargée — vérifier la connexion ou l\'API Insee.');
    await cache.bulkPut(records);
    await cache.setMeta('lastPullAt', Date.now());
    await cache.setMeta('lastPullWarnings', warnings);
    await cache.setMeta('regions', regions);
    await cache.setMeta('departements', departements);
    await loadFromCache();
    const tail = warnings.length
      ? ` — ${warnings.length} avertissement(s) (API Insee partielle, voir console).`
      : '';
    ui.setProgress(1, `Terminé — ${records.length.toLocaleString('fr-FR')} communes chargées${tail}`);
    if (warnings.length) console.warn('Pull warnings:', warnings);
    showSearch();
  } catch (err) {
    console.error(err);
    ui.showError(`Le chargement a échoué : ${err.message}. Réessayer plus tard.`);
  } finally {
    btnPull.disabled = false;
    btnRefresh.disabled = false;
    state.pulling = false;
  }
}

async function loadFromCache() {
  state.communes = await cache.getAllCommunes();
  state.byCode = new Map();
  state.byNorm = [];
  for (const c of state.communes) {
    state.byCode.set(c.code, c);
    state.byNorm.push({ commune: c, norm: normalize(c.name) });
  }
  state.regions = (await cache.getMeta('regions')) || [];
  state.departements = (await cache.getMeta('departements')) || [];

  // Migration : pull réalisé avant la v2 du sélecteur de scope → les listes
  // régions/départements n'étaient pas en cache. On les récupère à la volée
  // (~5 KB, ~200 ms) pour éviter à l'utilisateur de re-pull les 67 MB.
  if (!state.regions.length || !state.departements.length) {
    try {
      const [regions, departements] = await Promise.all([
        fetch('https://geo.api.gouv.fr/regions').then(r => r.ok ? r.json() : []),
        fetch('https://geo.api.gouv.fr/departements?fields=code,nom,codeRegion').then(r => r.ok ? r.json() : [])
      ]);
      if (regions.length)      { state.regions = regions;          await cache.setMeta('regions', regions); }
      if (departements.length) { state.departements = departements; await cache.setMeta('departements', departements); }
    } catch (err) {
      console.warn('Référentiels régions/départements indisponibles :', err);
    }
  }

  // Migration : les communes en cache (pull v1) n'ont pas codeRegion. On le
  // backfill localement depuis la liste des départements.
  const deptToRegion = new Map(state.departements.map(d => [d.code, d.codeRegion]));
  for (const c of state.communes) {
    if (!c.codeRegion && c.dept) {
      c.codeRegion = deptToRegion.get(c.dept) || null;
    }
  }

  state.regionsByCode = new Map(state.regions.map(r => [r.code, r]));
  state.departementsByCode = new Map(state.departements.map(d => [d.code, d]));

  const ts = await cache.getMeta('lastPullAt');
  document.getElementById('cache-status').innerHTML =
    `${state.communes.length.toLocaleString('fr-FR')} communes · chargées le ${fmtDate(ts)}`;
  document.getElementById('header-meta').hidden = false;
  document.getElementById('bootstrap').hidden = true;
}

function showSearch() {
  document.getElementById('tabs').hidden = false;
  document.getElementById('panel-single').hidden = false;
  document.getElementById('panel-multi').hidden = true;
  document.getElementById('search').hidden = false;
  document.getElementById('search-multi').hidden = true;
  document.getElementById('search-summary').hidden = true;

  // Re-population des dropdowns scope à chaque appel — la liste régions/
  // départements peut venir d'arriver après un refresh ; populateScopeOptions
  // remplace innerHTML, donc idempotent.
  ui.populateScopeOptions(state.regions, state.departements);

  if (uiInitialized) return;

  // One-time setup : sinon les écouteurs s'empilent à chaque refresh des
  // données et on déclenche autocomplete/scope/analyses en double, triple…
  setupSearchUI();
  scopeApi = ui.setupScopeRadio({ onChange: onScopeChange });
  ui.setupStickyBanner({ onChange: () => ui.expandSearch() });
  setupMultiCompare();
  setupTabs();

  document.getElementById('btn-modify').addEventListener('click', () => {
    ui.expandSearch();
    // ui.expandSearch déplace déjà le focus sur #commune-input — on passe
    // preventScroll:true là-bas pour ne pas concurrencer ce scrollIntoView.
    document.getElementById('search').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  });

  uiInitialized = true;
}

// ---------- onglets : Une commune | Plusieurs communes ----------

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('.search-tab'));
  tabs.forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(t);
      if (e.key === 'ArrowRight') { e.preventDefault(); tabs[(idx + 1) % tabs.length].focus(); tabs[(idx + 1) % tabs.length].click(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); tabs[(idx - 1 + tabs.length) % tabs.length].focus(); tabs[(idx - 1 + tabs.length) % tabs.length].click(); }
    });
  });
}

function switchTab(tab) {
  const tabs = document.querySelectorAll('.search-tab');
  tabs.forEach(t => {
    const isActive = t.dataset.tab === tab;
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    // Roving tabindex (WAI-ARIA tablist) : seul l'onglet actif est tabable.
    t.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  // Toggle des tabpanels eux-mêmes (pattern WAI-ARIA tabs).
  document.getElementById('panel-single').hidden = (tab !== 'single');
  document.getElementById('panel-multi').hidden  = (tab !== 'multi');

  const search        = document.getElementById('search');
  const searchMulti   = document.getElementById('search-multi');
  const searchSummary = document.getElementById('search-summary');
  const results       = document.getElementById('results');

  if (tab === 'multi') {
    search.hidden = true;
    searchMulti.hidden = false;
    searchSummary.hidden = true;
    results.hidden = true;
    return;
  }

  // single : la card search et la summary compacte sont mutuellement
  // exclusives (la summary remplace la card après une analyse réussie).
  searchMulti.hidden = true;
  if (state.hasAnalyzed && state.selected && state.comparables) {
    search.hidden = true;
    searchSummary.hidden = false;
    results.hidden = false;
  } else {
    search.hidden = false;
    searchSummary.hidden = true;
    results.hidden = true;
  }
}

// ---------- panel multi (Plusieurs communes) ----------

function setupMultiCompare() {
  const input = document.getElementById('multi-input');
  const list = document.getElementById('multi-autocomplete');
  if (!input || !list) return;

  ui.setupAutocomplete(input, list, searchCommunes, item => {
    addMultiCommune(item._commune);
    input.value = '';
    input.focus();
  });
  ui.renderMultiCompare(state.customCommunes, removeMultiCommune);
}

function addMultiCommune(commune) {
  if (!commune || !commune.code) return;
  if (state.customCommunes.some(c => c.code === commune.code)) return;
  if (state.customCommunes.length >= 10) return;
  state.customCommunes.push(commune);
  ui.renderMultiCompare(state.customCommunes, removeMultiCommune);
}

function removeMultiCommune(code) {
  state.customCommunes = state.customCommunes.filter(c => c.code !== code);
  ui.renderMultiCompare(state.customCommunes, removeMultiCommune);
}

// ---------- search & autocomplete ----------

function normalize(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
}

function searchCommunes(q) {
  const nq = normalize(q);
  if (/^\d{2,5}$/.test(q)) {
    return state.communes
      .filter(c => c.code.startsWith(q))
      .slice(0, 10)
      .map(c => ({ name: `${c.name} (${c.dept})`, code: c.code, _commune: c }));
  }
  const out = [];
  for (const { commune, norm } of state.byNorm) {
    if (norm.startsWith(nq)) out.push({ commune, score: 0 });
    else if (norm.includes(nq)) out.push({ commune, score: 1 });
    if (out.length > 200) break;
  }
  out.sort((a, b) => a.score - b.score || b.commune.population - a.commune.population);
  return out.slice(0, 10).map(x => ({
    name: `${x.commune.name} (${x.commune.dept})`,
    code: x.commune.code,
    _commune: x.commune
  }));
}

function setupSearchUI() {
  const input = document.getElementById('commune-input');
  const list = document.getElementById('autocomplete');
  const btn = document.getElementById('btn-analyze');

  ui.setupAutocomplete(input, list, searchCommunes, item => {
    const newCode = item._commune.code;
    const targetChanged = !state.selected || state.selected.code !== newCode;
    state.selected = item._commune;
    btn.disabled = false;
    // Si la cible change, l'analyse précédente devient caduque : on
    // invalide explicitement state.hasAnalyzed et les données pour qu'une
    // erreur sur la nouvelle commune ne ramène pas la summary obsolète.
    if (targetChanged) {
      state.hasAnalyzed = false;
      state.comparables = null;
      state.summary = null;
      document.getElementById('search-summary').hidden = true;
      document.getElementById('results').hidden = true;
    }
    ui.syncScopeWithTarget(state.selected, state.regionsByCode, state.departementsByCode);
    updateRayonCount();
    ui.setSearchHint(null);
    runAnalysis(state.selected);
  });

  input.addEventListener('input', () => {
    state.selected = null;
    btn.disabled = true;
    // La hint n'apparaît que lorsque l'utilisateur a saisi assez de
    // caractères pour que l'autocomplete propose des suggestions, et qu'il
    // pourrait hésiter sur la suite. Sinon, le placeholder du champ suffit.
    if (input.value.trim().length >= 2) {
      ui.setSearchHint('Sélectionnez une commune dans la liste pour lancer l’analyse.');
    } else {
      ui.setSearchHint(null);
    }
  });
}

// ---------- scope changes ----------

function onScopeChange() {
  if (!state.selected) return;
  // Mise à jour des libellés de pills (Même région / Région choisie, idem dépt)
  ui.refreshScopeLabels(state.selected);
  // Compteur live pour le rayon
  updateRayonCount();
  // Dès qu'une commune est sélectionnée, tout changement de scope re-déclenche
  // l'analyse — même si la précédente avait échoué (pop_floor / too_few),
  // l'utilisateur change de scope précisément pour tenter de la faire réussir.
  clearTimeout(rayonDebounce);
  rayonDebounce = setTimeout(() => runAnalysis(state.selected), 200);
}

function updateRayonCount() {
  const kind = scopeApi?.getKind?.();
  if (kind !== 'distance' || !state.selected) {
    ui.setRayonCount(null);
    return;
  }
  const radius = Number(document.getElementById('radius').value) || 50;
  const n = countInRadius(state.selected, state.communes, radius);
  ui.setRayonCount(n);
}

// ---------- analyze ----------

function wireAnalyze() {
  document.getElementById('btn-analyze').addEventListener('click', () => {
    if (!state.selected) return;
    runAnalysis(state.selected);
  });
}

function runAnalysis(target) {
  // Filet de sécurité : invalide systématiquement l'éventuelle analyse
  // précédente. En cas d'échec ci-dessous, la summary et les résultats ne
  // pourront plus être ré-affichés à partir de données obsolètes (via
  // switchTab ou onScopeChange).
  state.hasAnalyzed = false;
  state.comparables = null;
  state.summary = null;
  document.getElementById('search-summary').hidden = true;
  document.getElementById('results').hidden = true;

  const scope = ui.readScopeFromUI();
  const result = findComparables(target, state.communes, { scope });

  if (result.reason === 'pop_floor') {
    ui.showError(
      `${target.name} compte ${target.population.toLocaleString('fr-FR')} habitants. ` +
      `En dessous de 2 000 habitants, 1 ou 2 sièges sociaux suffisent à déformer le total des entreprises actives, ` +
      `et l'Insee masque la plupart des chiffres détaillés pour préserver l'anonymat.`,
      'Comparaison indisponible — commune trop petite'
    );
    document.getElementById('results').hidden = true;
    ui.expandSearch();
    return;
  }
  if (result.reason === 'no_data') {
    ui.showError(
      `Aucune commune française n'est suffisamment comparable à ${target.name} avec ces critères. ` +
      `Essayez d'élargir la zone (« Toute la France ») ou d'augmenter le rayon en mode « Autour ».`,
      'Comparaison indisponible — aucune commune comparable'
    );
    document.getElementById('results').hidden = true;
    ui.expandSearch();
    return;
  }
  ui.hideError();

  const comparables = result.candidates;
  const summary = summarizeComparables(target, comparables);
  state.comparables = comparables;
  state.summary = summary;
  state.hasAnalyzed = true;

  ui.renderTarget(target, summary);
  ui.renderSectorChart(target, summary.summary.sectorMedianShares, { coverage: target.sectorialCoverage });
  ui.renderComparables(comparables, summary, target);
  ui.applyComparablesCollapse();
  ui.renderLimitedPanelWarning(comparables.length, result.scope, state.regionsByCode, state.departementsByCode);
  ui.renderScopeBadge(result.scope, target, comparables.length, state.regionsByCode, state.departementsByCode);
  ui.updateStickyBanner(target, result.scope, state.regionsByCode, state.departementsByCode);
  ui.showSearchSummary(target, result.scope, state.regionsByCode, state.departementsByCode);
  ui.setStaleResults(false);

  const resultsEl = document.getElementById('results');
  const wasHidden = resultsEl.hidden;
  resultsEl.hidden = false;
  if (wasHidden) {
    document.getElementById('search-summary').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
  // Annonce de fin d'analyse aux lecteurs d'écran : déplace le focus sur le
  // titre de la commune cible (tabindex=-1). NVDA / VoiceOver lisent
  // « Saint-Étienne, titre niveau 2 » — signal clair que l'analyse a abouti.
  document.getElementById('target-name').focus({ preventScroll: true });
}

// ---------- export ----------

function wireExport() {
  document.getElementById('btn-export').addEventListener('click', () => {
    if (!state.selected || !state.comparables) return;
    const scope = ui.readScopeFromUI();
    exportCsv(state.selected, state.comparables, state.summary, scope);
  });
}
