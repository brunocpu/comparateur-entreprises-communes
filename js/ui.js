import { A10_SECTORS, SECTOR_LABELS, SECTOR_DETAILS } from './insee-api.js';
import { fmtInt, fmtDec1, fmtPct, fmtPctSigned } from './format.js';
import { escapeHtml } from './util.js';

// Respect du paramètre système « réduire les animations » (RGAA 13.x).
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- tooltip partagé (WCAG 1.4.13) ----------
// Un seul élément réutilisé pour tous les labels qui demandent un tooltip.
// Affiché au focus clavier ET au hover souris, refermé par Échap, ou quand
// le pointeur quitte à la fois le label et le tooltip lui-même.
let tooltipEl = null;
let tooltipHideTimer = 0;
function ensureTooltipEl() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.setAttribute('role', 'tooltip');
  tooltipEl.hidden = true;
  // Le tooltip lui-même est « hoverable » : si le pointeur entre dans le
  // tooltip pendant le délai de fermeture, on annule la fermeture.
  tooltipEl.addEventListener('mouseenter', () => clearTimeout(tooltipHideTimer));
  tooltipEl.addEventListener('mouseleave', () => {
    tooltipHideTimer = setTimeout(hideTooltip, 80);
  });
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}
function showTooltip(targetEl, text) {
  if (!text) return;
  clearTimeout(tooltipHideTimer);
  const tip = ensureTooltipEl();
  tip.textContent = text;
  tip.hidden = false;
  // Positionnement : sous le label, recadré pour ne pas sortir du viewport.
  const rect = targetEl.getBoundingClientRect();
  const tipW = tip.offsetWidth;
  const margin = 8;
  let left = rect.left + window.scrollX;
  if (left + tipW > window.scrollX + window.innerWidth - margin) {
    left = window.scrollX + window.innerWidth - tipW - margin;
  }
  if (left < window.scrollX + margin) left = window.scrollX + margin;
  tip.style.left = `${left}px`;
  tip.style.top = `${rect.bottom + window.scrollY + 6}px`;
}
function hideTooltip() {
  if (tooltipEl) tooltipEl.hidden = true;
}
function attachTooltip(el) {
  const text = el.dataset.tooltip;
  if (!text) return;
  el.addEventListener('mouseenter', () => showTooltip(el, text));
  el.addEventListener('mouseleave', () => {
    tooltipHideTimer = setTimeout(hideTooltip, 80);
  });
  el.addEventListener('focus',  () => showTooltip(el, text));
  el.addEventListener('blur',   hideTooltip);
  el.addEventListener('keydown', (e) => {
    // Échap referme le tooltip sans déplacer le focus (WCAG 1.4.13 dismissible).
    if (e.key === 'Escape' && tooltipEl && !tooltipEl.hidden) {
      e.preventDefault();
      hideTooltip();
    }
  });
}

// ---------- autocomplete ----------

export function setupAutocomplete(input, listEl, getItems, onPick) {
  let items = [];
  let active = -1;

  const close = () => {
    listEl.innerHTML = '';
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const render = () => {
    listEl.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.id = `ac-opt-${i}`;
      li.setAttribute('role', 'option');
      if (i === active) {
        li.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', li.id);
      }
      li.innerHTML = `<span>${escapeHtml(it.name)}</span>` +
        `<span class="ac-code">${escapeHtml(it.code)}</span>`;
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        pick(it);
      });
      listEl.appendChild(li);
    });
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
  };

  const pick = (it) => {
    input.value = it.name;
    close();
    onPick(it);
  };

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { close(); return; }
    items = getItems(q).slice(0, 10);
    active = -1;
    render();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      // Auto-pick on Enter : on prend l'option active si l'utilisateur a
      // navigué avec ↑/↓, sinon le premier résultat (= meilleur match).
      if (active >= 0 && items[active]) { e.preventDefault(); pick(items[active]); return; }
      if (items.length >= 1)            { e.preventDefault(); pick(items[0]);      return; }
    }
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if (e.key === 'Escape') { close(); }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));
}

// ---------- target card ----------

const DELTA_LABELS = {
  stock:     '% par rapport à la médiane des comparables',
  density:   '% par rapport à la médiane des comparables',
  growth:    'points d\'écart avec la médiane',
  crea:      '% par rapport à la médiane des comparables'
};

