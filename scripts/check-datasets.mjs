// Sonde de disponibilité des sources de données — exécutée chaque lundi par
// .github/workflows/datasets-watch.yml.
//
// Motivation : en juillet 2026, l'Insee a renommé DS_SIDE_STOCKS_UL_COM en
// DS_SIDE_STOCKS_COM. L'ancien identifiant renvoyait 400, mais personne ne l'a
// su : l'artefact pré-bundlé masquait la panne côté visiteurs, et le seul
// consommateur de l'API — le cron annuel de build-data.yml — ne s'exécute
// qu'une fois par an. La rupture serait apparue avec quatre mois de retard.
//
// La sonde contrôle quatre choses, à partir des identifiants épinglés dans
// js/insee-api.js (importés, donc jamais désynchronisés du code) :
//   1. le jeu de données figure toujours dans le catalogue Melodi ;
//   2. le produit CSV épinglé figure toujours parmi ses accessURL ;
//   3. l'URL de téléchargement répond bien (HEAD 200) ;
//   4. aucun millésime plus récent n'est disponible — c'est ce point qui
//      signale une nouvelle publication Insee dès sa mise en ligne.
//
// Sortie en code 1 si l'un des contrôles échoue : le workflow passe au rouge
// et GitHub envoie une notification.
//
// Usage : node scripts/check-datasets.mjs

import { PRODUCTS } from '../js/insee-api.js';

const CATALOG_URL = 'https://api.insee.fr/melodi/catalog/all';
const FILE_BASE = 'https://api.insee.fr/melodi/file';
// Référentiel géographique : seconde dépendance runtime de l'app (js/insee-api.js).
// /regions est la ressource la plus légère de l'API, suffisante comme test de vie.
const GEO_PROBE = 'https://geo.api.gouv.fr/regions';

const problems = [];
const lines = [];

function ok(msg) { lines.push(`  ok    ${msg}`); }
function fail(kind, msg) { lines.push(`  ${kind}  ${msg}`); problems.push(`[${kind}] ${msg}`); }

// Millésime = année en suffixe de l'identifiant produit (…_2024_CSV_FR).
function millesimeOf(productId) {
  const m = /_(\d{4})_CSV_FR$/.exec(productId);
  return m ? Number(m[1]) : null;
}

const catalogRes = await fetch(CATALOG_URL);
if (!catalogRes.ok) {
  console.error(`✗ Catalogue Melodi inaccessible : HTTP ${catalogRes.status} sur ${CATALOG_URL}`);
  process.exit(1);
}
const catalog = await catalogRes.json();
if (!Array.isArray(catalog)) {
  console.error('✗ Catalogue Melodi : format inattendu (tableau attendu).');
  process.exit(1);
}

console.log(`Catalogue Melodi : ${catalog.length} jeux de données\n`);

for (const [key, { ds, product }] of Object.entries(PRODUCTS)) {
  lines.push(`${key} — ${ds} / ${product}`);

  const entry = catalog.find(d => d.identifier === ds);
  if (!entry) {
    // Cas du renommage de juillet 2026 : le jeu disparaît du catalogue et
    // l'endpoint /file répond 400. On propose les candidats les plus proches.
    const stem = ds.replace(/^DS_/, '').split('_').slice(0, 2).join('_');
    const near = catalog.map(d => d.identifier).filter(id => id.includes(stem));
    fail('ABSENT', `${ds} ne figure plus dans le catalogue (renommé ou retiré).`
      + (near.length ? ` Candidats : ${near.join(', ')}` : ''));
    lines.push('');
    continue;
  }
  ok(`jeu de données présent (modifié le ${String(entry.modified).slice(0, 10)})`);

  const products = (entry.product || [])
    .map(p => p.accessURL || '')
    .map(u => u.split('/').pop())
    .filter(Boolean);

  if (!products.includes(product)) {
    fail('PRODUIT', `${product} ne figure plus parmi les produits de ${ds}.`
      + ` Disponibles : ${products.join(', ')}`);
  } else {
    ok('produit CSV présent au catalogue');
  }

  const url = `${FILE_BASE}/${ds}/${product}`;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) {
      fail('HTTP', `HTTP ${head.status} sur ${url}`);
    } else {
      const mb = (Number(head.headers.get('content-length') || 0) / 1e6).toFixed(1);
      ok(`téléchargement disponible (${mb} Mo)`);
    }
  } catch (err) {
    fail('RESEAU', `${url} injoignable : ${err.message}`);
  }

  const pinned = millesimeOf(product);
  const latest = products
    .map(millesimeOf)
    .filter(y => y != null)
    .reduce((a, b) => Math.max(a, b), 0);
  if (pinned && latest > pinned) {
    fail('MILLESIME', `millésime ${latest} publié, ${pinned} épinglé dans js/insee-api.js.`);
  } else if (pinned) {
    ok(`millésime ${pinned} à jour`);
  }

  lines.push('');
}

lines.push('geo.api.gouv.fr');
try {
  const geo = await fetch(GEO_PROBE);
  if (!geo.ok) fail('HTTP', `HTTP ${geo.status} sur ${GEO_PROBE}`);
  else ok(`référentiel géographique disponible (${(await geo.json()).length} régions)`);
} catch (err) {
  fail('RESEAU', `${GEO_PROBE} injoignable : ${err.message}`);
}

console.log(lines.join('\n'));

if (problems.length) {
  console.error(`\n✗ ${problems.length} anomalie(s) :`);
  problems.forEach(p => console.error('  - ' + p));
  console.error('\nCorriger les identifiants dans js/insee-api.js, puis régénérer'
    + " l'artefact avec `npm run build:data`.");
  process.exit(1);
}

console.log('\n✓ Toutes les sources sont disponibles et à jour.');
