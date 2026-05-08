// Build OG image — génère assets/og-image.png (1200×630) à partir d'un SVG
// composé à la main, qui rejoue la palette papier-encre + Fraunces sérif +
// accent rouille du site. Image utilisée comme aperçu social
// (Twitter / LinkedIn / Slack / Mastodon) et social preview GitHub.
//
// Usage : npm install (une fois) puis node scripts/build-og-image.mjs

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import wawoff2 from 'wawoff2';

const W = 1200;
const H = 630;

// Couleurs synchrones avec :root de css/styles.css
const PAPER       = '#f5f1ea';
const PAPER_DEEP  = '#ebe6da';
const SURFACE     = '#fffefb';
const INK         = '#1c1a16';
const INK_MUTED   = '#6b6660';
const INK_SUBTLE  = '#6e6962';
const RULE        = '#d9d3c4';
const ACCENT      = '#1c3d5a';
const MEDIAN      = '#c2570e';

// Polices résolues via les paquets @fontsource/* (devDeps) — fichiers
// woff2 livrés dans node_modules. Le rasterizer resvg-js exige du TTF, on
// décompresse donc les woff2 à la volée via wawoff2 et on cache le résultat
// dans assets/fonts-cache/ (gitignored, régénérable).
const WOFF2_FILES = [
  'node_modules/@fontsource/fraunces/files/fraunces-latin-500-normal.woff2',
  'node_modules/@fontsource/fraunces/files/fraunces-latin-400-italic.woff2',
  'node_modules/@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2',
  'node_modules/@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff2',
  'node_modules/@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2'
];
const FONTS_CACHE = 'assets/fonts-cache';

async function woff2ToTtf(woff2Path) {
  const ttfPath = `${FONTS_CACHE}/${woff2Path.split('/').pop().replace(/\.woff2$/, '.ttf')}`;
  if (existsSync(ttfPath)) return ttfPath;
  const woff2Buf = readFileSync(woff2Path);
  const ttfBuf = await wawoff2.decompress(woff2Buf);
  writeFileSync(ttfPath, Buffer.from(ttfBuf));
  return ttfPath;
}