export function renderTarget(target, summary) {
  const nameEl = document.getElementById('target-name');
  const armPrefix = target.isArm ? 'Arrondissement municipal — ' : '';
  nameEl.textContent = `${armPrefix}${target.name} (${target.code})`;

  document.getElementById('target-meta').textContent =
    `Département ${target.dept} — population ${fmtInt(target.population)} habitants` +
    ` · ${summary.summary.n} communes comparables`;

  setIndicator('stock',   fmtInt(target.stock),         summary.delta.stock,     DELTA_LABELS.stock);
  setIndicator('density', fmtDec1(target.density),      summary.delta.density,   DELTA_LABELS.density);
  setIndicator('growth',  fmtPct(target.growth10y),     summary.delta.growth10y, DELTA_LABELS.growth);
  setIndicator('crea',    fmtInt(target.creations),     summary.delta.creations, DELTA_LABELS.crea);

  // Bullet charts sous chaque indicateur : Q1—Q3 ribbon + médiane + cible
  renderBullet('stock',   target.stock,      summary.summary.stock);
  renderBullet('density', target.density,    summary.summary.density);
  renderBullet('growth',  target.growth10y,  summary.summary.growth10y);
  renderBullet('crea',    target.creations,  summary.summary.creations);

  // Écart de densité d'entreprises exprimé en pourcentage par rapport à la
  // médiane des comparables — sans conversion en nombre absolu d'entreprises
  // (la médiane porte sur 10 voisins choisis par similarité, pas sur une norme).
  const gapEl = document.getElementById('theoretical-gap');
  const dDelta = summary.delta.density;
  if (dDelta == null) {
    gapEl.textContent = '';
  } else if (dDelta > 0) {
    gapEl.textContent =
      `Nombre d'entreprises pour 1 000 habitants : +${(dDelta * 100).toFixed(1)} % par rapport à la médiane des communes comparables.`;
  } else if (dDelta < 0) {
    gapEl.textContent =
      `Nombre d'entreprises pour 1 000 habitants : ${(dDelta * 100).toFixed(1)} % par rapport à la médiane des communes comparables.`;
  } else {
    gapEl.textContent = `Nombre d'entreprises pour 1 000 habitants aligné sur la médiane des comparables.`;
  }
}

function setIndicator(key, value, delta, suffix) {
  document.getElementById(`ind-${key}`).textContent = value;
  const d = document.getElementById(`ind-${key}-delta`);
  if (delta == null) { d.textContent = ''; d.className = 'indicator-delta'; return; }
  d.textContent = `${fmtPctSigned(delta)} ${suffix}`;
  d.className = 'indicator-delta ' + (delta >= 0 ? 'delta-pos' : 'delta-neg');
}

// Bullet chart : SVG inline montrant Q1-Q3 (ribbon), médiane (tick) et cible (dot).
// Domaine cadré sur [min, max] des 4 valeurs avec 12% de padding de chaque côté.
const BULLET_LABELS = {
  stock:   { noun: 'entreprises actives',         fmt: fmtInt },
  density: { noun: 'entreprises pour 1 000 hab.', fmt: fmtDec1 },
  growth:  { noun: 'croissance 2014→2023',        fmt: fmtPct },
  crea:    { noun: 'créations par an',            fmt: fmtInt }
};
function renderBullet(key, target, stat) {
  const el = document.getElementById(`ind-${key}-bullet`);
  if (!el) return;
  const { q1, median, q3 } = stat || {};
  if (![target, q1, median, q3].every(v => v != null && Number.isFinite(v))) {
    el.innerHTML = '';
    return;
  }
  const vals = [q1, median, q3, target];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const range = Math.max(hi - lo, Math.abs(hi) * 0.05, 0.001);
  const pad = range * 0.12;
  lo -= pad; hi += pad;
  const span = hi - lo;
  const pos = v => ((v - lo) / span * 100).toFixed(2);
  const cls = target >= median ? 'above' : 'below';

  // Label SVG enrichi pour lecteurs d'écran : décrit la position de la cible
  // dans la distribution des comparables avec valeurs réelles formatées.
  const f = BULLET_LABELS[key] || { noun: '', fmt: v => String(v) };
  const position = target >= q3     ? 'au-dessus du quart supérieur'
                 : target >= median ? 'au-dessus de la médiane'
                 : target >= q1     ? 'sous la médiane'
                 :                    'sous le quart inférieur';
  const ariaLabel =
    `${f.noun} — cible ${f.fmt(target)}, ${position} des comparables ` +
    `(quart inférieur ${f.fmt(q1)}, médiane ${f.fmt(median)}, quart supérieur ${f.fmt(q3)}).`;

  el.innerHTML = `
    <svg viewBox="0 0 100 16" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(ariaLabel)}">
      <line x1="0" y1="8" x2="100" y2="8" class="bullet-track" vector-effect="non-scaling-stroke"/>
      <rect x="${pos(q1)}" y="5" width="${(pos(q3) - pos(q1))}" height="6" class="bullet-iqr"/>
      <line x1="${pos(median)}" y1="3" x2="${pos(median)}" y2="13" class="bullet-median" vector-effect="non-scaling-stroke"/>
      <circle cx="${pos(target)}" cy="8" r="3.5" class="bullet-target ${cls}"/>
    </svg>`;
}

