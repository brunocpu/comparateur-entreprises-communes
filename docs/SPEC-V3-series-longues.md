# Spec V3 — séries longues et fenêtre d'observation

État : proposée · 6 septembre 2026

## Objet

Rendre visible l'évolution récente d'une commune, aujourd'hui masquée par un
indicateur unique portant sur dix ans.

Romans-sur-Isère affiche **+33,8 %** en tête de fiche. La commune recule
pourtant depuis deux ans : 2 944 unités légales en 2022, 2 932 en 2023,
2 883 en 2024. L'indicateur n'est pas faux, il est muet sur le présent. Selon
la fenêtre retenue, l'outil affirme une commune en forte expansion
(+33,8 % sur dix ans) ou à l'arrêt (+0,2 % sur trois ans).

La V3 ajoute donc deux choses : une **fenêtre d'observation réglable**, qui
pilote l'indicateur de croissance et l'écart aux comparables, et une **courbe
visible sans clic**, qui donne la forme de la trajectoire quel que soit le
réglage.

## Décisions arrêtées

| Décision | Retenu |
|---|---|
| Portée de la fenêtre | Pilote la comparaison, pas seulement un écran d'exploration |
| Valeur par défaut | 10 ans, comme aujourd'hui |
| Fenêtres proposées | 10, 5 et 3 ans |
| Séries embarquées | Stocks **et** créations |
| Emplacement des séries | Dans l'artefact pré-bundlé, pas en requête à la demande |
| Courbe | Visible sans clic, sous le chiffre |
| Écran dédié | Non — un panneau dépliant sous la fiche |

Le choix d'embarquer les séries plutôt que de les demander à l'Insee au clic
tient à la fenêtre réglable : recalculer la médiane du groupe sur une autre
période suppose de disposer des séries **des comparables**, pas seulement de
la cible. Une requête par commune coûterait onze appels par analyse et
romprait le fonctionnement hors ligne.

## Données

### Schéma de l'artefact

Deux tableaux d'entiers remplacent quatre champs devenus dérivables.

| Champ | Avant | Après |
|---|---|---|
| `stock` | entier (2024) | supprimé — dérivé de `stockSeries` |
| `stockBaseline` | entier (2014) | supprimé — dérivé de `stockSeries` |
| `growth10y` | réel ou `null` | supprimé — dérivé de `stockSeries` |
| `creations` | entier (2025) | supprimé — dérivé de `creationsSeries` |
| `stockSeries` | — | 11 entiers, 2014 → 2024 |
| `creationsSeries` | — | 14 entiers, 2012 → 2025 |

Les deux séries portent sur des plages différentes parce que les jeux Insee ne
couvrent pas les mêmes années : `DS_SIDE_STOCKS_COM` va de 2014 à 2024,
`DS_SIDE_CREA_ENT_COM` de 2012 à 2025. Chaque indicateur utilise la donnée la
plus fraîche dont il dispose, comme c'est déjà le cas aujourd'hui.

Une valeur manquante est représentée par `null` — 189 communes n'ont pas de
stock 2014, essentiellement des communes nouvelles dont le code actuel
n'existait pas à l'époque.

### Coût, mesuré

| | brut | gzip, sur le fil |
|---|---|---|
| Artefact actuel | 13,32 Mo | 2,45 Mo |
| Avec les deux séries | 14,98 Mo | 3,53 Mo |
| Après suppression des quatre champs dérivés | — | **3,13 Mo** |

Soit **+0,68 Mo net**, mesuré sur les 34 002 communes. Le plafond de bande
passante GitHub Pages passe d'environ 38 000 à 32 000 nouveaux visiteurs par
mois : sans effet pratique, l'artefact n'étant téléchargé qu'une fois par
navigateur.

### Version des données

`DATA_VERSION` encode aujourd'hui quatre années ponctuelles. Elle doit encoder
les plages, faute de quoi l'ajout d'un millésime en fin de série ne
déclencherait pas la réinitialisation des caches :

```
DATA_VERSION = `${POP_YEAR}-s${STOCK_START}_${STOCK_END}-c${CREA_START}_${CREA_END}`
             = "2023-s2014_2024-c2012_2025"
```

Le passage à cette forme invalide les données locales de tous les visiteurs et
déclenche la reprise de l'artefact. Le mécanisme est en place et vérifié.

## Calculs

### Croissance

```
croissance(n) = (stockSeries[fin] − stockSeries[fin − n]) / stockSeries[fin − n]
```

pour n ∈ {10, 5, 3}, la borne haute étant toujours la dernière année de la
série. La médiane du groupe de comparables est recalculée sur la même fenêtre.

`null` si l'une des deux bornes est absente, ou si la base est inférieure au
plancher.

### Plancher de bruit

**Le plancher reste à 20 unités légales, identique pour les trois fenêtres.**

L'hypothèse de départ était qu'une fenêtre courte exigerait un plancher plus
haut, une variation d'une unité pesant davantage sur trois ans que sur dix.
La mesure la contredit pour le parcours qui compte :

| | n | base médiane | sous 20 UL | sous 50 | sous 100 |
|---|---|---|---|---|---|
| Comparables possibles (pop ≥ 1 600) | 6 722 | 266 | 3 | 13 | 348 |
| Mode « plusieurs communes » (toutes) | 34 002 | — | 12 031 | 21 223 | — |

