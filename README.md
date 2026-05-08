# Comparateur d'entreprises — communes françaises

Application web statique qui compare les **~34 000 communes françaises** selon leur démographie d'entreprises (stocks d'unités légales, créations annuelles, profil sectoriel) à partir des données ouvertes Insee.

Deux modes d'usage :

- **Une commune** — saisis une commune, l'app calcule une sélection de 10 communes comparables (taille démographique et profil sectoriel similaires) et restitue le positionnement de la cible : indicateurs cardinaux, mini bullet-charts par indicateur, profil sectoriel A10 avec marqueur médian, tableau des comparables avec barres de fond proportionnelles, quartiles Q1 / médiane / Q3.
- **Plusieurs communes** — comparaison libre de 2 à 10 communes au choix, sans contrainte de taille ni de profil. Pour confronter des villes voisines, ou des communes à profils contrastés.

---

## Fonctionnalités principales

### Onglet « Une commune »

- Autocomplete sur 34 002 communes (par nom ou code Insee), reconnaissance des accents.
- 4 indicateurs cardinaux : **Entreprises actives**, **Entreprises pour 1 000 habitants**, **Croissance 2014→2023**, **Créations d'entreprises annuelles**.
- Sous chaque chiffre : un **bullet chart** SVG montrant Q1—Q3 des comparables + médiane + position de la cible.
- Profil sectoriel A10 hors agriculture (9 secteurs publiés à l'échelle communale par l'Insee) en barres horizontales, marqueur médian rouille distinct.
- Tableau des comparables avec **bar-in-cell** (barre de fond proportionnelle dans chaque cellule numérique) et lignes Q1 / médiane / Q3 en pied de tableau.
- Sélecteur de zone à 4 modes : **Toute la France**, **Même région**, **Même département**, **Autour de la commune** (rayon configurable 5–500 km).
- Possibilité d'**override** la région ou le département (ex. comparer Romans-sur-Isère à des communes du 76 Seine-Maritime).
- **Auto-recompute** au changement de zone dès qu'une commune est sélectionnée, avec debounce 200 ms.
- **Bandeau persistant** au défilement : nom de la commune cible + zone active + lien « Changer ↑ ».
- Avertissement automatique « sélection limitée » si moins de 5 comparables, avec suggestion d'élargir la strate.
- Avertissement « répartition sectorielle partielle » si l'Insee a masqué trop de cellules au titre du secret statistique.
- **Export CSV** (UTF-8 BOM) et impression PDF via le navigateur.

### Onglet « Plusieurs communes »

- Comparaison libre, indépendante des filtres de zone et de la sélection automatique.
- Ajout de communes par autocomplete, suppression par chip × .
- Mêmes colonnes et bar-in-cell que l'onglet « Une commune ».
- Limite 10 communes.
- Export CSV et impression PDF une fois deux communes ajoutées (mise en page A4 paysage : chips + tableau).

### Méthodologie

Filtres durs sur les comparables (onglet « Une commune ») :

- Plancher de population cible **2 000 habitants**. Sous ce seuil, un ou deux sièges sociaux suffisent à déformer le total des unités légales, et l'Insee masque la majeure partie du profil sectoriel au titre du secret statistique.
- Bande de population **[cible / 1,25 ; cible × 1,25]**. Tolérance de ±25 % en échelle multiplicative : une cible de 5 000 habitants cherche entre 4 000 et 6 250 habitants.
- **Couverture sectorielle ≥ 95 %** sur les candidats. Exclut les communes dont le profil A10 publié est trop lacunaire pour porter une comparaison.
- 0 comparable : message d'erreur explicite avec suggestion d'élargissement de la zone.
- 1 à 4 comparables : analyse affichée avec encadré « sélection limitée », médiane signalée comme indicative.

Score de proximité (top 10) :

| Composant | Pondération mode rayon | Pondération autres modes | Mesure |
|---|---|---|---|
| Écart de population | 30 % | 33 % | `\|cible − candidate\| / cible` |
| Distance sectorielle | 60 % | 67 % | `1 − cosinus(profil_A10_cible, profil_A10_candidate)` |
| Distance géographique | 10 % | — | haversine, normalisée par le rayon |

---

## Lancement local

Pas de build, pas de backend.

```bash
# Serveur statique local (au choix)
python -m http.server 8000
# ou
npx serve .
```

Puis ouvrir <http://localhost:8000>.

> Le service worker exige une origine HTTPS ou `localhost` — ouvrir directement le fichier `index.html` (`file://`) ne fonctionne pas.

### Premier lancement

Chemin par défaut : l'app récupère un **artefact pré-bundlé** `data/communes-2023.json` (~12 MB JSON brut, **~2,3 MB sur le wire** après gzip) hébergé sur GitHub Pages, puis l'indexe en IndexedDB. Compter **~3 à 5 s en Wi-Fi**.

