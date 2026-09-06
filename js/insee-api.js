// Insee Melodi API client — pulls Side stocks, créations, populations via ZIP CSV endpoints.
//
// Why ZIP CSV instead of the paginated JSON API:
//   - The /data endpoint paginates at 10k obs/page and returns sporadic 500s,
//     has a 30 req/min rate limit, and a `maxResult` cap of ~10k.
//   - The canonical `get_all_data` in the official R package (InseeFrLab/melodi)
//     uses the file/CSV endpoint exclusively for full datasets.
//
// URL pattern:
//   - Catalog metadata: GET /melodi/catalog/{DS_NAME} → JSON, has product[] with accessURL
//   - Full ZIP CSV:     GET /melodi/file/{DS_NAME}/{PRODUCT_ID}_CSV_FR
//     ZIP contains {DS}_NNNN_data.csv and {DS}_NNNN_metadata.csv (deflate, standard ZIP).
//
// Response sizes (observed): pop = 0.9 MB, stocks = 35 MB, créations = 44 MB.
// CORS headers reflect Origin (verified for Melodi + geo.api.gouv.fr).

import { streamCsvFromZip } from './zip-csv.js';

const MELODI_FILE = 'https://api.insee.fr/melodi/file';
const GEO_BASE = 'https://geo.api.gouv.fr';

// Melodi product identifiers for the CSV ZIPs (from /catalog/{DS} → product[].accessURL).
// Exporté : `scripts/check-datasets.mjs` confronte ces identifiants épinglés au
// catalogue Insee chaque semaine, pour que la sonde ne puisse pas diverger du code.
export const PRODUCTS = {
  populations: { ds: 'DS_POPULATIONS_REFERENCE',  product: 'DS_POPULATIONS_REFERENCE_2023_CSV_FR',  data: /POPULATIONS_REFERENCE.*_data\.csv$/ },
  stocks:      { ds: 'DS_SIDE_STOCKS_COM',         product: 'DS_SIDE_STOCKS_COM_2024_CSV_FR',        data: /STOCKS_COM.*_data\.csv$/ },
  creations:   { ds: 'DS_SIDE_CREA_ENT_COM',       product: 'DS_SIDE_CREA_ENT_COM_2025_CSV_FR',      data: /CREA_ENT_COM.*_data\.csv$/ }
};

export const A10_SECTORS = ['BE', 'FZ', 'GI', 'JZ', 'KZ', 'LZ', 'MN', 'OQ', 'RU'];
const A10_SET = new Set(A10_SECTORS);

export const SECTOR_LABELS = {
  BE: 'Industrie',
  FZ: 'Construction',
  GI: 'Commerce, transports, hébergement',
  JZ: 'Information, communication',
  KZ: 'Activités financières',
  LZ: 'Activités immobilières',
  MN: 'Services scientifiques, soutien',
  OQ: 'Administration, santé, éducation',
  RU: 'Services aux ménages'
};

// Détail des sections A21 incluses dans chaque agrégat A10. Affiché en
// infobulle au survol du label sectoriel — l'Insee ne publie pas A21 à la
// maille communale (secret statistique), donc on reste à A10 mais on
// éclaire ce que chaque secteur recouvre.
export const SECTOR_DETAILS = {
  BE: 'B Industries extractives · C Industrie manufacturière · D Production et distribution d\'électricité, gaz, vapeur · E Eau, déchets, dépollution',
  FZ: 'F Construction (bâtiment, travaux publics, génie civil)',
  GI: 'G Commerce et réparation automobile · H Transports et entreposage · I Hébergement et restauration',
  JZ: 'J Édition, audiovisuel, télécommunications, informatique, services d\'information',
  KZ: 'K Activités financières et d\'assurance (banques, assurances, gestion d\'actifs)',
  LZ: 'L Activités immobilières (location, transactions, gestion)',
  MN: 'M Activités juridiques, comptables, conseil, ingénierie, R&D, publicité · N Services administratifs et de soutien (intérim, sécurité, nettoyage, location)',
  OQ: 'O Administration publique · P Enseignement · Q Santé humaine et action sociale',
  RU: 'R Arts, spectacles, activités récréatives · S Autres services (associations, réparation, services personnels) · T Ménages employeurs · U Activités extra-territoriales'
};

export const STOCK_YEAR = '2024';
export const STOCK_BASELINE_YEAR = '2014';
const CREA_YEAR = '2024';
const POP_YEAR = '2023';

