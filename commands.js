const {
	ApplicationCommandType,
	ChannelType,
	SlashCommandBuilder,
	ContextMenuCommandBuilder,
} = require('discord.js');

const categories = [
	{
		key: 'absences',
		label: 'Absences',
		description: "Demandes d'absence staff et suivi.",
		commands: ['absence', 'absences'],
	},
	{
		key: 'sanctions',
		label: 'Sanctions',
		description: 'Avertissements, mutes, bans et historique.',
		commands: ['avert', 'avertissements', 'remove', 'tempmute', 'unmute', 'mutelist', 'ban', 'unban', 'unbanall', 'banlist', 'baninfo', 'sanctions', 'bl', 'blrank', 'derank', 'protect', 'tribunal'],
	},
	{
		key: 'moderation',
		label: 'Modération',
		description: 'Outils de salon et actions mod.',
		commands: ['clear', 'lock', 'unlock', 'hide', 'unhide', 'renew', 'nick', 'mv', 'voicemove', 'pv'],
	},
	{
		key: 'roles',
		label: 'Rôles',
		description: 'Attribution, groupes et grades.',
		commands: ['addrole', 'removerole', 'rank', 'limitrole'],
	},
	{
		key: 'utilities',
		label: 'Utilitaires',
		description: 'Profils, serveur, listes et outils pratiques.',
		commands: ['staff', 'snipe', 'embed', 'vc', 'find', 'pic', 'banner', 'user', 'serveur', 'create', 'rolemembers', 'allbots', 'adminlist'],
	},
	{
		key: 'settings',
		label: 'Configuration',
		description: 'Réglages du bot réservés aux administrateurs.',
		commands: ['setup', 'acces', 'customlogs', 'prefix', 'owner'],
	},
	{
		key: 'help',
		label: 'help',
		description: 'Consultation des permissions et de l’aide.',
		commands: ['aide'],
	},
];

const definitions = [
	['absence', 'Déposer ou traiter une demande d’absence.', 'absences', [['action', 'string'], ['raison', 'string'], ['id', 'string']]],
	['absences', 'Consulter et traiter les demandes d’absence.', 'absences', [['action', 'string'], ['membre', 'user'], ['id', 'string']]],
	['avert', 'Avertir un membre.', 'sanctions', [['membre', 'user', true], ['raison', 'string', true]]],
	['avertissements', 'Afficher les avertissements d’un membre.', 'sanctions', [['membre', 'user']]],
	['remove', 'Retirer un avertissement avec son identifiant.', 'sanctions', [['id', 'string', true]]],
	['tempmute', 'Mettre un membre en sourdine pour une durée.', 'sanctions', [['membre', 'user', true], ['duree', 'string', true], ['raison', 'string']]],
	['unmute', 'Retirer la sourdine d’un membre.', 'sanctions', [['membre', 'user', true], ['raison', 'string']]],
	['mutelist', 'Afficher les mutes actifs du serveur.', 'sanctions', []],
	['ban', 'Bannir un membre ou utilisateur.', 'sanctions', [['membre', 'user', true], ['raison', 'string']]],
	['unban', 'Débannir un utilisateur avec son identifiant.', 'sanctions', [['id', 'string', true], ['raison', 'string']]],
	['unbanall', 'Débannir tous les utilisateurs bannis.', 'sanctions', []],
	['banlist', 'Afficher les bannissements du serveur.', 'sanctions', []],
	['baninfo', 'Afficher les informations de ban d’un utilisateur.', 'sanctions', [['id', 'string', true]]],
	['sanctions', 'Afficher l’historique de sanctions d’un membre.', 'sanctions', [['membre', 'user', true]]],
	['bl', 'Gérer la blacklist de membres.', 'sanctions', [['action', 'string', true], ['membre', 'user']]],
	['blrank', 'Retirer une plage de rôles d’un membre.', 'sanctions', [['membre', 'user', true], ['role', 'role', true], ['role2', 'role']]],
	['derank', 'Retirer les rôles supérieurs au rôle indiqué.', 'sanctions', [['membre', 'user', true], ['role', 'role', true]]],
	['protect', 'Gérer les membres protégés contre le ban.', 'sanctions', [['action', 'string', true], ['membre', 'user']]],
	['tribunal', 'Créer ou traiter une demande de ban.', 'sanctions', [['action', 'string'], ['membre', 'user'], ['raison', 'string'], ['id', 'string']]],
	['clear', 'Supprimer un nombre de messages.', 'moderation', [['nombre', 'integer', true]]],
	['lock', 'Verrouiller le salon actuel ou indiqué.', 'moderation', [['salon', 'channel']]],
	['unlock', 'Déverrouiller un salon.', 'moderation', [['salon', 'channel']]],
	['hide', 'Masquer un salon aux membres.', 'moderation', [['salon', 'channel']]],
	['unhide', 'Rendre un salon visible aux membres.', 'moderation', [['salon', 'channel']]],
	['renew', 'Recréer le salon actuel.', 'moderation', []],
	['nick', 'Modifier ou retirer le surnom d’un membre.', 'moderation', [['membre', 'user', true], ['texte', 'string']]],
	['mv', 'Déplacer un membre dans un salon vocal.', 'moderation', [['membre', 'user', true], ['salon', 'channel', true]]],
	['voicemove', 'Répartir les membres vocaux dans une catégorie.', 'moderation', [['categorie', 'channel', true]]],
	['pv', 'Verrouiller un vocal aux membres qui ne sont pas présents.', 'moderation', [['salon', 'channel']]],
	['addrole', 'Ajouter un rôle à un membre.', 'roles', [['membre', 'user', true], ['role', 'role', true]]],
	['removerole', 'Retirer un rôle à un membre.', 'roles', [['membre', 'user', true], ['role', 'role', true]]],
	['rank', 'Afficher les rôles de grade configurés.', 'roles', [['membre', 'user']]],
	['limitrole', 'Définir une limite d’attribution pour un rôle.', 'roles', [['role', 'role', true], ['limite', 'integer', true]]],
	['staff', 'Afficher les membres de l’équipe staff.', 'utilities', []],
	['snipe', 'Afficher le dernier message supprimé du salon.', 'utilities', []],
	['embed', 'Envoyer un message formaté en Component V2.', 'utilities', [['texte', 'string', true], ['salon', 'channel']]],
	['vc', 'Afficher les membres connectés en vocal.', 'utilities', []],
	['find', 'Rechercher un membre par nom ou identifiant.', 'utilities', [['texte', 'string', true]]],
	['pic', 'Afficher l’avatar d’un utilisateur.', 'utilities', [['membre', 'user']]],
	['banner', 'Afficher la bannière d’un utilisateur.', 'utilities', [['membre', 'user']]],
	['user', 'Afficher les informations d’un utilisateur.', 'utilities', [['membre', 'user']]],
	['serveur', 'Afficher les informations du serveur.', 'utilities', []],
	['create', 'Créer un salon texte, vocal ou une catégorie.', 'utilities', [['type', 'string', true], ['nom', 'string', true], ['categorie', 'channel']]],
	['rolemembers', 'Afficher les membres ayant un rôle.', 'utilities', [['role', 'role', true]]],
	['allbots', 'Afficher les bots présents sur le serveur.', 'utilities', []],
	['adminlist', 'Afficher les administrateurs du serveur.', 'utilities', []],
	['setup', 'Configurer les rôles, salons et limites du bot.', 'settings', [['action', 'string', true], ['nom', 'string'], ['id', 'string']]],
	['acces', 'Configurer les permissions d’accès aux commandes.', 'settings', [['action', 'string', true], ['nom', 'string'], ['role', 'role'], ['texte', 'string']]],
	['customlogs', 'Configurer l’apparence et le salon des logs.', 'settings', [['action', 'string', true], ['nom', 'string'], ['salon', 'channel'], ['texte', 'string']]],
	['prefix', 'Afficher ou modifier le préfixe des commandes.', 'settings', [['texte', 'string']]],
	['owner', 'Afficher ou définir le propriétaire du bot.', 'settings', [['membre', 'user']]],
	['aide', 'Afficher le centre d’aide interactif.', 'help', []],
];