Le plancher démographique de 2 000 habitants pour la cible et la bande de
population à ±25 % font que toute commune effectivement comparée a une base de
plusieurs centaines d'unités légales. À une base de 266, une unité légale vaut
0,4 point de pourcentage ; à la base du premier décile, 117, elle en vaut 0,9.
Relever le plancher n'améliorerait donc pas la comparaison, et amputerait le
mode libre : à 50, la croissance disparaîtrait pour 21 223 communes sur 34 002.

Pour mémoire, la couverture par fenêtre au plancher actuel : 17 405 communes
à 10 ans, 18 989 à 5 ans, 20 308 à 3 ans — la fenêtre courte en retient
davantage, la base 2021 étant plus élevée que la base 2014.

### Créations

L'indicateur passe de la dernière année à la **moyenne sur la fenêtre**, prise
sur les n dernières années de `creationsSeries`. Le motif est le bruit : Romans
oscille entre 457 et 581 créations sur quatre ans, et une année isolée n'a pas
de sens comme indicateur de niveau.

### Densité

Inchangée. La population n'a qu'un millésime, aucune série n'est possible.

## Interface

**Sélecteur de période.** Un segmenté 10 / 5 / 3 ans à côté du sélecteur de
périmètre, qui utilise déjà ce composant (`ui.setupScopeRadio`). Changer la
fenêtre relance le calcul sans nouvelle analyse.

**Libellés dynamiques.** « Croissance 2021→2024 » dans la tuile, l'en-tête de
tableau et la colonne d'export. « Créations / an (moyenne 2023-2025) » pour
l'indicateur de créations.

Les deux libellés relèvent de la même fenêtre de trois ans sans couvrir les
mêmes années civiles, les séries ne s'arrêtant pas à la même date. L'écart est
assumé : les libellés portent les années réelles plutôt qu'une durée abstraite,
et chaque indicateur exploite la donnée la plus fraîche dont il dispose. Les
deux quantités sont d'ailleurs de nature différente — une variation d'un côté,
un niveau moyen de l'autre.

**Courbe.** Sous les chiffres de croissance et de créations, une courbe de la
série complète — onze points, quatorze pour les créations — avec la fenêtre
active mise en évidence. La série entière reste visible quel que soit le
réglage : c'est ce qui rend le retournement lisible sans manipulation.

**Panneau détaillé.** Un clic sur l'une des deux tuiles déplie sous la fiche un
tableau année par année et la courbe de la commune superposée à la médiane du
groupe de comparables.

## Ce qui ne change pas

La sélection des comparables : population à ±25 %, profil sectoriel A10 2024,
géographie en mode « Autour ». La croissance n'entre pas dans le score et la
fenêtre ne modifie donc pas la composition du groupe — seulement la valeur
comparée, pour la cible et pour ses pairs.

L'avertissement en dessous de cinq comparables, qui remplit déjà son office.

Le périmètre par défaut, « Même département ».

## Impacts sur le code

| Fichier | Nature |
|---|---|
| `js/insee-api.js` | Conserver toutes les années au lieu de deux bornes ; produire les deux séries ; `DATA_VERSION` par plages |
| `js/app.js` | Dériver `stock`, `density`, `growth`, `creations` à la fenêtre active, au chargement et à chaque changement |
| `js/matching.js` | Renommer `growth10y` en `growth` ; aucune modification de la sélection |
| `js/ui.js` | Sélecteur de fenêtre, libellés dynamiques, courbe, panneau dépliant |
| `js/export.js` | En-têtes de colonnes suivant la fenêtre |
| `index.html`, `css/styles.css` | Segmenté, courbe, panneau |
| `scripts/build-data.mjs` | Écrit les séries |
| `scripts/check-millesimes.mjs` | Vérifie chaque borne de fenêtre contre la source |

## Vérification

Unitaires, hors ligne : croissance sur séries synthétiques aux trois fenêtres,
bornes manquantes, plancher, moyennes de créations, médianes de groupe
recalculées.

Bout en bout : `check-millesimes` étendu, confrontant les bornes de chaque
fenêtre aux valeurs publiées par l'Insee.

Navigateur, selon la recette locale du dépôt : premier chargement, visiteur
d'un millésime antérieur, changement de fenêtre avec recalcul des écarts,
lecture de la courbe et du panneau, mode hors ligne.

## Risques

**Comparabilité dans le temps.** Une fenêtre de dix ans traverse la
généralisation du micro-entrepreneuriat et le passage au guichet unique en
2023. Le taux additionne une évolution économique et un changement de régime
d'enregistrement. La note méthodologique le signale déjà ; la V3 rend le
problème plus visible en offrant des fenêtres plus courtes, moins exposées.

**Charge de la fiche.** Deux courbes et un panneau s'ajoutent à une zone déjà
dense. Si l'encombrement l'emporte, la courbe des créations est le premier
élément à retirer : c'est la moyenne sur la fenêtre qui corrige son bruit, pas
son tracé.

**Reprise généralisée de l'artefact.** Le changement de `DATA_VERSION` fait
retélécharger 3,13 Mo à chaque visiteur déjà venu. C'est le comportement voulu
et il est vérifié, mais il concerne tout le monde en une fois.
