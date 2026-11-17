# Autopilote — mode autonome pour Claude Code

Tu donnes un **objectif** à Claude ; l'autopilote le fait travailler tout seul jusqu'au bout. Claude découpe l'objectif en tâches, les fait une par une, les vérifie, en ajoute quand la liste est vide, et s'arrête quand l'objectif est atteint. L'autopilote surveille ton forfait Claude (fenêtre de 5 h et semaine) pour **étaler ta consommation** au lieu de tout brûler d'un coup.

*English: an autonomous mode for Claude Code. → [README in English](README.en.md)*

## Où ça marche

- **Oui** : Claude Code, version 2.1.320 ou plus (`claude --version`, sinon `claude update`) — dans le terminal, l'onglet Code de l'application de bureau, et les extensions VS Code et JetBrains.
- **Non** : le chat de claude.ai et les applications mobiles seules (pas de plugins là-bas).
- **Le rythme du forfait** demande d'être connecté avec un abonnement Claude (Pro ou Max). Avec une clé d'API, Bedrock ou Vertex, l'autopilote marche quand même mais relance à chaque intervalle, sans regarder le forfait.
- Les plugins à code (« mods ») sont récents dans Claude Code : si le tien n'en veut pas, mets-le à jour.

## Installer

Dans une session Claude Code :

```
/plugin marketplace add skylors-prems/autopilote
/plugin install autopilote@autopilote
```

Ou en une ligne dans un terminal :

```
claude plugin marketplace add skylors-prems/autopilote && claude plugin install autopilote@autopilote
```

Dans l'application de bureau : + à côté de la zone de saisie, Plugins, Add marketplace avec `skylors-prems/autopilote`, puis Add plugin.

Tu peux aussi simplement demander à Claude : « installe le plugin autopilote depuis github skylors-prems/autopilote ».

## Démarrer sur un projet

1. Ouvre Claude Code dans le dossier de ton projet.
2. Donne l'objectif :
   ```
   /autopilote objectif une appli de notes avec recherche et export PDF
   ```
   Ça crée `AUTOPILOTE.md` (le fichier de suivi) : statut, objectif, règles, tâches, journal. Ou tape `/autopilote` et écris l'objectif dans le panneau.
3. Lance : `/autopilote on`.

À la première relance, Claude découpe l'objectif en 3 à 8 tâches. Ensuite, à chaque relance : la première tâche non cochée, faite et vérifiée, cochée, une ligne au journal, un commit local si le projet utilise git. Quand il n'y a plus de tâches mais que l'objectif n'est pas atteint, il en ajoute. Quand c'est fini, il écrit « Statut : terminé » et l'autopilote s'arrête tout seul.

Tu peux modifier `AUTOPILOTE.md` à la main quand tu veux : réordonner, ajouter ou barrer des tâches. Claude ne pose pas de questions (personne ne serait là pour répondre) : il tranche et note ce qu'il faut que tu valides sous « À valider par l'utilisateur ». S'il est vraiment bloqué, il écrit « Statut : bloqué » et l'autopilote se met en pause.

Tu as déjà ta propre liste de travail (un `TODO.md`, un `ETAT.md` avec des cases à cocher) ? Mets son nom dans le réglage « Fichier de suivi » : l'autopilote compte ses cases `- [ ]` / `- [x]`.

## Commandes

| Commande | Effet |
|---|---|
| `/autopilote` | ouvre le panneau (projet, forfait, réglages, journal) |
| `/autopilote objectif <texte>` | crée le fichier de suivi, ou change l'objectif |
| `/autopilote on` | démarre |
| `/autopilote off` | met en pause |
| `/autopilote maintenant` | relance Claude tout de suite |
| `/autopilote etat` | résumé en une ligne |

La barre d'état affiche « Autopilote actif · 3/7 · +1,2 pts · prochain 22 h 48 » tant qu'il tourne.

## Réglages

Tout se règle dans le panneau, ou dans `/config` :

| Réglage | Par défaut | Rôle |
|---|---|---|
| Intervalle (minutes) | 15 | fréquence des vérifications |
| Fichier de suivi | `AUTOPILOTE.md` | objectif, tâches et journal |
| Consignes en plus | (vide) | ajoutées à chaque relance, ex. « fais un push après chaque tâche » |
| Lecture du forfait | anthropic | `anthropic` : ton abonnement Claude ; `adresse` : ton propre fichier JSON ; `aucune` : ne rien lire (relance à chaque intervalle) |
| Adresse du forfait | (vide) | avec `adresse` : une URL https |
| Rythme | semaine | `semaine` : étaler sur la semaine ; `5h` : sur chaque fenêtre de 5 h ; `aucun` : relancer à chaque fois |
| Objectif de la semaine | 90 % | arrêt une fois atteint |
| Plafond de 5 h | 95 % | au-dessus, attente de la remise à zéro |
| Avance tolérée | 3 points | si tu consommes plus vite que prévu, la relance est sautée |
| Démarrer à chaque session | non | lancer l'autopilote dès l'ouverture |

## Lire le forfait autrement

Par défaut, le forfait est lu sur une adresse d'Anthropic qui n'est pas documentée officiellement. Tu peux :

- **la couper** : réglage « Lecture du forfait » sur `aucune`. Plus aucune requête ; l'autopilote relance à chaque intervalle.
- **utiliser ta propre adresse** : `adresse`, avec une URL https qui renvoie ce JSON (pourcentages de 0 à 100, dates ISO) :
  ```json
  { "five_hour": { "utilization": 42, "resets_at": "2026-11-18T03:00:00Z" },
    "seven_day": { "utilization": 37, "resets_at": "2026-11-21T19:00:00Z" } }
  ```
  Ta connexion Claude n'y est **jamais** envoyée (Claude Code ne la joint de toute façon qu'aux serveurs d'Anthropic).

## Vie privée et sécurité

- **Ta connexion** : pour lire le forfait, l'autopilote demande à Claude Code une poignée de connexion et l'envoie **uniquement** à `api.anthropic.com`. Le jeton reste chez Claude Code ; le plugin ne le voit jamais et ne l'écrit nulle part.
- **Tes données** : la consigne envoyée à Claude à chaque relance lui interdit d'écrire des données personnelles (noms, adresses, e-mails, mots de passe, clés) dans les fichiers ou les commits, et d'envoyer, publier ou pousser quoi que ce soit hors de ton ordinateur sans que tu l'aies demandé. Il reste dans le dossier du projet.
- Rien d'autre ne sort : pas de statistiques, pas de serveur tiers.
- L'autopilote relance Claude dans ta session avec tes permissions habituelles : choisis un mode de permissions qui te convient (Claude demandera ton accord pour les actions que tu n'as pas autorisées, et attendra s'il n'y a personne).
- Il ne relance jamais pendant que Claude travaille, et une seule relance attend à la fois.
- Le forfait est lu sur une adresse d'Anthropic qui n'est pas documentée officiellement : si elle change, l'autopilote continue sans le rythme.

## Crédits

Écrit avec [Claude](https://claude.com/claude-code) (Anthropic). Licence MIT.