Cet artefact est régénéré annuellement par le workflow GitHub Actions `.github/workflows/build-data.yml` (cron 15 novembre, ou déclenchement manuel) qui exécute `scripts/build-data.mjs` — le même pipeline que le téléchargement complet, mais côté CI.

Chemin de secours : si l'artefact est indisponible (404, première mise en place, etc.), l'app affiche un bouton « Lancer le chargement » qui exécute un téléchargement complet depuis l'API Insee Melodi. Ce chemin télécharge **~67 MB de ZIP CSV** (1 à 2 min en Wi-Fi) :

| Dataset | ZIP | CSV décompressé |
|---|---|---|
| `DS_POPULATIONS_REFERENCE` | ~0.9 MB | 3.5 MB |
| `DS_SIDE_STOCKS_UL_COM` | ~22 MB | ~184 MB |
| `DS_SIDE_CREA_ENT_COM` | ~44 MB | ~250 MB |

Extraction streaming via `DecompressionStream('deflate-raw')` natif, filtrage à la volée → seuls ~5 MB persistent en IndexedDB.

Bouton « Rafraîchir les données » dans le header : lance un téléchargement complet depuis l'API Insee, en court-circuitant l'artefact. À utiliser quand l'artefact CI est en retard sur la dernière publication Insee.

---

## Tests

```bash
node test-pull.mjs
```

Lance le pull complet depuis l'API Insee, vérifie l'extraction des ~34 000 communes (Romans-sur-Isère 26281 testée bout-en-bout), valide les filtres méthodologiques, le matching scope national / régional / départemental / distance, et l'algorithme `countInRadius`.

Pré-requis : **Node ≥ 18** (utilise `fetch`, `DecompressionStream` et `TextDecoderStream` natifs, comme le navigateur).

---

## Indicateurs et sources

| Indicateur | Formule | Source Insee |
|---|---|---|
| Entreprises actives | Total unités légales actives | `DS_SIDE_STOCKS_UL_COM` (ACTIVITY=`_T`, SIDE_MEASURE=`LEGAL_UNIT`, TIME_PERIOD=2023) |
| Entreprises pour 1 000 habitants | UL × 1 000 / population municipale | + `DS_POPULATIONS_REFERENCE` (POPREF_MEASURE=`PMUN`) |
| Croissance 2014→2023 | (UL_2023 − UL_2014) / UL_2014 | `DS_SIDE_STOCKS_UL_COM`, deux millésimes |
| Créations d'entreprises annuelles | Total entreprises créées | `DS_SIDE_CREA_ENT_COM` (ACTIVITY=`_T`, LEGAL_FORM=`_T`, SIDE_MEASURE=`BURE`, TIME_PERIOD=2024) |
| Profil sectoriel A10 (hors agriculture) | 9 parts sectorielles normalisées | `DS_SIDE_STOCKS_UL_COM` (ACTIVITY ∈ {BE, FZ, GI, JZ, KZ, LZ, MN, OQ, RU} ; secteur AZ non publié à la maille communale) |
| Position vs comparables | (cible − médiane) / médiane | calculé localement |
| Couverture sectorielle | Σ A10 publiés / stock(_T) | calculé localement |
| Quartiles Q1 / Q3 | quantiles empiriques sur la sélection | calculé localement |

---

## Structure

```
index.html              page unique
manifest.json           PWA manifest
sw.js                   service worker (shell offline)
package.json            "type": "module" (Node ≥ 18 pour les tests)
test-pull.mjs           harness de test bout-en-bout
LICENSE                 MIT
README.md               ce fichier
data/
  communes-2023.json    artefact pré-bundlé (~12 MB brut, ~2,3 MB gzip),
                        régénéré annuellement par GH Action
docs/
  SPEC-V2-historique.md spec implémentée, conservée pour traçabilité
scripts/
  build-data.mjs        exécute pullAll côté Node et écrit data/*.json
.github/workflows/
  pages.yml             déploiement automatique sur GitHub Pages
  build-data.yml        régénération annuelle de l'artefact (cron)
css/styles.css          mobile-first, sans framework
                        (Fraunces + Geist via Google Fonts)
assets/icon.svg
js/
  app.js                glue, état, recherche, onglets, scope,
                        tryLoadBundledData (premier chargement rapide)
  cache.js              IndexedDB (communes + meta)
  insee-api.js          client Melodi (file/CSV) + geo.api.gouv.fr
  zip-csv.js            extracteur ZIP minimal (central directory) +
                        streaming CSV via DecompressionStream natif
  matching.js           findComparables (scope national / region /
                        departement / distance), summarizeComparables
                        (Q1, médiane, Q3), countInRadius
  ui.js                 rendu : autocomplete, indicateurs, bullet
                        charts, profil sectoriel, tableau bar-in-cell,
                        sticky banner, search summary, multi-compare
  export.js             export CSV (UTF-8 BOM, séparateur `;`)
  format.js             formattage fr-FR (Intl.NumberFormat)
```

