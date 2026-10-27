# Messi vs Ronaldo

Tableau de bord qui compare les buts en carrière, le palmarès et la course aux 1 000 buts de Lionel Messi et Cristiano Ronaldo.

## Comment le site se met à jour

1. Toutes les heures, l'Action GitHub `.github/workflows/update.yml` lance `scripts/update.mjs`.
2. Le script demande à [API-Football](https://www.api-football.com) les derniers matchs d'Inter Miami, d'Al-Nassr et du Portugal.
3. Pour chaque nouveau match terminé, il ajoute les buts de Messi ou de Ronaldo au total dans `data.json`, puis enregistre le fichier.
4. La page relit `data.json` toutes les minutes. Quand un total augmente, le chiffre s'anime et le bandeau « BUT ! » s'affiche.

Les matchs amicaux ne sont pas comptés. Un but apparaît sur le site environ 1 heure après la fin du match (le temps que l'Action passe et que les statistiques du match soient publiées).

## Mise en route (une seule fois)

1. **Clé API** : crée un compte gratuit sur [dashboard.api-football.com](https://dashboard.api-football.com) et copie ta clé.
2. **Secret GitHub** : dans le dépôt, va dans *Settings → Secrets and variables → Actions → New repository secret*. Nom : `API_FOOTBALL_KEY`, valeur : ta clé.
3. **GitHub Pages** : *Settings → Pages*, source *Deploy from a branch*, branche `main`, dossier `/ (root)`.
4. **Premier test** : onglet *Actions → Mise à jour des buts → Run workflow*. Le journal affiche chaque appel et le quota restant.

## Corriger un total à la main

Onglet *Actions → Mise à jour des buts → Run workflow*, puis remplis les deux champs (Messi et Ronaldo) avec les bons totaux.

## Limites

- L'offre gratuite d'API-Football autorise 100 appels par jour. Le robot en utilise environ 75.
- Si l'offre gratuite ne donne pas accès à la saison en cours, le journal de l'Action affiche l'erreur renvoyée par API-Football. Il faudra alors une offre payante.
- Les statistiques secondaires (Ligue des champions, coups francs, palmarès) sont fixes dans `index.html` et ne sont pas mises à jour par le robot.