// Bar-in-cell : pour chaque colonne numérique (à partir d'un index donné),
// trouve la valeur max et applique un fond proportionnel sur chaque cellule.
function applyBarInCell(table, columnIndices) {
  const allRows = [...table.querySelectorAll('tbody tr'), ...table.querySelectorAll('tfoot tr')];
  for (const colIdx of columnIndices) {
    const cells = allRows.map(r => r.children[colIdx]).filter(Boolean);
    const values = cells.map(td => parseLocaleNumber(td.textContent));
    const finiteVals = values.filter(v => Number.isFinite(v));
    if (!finiteVals.length) continue;
    const min = Math.min(...finiteVals);
    const max = Math.max(...finiteVals);
    const hasNeg = min < 0;
    const absMax = Math.max(Math.abs(min), Math.abs(max));
    cells.forEach((td, i) => {
      const v = values[i];
      td.classList.add('has-bar');
      if (!Number.isFinite(v) || absMax === 0) {
        td.style.setProperty('--bar-width', '0%');
        return;
      }
      // Pour les colonnes avec négatif (croissance) : bar proportionnelle à |v|/absMax
      // Pour les autres : v/max (ancré à 0)
      const ratio = hasNeg ? Math.abs(v) / absMax : v / max;
      td.style.setProperty('--bar-width', `${(ratio * 100).toFixed(1)}%`);
      if (hasNeg && v < 0) td.classList.add('bar-neg');
      else td.classList.remove('bar-neg');
    });
  }
}