---

## Déploiement GitHub Pages

Un workflow GitHub Actions de déploiement automatique est livré dans le repo
(`.github/workflows/pages.yml`). À chaque push sur `main`, il publie la racine
du repo sur GitHub Pages, sans build ni dépendance.

1. Pousser sur `main` du repo public.
2. Activer Pages : **Settings → Pages → Build and deployment → Source : « GitHub Actions »**
   (et non plus le mode déprécié « branch / root »).
3. Le workflow se déclenche, le déploiement prend ~1 min. L'URL
   `https://<user>.github.io/comparateur-entreprises-communes/` est servie en HTTPS,
   le service worker fonctionne.

---

## Compatibilité

- Edge / Chrome desktop, Safari iOS 15.4+, Chrome Android, Firefox 113+.
- IndexedDB requis (universel).
- `DecompressionStream('deflate-raw')` requis (Chrome 80+, Edge 80+, Firefox 113+, Safari 16.4+).
- Service worker non bloquant : l'app fonctionne sans (mode offline simplement désactivé).

---

## Accessibilité

Cible : RGAA 4.1 / WCAG 2.1 niveau AA. Audit pa11y sur la version déployée : 0 erreur.

- Skip link « Aller au contenu », focus ring rouille global avec contraste ≥ 4,5:1 sur l'ensemble des éléments interactifs.
- Onglets et radiogroup zone : pattern WAI-ARIA complet (roving tabindex, `aria-controls`, `aria-labelledby`, `role="tabpanel"`, navigation flèches).
- Annonce de fin d'analyse aux lecteurs d'écran via déplacement de focus sur le titre de la commune cible. Restitution du focus à l'input de recherche après les boutons « Modifier ↑ » / « Changer ↑ ».
- Bullet charts SVG : `aria-label` enrichi avec les valeurs réelles (cible, Q1, médiane, Q3) plutôt qu'une description générique.
- Sticky banner masqué : attribut `inert` qui retire l'élément du flux de tabulation et de l'arbre d'accessibilité (WCAG 4.1.2).
- Tooltip A21 sur les labels sectoriels : visible au focus clavier et au survol souris, refermable par Échap (WCAG 1.4.13).
- `prefers-reduced-motion` respecté côté CSS (transitions, animations) et JS (`scrollIntoView`).

Non couverts par l'audit automatique : tests utilisateurs NVDA / VoiceOver, navigation clavier exclusive sur tablette, audit RGAA manuel par un cabinet certifié.

---

## Limitations méthodologiques

- Une commune correspond à son **territoire administratif**, pas à un bassin de vie ou une aire d'attraction (notions Insee plus larges qui regroupent plusieurs communes liées par l'emploi et les déplacements).
- Population « 2023 » = millésime légal au 1<sup>er</sup> janvier 2026, construit à partir des enquêtes du recensement 2018-2022.
- Les unités légales sont rattachées à leur commune d'**implantation administrative** (siège social), pas à leur lieu d'activité opérationnelle. Effet « Paris / La Défense » : les communes-sièges sur-représentées vs les communes résidentielles sous-représentées.
- Créations 2024 incluent les **micro-entrepreneurs**.
- Croissance 2014→2023 traverse plusieurs évolutions méthodologiques Insee (refonte du répertoire des entreprises, généralisation du statut de micro-entrepreneur). Comparabilité dans le temps affectée.
- **Pas d'effectifs salariés à la maille communale** (non publiés par l'Insee).
- Profil sectoriel volontairement large (9 secteurs A10, agriculture exclue à la maille communale par l'Insee). Sur les petites communes, certaines cellules sectorielles sont occultées au titre du secret statistique.
- Arrondissements municipaux de Paris / Lyon / Marseille traités séparément (codes Insee dédiés, niveau ARM).

---

## Sources & licence

- **Données** : [Insee — Système d'information sur la démographie d'entreprises (Side)](https://www.insee.fr/fr/metadonnees/source/serie/s2120) et populations légales du Recensement de la population. Licence Ouverte version 2.0 (LOV2).
- **Référentiel géographique** : [API Découpage administratif — geo.api.gouv.fr](https://geo.api.gouv.fr/decoupage-administratif), LOV2.
- **Code source** : MIT.
- **Typographies** : Fraunces (SIL OFL), Geist Sans + Mono (SIL OFL), via Google Fonts.

---

## Vie privée

Pas d'analytics, pas de cookies, pas de tag tiers. Les requêtes sortantes vont uniquement à `api.insee.fr` (premier pull et rafraîchissements manuels), `geo.api.gouv.fr` (référentiel communes / régions / départements) et `fonts.googleapis.com` / `fonts.gstatic.com` (typographies).
