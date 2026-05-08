# Spec v2 — Refonte du sélecteur de scope géographique (HISTORIQUE)

> **⚠️ Document historique conservé pour traçabilité.** Cette spec a été
> implémentée puis dépassée par l'évolution du produit (ajout de l'onglet
> « Plusieurs communes », bullet charts, bar-in-cell, etc.). L'état actuel
> de référence est le `README.md` à la racine.

**Statut** : implémentée, conservée pour historique.
**Auteur** : équipe POC, après revues croisées (statisticien Insee, UX designer, directeur artistique).
**Périmètre** : sélecteur de scope, mécanique d'auto-recompute, traitement visuel cards et header.

---

## 1. Objectif

Remplacer le `<select>` actuel + champ rayon « parfois visible » par un sélecteur de scope explicite, mobile-first, avec **un seul mode actif visuellement à la fois**, **auto-recompute** au changement, et **rappel persistant du scope appliqué** dans les résultats.

## 2. Problème observé sur la v1

| | v1 actuelle | Problème |
|---|---|---|
| Sélecteur | `<select>` 3 options + input rayon dans la même grille | L'utilisateur ne voit pas immédiatement quel mode est actif. Le champ rayon disparaît / réapparaît au changement, source de doute. |
| Réactivité | Le bouton « Analyser » re-déclenche tout | Si l'utilisateur change le scope **après** avoir analysé, les résultats restent figés et faux. Bug critique signalé en revue UX. |
| Rappel | Aucun | L'utilisateur scrolle vers la table et oublie quel filtre a produit le top-10. |
| Granularité | National / même département / rayon km | Pas de niveau **régional** ni de possibilité de **choisir** un département/région différent de celui de la cible. |

## 3. Nouveau modèle

### 3.1 Modes (4 options, exclusives)

| Libellé UI | Mobile (≤ 360 px) | Comportement |
|---|---|---|
| **Toute la France** | « France entière » | Aucun filtre géographique dur ; les filtres pop ±25 % et coverage ≥ 95 % restent actifs. |
| **Même région** | « Région » | Filtre `commune.codeRegion === target.codeRegion` par défaut ; override possible. |
| **Même département** | « Département » | Filtre `commune.dept === target.dept` par défaut ; override possible. |
| **Autour de la commune** | « Autour » | Filtre `haversine ≤ rayon`, rayon configurable 5–500 km, default 50. |

Tous mutuellement exclusifs (radio group).

### 3.2 Sous-champ contextuel

Un seul sous-champ visible à la fois, **immédiatement sous la rangée de pills**, formant un bloc visuel teinté commun avec la pill active :

| Mode | Sous-champ |
|---|---|
| Toute la France | aucun |
| Même région | `<select>` 18 régions (métropole + DROM), default = région cible |
| Même département | `<select>` 101 départements, default = département cible |
| Autour de la commune | `<input type="number">` km + compteur live « ~430 communes dans ce rayon » |

Au-dessus du sous-champ, une **ligne de contexte cible toujours affichée** (même après override) :
> « Romans-sur-Isère est en **Drôme** · **Auvergne-Rhône-Alpes** »

Override : si l'utilisateur change le dropdown, le label de la pill bascule de « **Même** région » à « **Région choisie** » (signal visuel implicite).

### 3.3 Auto-recompute

- 1ʳᵉ analyse : déclenchée par le clic « Analyser » (commune choisie ⇒ bouton activé).
- Après la 1ʳᵉ analyse, **tout changement** de scope (mode, sous-champ, rayon) **recompute en direct** sans clic. Animation : fondu de 200 ms sur les indicateurs et le tableau pour signaler le rafraîchissement.
- Le bouton « Analyser » reste utile pour relancer si la commune change.

### 3.4 Rappel du scope dans les résultats

Le scope appliqué est **rappelé** à deux endroits :

1. **Card cible — `target-meta`** (sous le titre `H2`) :
   > « Romans-sur-Isère (26281) · Drôme · Auvergne-Rhône-Alpes · 33 464 habitants · n = 47 communes comparables »

2. **Card « Communes comparables » — `<h2>` enrichi** :
   > « Communes comparables — **Région Auvergne-Rhône-Alpes** · n = 47 »

Pas de chip flottant, pas de bandeau pleine largeur teinté.

## 4. États

```
                      ┌─ commune non choisie ───────────────────┐
                      │ Bouton « Analyser » désactivé            │
                      │ Hint : « Choisis une commune »           │
                      └──────────────────────────────────────────┘
                                       │ user picks commune
                                       ▼
                      ┌─ commune choisie, jamais analysée ───────┐
                      │ Bouton « Analyser » activé               │
                      │ Hint : « Choisis un scope puis Analyser »│
                      └──────────────────────────────────────────┘
                                       │ user clicks Analyser
                                       ▼
                      ┌─ analyse affichée ───────────────────────┐
                      │ Résultats visibles, scope auto-recompute │
                      └──────────────────────────────────────────┘
                                       │ user changes commune
                                       ▼
                      ┌─ commune changée, résultats stale ───────┐
                      │ Résultats grisés (opacity 0.5)           │
                      │ Bouton « Analyser » re-activé            │
                      └──────────────────────────────────────────┘
```

## 5. Garde-fous (rappel des contrats matching v1.5)

- Plancher pop cible **2 000 hab** ⇒ `reason = 'pop_floor'`, message bloquant.
- Bande population **[target/1.25 ; target × 1.25]** ratio.
- `sectorialCoverage ≥ 95 %` filtre dur sur les candidats.
- Minimum **5 comparables** sinon `reason = 'too_few'`.
- Top-10 max.