function parseLocaleNumber(s) {
  if (!s) return NaN;
  // Remove fr-FR thousand separators (NBSP, narrow NBSP, regular space) and turn comma into dot
  const cleaned = s.replace(/[  \s]/g, '').replace(',', '.').replace('%', '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

// ---------- sector chart ----------

// Fixed 0–100 % scale: a sector at 45 % must visually dominate one at 12 %.
// `medianShares` is shown as a solid colored marker line, not a dashed border.
export function renderSectorChart(target, medianShares, opts = {}) {
  const { coverage = 1 } = opts;
  const container = document.getElementById('sector-chart');
  container.innerHTML = '';

  // Cap scale at 60 % to leave breathing room for very dominant sectors;
  // sectors > 60 % will visually clip but the numeric label always shows the truth.
  const maxScale = 0.6;

  A10_SECTORS.forEach((code, i) => {
    const t = target.sectorShares[i] || 0;
    const m = medianShares ? (medianShares[i] || 0) : null;
    const row = document.createElement('div');
    row.className = 'sector-row';
    const tWidth = Math.min(100, t / maxScale * 100);
    const mWidth = m != null ? Math.min(100, m / maxScale * 100) : null;
    const detail = SECTOR_DETAILS[code] || '';
    const tooltipText = `${SECTOR_LABELS[code]} — détail des sections A21 :\n${detail}`;
    row.innerHTML = `
      <div class="sector-info">
        <span class="sector-label has-tooltip" tabindex="0"
              data-tooltip="${escapeHtml(tooltipText)}"
              aria-label="${escapeHtml(SECTOR_LABELS[code])} — sections incluses : ${escapeHtml(detail)}">
          ${escapeHtml(SECTOR_LABELS[code])}
        </span>
        <span class="sector-values">
          <strong>cible ${fmtPct(t)}</strong>
          ${m != null ? `<span class="muted">médiane ${fmtPct(m)}</span>` : ''}
        </span>
      </div>
      <div class="sector-bars" aria-label="part sectorielle ${SECTOR_LABELS[code]} : cible ${fmtPct(t)}, médiane ${m != null ? fmtPct(m) : 'non disponible'}">
        <div class="sector-bar-target" style="width:${tWidth.toFixed(1)}%"></div>
        ${mWidth != null ? `<div class="sector-bar-median" style="left:${mWidth.toFixed(1)}%"></div>` : ''}
      </div>
    `;
    container.appendChild(row);
  });

  // Tooltip A21 personnalisé : remplace l'attribut HTML `title` (qui ne
  // s'affiche qu'au survol souris) par un tooltip CSS+JS visible au focus
  // clavier ET au hover, dismissible via Échap. WCAG 1.4.13.
  container.querySelectorAll('.sector-label.has-tooltip').forEach(attachTooltip);

  // Avertissement de couverture : si la répartition par secteur ne couvre
  // qu'une partie du total, c'est que l'Insee a masqué certaines cellules
  // pour préserver l'anonymat des entreprises (faibles effectifs).
  const note = document.getElementById('sector-note');
  if (note) {
    if (coverage != null && coverage < 0.85) {
      note.hidden = false;
      note.textContent =
        `Répartition sectorielle partielle : seulement ${(coverage * 100).toFixed(0)} % du total est ventilé par secteur. ` +
        `L'Insee masque les chiffres détaillés sur les petits effectifs pour préserver l'anonymat des entreprises. ` +
        `La comparaison reste indicative.`;
    } else {
      note.hidden = true;
    }
  }
}

// ---------- comparables table ----------

function renderCommuneRow(commune, { isTarget = false } = {}) {
  const tr = document.createElement('tr');
  if (isTarget) tr.className = 'target-row';
  const deptAttr = commune.dept ? ` data-dept="${escapeHtml(commune.dept)}"` : '';
  tr.innerHTML = `
    <td${deptAttr}>${escapeHtml(commune.name)} <span class="ac-code">${commune.code}</span></td>
    <td>${escapeHtml(commune.dept || '')}</td>
    <td class="num">${fmtInt(commune.population)}</td>
    <td class="num">${fmtInt(commune.stock)}</td>
    <td class="num">${fmtDec1(commune.density)}</td>
    <td class="num">${fmtPct(commune.growth10y)}</td>
    <td class="num">${fmtInt(commune.creations)}</td>
  `;
  return tr;
}

export function renderComparables(comparables, summary, target) {
  const tbody = document.querySelector('#comparables-table tbody');
  tbody.innerHTML = '';

  // Cible en tête du tableau pour comparaison directe avec les voisines
  if (target) tbody.appendChild(renderCommuneRow(target, { isTarget: true }));

  for (const { commune } of comparables) {
    tbody.appendChild(renderCommuneRow(commune));
  }

  const s = summary.summary;
  // Replace the single median row with three quantile rows: Q1, médiane, Q3.
  const tfoot = document.querySelector('#comparables-table tfoot');
  tfoot.innerHTML = '';
  const quantileRow = (label, q) => `
    <tr class="median-row">
      <td colspan="2"><strong>${label}</strong> <span class="muted small">(n = ${s.n})</span></td>
      <td class="num">${fmtInt(s.population[q])}</td>
      <td class="num">${fmtInt(s.stock[q])}</td>
      <td class="num">${fmtDec1(s.density[q])}</td>
      <td class="num">${fmtPct(s.growth10y[q])}</td>
      <td class="num">${fmtInt(s.creations[q])}</td>
    </tr>`;
  tfoot.innerHTML =
    quantileRow('Quart inférieur (25 % des comparables sous ce seuil)', 'q1') +
    quantileRow('Médiane des comparables (50 %)', 'median') +
    quantileRow('Quart supérieur (25 % des comparables au-dessus de ce seuil)', 'q3');

  // Bar-in-cell sur les colonnes numériques (3=pop, 4=stock, 5=density, 6=growth, 7=créations)
  applyBarInCell(document.getElementById('comparables-table'), [2, 3, 4, 5, 6]);
}

// ---------- progress ----------

let progressStart = 0;
let lastEtaUpdate = 0;
let lastEtaLabel = '';

function fmtDuration(s) {
  if (!Number.isFinite(s) || s <= 0) return '';
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return `${m} min`;
}

export function setProgress(ratio, label) {
  const wrap = document.getElementById('progress');
  wrap.hidden = false;
  const bar = document.getElementById('progress-bar');
  bar.style.width = `${(ratio * 100).toFixed(1)}%`;
  bar.parentElement.setAttribute('aria-valuenow', Math.round(ratio * 100));

  // ETA, refreshed at most once per second to avoid flicker
  const now = Date.now();
  if (!progressStart || ratio < 0.01) {
    progressStart = now;
    lastEtaLabel = '';
  }
  let eta = '';
  if (ratio > 0.05 && ratio < 0.99) {
    const elapsed = (now - progressStart) / 1000;
    const total = elapsed / ratio;
    const remaining = total - elapsed;
    if (now - lastEtaUpdate > 1000) {
      lastEtaUpdate = now;
      lastEtaLabel = ` — encore ~${fmtDuration(remaining)}`;
    }
    eta = lastEtaLabel;
  }
  document.getElementById('progress-label').textContent = label + eta;
}

export function hideProgress() {
  document.getElementById('progress').hidden = true;
  progressStart = 0;
}

export function showError(msg, title = 'Comparaison indisponible') {
  const sec = document.getElementById('errors');
  sec.hidden = false;
  const titleEl = document.getElementById('error-title');
  if (titleEl) titleEl.textContent = title;
  document.getElementById('error-message').textContent = msg;
  // Le message a été remonté en haut de page, on s'assure qu'il est visible
  // si l'utilisateur scrollait dans les résultats au moment du déclenchement.
  sec.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  // Focus sur le titre d'erreur (tabindex=-1) : indispensable au lecteur
  // d'écran pour que NVDA annonce le contexte d'erreur, et au clavier pour
  // ne pas rester bloqué sur un bouton qui vient d'être caché.
  if (titleEl) titleEl.focus({ preventScroll: true });
}

export function hideError() {
  document.getElementById('errors').hidden = true;
}

// ---------- search hint ----------

export function setSearchHint(msg, kind = 'muted') {
  const el = document.getElementById('search-hint');
  if (!el) return;
  if (!msg) { el.textContent = ''; el.hidden = true; return; }
  el.textContent = msg;
  el.className = `search-hint ${kind}`;
  el.hidden = false;
}

// ---------- scope (segmented control + sub-controls) ----------

const SCOPE_LABELS = {
  national:    { same: 'Toute la France',         override: 'Toute la France' },
  region:      { same: 'Même région',             override: 'Région choisie' },
  departement: { same: 'Même département',        override: 'Département choisi' },
  distance:    { same: 'Autour de la commune',    override: 'Autour de la commune' }
};

export function setupScopeRadio(opts) {
  const { onChange } = opts;
  const segments = Array.from(document.querySelectorAll('.scope-segment'));
  const subBlocks = {
    region:      document.getElementById('scope-sub-region'),
    departement: document.getElementById('scope-sub-departement'),
    distance:    document.getElementById('scope-sub-distance')
  };
  const selectRegion = document.getElementById('scope-region');
  const selectDept   = document.getElementById('scope-departement');
  const radius       = document.getElementById('radius');

  function setActive(kind) {
    segments.forEach(s => {
      const isActive = s.dataset.scope === kind;
      s.setAttribute('aria-checked', isActive ? 'true' : 'false');
      // Roving tabindex (WAI-ARIA radiogroup) : seul le segment coché est tabable.
      s.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    Object.entries(subBlocks).forEach(([k, el]) => {
      if (el) el.hidden = (k !== kind);
    });
    document.getElementById('scope-context').hidden = (kind === 'national');
  }

  segments.forEach(s => {
    s.addEventListener('click', () => {
      const kind = s.dataset.scope;
      setActive(kind);
      onChange();
    });
    s.addEventListener('keydown', (e) => {
      // Arrow keys navigate radio group
      const idx = segments.indexOf(s);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = segments[(idx + 1) % segments.length];
        next.focus(); next.click();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = segments[(idx - 1 + segments.length) % segments.length];
        prev.focus(); prev.click();
      }
    });
  });

  selectRegion?.addEventListener('change', onChange);
  selectDept?.addEventListener('change', onChange);
  radius?.addEventListener('input', onChange);

  return {
    setActive,
    getKind: () => segments.find(s => s.getAttribute('aria-checked') === 'true')?.dataset.scope || 'national'
  };
}

export function populateScopeOptions(regions, departements) {
  const selR = document.getElementById('scope-region');
  if (selR && regions?.length) {
    selR.innerHTML = '';
    regions
      .slice()
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
      .forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.code;
        opt.textContent = `${r.nom} (${r.code})`;
        selR.appendChild(opt);
      });
  }
  const selD = document.getElementById('scope-departement');
  if (selD && departements?.length) {
    selD.innerHTML = '';
    departements
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.code;
        opt.textContent = `${d.code} — ${d.nom}`;
        selD.appendChild(opt);
      });
  }
}

