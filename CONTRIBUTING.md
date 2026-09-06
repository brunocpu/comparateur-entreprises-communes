# Contribuer

Projet personnel ouvert aux PR — corrections de bugs, améliorations méthodologiques, traduction d'un texte mal formulé. Toute contribution est bienvenue tant qu'elle reste alignée avec le périmètre (comparaison de communes françaises sur la démographie d'entreprises Insee Side).

## Prérequis

- **Node ≥ 18** pour les scripts (tests, génération de l'artefact, build de l'image OG).
- Un serveur HTTP local pour le dev navigateur (le service worker exige `https` ou `localhost`).

## Lancement local

```bash
# Au choix
python -m http.server 8000
# ou
npx serve .
```

Puis [http://localhost:8000](http://localhost:8000).

Premier chargement : si `data/communes-2024.json` est présent dans le dépôt, il est récupéré et indexé en IndexedDB en quelques secondes. Sinon, fallback automatique vers le pull live de l'API Insee Melodi (~80 MB, 1 à 2 min).

## Tests

Deux niveaux :

```bash
# Unitaires offline — pas de réseau, ~100 ms, à lancer à chaque modif d'un helper.
npm test

# Bout-en-bout réseau — pull complet API Insee + matching, ~35 s.
npm run test:e2e
```

Les unitaires couvrent les helpers pures : `quantile`, `cosine`, `haversine`,
`relDelta`, `summarizeComparables`, `findComparables`, `parseCsvLine`,
`headerIndex`, `normalize`, `escapeHtml`, `fmtInt`/`fmtDec1`/`fmtPct`. Voir
`test/units.mjs`.

Le harness e2e (`test-pull.mjs`) vérifie l'extraction réelle depuis l'API
Insee, à utiliser quand on touche à la pipeline réseau (`insee-api.js`,
`zip-csv.js`).

## Conventions

- Commits en **français**, mono-auteur (pas de trailer `Co-Authored-By:`).
- Messages descriptifs : décrire le **pourquoi**, pas seulement le quoi.
- Documenter en commentaire les choix non évidents (la consigne s'applique au code aussi : commentaires `WHY`, pas `WHAT`).
- Pas de surcouches superflues (pas de TypeScript, pas de bundler, pas de framework — la simplicité est le contrat).

## Périmètre des PR

Acceptées :
- Corrections de bug ou de comportement inattendu (joindre une étape de reproduction).
- Améliorations d'accessibilité (RGAA / WCAG AA visé).
- Optimisations vérifiées par mesure (Lighthouse, pa11y, profil mémoire).
- Améliorations de la méthodologie statistique avec justification chiffrée.

Hors périmètre :
- Changement de stack technique (ajout TypeScript, React, framework CSS…).
- Ajout d'analytics, cookies, services tiers.
- Élargissement à d'autres jeux de données qui demanderait une refonte du modèle commune.

## Discussion

Issues ouvertes pour les bugs et propositions. Pour signaler une vulnérabilité, voir [SECURITY.md](./SECURITY.md).