Ces garde-fous **ne changent pas** en v2.

## 6. Contrats des modules

### `matching.findComparables(target, all, opts)`

```ts
opts: {
  scope: 'national' | 'region' | 'departement' | 'distance',
  scopeValue?: string | number  // codeRegion (string), codeDept (string), rayon en km (number)
}

return: {
  reason: 'ok' | 'pop_floor' | 'too_few',
  candidates: Array<{ commune, score, sizeDist, sectorDist, distanceKm }>
}
```

### `insee-api.pullAll`

Le record commune gagne le champ `codeRegion: string` (depuis `geo.api.gouv.fr/communes?fields=...,codeRegion`).
Au boot, `loadFromCache()` charge en plus la liste des **régions** (`/regions`) et **départements** (`/departements`) ; ces deux listes sont mises en cache IndexedDB sous les clés `meta.regions` et `meta.departements`.

### `ui.js`

Nouvelles fonctions :
- `setupScopeRadio(opts)` — wires le radio chip group + sous-champs conditionnels
- `renderScopeContext(target)` — ligne de contexte cible
- `renderScopeBadge(scope, target, n)` — enrichit `target-meta` et le `<h2>` comparables
- `renderRayonCount(n)` — compteur live sous le rayon

### `app.js`

- State `state.scope = { kind: 'national' | 'region' | 'departement' | 'distance', value: ... }`
- État initial : `kind: 'departement'`, `value: target.dept` quand commune choisie (default raisonnable)
- Listener `change` sur le radio group + sous-champs ⇒ si `state.selected && state.lastAnalyzed`, recompute immédiat

## 7. Visual

### 7.1 Segmented control (chips)

```css
.scope-segments {
  display: flex; flex-wrap: wrap;
  gap: 4px; padding: 4px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 4px;
}
.scope-segment {
  flex: 1 1 auto; min-height: 44px;
  padding: 0.6rem 0.9rem;
  background: transparent; border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer; font-size: 0.9rem;
  color: var(--color-text);
}
.scope-segment[aria-pressed="true"] {
  background: #eef2fb;          /* tinted, NOT solid primary */
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 600;
}
@media (max-width: 360px) {
  .scope-segment { flex-basis: calc(50% - 4px); }  /* wrap 2×2 */
}
```

Le **bouton « Analyser » garde son fond plein primary** : un seul CTA fort par section (recommandation DA).

### 7.2 Bloc contextualisé

```css
.scope-context {
  background: #eef2fb;
  border-radius: 0 0 4px 4px;
  padding: var(--space-md);
  margin-top: -1px;  /* recolle au segmented control */
}
.scope-context-cible { font-size: 0.85rem; color: var(--color-muted); margin-bottom: var(--space-sm); }
.scope-context-cible strong { color: var(--color-text); font-weight: 600; }
```

### 7.3 Reset cards (recommandation DA)

| Avant | Après |
|---|---|
| `box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 2px 4px rgba(0,0,0,.04)` | aucune ombre, juste `border: 1px solid var(--color-border)` |
| `border-radius: 8px` | `border-radius: 4px` |
| Header bandeau bleu plein | + filet rouge République `#e1000f` 3 px en haut |
| Indicateurs `font-family: system-ui` | + `font-variant-numeric: tabular-nums` sur `.indicator-value` et cellules `.num` |

### 7.4 Mobile breakpoint

- ≤ 360 px : pills wrap en 2×2.
- Le sous-champ reste full-width.
- Le compteur live rayon passe sous l'input (au lieu de à côté).

## 8. Critères d'acceptation

- [ ] 4 modes accessibles via radio (clavier : flèches G/D, espace pour activer, tab pour quitter).
- [ ] Pill active visuellement distincte ; aucun autre élément n'est en couleur primary à l'écran simultanément.
- [ ] Sous-champ unique visible à la fois ; `<select>` régions/départements pré-rempli avec la cible.
- [ ] Override autorisé ; le label « Même X » devient « X choisi(e) ».
- [ ] Auto-recompute après 1ʳᵉ analyse, sans clic, en < 300 ms.
- [ ] `target-meta` et `<h2>` comparables rappellent le scope appliqué.
- [ ] Mobile 320 px : tout reste cliquable, rien ne déborde.
- [ ] DROM (Mayotte, Réunion, Guyane, Martinique, Guadeloupe) sélectionnables.
- [ ] CSV export inclut le scope (ligne d'entête : `[scope: Région Auvergne-Rhône-Alpes (84)]`).
- [ ] Compteur live rayon : se met à jour à chaque keystroke avec un debounce 250 ms.

## 9. Hors-scope v2

- Filtrage par EPCI (intercommunalité) — nécessite un dataset additionnel
- Filtrage par tranche d'unité urbaine — idem
- Cartographie choroplèthe — superflu pour la question utilisateur
- Multi-cibles (comparer 2-3 communes côte à côte)
- Permaliens (URL avec scope encodé) — utile mais hors POC

## 10. Risques

- **Auto-recompute** sur dataset 34 k records : `findComparables` est O(n) ⇒ ~50 ms sur desktop, possiblement 150-200 ms sur mobile bas de gamme. Acceptable, surveiller.
- **Listes région/département** : si `geo.api.gouv.fr` ne répond pas au boot, on fallback sur des listes en dur (18 régions + 101 départements ne changent pas souvent).
- **Override de région éloignée** (Mayotte vs Bretagne) : la pop ±25 % et le coverage ≥ 95 % filtrent toujours, donc cohérence statistique préservée.