// Pré-positionne les sous-champs sur la cible et rafraîchit les libellés des
// pills selon que la valeur courante correspond à la cible (« Même X ») ou
// non (« X choisi »).
export function syncScopeWithTarget(target, regionsByCode, deptsByCode) {
  if (!target) return;
  const selR = document.getElementById('scope-region');
  const selD = document.getElementById('scope-departement');

  if (selR && target.codeRegion) {
    if ([...selR.options].some(o => o.value === target.codeRegion)) {
      selR.value = target.codeRegion;
    }
  }
  if (selD && target.dept) {
    if ([...selD.options].some(o => o.value === target.dept)) {
      selD.value = target.dept;
    }
  }
  refreshScopeLabels(target);
  refreshScopeContextLine(target, regionsByCode, deptsByCode);
}

export function refreshScopeLabels(target) {
  const selR = document.getElementById('scope-region');
  const selD = document.getElementById('scope-departement');
  const segR = document.querySelector('.scope-segment[data-scope="region"]');
  const segD = document.querySelector('.scope-segment[data-scope="departement"]');

  if (segR && target) {
    const cur = selR?.value;
    const same = !cur || cur === target.codeRegion;
    segR.textContent = same ? SCOPE_LABELS.region.same : SCOPE_LABELS.region.override;
  }
  if (segD && target) {
    const cur = selD?.value;
    const same = !cur || cur === target.dept;
    segD.textContent = same ? SCOPE_LABELS.departement.same : SCOPE_LABELS.departement.override;
  }
}