function buildSvg() {
  // Layout : titre éditorial 3 lignes à gauche (cols 1-7), encart « cible
  // analysée » à droite (cols 8-12) reprenant un indicateur cardinal +
  // bullet chart + extrait du profil sectoriel.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- Fond papier + filet inférieur subtil -->
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="${RULE}" stroke-width="2"/>

  <!-- ===== Colonne gauche : titre éditorial ===== -->
  <!-- Eyebrow mono uppercase, lettrage espacé -->
  <text x="80" y="100" font-family="GeistMono" font-size="20" fill="${INK_SUBTLE}" letter-spacing="3.5">
    COMPARATEUR · DONNÉES INSEE · 2026
  </text>

  <!-- H1 trois lignes, Fraunces 88pt, chute en italique rouille -->
  <text x="80" y="220" font-family="Fraunces" font-weight="500" font-size="88" fill="${INK}" letter-spacing="-1.6">
    Une commune,
  </text>
  <text x="80" y="320" font-family="Fraunces" font-weight="500" font-size="88" fill="${INK}" letter-spacing="-1.6">
    dix comparables,
  </text>
  <text x="80" y="420" font-family="Fraunces" font-style="italic" font-weight="400" font-size="88" fill="${MEDIAN}" letter-spacing="-1.6">
    quatre repères.
  </text>

  <!-- Filet horizontal entre titre et sous-titre, façon Datawrapper -->
  <line x1="80" y1="475" x2="200" y2="475" stroke="${INK}" stroke-width="2"/>

  <!-- Sous-titre Geist, deux lignes -->
  <text x="80" y="528" font-family="Geist" font-weight="400" font-size="22" fill="${INK_MUTED}">
    Pour chaque commune française, dix communes
  </text>
  <text x="80" y="560" font-family="Geist" font-weight="400" font-size="22" fill="${INK_MUTED}">
    de taille et de profil économique proches. Données Insee Side.
  </text>

  <!-- ===== Colonne droite : encart « indicateur + bullet chart » ===== -->
  <g transform="translate(770, 80)">
    <!-- Card surface beige clair, filet papier -->
    <rect x="0" y="0" width="360" height="470" fill="${SURFACE}" stroke="${RULE}" stroke-width="1" rx="6"/>

    <!-- Header card : commune cible -->
    <text x="24" y="44" font-family="GeistMono" font-size="11" fill="${INK_SUBTLE}" letter-spacing="2.2">
      CIBLE · DRÔME
    </text>
    <text x="24" y="80" font-family="Fraunces" font-weight="500" font-size="28" fill="${INK}" letter-spacing="-0.6">
      Romans-sur-Isère
    </text>
    <line x1="24" y1="100" x2="336" y2="100" stroke="${RULE}"/>

    <!-- Indicateur cardinal -->
    <text x="24" y="130" font-family="GeistMono" font-size="11" fill="${INK_SUBTLE}" letter-spacing="2.2">
      ENTREPRISES ACTIVES
    </text>
    <text x="24" y="180" font-family="Fraunces" font-weight="400" font-size="56" fill="${INK}" letter-spacing="-1.4">
      4 217
    </text>

    <!-- Bullet chart : Q1—Q3 ribbon + médiane + cible -->
    <g transform="translate(24, 210)">
      <line x1="0" y1="14" x2="312" y2="14" stroke="${RULE}" stroke-width="1"/>
      <rect x="78" y="6" width="160" height="16" fill="${PAPER_DEEP}"/>
      <line x1="158" y1="2" x2="158" y2="26" stroke="${INK_SUBTLE}" stroke-width="1.5"/>
      <circle cx="118" cy="14" r="9" fill="${ACCENT}" stroke="${SURFACE}" stroke-width="3"/>
    </g>
    <text x="24" y="262" font-family="GeistMono" font-size="11" fill="${INK_SUBTLE}" letter-spacing="0.5">
      Q1 3 580 · médiane 4 720 · Q3 5 240
    </text>

    <line x1="24" y1="284" x2="336" y2="284" stroke="${RULE}"/>

    <!-- Profil sectoriel : 3 secteurs représentatifs -->
    <text x="24" y="312" font-family="GeistMono" font-size="11" fill="${INK_SUBTLE}" letter-spacing="2.2">
      RÉPARTITION SECTORIELLE
    </text>

    <!-- Industrie -->
    <text x="24" y="342" font-family="Geist" font-size="14" fill="${INK}">Industrie</text>
    <text x="336" y="342" font-family="GeistMono" font-size="12" fill="${INK_SUBTLE}" text-anchor="end">14,2 %</text>
    <rect x="24" y="350" width="312" height="6" fill="${PAPER_DEEP}"/>
    <rect x="24" y="350" width="74" height="6" fill="${ACCENT}"/>
    <line x1="118" y1="346" x2="118" y2="360" stroke="${MEDIAN}" stroke-width="2"/>
    <circle cx="118" cy="346" r="4" fill="${MEDIAN}"/>

    <!-- Commerce / transports / hébergement -->
    <text x="24" y="385" font-family="Geist" font-size="14" fill="${INK}">Commerce, transports</text>
    <text x="336" y="385" font-family="GeistMono" font-size="12" fill="${INK_SUBTLE}" text-anchor="end">28,7 %</text>
    <rect x="24" y="393" width="312" height="6" fill="${PAPER_DEEP}"/>
    <rect x="24" y="393" width="184" height="6" fill="${ACCENT}"/>
    <line x1="170" y1="389" x2="170" y2="403" stroke="${MEDIAN}" stroke-width="2"/>
    <circle cx="170" cy="389" r="4" fill="${MEDIAN}"/>

    <!-- Services scientifiques -->
    <text x="24" y="428" font-family="Geist" font-size="14" fill="${INK}">Services scientifiques</text>
    <text x="336" y="428" font-family="GeistMono" font-size="12" fill="${INK_SUBTLE}" text-anchor="end">11,4 %</text>
    <rect x="24" y="436" width="312" height="6" fill="${PAPER_DEEP}"/>
    <rect x="24" y="436" width="58" height="6" fill="${ACCENT}"/>
    <line x1="84" y1="432" x2="84" y2="446" stroke="${MEDIAN}" stroke-width="2"/>
    <circle cx="84" cy="432" r="4" fill="${MEDIAN}"/>
  </g>
</svg>`;
}

async function main() {
  // Décompression woff2 → ttf (resvg-js ne lit pas le woff2 directement)
  mkdirSync(FONTS_CACHE, { recursive: true });
  const ttfFiles = [];
  for (const woff2Path of WOFF2_FILES) {
    if (!existsSync(woff2Path)) {
      throw new Error(`Police introuvable : ${woff2Path}. Lancer « npm install » pour récupérer @fontsource/*.`);
    }
    ttfFiles.push(await woff2ToTtf(woff2Path));
  }

  const svg = buildSvg();
  mkdirSync('assets', { recursive: true });
  writeFileSync('assets/og-image.svg', svg);

  // Rasterisation SVG → PNG via resvg (Rust). On charge les TTF décompressés
  // pour un rendu identique en CI et en local.
  const resvg = new Resvg(svg, {
    background: PAPER,
    fitTo: { mode: 'width', value: W },
    font: {
      fontFiles: ttfFiles,
      loadSystemFonts: false,
      defaultFontFamily: 'Geist'
    }
  });
  const png = resvg.render().asPng();
  writeFileSync('assets/og-image.png', png);
  process.stderr.write(`✓ Écrit assets/og-image.png (${(png.length / 1024).toFixed(1)} KB) + assets/og-image.svg\n`);
}

main().catch(err => {
  process.stderr.write('✗ Échec : ' + err.message + '\n');
  process.exit(1);
});