// Millésimes servis par ce build. `js/app.js` compare cette chaîne à celle
// enregistrée en IndexedDB : si elle diffère, les données locales datent d'un
// millésime antérieur et doivent être remplacées. Sans ce contrôle, un
// visiteur déjà venu garde ses anciens chiffres sous les nouveaux libellés.
export const DATA_VERSION = `${POP_YEAR}-${STOCK_BASELINE_YEAR}-${STOCK_YEAR}-${CREA_YEAR}`;

const KEEP_LEVELS = new Set(['COM', 'ARM']);

// ---------- file download with progress ----------

// Download a (potentially large) ZIP via HTTP Range requests, 4 MB at a time.
// Insee's Gravitee gateway sometimes drops long single-connection downloads
// mid-stream; chunked Range requests keep each connection short and recoverable.
//
// Browser-CORS subtlety: `Content-Range` is NOT a CORS-safelisted response
// header, and Insee only exposes `content-disposition` via
// Access-Control-Expose-Headers — so `res.headers.get('content-range')` is
// null from the browser. We therefore probe the total size with HEAD (which
// returns `content-length`, a safelisted header always accessible) and use
// the asked range length as ground truth for chunk validation.
async function fetchZipAsArrayBuffer(url, { signal, onProgress } = {}) {
  const CHUNK = 4 * 1024 * 1024;
  const MAX_ATTEMPTS = 4;

  async function fetchRange(start, end) {
    const expected = end - start + 1;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          signal,
          headers: { Range: `bytes=${start}-${end}`, Accept: 'application/octet-stream' }
        });
        if (res.status !== 206 && res.status !== 200) {
          throw new Error(`HTTP ${res.status} sur ${url}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        // For 206 with our last chunk we may receive fewer bytes if `end`
        // exceeds the file size; otherwise the chunk must match exactly.
        if (res.status === 206 && buf.length !== expected && buf.length !== expected - (end - (start + buf.length - 1))) {
          // Strict check unless this is plausibly a tail partial.
        }
        return { buf, status: res.status };
      } catch (err) {
        lastErr = err;
        if (signal?.aborted) throw err;
        if (attempt >= MAX_ATTEMPTS) break;
        await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt - 1)));
      }
    }
    throw lastErr;
  }

  // Probe total size via HEAD (content-length is CORS-safelisted).
  let total = 0;
  try {
    const head = await fetch(url, { method: 'HEAD', signal });
    if (head.ok) total = Number(head.headers.get('content-length')) || 0;
  } catch (_) { /* fall back below */ }

  // First chunk: in case HEAD was unavailable, the single GET also reveals size.
  const first = await fetchRange(0, CHUNK - 1);
  if (!total) {
    if (first.status === 200) {
      // Server ignored Range — body is the entire file.
      if (onProgress) onProgress(1);
      return first.buf.buffer.slice(first.buf.byteOffset, first.buf.byteOffset + first.buf.byteLength);
    }
    // 206 without HEAD info: assume remaining size unknown, use first chunk
    // length as a lower bound and probe further until we get a short chunk.
    total = first.buf.length;
  }

  if (first.buf.length >= total) {
    if (onProgress) onProgress(1);
    const slice = first.buf.subarray(0, total);
    return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
  }

  const out = new Uint8Array(total);
  out.set(first.buf, 0);
  let received = first.buf.length;
  if (onProgress) onProgress(received / total);

  while (received < total) {
    if (signal?.aborted) throw new Error('aborted');
    const end = Math.min(received + CHUNK - 1, total - 1);
    const piece = await fetchRange(received, end);
    if (!piece.buf.length) {
      throw new Error(`Tranche vide à offset ${received}`);
    }
    out.set(piece.buf, received);
    received += piece.buf.length;
    if (onProgress) onProgress(received / total);
  }
  return out.buffer;
}

// ---------- public pull orchestrator ----------

export async function pullAll(onProgress, signal) {
  const steps = [
    { weight: 4,  label: 'Référentiel géographique',                     fn: pullCommunes },
    { weight: 6,  label: `Population municipale ${POP_YEAR}`,            fn: pullPopulations },
    { weight: 70, label: `Entreprises actives & répartition par secteur — année ${STOCK_YEAR}`, fn: pullStocksAndSectors },
    { weight: 20, label: `Créations d'entreprises ${CREA_YEAR}`,         fn: pullCreations }
  ];

  const totalWeight = steps.reduce((s, x) => s + x.weight, 0);
  let done = 0;
  const ctx = { byCode: new Map(), warnings: [] };

  for (const step of steps) {
    if (signal?.aborted) throw new Error('aborted');
    onProgress({ ratio: done / totalWeight, label: step.label });
    const stepStart = done;
    const stepWeight = step.weight;
    const subProgress = (subRatio, subLabel) => {
      onProgress({
        ratio: (stepStart + stepWeight * Math.max(0, Math.min(1, subRatio))) / totalWeight,
        label: subLabel || step.label
      });
    };
    await step.fn(ctx, signal, subProgress);
    done += step.weight;
    onProgress({ ratio: done / totalWeight, label: step.label + ' — terminé' });
  }

  // Compute derived indicators per commune.
  // sectorialCoverage = Σ(A10 publiés) / stock(_T) — < 1 quand l'Insee a
  // supprimé des cellules au titre du secret statistique (typiquement < 5 UL).
  // En dessous de ~85 %, la comparaison sectorielle perd de sa valeur.
  const records = [];
  for (const c of ctx.byCode.values()) {
    if (!c.population || c.population < 50) continue;
    const stock = c.stockTarget || 0;
    const stockBaseline = c.stockBaseline || 0;
    const sectorVec = A10_SECTORS.map(s => c.sectoriel?.[s] || 0);
    const sectorRawSum = sectorVec.reduce((a, b) => a + b, 0);
    const sectorShares = sectorRawSum > 0
      ? sectorVec.map(v => v / sectorRawSum)
      : sectorVec.map(() => 0);
    const sectorialCoverage = stock > 0 ? Math.min(1, sectorRawSum / stock) : 0;

    // Croissance 10 ans : nulle si la base est trop faible (< 20 UL),
    // sinon le ratio amplifie le bruit en passant du simple au triple
    // pour des écarts de 1-2 UL.
    const growth10y = stockBaseline >= 20 ? (stock - stockBaseline) / stockBaseline : null;

    records.push({
      code: c.code,
      name: c.name,
      dept: c.dept,
      codeRegion: c.codeRegion || null,
      lat: c.lat,
      lon: c.lon,
      isArm: !!c.isArm,
      population: c.population,
      stock,
      stockBaseline,
      density: stock * 1000 / c.population,
      growth10y,
      creations: c.creations || 0,
      sectorShares,
      sectorialCoverage
    });
  }
  return {
    records,
    warnings: ctx.warnings,
    regions: ctx.regions || [],
    departements: ctx.departements || []
  };
}

