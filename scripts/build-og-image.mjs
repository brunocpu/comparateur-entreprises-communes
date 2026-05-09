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

  <!-- H1 deux lignes, Fraunces 48pt, seconde ligne en italique rouille -->
  <text x="80" y="220" font-family="Fraunces" font-weight="500" font-size="48" fill="${INK}" letter-spacing="-0.8">
    Comparateur de communes —
  </text>
  <text x="80" y="290" font-family="Fraunces" font-style="italic" font-weight="400" font-size="48" fill="${MEDIAN}" letter-spacing="-0.8">
    démographie des entreprises
  </text>

  <!-- Filet horizontal entre titre et sous-titre, façon Datawrapper -->
  <line x1="80" y1="345" x2="200" y2="345" stroke="${INK}" stroke-width="2"/>

  <!-- Sous-titre Geist, trois lignes -->
  <text x="80" y="398" font-family="Geist" font-weight="400" font-size="22" fill="${INK_MUTED}">
    Positionner une commune française dans sa strate de
  </text>
  <text x="80" y="430" font-family="Geist" font-weight="400" font-size="22" fill="${INK_MUTED}">
    comparables sur les indicateurs Insee Side : entreprises
  </text>
  <text x="80" y="462" font-family="Geist" font-weight="400" font-size="22" fill="${INK_MUTED}">
    actives, créations, croissance, profil sectoriel A10.
  </text>

  <!-- ===== Colonne droite : encart « indicateur + bullet chart » =====
       Données réelles d'Arles (Bouches-du-Rhône, 13) — sélectionnée parce
       qu'elle compte 11 communes comparables dans son département (vue
       par défaut du sélecteur de zone). ===== -->
  <g transform="translate(770, 80)">
    <!-- Card surface beige clair, filet papier -->
    <rect x="0" y="0" width="360" height="470" fill="${SURFACE}" stroke="${RULE}" stroke-width="1" rx="6"/>

    <!-- Header card : commune cible -->
    <text x="24" y="44" font-family="GeistMono" font-size="11" fill="${INK_SUBTLE}" letter-spacing="2.2">
      CIBLE · BOUCHES-DU-RHÔNE
    </text>
    <text x="24" y="80" font-family="Fraunces" font-weight="500" font-size="28" fill="${INK}" letter-spacing="-0.6">
      Arles
    </text>
    <line x1="24" y1="100" x2="336" y2="100" stroke="${RULE}"/>

    <!-- Indicateur cardinal -->
    <text x="24" y="130" font-family="GeistMono" font-size="11" fill="${INK_SUBTLE}" letter-spacing="2.2">
      ENTREPRISES ACTIVES
    </text>
    <text x="24" y="180" font-family="Fraunces" font-weight="400" font-size="56" fill="${INK}" letter-spacing="-1.4">
      5 069
    </text>

    <!-- Bullet chart : Q1—Q3 ribbon + médiane + cible.
         Domaine [3349 ; 5253] (12 % de padding autour des extrêmes).
         Q1=3533 → 9,7 % → x=30
         Médiane=4038 → 36,2 % → x=113
         Q3=4227 → 46,1 % → x=144
         Cible=5069 → 90,3 % → x=282 (au-dessus du quart supérieur) -->
    <g transform="translate(24, 210)">
      <line x1="0" y1="14" x2="312" y2="14" stroke="${RULE}" stroke-width="1"/>
      <rect x="30" y="6" width="114" height="16" fill="${PAPER_DEEP}"/>
      <line x1="113" y1="2" x2="113" y2="26" stroke="${INK_SUBTLE}" stroke-width="1.5"/>
      <circle cx="282" cy="14" r="9" fill="${ACCENT}" stroke="${SURFACE}" stroke-width="3"/>
    </g>
    <text x="24" y="262" font-family="GeistMono" font-size="11" fill="${INK_SUBTLE}" letter-spacing="0.5">
      Q1 3 533 · médiane 4 038 · Q3 4 227
    </text>

    <line x1="24" y1="284" x2="336" y2="284" stroke="${RULE}"/>

    <!-- Profil sectoriel : 3 secteurs dominants d'Arles, scale max 60 % -->
    <text x="24" y="312" font-family="GeistMono" font-size="11" fill="${INK_SUBTLE}" letter-spacing="2.2">
      RÉPARTITION SECTORIELLE
    </text>

    <!-- Commerce, transports : 27,4 % | médiane 25,9 % -->
    <text x="24" y="342" font-family="Geist" font-size="14" fill="${INK}">Commerce, transports</text>
    <text x="336" y="342" font-family="GeistMono" font-size="12" fill="${INK_SUBTLE}" text-anchor="end">27,4 %</text>
    <rect x="24" y="350" width="312" height="6" fill="${PAPER_DEEP}"/>
    <rect x="24" y="350" width="142" height="6" fill="${ACCENT}"/>
    <line x1="158" y1="346" x2="158" y2="360" stroke="${MEDIAN}" stroke-width="2"/>
    <circle cx="158" cy="346" r="4" fill="${MEDIAN}"/>

    <!-- Services scientifiques : 17,0 % | médiane 17,3 % -->
    <text x="24" y="385" font-family="Geist" font-size="14" fill="${INK}">Services scientifiques</text>
    <text x="336" y="385" font-family="GeistMono" font-size="12" fill="${INK_SUBTLE}" text-anchor="end">17,0 %</text>
    <rect x="24" y="393" width="312" height="6" fill="${PAPER_DEEP}"/>
    <rect x="24" y="393" width="88" height="6" fill="${ACCENT}"/>
    <line x1="90" y1="389" x2="90" y2="403" stroke="${MEDIAN}" stroke-width="2"/>
    <circle cx="90" cy="389" r="4" fill="${MEDIAN}"/>

    <!-- Administration, santé, éducation : 14,0 % | médiane 20,2 % -->
    <text x="24" y="428" font-family="Geist" font-size="14" fill="${INK}">Administration, santé</text>
    <text x="336" y="428" font-family="GeistMono" font-size="12" fill="${INK_SUBTLE}" text-anchor="end">14,0 %</text>
    <rect x="24" y="436" width="312" height="6" fill="${PAPER_DEEP}"/>
    <rect x="24" y="436" width="73" height="6" fill="${ACCENT}"/>
    <line x1="105" y1="432" x2="105" y2="446" stroke="${MEDIAN}" stroke-width="2"/>
    <circle cx="105" cy="432" r="4" fill="${MEDIAN}"/>
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