export function refreshScopeContextLine(target, regionsByCode, deptsByCode) {
  const el = document.getElementById('scope-context-cible');
  if (!el || !target) { if (el) el.textContent = ''; return; }
  const dept = deptsByCode?.get?.(target.dept);
  const region = regionsByCode?.get?.(target.codeRegion);
  const deptLabel = dept ? `${dept.nom} (${dept.code})` : target.dept;
  const regionLabel = region ? region.nom : (target.codeRegion ?? '');
  el.innerHTML =
    `<strong>${escapeHtml(target.name)}</strong> est en ` +
    `<strong>${escapeHtml(deptLabel)}</strong>` +
    (regionLabel ? ` · <strong>${escapeHtml(regionLabel)}</strong>` : '');
}

export function readScopeFromUI() {
  const seg = document.querySelector('.scope-segment[aria-checked="true"]');
  const kind = seg?.dataset.scope || 'national';
  if (kind === 'region')      return { kind, value: document.getElementById('scope-region').value };
  if (kind === 'departement') return { kind, value: document.getElementById('scope-departement').value };
  if (kind === 'distance')    return { kind, value: Number(document.getElementById('radius').value) || 50 };
  return { kind: 'national' };
}

export function setRayonCount(n) {
  const el = document.getElementById('rayon-count');
  if (!el) return;
  el.textContent = n != null ? `~${n.toLocaleString('fr-FR')} commune(s) dans ce rayon` : '';
}

// Avertissement « sélection limitée » quand n < 5 : on affiche quand même les
// résultats, mais on incite à élargir la strate pour plus de représentativité.
export function renderLimitedPanelWarning(n, scope, regionsByCode, deptsByCode) {
  const el = document.getElementById('comparables-warning');
  if (!el) return;
  if (n >= 5) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  // Suggestion de strate plus large selon le scope actif
  let suggestion;
  if (scope.kind === 'national') {
    suggestion = `Pour cette taille de commune, peu de pairs existent en France. Utiliser l'onglet « Plusieurs communes » pour composer une sélection sur mesure.`;
  } else if (scope.kind === 'departement') {
    const dept = deptsByCode?.get?.(scope.value);
    suggestion = `Élargir à « Même région » ou « Toute la France » pour une sélection plus représentative (le département ${dept?.nom || scope.value} contient peu de communes de cette strate).`;
  } else if (scope.kind === 'region') {
    const region = regionsByCode?.get?.(scope.value);
    suggestion = `Élargir à « Toute la France » pour plus de communes comparables (la région ${region?.nom || scope.value} en contient peu sur cette strate).`;
  } else if (scope.kind === 'distance') {
    suggestion = `Augmenter le rayon ou basculer sur une zone administrative (région, département, France entière).`;
  }

  el.hidden = false;
  el.innerHTML =
    `<strong>Sélection limitée — ${n} commune${n > 1 ? 's' : ''} comparable${n > 1 ? 's' : ''}.</strong> ` +
    `En dessous de 5 communes comparables, les écarts à la médiane peuvent être influencés ` +
    `par un seul cas atypique. À interpréter avec prudence. ${suggestion}`;
}

