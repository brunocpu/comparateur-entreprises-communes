// Parcours navigateur — non-régression de ce que les tests Node ne voient pas :
// service worker, IndexedDB, rendu, exports, impression.
//
// Chrome headless piloté en CDP (WebSocket natif de Node ≥ 22), servi par un
// serveur HTTP intégré, profil jetable à chaque exécution. Aucune dépendance.
//
//   npm run test:browser
//   CHROME_PATH=/chemin/vers/chrome npm run test:browser
//   UPDATE_FIXTURES=1 npm run test:browser     recapture l'export CSV de référence
//
// Les parcours marqués `todo` décrivent un défaut connu : ils s'exécutent et
// s'affichent sans faire échouer la suite, jusqu'à l'étape qui les corrige.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_VERSION, ARTEFACT_PATH } from '../js/insee-api.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ARTEFACT_URL_PATH = `/${ARTEFACT_PATH}`;
const CSV_FIXTURE = new URL('./fixtures/export-26281-national.csv', import.meta.url);
const UPDATE = process.env.UPDATE_FIXTURES === '1';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find(p => existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---------- serveur statique ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    if (p === ARTEFACT_URL_PATH && server.artefactOverride) {
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
      res.end(server.artefactOverride);
      return;
    }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    readFileAsync(file).then(buf => {
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(buf);
    }, () => { res.writeHead(404); res.end(); });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
const readFileAsync = f => new Promise((ok, ko) => { try { ok(readFileSync(f)); } catch (e) { ko(e); } });

// ---------- Chrome + CDP ----------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        const { resolve, reject } = this.pending.get(d.id);
        this.pending.delete(d.id);
        if (d.error) reject(new Error(`CDP ${d.error.message}`)); else resolve(d.result);
      } else if (d.method) {
        for (const l of this.listeners) l(d);
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  waitEvent(pred, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const off = this.on(e => { if (pred(e)) { clearTimeout(t); off(); resolve(e); } });
      const t = setTimeout(() => { off(); reject(new Error('Événement CDP attendu non reçu')); }, timeout);
    });
  }
}

async function launchChrome(profileDir) {
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
    '--window-size=1280,1400', 'about:blank'
  ], { stdio: 'ignore' });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  return { proc, cdp: new Cdp(ws), ws };
}

// ---------- contexte partagé par les parcours ----------

let server, chrome, cdp, base, profileDir;
const requests = [];
const errors = [];

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`Évaluation : ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}

async function waitUntil(expression, timeout = 15000, what = expression) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Délai dépassé : ${what}`);
}

// Clic réel (mousePressed + mouseReleased) : les suggestions écoutent
// `mousedown`, qu'un element.click() ne déclenche pas.
async function clickElement(elementExpr, what) {
  const r = await evaluate(`(() => {
    const e = ${elementExpr};
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const b = e.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width };
  })()`);
  if (!r || !r.w) throw new Error(`Élément non cliquable : ${what || elementExpr}`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  }
}
const click = sel => clickElement(`document.querySelector(${JSON.stringify(sel)})`, sel);