const optionDescriptions = {
	action: 'Action à effectuer (ex: add, remove, list, valider, refuser)',
	membre: 'Membre concerné',
	utilisateur: 'Utilisateur concerné',
	raison: 'Raison de la demande ou de la sanction',
	duree: 'Durée (ex: 15m, 2h, 3d)',
	id: 'Identifiant Discord ou de la demande',
	role: 'Rôle concerné',
	role2: 'Limite supérieure facultative',
	salon: 'Salon concerné',
	categorie: 'Catégorie de salons',
	texte: 'Texte, nom ou valeur',
	nombre: 'Nombre de messages à supprimer (1-100)',
	limite: 'Nombre maximum de membres autorisés',
	type: 'Type de salon (texte, vocal, categorie)',
	nom: 'Nom du salon ou de la configuration',
};

const commands = definitions.map(([name, description, category, params]) => {
	const command = new SlashCommandBuilder().setName(name).setDescription(description);
	for (const [key, type, required = false] of params) {
		const optionDescription = optionDescriptions[key] || key;
		if (type === 'user') command.addUserOption((option) => option.setName(key).setDescription(optionDescription).setRequired(required));
		else if (type === 'role') command.addRoleOption((option) => option.setName(key).setDescription(optionDescription).setRequired(required));
		else if (type === 'channel') command.addChannelOption((option) => option.setName(key).setDescription(optionDescription).addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement, ChannelType.GuildForum).setRequired(required));
		else if (type === 'integer') command.addIntegerOption((option) => option.setName(key).setDescription(optionDescription).setMinValue(key === 'nombre' ? 1 : 0).setMaxValue(key === 'nombre' ? 100 : 100000).setRequired(required));
		else command.addStringOption((option) => option.setName(key).setDescription(optionDescription).setMaxLength(key === 'raison' ? 500 : 1000).setRequired(required));
	}
	return { name, description, category, params, json: command.toJSON() };
});

const moderationContextMenu = new ContextMenuCommandBuilder()
	.setName('Modérer')
	.setType(ApplicationCommandType.User)
	.toJSON();

module.exports = {
	categories,
	commands,
	definitions,
	discordCommands: [...commands.map((command) => command.json), moderationContextMenu],
	moderationContextMenu,
};