// Badge récap dans la card cible et le H2 des comparables.
export function renderScopeBadge(scope, target, n, regionsByCode, deptsByCode) {
  const dept = deptsByCode?.get?.(target.dept);
  const region = regionsByCode?.get?.(target.codeRegion);
  const tail = `${target.population.toLocaleString('fr-FR')} habitants · ${n} communes comparables`;

  // 1. Card cible — meta enrichie
  const meta = document.getElementById('target-meta');
  if (meta) {
    const parts = [`Département ${dept?.nom || target.dept} (${target.dept})`];
    if (region) parts.push(`Région ${region.nom}`);
    parts.push(`${target.population.toLocaleString('fr-FR')} habitants`);
    parts.push(`n = ${n} communes comparables`);
    meta.textContent = parts.join(' · ');
  }

  // 2. Card comparables — H2 enrichi
  const h2 = document.getElementById('comparables-h2');
  if (h2) {
    let scopeLabel;
    if (scope.kind === 'national')         scopeLabel = 'Toute la France';
    else if (scope.kind === 'region') {
      const r = regionsByCode?.get?.(scope.value);
      scopeLabel = `Région ${r?.nom || scope.value}`;
    }
    else if (scope.kind === 'departement') {
      const d = deptsByCode?.get?.(scope.value);
      scopeLabel = `Département ${d?.nom || ''} (${scope.value})`;
    }
    else if (scope.kind === 'distance')    scopeLabel = `Rayon ${scope.value} km`;
    h2.textContent = `Communes comparables — ${scopeLabel} · n = ${n}`;
  }
}

export function setStaleResults(stale) {
  document.querySelectorAll('#results .card').forEach(card => {
    if (stale) card.classList.add('is-stale');
    else card.classList.remove('is-stale');
  });
}

// Sticky banner : visible quand l'utilisateur scrolle hors de la card recherche
// ET que les résultats sont visibles. Affiche cible + zone + lien « Changer ↑ ».
let stickyObserver = null;
export function setupStickyBanner({ onChange } = {}) {
  const banner = document.getElementById('sticky-banner');
  const search = document.getElementById('search');
  if (!banner || !search) return;

  if (stickyObserver) stickyObserver.disconnect();
  stickyObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const resultsVisible = !document.getElementById('results').hidden;
      const visible = !entry.isIntersecting && resultsVisible;
      banner.hidden = false;
      banner.classList.toggle('is-visible', visible);
      banner.setAttribute('aria-hidden', visible ? 'false' : 'true');
      // `inert` retire le banner du flux de tabulation et du calque AT quand
      // il est masqué — sinon Shift+Tab depuis le haut atteint un bouton
      // visuellement invisible (anti-pattern WCAG 4.1.2).
      if (visible) banner.removeAttribute('inert');
      else         banner.setAttribute('inert', '');
    }
  }, { threshold: 0, rootMargin: '-60px 0px 0px 0px' });
  stickyObserver.observe(search);

  document.getElementById('sticky-change').onclick = () => {
    if (onChange) onChange();
    search.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };
}

// Replace les détails de la card recherche par une barre compacte montrant
// la cible + zone + bouton « Modifier ↑ » qui rouvre la card.
export function showSearchSummary(target, scope, regionsByCode, deptsByCode) {
  const search = document.getElementById('search');
  const summary = document.getElementById('search-summary');
  if (!search || !summary || !target) return;

  const armPrefix = target.isArm ? 'Arr. mun. ' : '';
  document.getElementById('summary-target-name').textContent =
    `${armPrefix}${target.name} (${target.code})`;

  let scopeLabel = '';
  if (!scope || scope.kind === 'national') scopeLabel = 'Toute la France';
  else if (scope.kind === 'region') {
    const r = regionsByCode?.get?.(scope.value);
    scopeLabel = `Région ${r?.nom || scope.value}`;
  } else if (scope.kind === 'departement') {
    const d = deptsByCode?.get?.(scope.value);
    scopeLabel = `Département ${scope.value}${d?.nom ? ' — ' + d.nom : ''}`;
  } else if (scope.kind === 'distance') {
    scopeLabel = `Rayon ${scope.value} km`;
  }
  document.getElementById('summary-scope').textContent = scopeLabel;

  search.hidden = true;
  summary.hidden = false;
}

export function expandSearch() {
  const search = document.getElementById('search');
  const summary = document.getElementById('search-summary');
  if (search) search.hidden = false;
  if (summary) summary.hidden = true;
  // Restitue le focus à l'input recherche : sans ça, le bouton « Modifier ↑ »
  // ou « Changer ↑ » qui vient d'être caché laisse le focus dans le néant
  // (repart sur <body> au prochain Tab). RGAA 12.10.
  const input = document.getElementById('commune-input');
  if (input) input.focus({ preventScroll: true });
}

// Comparables collapsed/expanded — top 5 par défaut, bouton pour étendre.
const COMPARABLES_DEFAULT_VISIBLE = 5;

// ---------- comparaison à façon (onglet « Plusieurs communes ») ----------