async function typeInto(sel, text) {
  await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ''; e.focus(); })()`);
  await cdp.send('Input.insertText', { text });
}

async function pickCommune(inputSel, listSel, text, code) {
  await typeInto(inputSel, text);
  const li = `[...document.querySelectorAll(${JSON.stringify(listSel + ' li')})].find(li => li.querySelector('.ac-code')?.textContent === ${JSON.stringify(code)})`;
  await waitUntil(`!!(${li})`, 5000, `suggestion ${code}`);
  await clickElement(li, `suggestion ${code}`);
}

const text = sel => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const isHidden = sel => evaluate(`document.querySelector(${JSON.stringify(sel)}).hidden`);

const idb = body => `new Promise((res, rej) => {
  const rq = indexedDB.open('cec-cache');
  rq.onerror = () => rej(rq.error);
  rq.onsuccess = () => { const db = rq.result; ${body} };
})`;
const getMeta = key => evaluate(idb(`const r = db.transaction('meta').objectStore('meta').get(${JSON.stringify(key)});
  r.onsuccess = () => { db.close(); res(r.result ? r.result.value : null); };`));
const setMeta = (key, value) => evaluate(idb(`const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key: ${JSON.stringify(key)}, value: ${JSON.stringify(value)} });
  tx.oncomplete = () => { db.close(); res(true); };`));
const countCommunes = () => evaluate(idb(`const r = db.transaction('communes').objectStore('communes').count();
  r.onsuccess = () => { db.close(); res(r.result); };`));

// Rechargement ordinaire, comme un visiteur qui revient : le service worker
// reste dans la boucle (un rechargement forcé le contournerait).
async function reload() {
  const loaded = cdp.waitEvent(e => e.method === 'Page.loadEventFired', 20000);
  await cdp.send('Page.reload');
  await loaded;
}

// Déclenche une action et renvoie le fichier téléchargé, dans un dossier neuf.
async function download(action, timeout = 5000) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cec-dl-'));
  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
    const done = cdp.waitEvent(e => e.method === 'Browser.downloadProgress' && e.params.state === 'completed', timeout);
    await action();
    await done;
    const [name] = readdirSync(dir);
    return { name, content: readFileSync(path.join(dir, name), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- parcours ----------

describe('parcours navigateur', { skip: !CHROME && 'Chrome introuvable — définir CHROME_PATH' }, () => {
  before(async () => {
    server = await startServer();
    base = `http://127.0.0.1:${server.address().port}/`;
    profileDir = mkdtempSync(path.join(tmpdir(), 'cec-chrome-'));
    chrome = await launchChrome(profileDir);
    cdp = chrome.cdp;
    cdp.on(e => {
      if (e.method === 'Network.requestWillBeSent') requests.push(e.params.request.url);
      if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
      if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') errors.push(e.params.args.map(a => a.value ?? a.description).join(' '));
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
  });

  after(async () => {
    try { chrome?.ws.close(); } catch {}
    chrome?.proc.kill();
    server?.close();
    await sleep(500);
    if (profileDir) rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  test('S1 premier chargement : artefact indexé, aucun appel à l\'API Insee', async () => {
    const loaded = cdp.waitEvent(e => e.method === 'Page.loadEventFired', 20000);
    await cdp.send('Page.navigate', { url: base });
    await loaded;
    await waitUntil(`!document.getElementById('search').hidden`, 60000, 'recherche affichée');
    assert.match(norm(await text('#cache-status')), /^34 002 communes · chargées le \d{2}\/\d{2}\/\d{4}$/);
    assert.equal(requests.filter(u => u.includes('api.insee.fr')).length, 0);
    assert.equal(await getMeta('dataVersion'), DATA_VERSION);
    assert.equal(await countCommunes(), 34002);
  });

  test('S2 analyse de Romans-sur-Isère, zone « Même département »', async () => {
    await pickCommune('#commune-input', '#autocomplete', 'Romans-sur', '26281');
    await waitUntil(`!document.getElementById('results').hidden`, 10000, 'résultats affichés');
    assert.equal(norm(await text('#ind-stock')), '2 883');
    assert.equal(norm(await text('#ind-density')), '86,2');
    assert.equal(norm(await text('#ind-growth')), '33,8 %');
    assert.equal(norm(await text('#ind-crea')), '500');
    assert.match(norm(await text('#comparables-h2')), /Drôme \(26\) · n = 1$/);
    assert.equal(await isHidden('#comparables-warning'), false);
    assert.match(norm(await text('#comparables-warning')), /^Sélection limitée — 1 commune comparable\./);
    assert.equal(await evaluate(`document.querySelectorAll('#comparables-table tbody tr').length`), 2);
  });

  test('S2b libellés : zone désignée partout de la même façon, accords, virgule décimale', async () => {
    const zone = 'Département Drôme (26)';
    assert.equal(norm(await text('#summary-scope')), zone);
    assert.equal(norm(await text('#sticky-scope')), zone);
    assert.equal(norm(await text('#comparables-h2')), `Communes comparables — ${zone} · n = 1`);
    assert.match(norm(await text('#target-meta')), /n = 1 commune comparable$/);
    assert.match(norm(await text('#theoretical-gap')), /^Nombre d'entreprises pour 1 000 habitants : [-−]13,4 % par rapport/);
  });

  test('S9 écarts à la médiane sans « % % » ni pourcentage pour la croissance', async () => {
    for (const id of ['stock', 'density', 'crea']) {
      assert.doesNotMatch(norm(await text(`#ind-${id}-delta`)), /%\s*%/, `#ind-${id}-delta`);
    }
    assert.doesNotMatch(norm(await text('#ind-growth-delta')), /%/);
  });

  test('S10 bandeau fixe masqué en haut de page, affiché après défilement', async () => {
    await evaluate('window.scrollTo(0, 0)');
    await sleep(400);
    assert.equal(await evaluate(`document.getElementById('sticky-banner').classList.contains('is-visible')`), false, 'visible en haut de page');
    await evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(400);
    assert.equal(await evaluate(`document.getElementById('sticky-banner').classList.contains('is-visible')`), true, 'masqué après défilement');
    // « Changer ↑ » déplie le bloc de recherche et y remonte : le bandeau s'efface.
    await click('#sticky-change');
    await waitUntil(`!document.getElementById('sticky-banner').classList.contains('is-visible')`, 3000, 'bandeau effacé après « Changer ↑ »');
    assert.equal(await isHidden('#search'), false);
  });

  test('S3 passage à « Toute la France » : recalcul à 10 comparables', async () => {
    if (!(await isHidden('#search-summary'))) await click('#btn-modify');
    await click('.scope-segment[data-scope="national"]');
    await waitUntil(`/Toute la France · n = 10$/.test(document.getElementById('comparables-h2').textContent)`, 5000, 'titre national');
    assert.equal(await evaluate(`document.querySelectorAll('#comparables-table tbody tr').length`), 11);
    assert.equal(await isHidden('#comparables-warning'), true);
  });

  test('S4 export CSV « Une commune » identique à la référence (hors date)', async () => {
    const { name, content } = await download(() => click('#btn-export'));
    assert.equal(name, 'comparateur-26281-Romans-sur-Isere.csv');
    assert.equal(content.charCodeAt(0), 0xfeff, 'BOM UTF-8');
    const lines = content.slice(1).split('\r\n').filter(l => !l.startsWith('# Export :'));
    if (UPDATE) writeFileSync(CSV_FIXTURE, lines.join('\n') + '\n');
    const expected = readFileSync(CSV_FIXTURE, 'utf8').replace(/\n$/, '').split('\n');
    assert.deepEqual(lines, expected);
  });

  test('S13 impression : la fiche tient sur une page A4', async () => {
    const { data } = await cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
    const pdf = Buffer.from(data, 'base64').toString('latin1');
    assert.equal((pdf.match(/\/Type\s*\/Page(?![s\w])/g) || []).length, 1);
  });

  test('S5 « Plusieurs communes » : ajout, retrait, tableau', async () => {
    await click('#tab-multi');
    await pickCommune('#multi-input', '#multi-autocomplete', 'Romans-sur', '26281');
    await pickCommune('#multi-input', '#multi-autocomplete', 'Valence', '26362');
    assert.equal(await evaluate(`document.querySelectorAll('#multi-chips .commune-chip').length`), 2);
    assert.equal(await evaluate(`document.querySelectorAll('#multi-table tbody tr').length`), 2);
    await click('#multi-chips .chip-remove[data-code="26281"]');
    assert.equal(await evaluate(`document.querySelectorAll('#multi-table tbody tr').length`), 1);
    assert.equal(await isHidden('#btn-multi-export'), true);
    await pickCommune('#multi-input', '#multi-autocomplete', 'Romans-sur', '26281');
    assert.equal(await isHidden('#btn-multi-export'), false);
  });

  test('S8 export CSV « Plusieurs communes »', async () => {
    const { name, content } = await download(() => click('#btn-multi-export'), 3000);
    assert.equal(name, 'comparateur-selection-26362-26281.csv');
    assert.equal(content.charCodeAt(0), 0xfeff, 'BOM UTF-8');
    const rows = content.split('\r\n').filter(l => /^Commune;/.test(l));
    assert.deepEqual(rows.map(r => r.split(';')[2]), ['26362', '26281']);
  });

  test('aucune erreur JavaScript pendant les parcours nominaux', () => {
    assert.deepEqual(errors, []);
  });

  test('S6 cache d\'un millésime antérieur : artefact repris', async () => {
    await setMeta('dataVersion', 'millesime-anterieur');
    const before = requests.filter(u => u.endsWith(ARTEFACT_URL_PATH)).length;
    await reload();
    await waitUntil(`!document.getElementById('search').hidden`, 60000, 'recherche affichée');
    assert.equal(requests.filter(u => u.endsWith(ARTEFACT_URL_PATH)).length, before + 1);
    assert.equal(await getMeta('dataVersion'), DATA_VERSION);
    assert.equal(await countCommunes(), 34002);
  });

  test('S12 le service worker ne met pas l\'artefact en cache', { todo: 'étape 8' }, async () => {
    await waitUntil('!!navigator.serviceWorker.controller', 10000, 'page contrôlée par le service worker');
    await evaluate(`fetch('.${ARTEFACT_URL_PATH}').then(r => r.arrayBuffer()).then(() => true)`);
    await sleep(500);
    const cached = await evaluate(`(async () => {
      const urls = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(r.url);
      return urls;
    })()`);
    assert.deepEqual(cached.filter(u => u.includes('/data/')), []);
  });

  test('S7 échec du téléchargement complet : erreur affichée, données conservées', async () => {
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*api.insee.fr*' }, { urlPattern: '*geo.api.gouv.fr*' }] });
    const off = cdp.on(e => {
      if (e.method === 'Fetch.requestPaused') cdp.send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'InternetDisconnected' }).catch(() => {});
    });
    try {
      await click('#btn-refresh');
      await waitUntil(`!document.getElementById('errors').hidden`, 20000, 'message d\'erreur');
      assert.match(norm(await text('#error-message')), /^Le chargement a échoué/);
      await waitUntil(`!document.getElementById('tabs').hidden`, 5000, 'onglets rétablis');
      assert.equal(await countCommunes(), 34002);
      assert.match(norm(await text('#cache-status')), /^34 002 communes/);
    } finally {
      off();
      await cdp.send('Fetch.disable');
    }
  });

  test('S11 artefact d\'une autre version que le code : refusé', async () => {
    const artefact = JSON.parse(readFileSync(path.join(ROOT, ARTEFACT_URL_PATH), 'utf8'));
    server.artefactOverride = JSON.stringify({ ...artefact, dataVersion: 'autre-version' });
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await cdp.send('Storage.clearDataForOrigin', { origin: base.replace(/\/$/, ''), storageTypes: 'indexeddb' });
    try {
      await reload();
      await waitUntil(`!document.getElementById('btn-pull').hidden || !document.getElementById('search').hidden`, 30000, 'fin du démarrage');
      assert.equal(await isHidden('#btn-pull'), false, 'bouton « Lancer le chargement » attendu');
      assert.equal(await isHidden('#search'), true);
    } finally {
      server.artefactOverride = null;
      await cdp.send('Network.setBypassServiceWorker', { bypass: false });
    }
  });
});