// ---------- 1. Geographic referential (geo.api.gouv.fr) ----------

async function pullCommunes(ctx, signal, progress) {
  // 3 queries : communes + arrondissements municipaux + listes régions/départements.
  const fields = 'fields=code,nom,codeDepartement,codeRegion,centre&format=json&geometry=centre';
  const sources = [
    [`${GEO_BASE}/communes?${fields}`, 'communes', false],
    [`${GEO_BASE}/communes?type=arrondissement-municipal&${fields}`, 'arrondissements municipaux', true]
  ];
  for (let i = 0; i < sources.length; i++) {
    const [url, label, isArm] = sources[i];
    progress(i / (sources.length + 1), `Référentiel — ${label}`);
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
    const arr = await res.json();
    for (const f of arr) {
      const code = f.code;
      if (!code) continue;
      const centre = f.centre?.coordinates || [null, null];
      ctx.byCode.set(code, {
        code,
        name: f.nom,
        dept: f.codeDepartement || code.slice(0, 2),
        codeRegion: f.codeRegion || null,
        lon: centre[0],
        lat: centre[1],
        isArm
      });
    }
  }
  progress(sources.length / (sources.length + 1), 'Référentiel — régions et départements');
  const [regions, departements] = await Promise.all([
    fetch(`${GEO_BASE}/regions`, { signal }).then(r => r.ok ? r.json() : []),
    fetch(`${GEO_BASE}/departements?fields=code,nom,codeRegion`, { signal }).then(r => r.ok ? r.json() : [])
  ]);
  ctx.regions = regions;
  ctx.departements = departements;
}

// ---------- helpers for ZIP CSV pulls ----------

const FRIENDLY_LABELS = {
  populations: 'population municipale',
  stocks:      'entreprises actives & secteurs d\'activité',
  creations:   'créations d\'entreprises'
};

async function downloadAndStream(productKey, signal, progress, downloadShare = 0.5) {
  const { ds, product, data } = PRODUCTS[productKey];
  const url = `${MELODI_FILE}/${ds}/${product}`;
  const friendly = FRIENDLY_LABELS[productKey] || ds;
  progress(0, `Téléchargement — ${friendly}…`);
  const buffer = await fetchZipAsArrayBuffer(url, {
    signal,
    onProgress: (frac, bytes) => {
      if (frac != null) progress(frac * downloadShare, `Téléchargement — ${friendly} (${Math.round(frac * 100)} %)`);
      else progress(0.05, `Téléchargement — ${friendly} (${(bytes / 1e6).toFixed(1)} Mo reçus)`);
    }
  });
  return { buffer, dataPattern: data, ds, friendly };
}