export function renderMultiCompare(communes, onRemove) {
  const chipsEl = document.getElementById('multi-chips');
  const tableWrap = document.getElementById('multi-table-wrap');
  const tbody = document.querySelector('#multi-table tbody');
  const emptyMsg = document.getElementById('multi-empty');
  const exportBtn = document.getElementById('btn-multi-export');
  if (!chipsEl || !tableWrap || !tbody) return;

  // Chips supprimables
  chipsEl.innerHTML = '';
  for (const c of communes) {
    const chip = document.createElement('span');
    chip.className = 'commune-chip';
    chip.innerHTML =
      `<span>${escapeHtml(c.name)}</span>` +
      `<span class="ac-code">${escapeHtml(c.code)}</span>` +
      `<button type="button" class="chip-remove" data-code="${escapeHtml(c.code)}" aria-label="Retirer ${escapeHtml(c.name)} du comparatif">×</button>`;
    chipsEl.appendChild(chip);
  }
  chipsEl.onclick = (e) => {
    const btn = e.target.closest('.chip-remove');
    if (btn && onRemove) onRemove(btn.dataset.code);
  };

  // Tableau : montre les communes dès la 1re ; à 2+, le comparatif a du sens
  tbody.innerHTML = '';
  const hasContent = communes.length > 0;
  if (hasContent) {
    for (const c of communes) tbody.appendChild(renderCommuneRow(c));
    applyBarInCell(document.getElementById('multi-table'), [2, 3, 4, 5, 6]);
  }
  tableWrap.hidden = !hasContent;
  if (emptyMsg) {
    if (!communes.length) {
      emptyMsg.hidden = false;
      emptyMsg.textContent = 'Saisissez un nom ou un code Insee ci-dessus pour ajouter une première commune.';
    } else if (communes.length === 1) {
      emptyMsg.hidden = false;
      emptyMsg.textContent = 'Ajoutez au moins une seconde commune pour comparer côte à côte.';
    } else {
      emptyMsg.hidden = true;
    }
  }
  if (exportBtn) exportBtn.hidden = communes.length < 2;
  const printBtn = document.getElementById('btn-multi-print');
  if (printBtn) printBtn.hidden = communes.length < 2;
}

export function applyComparablesCollapse() {
  const tbody = document.querySelector('#comparables-table tbody');
  if (!tbody) return;
  // La ligne cible est toujours visible — on ne replie que les comparables.
  const compRows = Array.from(tbody.children).filter(r => !r.classList.contains('target-row'));
  const showAllBtn = document.getElementById('btn-show-all');
  if (!showAllBtn) return;

  if (compRows.length <= COMPARABLES_DEFAULT_VISIBLE) {
    showAllBtn.hidden = true;
    compRows.forEach(r => r.classList.remove('is-hidden'));
    return;
  }
  compRows.forEach((r, i) => {
    if (i >= COMPARABLES_DEFAULT_VISIBLE) r.classList.add('is-hidden');
  });
  showAllBtn.hidden = false;
  showAllBtn.textContent = `Voir les ${compRows.length} communes comparables ↓`;
  showAllBtn.dataset.expanded = 'false';
  showAllBtn.onclick = () => {
    const expanded = showAllBtn.dataset.expanded === 'true';
    compRows.forEach((r, i) => {
      if (i >= COMPARABLES_DEFAULT_VISIBLE) r.classList.toggle('is-hidden', expanded);
    });
    showAllBtn.dataset.expanded = expanded ? 'false' : 'true';
    showAllBtn.textContent = expanded
      ? `Voir les ${compRows.length} communes comparables ↓`
      : `Replier ↑`;
  };
}

export function updateStickyBanner(target, scope, regionsByCode, deptsByCode) {
  if (!target) return;
  const armPrefix = target.isArm ? 'Arr. mun. ' : '';
  document.getElementById('sticky-target-name').textContent =
    `${armPrefix}${target.name}`;

  let scopeLabel = '';
  if (!scope || scope.kind === 'national') scopeLabel = 'Toute la France';
  else if (scope.kind === 'region') {
    const r = regionsByCode?.get?.(scope.value);
    scopeLabel = `Région ${r?.nom || scope.value}`;
  } else if (scope.kind === 'departement') {
    const d = deptsByCode?.get?.(scope.value);
    scopeLabel = `Dépt ${scope.value}${d?.nom ? ' — ' + d.nom : ''}`;
  } else if (scope.kind === 'distance') {
    scopeLabel = `Rayon ${scope.value} km`;
  }
  document.getElementById('sticky-scope').textContent = scopeLabel;
}
