# Politique de sécurité

## Versions supportées

Seule la branche `main` est maintenue. Les releases taguées (ex. `v1.0.0`) sont des points fixes de communication et ne reçoivent pas de patchs rétroactifs.

## Signaler une vulnérabilité

Application web statique sans backend, sans auth, sans données utilisateur transmises. Surface d'attaque limitée à : XSS via injection dans le DOM, fuite via les URL d'API tierces appelées (`api.insee.fr`, `geo.api.gouv.fr`), exécution de code via une dépendance npm de build compromise.

Signalement privé recommandé via [GitHub Security Advisories](https://github.com/brunocpu/comparateur-entreprises-communes/security/advisories/new) — canal intégré, pas de divulgation publique avant correctif.

Délai de réponse cible : 7 jours pour accusé de réception, correctif sous 30 jours pour les vulnérabilités à risque réel.