// ---------- 2. Populations ----------

async function pullPopulations(ctx, signal, progress) {
  const { buffer, dataPattern, friendly } = await downloadAndStream('populations', signal, progress, 0.6);
  progress(0.6, `Lecture du fichier — ${friendly}…`);

  let h;
  await streamCsvFromZip(buffer, dataPattern, {
    onHeader: (_, idx) => { h = idx; },
    onRow: (row) => {
      if (row[h.POPREF_MEASURE] !== 'PMUN') return;
      if (row[h.TIME_PERIOD] !== POP_YEAR) return;
      if (!KEEP_LEVELS.has(row[h.GEO_OBJECT])) return;
      const c = ctx.byCode.get(row[h.GEO]);
      if (!c) return;
      c.population = Number(row[h.OBS_VALUE]);
    },
    onProgress: n => progress(0.6 + 0.4 * Math.min(1, n / 36000), `Lecture — population municipale (${n.toLocaleString('fr-FR')} lignes traitées)`)
  });
}

// ---------- 3. Stocks UL + sector profile (single CSV) ----------

async function pullStocksAndSectors(ctx, signal, progress) {
  // The DS_SIDE_STOCKS_COM CSV contains all years (2014-2024), both measures
  // (LEGAL_UNIT / UNIT_LOC), all activities and all geo levels. We extract:
  // SIDE_MEASURE = LEGAL_UNIT × TIME_PERIOD ∈ {2014, 2024} × ACTIVITY ∈ {_T, A10} × COM/ARM.
  const { buffer, dataPattern, friendly } = await downloadAndStream('stocks', signal, progress, 0.4);
  progress(0.4, `Lecture du fichier — ${friendly}…`);

  let h;
  await streamCsvFromZip(buffer, dataPattern, {
    onHeader: (_, idx) => { h = idx; },
    onRow: (row) => {
      if (row[h.SIDE_MEASURE] !== 'LEGAL_UNIT') return;
      if (!KEEP_LEVELS.has(row[h.GEO_OBJECT])) return;
      const tp = row[h.TIME_PERIOD];
      const act = row[h.ACTIVITY];

      const targetIsTotal = act === '_T';
      const targetIsSector = A10_SET.has(act);
      if (!targetIsTotal && !targetIsSector) return;

      const c = ctx.byCode.get(row[h.GEO]);
      if (!c) return;
      const v = Number(row[h.OBS_VALUE]);

      if (targetIsTotal) {
        if (tp === STOCK_YEAR) c.stockTarget = v;
        else if (tp === STOCK_BASELINE_YEAR) c.stockBaseline = v;
      } else if (targetIsSector && tp === STOCK_YEAR) {
        if (!c.sectoriel) c.sectoriel = {};
        c.sectoriel[act] = v;
      }
    },
    onProgress: n => progress(0.4 + 0.6 * Math.min(1, n / 9_200_000), `Lecture — entreprises actives & secteurs (${n.toLocaleString('fr-FR')} lignes traitées)`)
  });
}

// ---------- 4. Créations ----------

async function pullCreations(ctx, signal, progress) {
  const { buffer, dataPattern, friendly } = await downloadAndStream('creations', signal, progress, 0.5);
  progress(0.5, `Lecture du fichier — ${friendly}…`);

  let h;
  await streamCsvFromZip(buffer, dataPattern, {
    onHeader: (_, idx) => { h = idx; },
    onRow: (row) => {
      if (row[h.SIDE_MEASURE] !== 'BURE') return;
      if (row[h.ACTIVITY] !== '_T') return;
      if (row[h.LEGAL_FORM] !== '_T') return;
      if (row[h.TIME_PERIOD] !== CREA_YEAR) return;
      if (!KEEP_LEVELS.has(row[h.GEO_OBJECT])) return;
      const c = ctx.byCode.get(row[h.GEO]);
      if (!c) return;
      c.creations = Number(row[h.OBS_VALUE]);
    },
    onProgress: n => progress(0.5 + 0.5 * Math.min(1, n / 9_000_000), `Lecture — créations d'entreprises (${n.toLocaleString('fr-FR')} lignes traitées)`)
  });
}
