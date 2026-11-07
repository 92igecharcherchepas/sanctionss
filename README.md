# Bot de modération Shiza

Bot Discord.js v14 avec commandes slash et commandes texte, centre d’aide gris en Components V2, sanctions, modération, rôles, absences et outils de serveur.

## Installation

```powershell
npm install
```

Si tu n’as pas encore de `.env`, copie `.env.example` en `.env`. Sinon, complète le fichier existant sans écraser ses valeurs. Il faut renseigner au minimum :

```env
DISCORD_TOKEN=token_du_bot
CLIENT_ID=id_de_l_application
OWNER_ID=id_du_proprietaire
# Facultatif : déploiement immédiat des commandes sur un serveur de test.
GUILD_ID=id_du_serveur
```

Active les intents privilégiés **Server Members Intent** et **Message Content Intent** dans le portail développeur Discord. Le bot doit aussi avoir les permissions nécessaires aux commandes qu’il utilise : gérer les messages, les salons, les rôles, les membres, les bannissements et les salons vocaux.

```powershell
npm start
```

Sans `GUILD_ID`, les commandes slash sont publiées globalement et leur propagation peut prendre quelques minutes. Avec `GUILD_ID`, elles sont publiées immédiatement sur le serveur de test indiqué.

## Commandes et préfixe

Toutes les commandes listées dans le centre d’aide sont enregistrées en slash et utilisables avec le préfixe textuel. Le préfixe initial est `-` ; `/prefix` ou `-prefix` l’affiche et le modifie. Les raisons ou textes contenant plusieurs mots doivent être placés entre guillemets en préfixe, par exemple :

```text
-ban @membre "spam répété"
-tempmute @membre 30m "insultes"
```

`/aide` ou `-aide` ouvre le panneau gris Component V2 avec le menu de catégories. Il n’y a pas de bouton Support.

Toutes les logs sont envoyées dans le salon <#1567633562671521872> du serveur `1567631150443139183`. Le bot doit être présent sur ce serveur et avoir la permission d’envoyer des messages dans ce salon. La destination est fixe.

Les demandes d’absence se font avec `/absence action:demande raison:...` ou `-absence demande "raison..."`. Une demande peut être traitée avec `/absences action:valider id:...` ou `refuser`. La demande et son résultat sont également envoyés dans le salon fixe des logs.

Les commandes de configuration acceptent des clés/valeurs textuelles. `/setup action:list` affiche les réglages ; `staffRoles` accepte des IDs séparés par des virgules et `ranks` configure les rôles affichés par `/rank`. `/acces action:list` affiche les accès personnalisés. `/customlogs action:style nom:ban texte:rouge` change la couleur des logs de ban ; les catégories disponibles sont `all`, `mute`, `ban`, `moderation`, `averts`, `blrank` et `absences`. Les couleurs disponibles sont `gris`, `rouge`, `vert`, `bleu`, `violet`, `orange` ou un code hexadécimal.

## Données et limites

Les données de chaque serveur sont stockées dans `data/<ID_SERVEUR>.json`. Elles comprennent les sanctions, les demandes d’absence, les listes de protection et les réglages. Sauvegarde ce dossier.

La couleur des logs peut être configurée par serveur avec `/customlogs`. La blacklist bannit automatiquement un membre lorsqu’il rejoint le serveur. Le menu contextuel **Modérer** propose avertissement, mute, ban et retrait de rôles.

Les commandes qui suppriment ou renouvellent des ressources demandent une confirmation par bouton. Les sanctions Discord restent soumises aux permissions et à la hiérarchie des rôles du bot.
