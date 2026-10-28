# Messi vs Ronaldo

Tableau de bord qui compare les buts en carrière, le palmarès et la course aux 1 000 buts de Lionel Messi et Cristiano Ronaldo.

## Comment le site se met à jour

1. Toutes les heures, l'Action GitHub `.github/workflows/update.yml` lance `scripts/update.mjs`.
2. Le script lit les données publiques d'ESPN (sans compte ni clé) pour Inter Miami, Al-Nassr et le Portugal : résultats, statistiques des joueurs par match et calendrier.
3. Pour chaque nouveau match terminé, il ajoute les buts de Messi ou de Ronaldo au total dans `data.json`, met à jour la carte « Dernier match » et le prochain match, puis enregistre le fichier.
4. La page relit `data.json` toutes les minutes. Quand un total augmente, le chiffre s'anime et le bandeau « BUT ! » s'affiche.

Les matchs amicaux ne sont pas comptés. Un but apparaît sur le site environ 1 heure après la fin du match.

## Corriger un total à la main

Onglet *Actions → Mise à jour des buts → Run workflow*, puis remplis les deux champs (Messi et Ronaldo) avec les bons totaux.

## Mettre le robot en pause

Onglet *Actions → Mise à jour des buts*, menu « ⋯ » en haut à droite → *Disable workflow*. *Enable workflow* le relance.

## Limites

- Les données d'ESPN ne sont pas une API officielle : ESPN peut les modifier sans prévenir. Si le robot échoue, GitHub envoie un e-mail avec la cause.
- ESPN ne donne pas les minutes jouées ni la note du joueur ; la carte « Dernier match » affiche buts, passes décisives, tirs, tirs cadrés, statut (titulaire ou entré en jeu), fautes subies, hors-jeu et cartons.
- Les statistiques secondaires (Ligue des champions, coups francs, palmarès) sont fixes dans `index.html`.
