require('dotenv').config();

const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	Client,
	GatewayIntentBits,
	MessageFlags,
	PermissionFlagsBits,
	REST,
	Routes,
	StringSelectMenuBuilder,
	ContainerBuilder,
	TextDisplayBuilder,
} = require('discord.js');
const { categories, commands, discordCommands } = require('./commands');
const { defaultPrefix, loadGuild, makeId, saveGuild } = require('./storage');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const deployGuildId = process.env.GUILD_ID;
const ownerId = process.env.OWNER_ID;
const logGuildId = '1567631150443139183';
const logChannelId = '1567633562671521872';
const guildQueues = new Map();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildModeration,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.MessageContent,
	],
});

function serializeGuild(guildId, task) {
	const previous = guildQueues.get(guildId) || Promise.resolve();
	const current = previous.catch(() => {}).then(task);
	guildQueues.set(guildId, current);
	return current.finally(() => {
		if (guildQueues.get(guildId) === current) guildQueues.delete(guildId);
	});
}

function container(content, rows = [], accentColor = 0x808080) {
	const result = new ContainerBuilder()
		.setAccentColor(accentColor)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
	for (const row of rows) result.addActionRowComponents(row);
	return result;
}

function helpSelect(selected = 'none') {
	const options = categories.map((category) => ({
		label: category.label,
		value: category.key,
		description: category.description,
	}));
	return new ActionRowBuilder().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId('help:select')
			.setPlaceholder('Choisir une catégorie')
			.addOptions(options)
			.setMinValues(1)
			.setMaxValues(1),
	);
}

function categoryHelp(categoryKey, prefix) {
	const category = categories.find((item) => item.key === categoryKey);
	if (!category) {
		const overview = [
			categories.filter((item) => ['absences', 'sanctions', 'moderation', 'roles'].includes(item.key)),
			categories.filter((item) => ['utilities', 'settings'].includes(item.key)),
			categories.filter((item) => item.key === 'help'),
		].map((group) => group.map((item) => `**${item.label}**\n${item.description}`).join('\n\n')).join('\n\n---\n\n');
		const count = commands.length;
		return `# Centre d’aide\nVoici les commandes auxquelles vous avez accès.\nChaque commande fonctionne aussi en préfixe (ex. \`${prefix}clear\`).\n${count} commandes disponibles · préfixe \`${prefix}\`\n\n---\n\n${overview}\n\n---\nChoisir une catégorie`;
	}

	const names = category.commands
		.map((name) => {
			const definition = commands.find((command) => command.name === name);
			return definition ? `\`${prefix}${name}\` · \`/${name}\`` : `\`${prefix}${name}\` · \`/${name}\``;
		})
		.join('\n');
	return `# Centre d’aide · ${category.label}\n${category.description}\n\n${names || 'Aucune commande dans cette catégorie.'}\n\n---\nChoisir une catégorie`;
}

async function replyV2(target, content, { ephemeral = false, rows = [] } = {}) {
	const payload = {
		flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
		components: [container(content, rows)],
		allowedMentions: { parse: [] },
	};
	if (target.isChatInputCommand?.() || target.isContextMenuCommand?.() || target.isMessageComponent?.()) {
		if (target.replied || target.deferred) return target.followUp(payload);
		return target.reply(payload);
	}
	return target.reply(payload);
}

async function editV2(interaction, content, rows = []) {
	return interaction.update({
		components: [container(content, rows)],
	});
}

function record(data, type, userId, moderatorId, reason, extra = {}) {
	const item = {
		id: makeId(),
		type,
		userId,
		moderatorId,
		reason: reason || 'Aucune raison fournie',
		createdAt: new Date().toISOString(),
		...extra,
	};
	data.sanctions.push(item);
	return item;
}

function parseLogColor(value) {
	const colors = {
		gris: 0x808080,
		rouge: 0xe04f5f,
		vert: 0x43b581,
		bleu: 0x3498db,
		violet: 0x9b59b6,
		orange: 0xe67e22,
	};
	const normalized = String(value || '').trim().toLowerCase();
	if (colors[normalized]) return colors[normalized];
	const hex = normalized.replace(/^#/, '');
	return /^[0-9a-f]{6}$/.test(hex) ? Number.parseInt(hex, 16) : null;
}

async function sendLog(guild, data, text, type = 'moderation') {
	try {
		const targetGuild = await client.guilds.fetch(logGuildId);
		const channel = await targetGuild.channels.fetch(logChannelId);
		if (!channel?.isTextBased()) {
			console.error(`Le salon de logs fixe ${logChannelId} est introuvable ou n’est pas textuel dans le serveur ${logGuildId}.`);
			return;
		}
		const color = parseLogColor(data.settings.logStyles?.[type] || data.settings.logStyle) ?? 0x808080;
		await channel.send({
			flags: MessageFlags.IsComponentsV2,
			components: [container(`## ${guild.name}\n${text}`, [], color)],
			allowedMentions: { parse: [] },
		});
	} catch (error) {
		console.error(`Impossible d’envoyer le log du serveur ${guild.id} dans ${logGuildId}/${logChannelId}:`, error);
	}
}

function parseDuration(input) {
	const match = /^([1-9]\d*)\s*(s|m|h|d|w)$/i.exec(String(input || '').trim());
	if (!match) return null;
	const factor = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[match[2].toLowerCase()];
	const duration = Number(match[1]) * factor;
	return Number.isSafeInteger(duration) ? duration : null;
}

function readableTime(date) {
	const timestamp = Math.floor(new Date(date).getTime() / 1000);
	return Number.isFinite(timestamp) ? `<t:${timestamp}:R>` : 'date inconnue';
}

function quoteRemainder(params, index) {
	return index === params.length - 1 && ['raison', 'texte'].includes(params[index]?.[0]);
}

function splitArguments(input) {
	return input.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, '')) || [];
}

function getSlashValue(interaction, key) {
	const option = interaction.options.get(key);
	if (!option) return undefined;
	return option.member || option.user || option.role || option.channel || option.value;
}

async function parsePrefixArguments(message, definition, rawArgs) {
	const values = {};
	const action = String(rawArgs[0] || '').toLowerCase();
	if (definition.name === 'absence') {
		values.action = action || 'demande';
		if (['demande', 'request', ''].includes(action)) values.raison = rawArgs.slice(action ? 1 : 0).join(' ');
		else values.id = rawArgs[1];
		return values;
	}
	if (definition.name === 'absences' && !['list', 'historique', ''].includes(action)) {
		values.action = action;
		values.id = rawArgs[1];
		return values;
	}
	if (definition.name === 'tribunal' && !['demande', 'demander', 'create', ''].includes(action)) {
		values.action = action;
		values.id = rawArgs[1];
		return values;
	}
	if (definition.name === 'customlogs' && action === 'style') {
		values.action = action;
		if (rawArgs.length > 2) {
			values.nom = rawArgs[1];
			values.texte = rawArgs.slice(2).join(' ');
		} else {
			values.texte = rawArgs.slice(1).join(' ');
		}
		return values;
	}
	if (definition.name === 'customlogs' && action === 'salon') {
		values.action = action;
		values.salon = rawArgs[1];
		return values;
	}
	let cursor = 0;
	for (let index = 0; index < definition.params.length; index += 1) {
		const [key, type] = definition.params[index];
		if (cursor >= rawArgs.length) continue;
		const value = quoteRemainder(definition.params, index) ? rawArgs.slice(cursor).join(' ') : rawArgs[cursor];
		cursor += quoteRemainder(definition.params, index) ? rawArgs.length - cursor : 1;
		if (type === 'user') {
			const id = value.replace(/[<@!>]/g, '');
			values[key] = message.guild.members.cache.get(id) || await message.guild.members.fetch(id).catch(() => null) || id;
		} else if (type === 'role') {
			const id = value.replace(/[<@&>]/g, '');
			values[key] = message.guild.roles.cache.get(id) || id;
		} else if (type === 'channel') {
			const id = value.replace(/[<#>]/g, '');
			values[key] = message.guild.channels.cache.get(id) || id;
		} else if (type === 'integer') {
			values[key] = Number(value);
		} else {
			values[key] = value;
		}
	}
	return values;
}

async function getValue(ctx, key) {
	return ctx.prefix ? ctx.values[key] : getSlashValue(ctx.interaction, key);
}

async function resolveMember(ctx, key = 'membre') {
	const value = await getValue(ctx, key);
	if (!value) return null;
	if (value.roles && value.user) return value;
	const id = typeof value === 'string' ? value.replace(/[<@!>]/g, '') : value.id;
	return ctx.guild.members.cache.get(id) || ctx.guild.members.fetch(id).catch(() => null);
}

async function resolveUser(ctx, key = 'membre') {
	const value = await getValue(ctx, key);
	if (!value) return null;
	if (value.id && !value.roles) return value;
	const id = typeof value === 'string' ? value.replace(/[<@!>]/g, '') : value.id;
	return ctx.client.users.fetch(id).catch(() => null);
}

async function resolveRole(ctx, key = 'role') {
	const value = await getValue(ctx, key);
	if (!value) return null;
	if (value.guild && value.members) return value;
	const id = typeof value === 'string' ? value.replace(/[<@&>]/g, '') : value.id;
	return ctx.guild.roles.cache.get(id) || ctx.guild.roles.fetch(id).catch(() => null);
}

async function resolveChannel(ctx, key = 'salon') {
	const value = await getValue(ctx, key);
	if (!value) return null;
	if (value.guild && value.type !== undefined) return value;
	const id = typeof value === 'string' ? value.replace(/[<#>]/g, '') : value.id;
	return ctx.guild.channels.cache.get(id) || ctx.guild.channels.fetch(id).catch(() => null);
}

function memberHasPermission(member, permission) {
	return Boolean(member?.permissions?.has(permission));
}

function isOwner(userId, data) {
	return userId === ownerId || userId === data.settings.ownerId;
}

function isStaff(member, data) {
	const configuredRoles = String(data?.settings.staffRoles || '')
		.split(',')
		.map((roleId) => roleId.trim())
		.filter(Boolean);
	if (configuredRoles.some((roleId) => member?.roles?.cache?.has(roleId))) return true;
	return memberHasPermission(member, PermissionFlagsBits.Administrator)
		|| memberHasPermission(member, PermissionFlagsBits.ManageGuild)
		|| memberHasPermission(member, PermissionFlagsBits.ModerateMembers)
		|| memberHasPermission(member, PermissionFlagsBits.ManageMessages);
}

async function checkAccess(ctx, commandName, data) {
	if (isOwner(ctx.user.id, data) || memberHasPermission(ctx.member, PermissionFlagsBits.Administrator)) return true;
	const access = data.access[commandName];
	if (access === 'public') return true;
	if (access && ctx.member.roles.cache.has(access)) return true;
	if (access === 'staff') return isStaff(ctx.member, data);
	const action = getAction(ctx);
	if (commandName === 'absence' && ['', 'demande', 'request'].includes(action)) return true;
	if (commandName === 'tribunal' && ['', 'demande', 'demander', 'create'].includes(action)) return true;
	return !isStaffCommand(commandName) || isStaff(ctx.member, data);
}

function isStaffCommand(name) {
	return new Set([
		'avert', 'remove', 'tempmute', 'unmute', 'ban', 'unban', 'unbanall', 'banlist', 'baninfo', 'mutelist', 'bl', 'blrank', 'derank', 'protect', 'tribunal',
		'clear', 'lock', 'unlock', 'hide', 'unhide', 'renew', 'nick', 'mv', 'voicemove', 'pv', 'addrole', 'removerole',
		'limitrole', 'absence', 'absences', 'create', 'setup', 'acces', 'customlogs', 'prefix', 'owner', 'embed',
	]).has(name);
}

function canModerateTarget(moderator, target) {
	return target.id !== moderator.id
		&& target.roles.highest.position < moderator.roles.highest.position
		&& !target.permissions.has(PermissionFlagsBits.Administrator);
}

function listText(title, entries, formatter) {
	if (!entries.length) return `# ${title}\nAucun résultat.`;
	return `# ${title}\n${entries.slice(0, 20).map(formatter).join('\n')}${entries.length > 20 ? `\n\n+ ${entries.length - 20} résultat(s)` : ''}`;
}

function getAction(ctx) {
	return String(ctx.prefix ? ctx.values.action || '' : ctx.interaction.options.getString('action') || '').toLowerCase();
}

function getReason(ctx, fallback = 'Aucune raison fournie') {
	return String(ctx.prefix ? ctx.values.raison || fallback : ctx.interaction.options.getString('raison') || fallback);
}

async function handleHelp(ctx, selected) {
	const data = loadGuild(ctx.guild.id);
	const selectedKey = selected || 'none';
	return replyV2(ctx.target, categoryHelp(selectedKey, data.prefix || defaultPrefix), {
		ephemeral: ctx.interaction ? true : false,
		rows: [helpSelect(selectedKey)],
	});
}

async function handleCommand(ctx) {
	if (!ctx.guild || !ctx.member) {
		return replyV2(ctx.target, 'Cette commande doit être utilisée dans un serveur.', { ephemeral: true });
	}
	const data = loadGuild(ctx.guild.id);
	if (!(await checkAccess(ctx, ctx.commandName, data))) {
		return replyV2(ctx.target, 'Tu n’as pas les permissions nécessaires pour cette commande.', { ephemeral: true });
	}

	const reply = (content, ephemeral = Boolean(ctx.interaction)) => replyV2(ctx.target, content, { ephemeral });
	const command = ctx.commandName;
	const reason = getReason(ctx);

	if (command === 'aide') return handleHelp(ctx);
	if (command === 'prefix') {
		const newPrefix = await getValue(ctx, 'texte');
		if (!newPrefix) return reply(`Préfixe actuel : \`${data.prefix}\``);
		if (newPrefix.length > 5 || /\s/.test(newPrefix)) return reply('Le préfixe doit faire entre 1 et 5 caractères, sans espace.');
		data.prefix = newPrefix;
		saveGuild(ctx.guild.id, data);
		return reply(`Préfixe défini sur \`${newPrefix}\`.`);
	}

	if (command === 'avert') {
		const member = await resolveMember(ctx);
		if (!member) return reply('Membre introuvable.');
		if (!canModerateTarget(ctx.member, member)) return reply('Tu ne peux pas avertir un membre avec un rôle supérieur ou égal au tien.');
		const item = record(data, 'AVERT', member.id, ctx.user.id, reason);
		saveGuild(ctx.guild.id, data);
		await sendLog(ctx.guild, data, `## Avertissement\nMembre : <@${member.id}>\nModérateur : <@${ctx.user.id}>\nRaison : ${reason}\nID : \`${item.id}\``, 'averts');
		return reply(`<@${member.id}> a reçu un avertissement. ID : \`${item.id}\``);
	}
	if (command === 'avertissements' || command === 'sanctions') {
		const member = await resolveMember(ctx);
		if (!member) return reply('Membre introuvable.');
		const items = data.sanctions.filter((item) => item.userId === member.id && (command !== 'avertissements' || item.type === 'AVERT'));
		return reply(listText(command === 'avertissements' ? `Avertissements de ${member.user.username}` : `Sanctions de ${member.user.username}`, items, (item) => `• \`${item.id}\` · **${item.type}** · ${readableTime(item.createdAt)}\n  ${item.reason}`));
	}
	if (command === 'remove') {
		const id = String(await getValue(ctx, 'id') || '').toUpperCase();
		const index = data.sanctions.findIndex((item) => item.id === id && item.type === 'AVERT');
		if (index < 0) return reply('Avertissement introuvable.');
		data.sanctions.splice(index, 1);
		saveGuild(ctx.guild.id, data);
		return reply(`Avertissement \`${id}\` retiré de l’historique.`);
	}
	if (command === 'tempmute') {
		const member = await resolveMember(ctx);
		const duration = parseDuration(await getValue(ctx, 'duree'));
		if (!member) return reply('Membre introuvable.');
		if (!duration || duration > 28 * 86400000) return reply('Durée invalide. Utilise par exemple `15m`, `2h`, `3d` (maximum 28 jours).');
		if (!canModerateTarget(ctx.member, member)) return reply('Tu ne peux pas mute un membre avec un rôle supérieur ou égal au tien.');
		await member.timeout(duration, reason);
		const item = record(data, 'TEMPMUTE', member.id, ctx.user.id, reason, { expiresAt: new Date(Date.now() + duration).toISOString() });
		saveGuild(ctx.guild.id, data);
		await sendLog(ctx.guild, data, `## Mute temporaire\nMembre : <@${member.id}>\nModérateur : <@${ctx.user.id}>\nDurée : ${await getValue(ctx, 'duree')}\nRaison : ${reason}\nID : \`${item.id}\``, 'mute');
		return reply(`<@${member.id}> a été mute pour \`${await getValue(ctx, 'duree')}\`. ID : \`${item.id}\``);
	}
	if (command === 'unmute') {
		const member = await resolveMember(ctx);
		if (!member) return reply('Membre introuvable.');
		if (!canModerateTarget(ctx.member, member)) return reply('Tu ne peux pas unmute ce membre.');
		await member.timeout(null, reason);
		record(data, 'UNMUTE', member.id, ctx.user.id, reason);
		saveGuild(ctx.guild.id, data);
		await sendLog(ctx.guild, data, `## Unmute\nMembre : <@${member.id}>\nModérateur : <@${ctx.user.id}>\nRaison : ${reason}`, 'mute');
		return reply(`<@${member.id}> n’est plus mute.`);
	}
	if (command === 'mutelist') {
		const entries = data.sanctions.filter((item) => item.type === 'TEMPMUTE' && Date.parse(item.expiresAt) > Date.now());
		return reply(listText('Mutes actifs', entries, (item) => `• <@${item.userId}> · jusqu’à ${readableTime(item.expiresAt)} · ${item.reason}`));
	}

	if (command === 'ban') {
		const user = await resolveUser(ctx);
		const member = await resolveMember(ctx);
		const userId = member?.id || user?.id || String(await getValue(ctx, 'membre') || '').replace(/[<@!>]/g, '');
		if (!/^\d{17,20}$/.test(userId)) return reply('Utilisateur introuvable ou identifiant invalide.');
		if (data.protectedMembers.includes(userId)) return reply('Cet utilisateur est protégé contre les bans.');
		if (member && !canModerateTarget(ctx.member, member)) return reply('Tu ne peux pas bannir un membre avec un rôle supérieur ou égal au tien.');
		await ctx.guild.members.ban(userId, { reason });
		const item = record(data, 'BAN', userId, ctx.user.id, reason);
		saveGuild(ctx.guild.id, data);
		await sendLog(ctx.guild, data, `## Ban\nUtilisateur : <@${userId}>\nModérateur : <@${ctx.user.id}>\nRaison : ${reason}\nID : \`${item.id}\``, 'ban');
		return reply(`<@${userId}> a été banni. ID : \`${item.id}\``);
	}
	if (command === 'unban') {
		const id = String(await getValue(ctx, 'id') || '').replace(/[<@!>]/g, '');
		if (!/^\d{17,20}$/.test(id)) return reply('Identifiant Discord invalide.');
		await ctx.guild.members.unban(id, reason);
		record(data, 'UNBAN', id, ctx.user.id, reason);
		saveGuild(ctx.guild.id, data);
		await sendLog(ctx.guild, data, `## Unban\nUtilisateur : <@${id}>\nModérateur : <@${ctx.user.id}>\nRaison : ${reason}`, 'ban');
		return reply(`<@${id}> a été débanni.`);
	}
	if (command === 'unbanall') {
		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`confirm:unbanall:${ctx.user.id}`).setLabel('Confirmer le débannissement total').setStyle(ButtonStyle.Danger),
		);
		return replyV2(ctx.target, `Confirmer le débannissement de tous les utilisateurs bannis de **${ctx.guild.name}** ?`, { ephemeral: Boolean(ctx.interaction), rows: [row] });
	}
	if (command === 'banlist' || command === 'baninfo') {
		const bans = await ctx.guild.bans.fetch();
		if (command === 'baninfo') {
			const id = String(await getValue(ctx, 'id') || '').replace(/[<@!>]/g, '');
			const ban = bans.get(id);
			const past = data.sanctions.filter((item) => item.userId === id && item.type === 'BAN').at(-1);
			if (!ban && !past) return reply('Aucun bannissement enregistré pour cet utilisateur.');
			return reply(`# Baninfo · ${ban?.user.tag || id}\nÉtat : ${ban ? 'banni actuellement' : 'bannissement terminé'}\nID : \`${id}\`\nRaison : ${ban?.reason || past?.reason || 'Non précisée'}\nModérateur : ${past ? `<@${past.moderatorId}>` : 'inconnu'}`);
		}
		return reply(listText('Liste des bannis', [...bans.values()], (ban) => `• ${ban.user.tag} · \`${ban.user.id}\` · ${ban.reason || 'Aucune raison'}`));
	}

	if (command === 'bl') {
		const action = getAction(ctx);
		const member = await resolveMember(ctx);
		if (action === 'list') return reply(listText('Blacklist', data.blacklist, (entry) => `• <@${entry.userId}> · ${entry.reason}`));
		if (!member) return reply('Membre introuvable.');
		if (action === 'add' || action === 'ajouter') {
			if (!data.blacklist.some((item) => item.userId === member.id)) data.blacklist.push({ userId: member.id, reason, addedBy: ctx.user.id, createdAt: new Date().toISOString() });
			saveGuild(ctx.guild.id, data);
			return reply(`<@${member.id}> a été ajouté à la blacklist. Une tentative de connexion future entraînera un bannissement.`);
		}
		if (action === 'remove' || action === 'retirer' || action === 'del') {
			data.blacklist = data.blacklist.filter((item) => item.userId !== member.id);
			saveGuild(ctx.guild.id, data);
			return reply(`<@${member.id}> a été retiré de la blacklist.`);
		}
		return reply('Action attendue : `add`, `remove` ou `list`.');
	}
	if (command === 'blrank' || command === 'derank') {
		const member = await resolveMember(ctx);
		const lowerRole = await resolveRole(ctx, 'role');
		const upperRole = command === 'blrank' ? await resolveRole(ctx, 'role2') : null;
		if (!member || !lowerRole) return reply('Membre ou rôle introuvable.');
		if (!canModerateTarget(ctx.member, member)) return reply('Tu ne peux pas modifier les rôles de ce membre.');
		if (command === 'derank') {
			const removed = member.roles.cache.filter((role) => role.position > lowerRole.position && !role.managed);
			if (!removed.size) return reply('Aucun rôle supérieur à retirer.');
			await member.roles.remove(removed, reason);
			await sendLog(ctx.guild, data, `## Derank\nMembre : <@${member.id}>\nModérateur : <@${ctx.user.id}>\nRôles retirés : ${removed.map((role) => role.name).join(', ')}`, 'blrank');
			return reply(`${removed.size} rôle(s) supérieur(s) à **${lowerRole.name}** retiré(s) à <@${member.id}>.`);
		}
		const min = Math.min(lowerRole.position, upperRole?.position ?? lowerRole.position);
		const max = Math.max(lowerRole.position, upperRole?.position ?? lowerRole.position);
		const removed = member.roles.cache.filter((role) => role.id !== ctx.guild.id && role.position >= min && role.position <= max && !role.managed);
		if (!removed.size) return reply('Aucun rôle de cette plage à retirer.');
		await member.roles.remove(removed, reason);
		await sendLog(ctx.guild, data, `## Blrank\nMembre : <@${member.id}>\nModérateur : <@${ctx.user.id}>\nRôles retirés : ${removed.map((role) => role.name).join(', ')}`, 'blrank');
		return reply(`Plage de rôles retirée à <@${member.id}>.`);
	}
	if (command === 'protect') {
		const action = getAction(ctx);
		const member = await resolveMember(ctx);
		if (action === 'list') return reply(`# Membres protégés\n${data.protectedMembers.map((id) => `• <@${id}>`).join('\n') || 'Aucun membre protégé.'}`);
		if (!member) return reply('Membre introuvable.');
		if (action === 'add' || action === 'ajouter') {
			if (!data.protectedMembers.includes(member.id)) data.protectedMembers.push(member.id);
		} else if (action === 'remove' || action === 'retirer') {
			data.protectedMembers = data.protectedMembers.filter((id) => id !== member.id);
		} else return reply('Action attendue : `add`, `remove` ou `list`.');
		saveGuild(ctx.guild.id, data);
		return reply(action === 'add' || action === 'ajouter' ? `<@${member.id}> est protégé contre les bans.` : `<@${member.id}> n’est plus protégé.`);
	}
	if (command === 'tribunal') {
		const action = getAction(ctx) || 'demande';
		const id = String(await getValue(ctx, 'id') || '');
		if (action === 'demande' || action === 'create' || action === 'demander') {
			const member = await resolveMember(ctx);
			if (!member) return reply('Membre à signaler introuvable.');
			const request = { id: makeId('T'), userId: member.id, reason, createdBy: ctx.user.id, createdAt: new Date().toISOString(), status: 'pending' };
			data.tribunal = Array.isArray(data.tribunal) ? data.tribunal : [];
			data.tribunal.push(request);
			saveGuild(ctx.guild.id, data);
			return reply(`Demande de ban créée : \`${request.id}\`. Les modérateurs peuvent la traiter avec \`/tribunal action:accepter id:${request.id}\` ou \`refuser\`.`);
		}
		data.tribunal = Array.isArray(data.tribunal) ? data.tribunal : [];
		if (action === 'list') return reply(listText('Demandes de tribunal', data.tribunal.filter((entry) => entry.status === 'pending'), (entry) => `• \`${entry.id}\` · <@${entry.userId}> · ${entry.reason}`));
		const request = data.tribunal.find((entry) => entry.id.toLowerCase() === id.toLowerCase() && entry.status === 'pending');
		if (!request) return reply('Demande en attente introuvable.');
		if (action !== 'accepter' && action !== 'accept' && action !== 'refuser' && action !== 'reject') return reply('Action attendue : `demande`, `list`, `accepter` ou `refuser`.');
		const accepted = action === 'accepter' || action === 'accept';
		if (accepted && data.protectedMembers.includes(request.userId)) return reply('Cette personne est protégée contre les bans ; la demande ne peut pas être acceptée.');
		request.status = accepted ? 'accepted' : 'rejected';
		request.reviewedBy = ctx.user.id;
		request.reviewedAt = new Date().toISOString();
		if (accepted) {
			await ctx.guild.members.ban(request.userId, { reason: `Tribunal: ${request.reason}` });
			record(data, 'BAN', request.userId, ctx.user.id, `Tribunal: ${request.reason}`);
		}
		saveGuild(ctx.guild.id, data);
		const user = await ctx.client.users.fetch(request.userId).catch(() => null);
		if (user) await user.send(`Ta demande de tribunal sur **${ctx.guild.name}** a été ${accepted ? 'acceptée' : 'refusée'}.`).catch((error) => console.error(`Impossible d’envoyer le résultat du tribunal à ${user.id}:`, error));
		return reply(`Demande \`${request.id}\` ${accepted ? 'acceptée' : 'refusée'}.`);
	}

	if (command === 'clear') {
		const count = Number(await getValue(ctx, 'nombre'));
		if (!Number.isInteger(count) || count < 1 || count > 100) return reply('Le nombre doit être compris entre 1 et 100.');
		const channel = ctx.channel;
		if (!channel?.bulkDelete) return reply('Cette commande ne fonctionne que dans un salon textuel.');
		const deleted = await channel.bulkDelete(count, true);
		if (!ctx.interaction) {
			await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container(`${deleted.size} message(s) supprimé(s).`)], allowedMentions: { parse: [] } });
			return;
		}
		return reply(`${deleted.size} message(s) supprimé(s).`, true);
	}
	if (['lock', 'unlock', 'hide', 'unhide'].includes(command)) {
		const channel = await resolveChannel(ctx) || ctx.channel;
		if (!channel?.permissionOverwrites) return reply('Salon introuvable ou non compatible.');
		const everyone = ctx.guild.roles.everyone;
		if (command === 'lock') await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason });
		if (command === 'unlock') await channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason });
		if (command === 'hide') await channel.permissionOverwrites.edit(everyone, { ViewChannel: false }, { reason });
		if (command === 'unhide') await channel.permissionOverwrites.edit(everyone, { ViewChannel: null }, { reason });
		return reply(`Salon <#${channel.id}> mis à jour.`);
	}
	if (command === 'renew') {
		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId(`confirm:renew:${ctx.user.id}:${ctx.channel.id}`).setLabel('Confirmer le renouvellement').setStyle(ButtonStyle.Danger),
		);
		return replyV2(ctx.target, `Confirmer le renouvellement de <#${ctx.channel.id}> ? L’ancien salon sera supprimé après la copie.`, { ephemeral: Boolean(ctx.interaction), rows: [row] });
	}
	if (command === 'nick') {
		const member = await resolveMember(ctx);
		const nickname = await getValue(ctx, 'texte');
		if (!member) return reply('Membre introuvable.');
		if (!canModerateTarget(ctx.member, member)) return reply('Tu ne peux pas modifier le surnom de ce membre.');
		await member.setNickname(nickname || null, reason);
		return reply(`Surnom ${nickname ? `défini sur **${nickname}**` : 'retiré'} pour <@${member.id}>.`);
	}
	if (command === 'mv') {
		const member = await resolveMember(ctx);
		const channel = await resolveChannel(ctx);
		if (!member || !channel?.isVoiceBased()) return reply('Membre ou salon vocal introuvable.');
		if (!member.voice.channel) return reply('Ce membre n’est pas connecté en vocal.');
		await member.voice.setChannel(channel, reason);
		return reply(`<@${member.id}> déplacé vers <#${channel.id}>.`);
	}
	if (command === 'voicemove') {
		const category = await resolveChannel(ctx, 'categorie');
		if (!category || category.type !== ChannelType.GuildCategory) return reply('Catégorie introuvable.');
		const voiceChannels = category.children.cache.filter((channel) => channel.isVoiceBased());
		if (!voiceChannels.size) return reply('Aucun salon vocal dans cette catégorie.');
		const members = category.children.cache.filter((channel) => channel.isVoiceBased()).flatMap((channel) => [...channel.members.values()]);
		if (!members.length) return reply('Aucun membre connecté dans cette catégorie.');
		let index = 0;
		for (const member of members) {
			const channel = [...voiceChannels.values()][index % voiceChannels.size];
			if (member.voice.channelId !== channel.id) await member.voice.setChannel(channel, reason);
			index += 1;
		}
		return reply(`${members.length} membre(s) réparti(s) dans ${voiceChannels.size} salon(s) vocal(aux).`);
	}
	if (command === 'pv') {
		const channel = await resolveChannel(ctx) || ctx.member.voice.channel;
		if (!channel?.isVoiceBased()) return reply('Tu dois être dans un vocal ou indiquer un salon vocal.');
		await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { Connect: false }, { reason });
		for (const member of channel.members.values()) {
			await channel.permissionOverwrites.edit(member, { Connect: true }, { reason });
		}
		return reply(`Vocal <#${channel.id}> verrouillé : seuls les membres actuellement présents peuvent rester.`);
	}

	if (command === 'addrole' || command === 'removerole') {
		const member = await resolveMember(ctx);
		const role = await resolveRole(ctx);
		if (!member || !role) return reply('Membre ou rôle introuvable.');
		if (!canModerateTarget(ctx.member, member) || role.position >= ctx.member.roles.highest.position) return reply('Hiérarchie de rôles insuffisante.');
		const limits = Number(data.roleLimits[role.id]);
		if (command === 'addrole' && limits > 0 && role.members.size >= limits && !member.roles.cache.has(role.id)) return reply(`La limite configurée pour **${role.name}** (${limits}) est atteinte.`);
		if (command === 'addrole') await member.roles.add(role, reason);
		else await member.roles.remove(role, reason);
		return reply(`Rôle **${role.name}** ${command === 'addrole' ? 'ajouté à' : 'retiré à'} <@${member.id}>.`);
	}
	if (command === 'rank') {
		const member = await resolveMember(ctx) || ctx.member;
		const configured = Array.isArray(data.settings.ranks)
			? data.settings.ranks
			: String(data.settings.ranks || '').split(',').map((roleId) => roleId.trim()).filter(Boolean);
		const roles = member.roles.cache.filter((role) => role.id !== ctx.guild.id && (!configured.length || configured.includes(role.id)));
		return reply(`# Rôles de ${member.user.username}\n${roles.map((role) => `• ${role}`).join('\n') || 'Aucun rôle.'}`);
	}
	if (command === 'limitrole') {
		const role = await resolveRole(ctx);
		const limit = Number(await getValue(ctx, 'limite'));
		if (!role || !Number.isInteger(limit) || limit < 0) return reply('Rôle ou limite invalide (0 désactive la limite).');
		if (role.position >= ctx.member.roles.highest.position) return reply('Tu ne peux pas configurer un rôle supérieur ou égal au tien.');
		if (limit === 0) delete data.roleLimits[role.id];
		else data.roleLimits[role.id] = limit;
		saveGuild(ctx.guild.id, data);
		return reply(`Limite de **${role.name}** ${limit ? `définie à ${limit}` : 'retirée'}.`);
	}

	if (command === 'absence' || command === 'absences') {
		const action = getAction(ctx) || (command === 'absence' ? 'demande' : 'list');
		data.absences = Array.isArray(data.absences) ? data.absences : [];
		if (command === 'absence' && ['demande', 'request', ''].includes(action)) {
			const request = { id: makeId('A'), userId: ctx.user.id, reason, createdAt: new Date().toISOString(), status: 'pending' };
			data.absences.push(request);
			saveGuild(ctx.guild.id, data);
			await sendLog(ctx.guild, data, `## Demande d’absence\nMembre : <@${request.userId}>\nRaison : ${request.reason}\nID : \`${request.id}\``, 'absences');
			return reply(`Demande d’absence envoyée. Référence : \`${request.id}\`.`);
		}
		if (action === 'list' || action === 'historique') return reply(listText('Historique des absences', data.absences, (entry) => `• \`${entry.id}\` · <@${entry.userId}> · **${entry.status}** · ${entry.reason}`));
		const id = String(await getValue(ctx, 'id') || '');
		const member = await resolveMember(ctx);
		const pending = data.absences.find((entry) => entry.status === 'pending' && (entry.id === id || (member && entry.userId === member.id)));
		if (!pending) return reply('Demande d’absence en attente introuvable.');
		const accepted = ['valider', 'accepter', 'accept'].includes(action);
		if (!accepted && !['refuser', 'rejeter', 'reject'].includes(action)) return reply('Action attendue : `demande`, `list`, `valider` ou `refuser`.');
		pending.status = accepted ? 'accepted' : 'rejected';
		pending.reviewedBy = ctx.user.id;
		pending.reviewedAt = new Date().toISOString();
		saveGuild(ctx.guild.id, data);
		const applicant = await ctx.client.users.fetch(pending.userId).catch(() => null);
		if (applicant) await applicant.send(`Ta demande d’absence sur **${ctx.guild.name}** a été ${accepted ? 'validée' : 'refusée'}.`).catch((error) => console.error(`Impossible de notifier ${applicant.id} pour son absence:`, error));
		await sendLog(ctx.guild, data, `## Demande d’absence ${accepted ? 'validée' : 'refusée'}\nMembre : <@${pending.userId}>\nValidée/refusée par : <@${ctx.user.id}>\nRéférence : \`${pending.id}\``, 'absences');
		return reply(`Demande \`${pending.id}\` ${accepted ? 'validée' : 'refusée'}.`);
	}

	if (command === 'staff') {
		await ctx.guild.members.fetch();
		const staff = ctx.guild.members.cache.filter((member) => isStaff(member, data));
		return reply(listText('Staff', [...staff.values()], (member) => `• ${member} · ${member.user.tag}`));
	}
	if (command === 'snipe') {
		const entry = data.snipes[ctx.channel.id];
		if (!entry) return reply('Aucun message supprimé récemment dans ce salon.');
		return reply(`# Dernier message supprimé\nAuteur : <@${entry.authorId}>\nContenu : ${entry.content || '[aucun texte]'}\nSupprimé : ${readableTime(entry.deletedAt)}`);
	}
	if (command === 'embed') {
		const text = String(await getValue(ctx, 'texte') || '');
		const channel = await resolveChannel(ctx) || ctx.channel;
		if (!channel?.isTextBased()) return reply('Salon textuel introuvable.');
		await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container(text)], allowedMentions: { parse: [] } });
		return reply(`Message envoyé dans <#${channel.id}>.`);
	}
	if (command === 'vc') {
		const members = ctx.guild.members.cache.filter((member) => member.voice.channel);
		return reply(listText('Membres en vocal', [...members.values()], (member) => `• ${member} · <#${member.voice.channelId}>`));
	}
	if (command === 'find') {
		const query = String(await getValue(ctx, 'texte') || '').toLowerCase();
		await ctx.guild.members.fetch();
		const matches = ctx.guild.members.cache.filter((member) => member.user.username.toLowerCase().includes(query) || member.displayName.toLowerCase().includes(query) || member.id === query);
		return reply(listText(`Résultats · ${query}`, [...matches.values()], (member) => `• ${member} · ${member.user.tag} · \`${member.id}\``));
	}
	if (command === 'pic' || command === 'banner' || command === 'user') {
		const user = await resolveUser(ctx) || ctx.user;
		const fetched = await ctx.client.users.fetch(user.id, { force: true });
		if (command === 'pic') return reply(`# Avatar de ${fetched.tag}\n${fetched.displayAvatarURL({ size: 1024 })}`);
		if (command === 'banner') return reply(fetched.bannerURL({ size: 1024 }) ? `# Bannière de ${fetched.tag}\n${fetched.bannerURL({ size: 1024 })}` : `Aucune bannière publique pour ${fetched.tag}.`);
		const member = ctx.guild.members.cache.get(fetched.id);
		return reply(`# ${fetched.tag}\nID : \`${fetched.id}\`\nCréé : ${readableTime(fetched.createdAt)}\nA rejoint : ${member ? readableTime(member.joinedAt) : 'pas membre du serveur'}\nAvatar : ${fetched.displayAvatarURL({ size: 512 })}`);
	}
	if (command === 'serveur') {
		return reply(`# ${ctx.guild.name}\nID : \`${ctx.guild.id}\`\nPropriétaire : <@${ctx.guild.ownerId}>\nMembres : ${ctx.guild.memberCount}\nCréé : ${readableTime(ctx.guild.createdAt)}\nSalons : ${ctx.guild.channels.cache.size}`);
	}
	if (command === 'create') {
		const typeName = String(await getValue(ctx, 'type') || '').toLowerCase();
		const name = String(await getValue(ctx, 'nom') || '').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 90);
		const category = await resolveChannel(ctx, 'categorie');
		const type = typeName === 'vocal' || typeName === 'voice' ? ChannelType.GuildVoice
			: typeName === 'categorie' || typeName === 'category' ? ChannelType.GuildCategory
				: typeName === 'texte' || typeName === 'text' ? ChannelType.GuildText : null;
		if (!type || !name) return reply('Type invalide. Utilise `texte`, `vocal` ou `categorie`, puis un nom.');
		const channel = await ctx.guild.channels.create({ name, type, parent: category?.type === ChannelType.GuildCategory ? category : undefined, reason });
		return reply(`Salon créé : <#${channel.id}>.`);
	}
	if (command === 'rolemembers') {
		const role = await resolveRole(ctx);
		if (!role) return reply('Rôle introuvable.');
		await ctx.guild.members.fetch();
		return reply(listText(`Membres · ${role.name}`, [...role.members.values()], (member) => `• ${member} · ${member.user.tag}`));
	}
	if (command === 'allbots') {
		await ctx.guild.members.fetch();
		const bots = ctx.guild.members.cache.filter((member) => member.user.bot);
		return reply(listText('Bots du serveur', [...bots.values()], (member) => `• ${member.user.tag} · \`${member.id}\``));
	}
	if (command === 'adminlist') {
		await ctx.guild.members.fetch();
		const admins = ctx.guild.members.cache.filter((member) => member.permissions.has(PermissionFlagsBits.Administrator));
		return reply(listText('Administrateurs', [...admins.values()], (member) => `• ${member} · ${member.user.tag}`));
	}

	if (command === 'setup') {
		const action = getAction(ctx);
		const key = String(await getValue(ctx, 'nom') || '').trim();
		const value = String(await getValue(ctx, 'id') || '');
		if (action === 'list' || action === 'afficher') return reply(`# Configuration\n${Object.entries(data.settings).map(([name, setting]) => `• \`${name}\` : \`${JSON.stringify(setting)}\``).join('\n') || 'Aucun réglage configuré.'}`);
		if (action !== 'set' && action !== 'configurer' && action !== 'del' && action !== 'remove') return reply('Utilise `/setup action:set nom:<clé> id:<valeur>` ou `/setup action:list`.');
		if (!key) return reply('Indique le nom du réglage à modifier.');
		if (action === 'del' || action === 'remove') delete data.settings[key];
		else if (value) data.settings[key] = value;
		else return reply('Indique la valeur dans l’option `id`.');
		saveGuild(ctx.guild.id, data);
		return reply(`Réglage \`${key}\` ${action === 'del' || action === 'remove' ? 'supprimé' : `défini sur \`${value}\``}. Exemples de clés : \`logsSalonId\`, \`staffRoleIds\`, \`rank\`.`);
	}
	if (command === 'acces') {
		const action = getAction(ctx);
		const name = String(await getValue(ctx, 'nom') || '').replace(/^\//, '');
		const role = await resolveRole(ctx);
		if (action === 'list') return reply(`# Accès personnalisés\n${Object.entries(data.access).map(([cmd, access]) => `• \`/${cmd}\` : ${access}`).join('\n') || 'Aucun accès personnalisé.'}`);
		if (!name || !commands.some((entry) => entry.name === name)) return reply('Commande inconnue. Indique son nom sans `/`.');
		if (action === 'public') data.access[name] = 'public';
		else if (action === 'staff') data.access[name] = 'staff';
		else if (action === 'role' && role) data.access[name] = role.id;
		else if (action === 'reset' || action === 'remove') delete data.access[name];
		else return reply('Action attendue : `public`, `staff`, `role`, `reset` ou `list` (avec `role` pour définir le rôle).');
		saveGuild(ctx.guild.id, data);
		return reply(`Accès de \`/${name}\` mis à jour.`);
	}
	if (command === 'customlogs') {
		const action = getAction(ctx);
		if (action === 'list') {
			const styles = Object.entries(data.settings.logStyles || {}).map(([type, style]) => `• ${type} : ${style}`).join('\n');
			return reply(`# Logs personnalisés\nSalon fixe : <#${logChannelId}> · serveur \`${logGuildId}\`\nStyle global : ${data.settings.logStyle || 'gris'}${styles ? `\nStyles par catégorie :\n${styles}` : ''}`);
		}
		if (action === 'salon' || action === 'channel') {
			return reply(`Le salon de logs est fixe : <#${logChannelId}> sur le serveur \`${logGuildId}\`.`);
		} else if (action === 'style') {
			const style = String(await getValue(ctx, 'texte') || '');
			const category = String(await getValue(ctx, 'nom') || 'all').toLowerCase();
			const supportedCategories = ['all', 'mute', 'ban', 'moderation', 'averts', 'blrank', 'absences'];
			if (parseLogColor(style) === null) return reply('Style invalide. Couleurs disponibles : `gris`, `rouge`, `vert`, `bleu`, `violet`, `orange` ou un code hexadécimal.');
			if (!supportedCategories.includes(category)) return reply(`Catégorie invalide. Choisis : ${supportedCategories.join(', ')}.`);
			if (category === 'all') {
				data.settings.logStyle = style;
				data.settings.logStyles = {};
			} else {
				data.settings.logStyles = data.settings.logStyles || {};
				data.settings.logStyles[category] = style;
			}
		} else if (action === 'reset') {
			delete data.settings.logStyle;
			delete data.settings.logStyles;
		} else return reply('Action attendue : `salon`, `style`, `list` ou `reset`.');
		saveGuild(ctx.guild.id, data);
		return reply('Apparence des logs mise à jour. Leur destination reste fixe.');
	}
	if (command === 'owner') {
		const user = await resolveUser(ctx);
		if (!ownerId && !data.settings.ownerId && memberHasPermission(ctx.member, PermissionFlagsBits.Administrator) && user) {
			data.settings.ownerId = user.id;
			saveGuild(ctx.guild.id, data);
			return reply(`Propriétaire du bot défini sur <@${user.id}>.`);
		}
		return reply(`Propriétaire configuré : ${ownerId ? `<@${ownerId}>` : data.settings.ownerId ? `<@${data.settings.ownerId}>` : 'aucun (configure OWNER_ID dans .env)'}.`);
	}

	return reply('Commande reconnue, mais cette action n’est pas disponible.');
}

async function handleConfirm(interaction) {
	const [, action, requesterId, channelId] = interaction.customId.split(':');
	if (interaction.user.id !== requesterId) return replyV2(interaction, 'Seule la personne ayant lancé la commande peut confirmer.', { ephemeral: true });
	if (action === 'unbanall') {
		const bans = await interaction.guild.bans.fetch();
		for (const ban of bans.values()) await interaction.guild.members.unban(ban.user.id, 'Débannissement total confirmé par un administrateur');
		const data = loadGuild(interaction.guild.id);
		for (const ban of bans.values()) record(data, 'UNBAN', ban.user.id, interaction.user.id, 'Débannissement total');
		saveGuild(interaction.guild.id, data);
		return editV2(interaction, `${bans.size} utilisateur(s) débanni(s).`);
	}
	if (action === 'renew') {
		const channel = await interaction.guild.channels.fetch(channelId);
		if (!channel || !channel.deletable) return replyV2(interaction, 'Ce salon ne peut pas être renouvelé.', { ephemeral: true });
		const newChannel = await channel.clone({ reason: `Renouvellement confirmé par ${interaction.user.tag}` });
		await newChannel.setPosition(channel.position);
		await channel.delete(`Renouvellement confirmé par ${interaction.user.tag}`);
		return editV2(interaction, `Salon renouvelé : <#${newChannel.id}>.`);
	}
	return replyV2(interaction, 'Confirmation inconnue.', { ephemeral: true });
}

async function handleModerationContext(interaction) {
	const target = interaction.targetMember;
	const data = loadGuild(interaction.guildId);
	if (!isOwner(interaction.user.id, data) && !isStaff(interaction.member, data)) {
		return replyV2(interaction, 'Tu n’as pas les permissions nécessaires pour modérer ce membre.', { ephemeral: true });
	}
	if (!target || !canModerateTarget(interaction.member, target)) {
		return replyV2(interaction, 'Tu ne peux pas modérer ce membre (hiérarchie ou cible invalide).', { ephemeral: true });
	}
	const row = new ActionRowBuilder().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId(`moderate:select:${target.id}:${interaction.user.id}`)
			.setPlaceholder('Choisir une action')
			.addOptions(
				{ label: 'Avertir', value: 'warn', description: 'Ajouter un avertissement' },
				{ label: 'Mute 10 minutes', value: 'mute', description: 'Mettre en sourdine pendant 10 minutes' },
				{ label: 'Bannir', value: 'ban', description: 'Bannir ce membre' },
				{ label: 'Retirer les rôles (derank)', value: 'derank', description: 'Retirer les rôles attribués' },
			),
	);
	return replyV2(interaction, `# Modérer ${target.user.tag}\nChoisis une action ci-dessous.`, { ephemeral: true, rows: [row] });
}

async function handleModerationSelect(interaction) {
	const [, , targetId, requesterId] = interaction.customId.split(':');
	if (interaction.user.id !== requesterId) return replyV2(interaction, 'Ce menu appartient à un autre modérateur.', { ephemeral: true });
	const target = await interaction.guild.members.fetch(targetId).catch(() => null);
	if (!target || !canModerateTarget(interaction.member, target)) return editV2(interaction, 'Cible introuvable ou hiérarchie insuffisante.');
	const data = loadGuild(interaction.guild.id);
	const action = interaction.values[0];
	if (action === 'warn') record(data, 'AVERT', target.id, interaction.user.id, 'Action via le menu Modérer');
	else if (action === 'mute') {
		await target.timeout(10 * 60000, 'Action via le menu Modérer');
		record(data, 'TEMPMUTE', target.id, interaction.user.id, 'Action via le menu Modérer', { expiresAt: new Date(Date.now() + 10 * 60000).toISOString() });
	} else if (action === 'ban') {
		if (data.protectedMembers.includes(target.id)) return editV2(interaction, 'Ce membre est protégé contre les bans.');
		await target.ban({ reason: 'Action via le menu Modérer' });
		record(data, 'BAN', target.id, interaction.user.id, 'Action via le menu Modérer');
	} else if (action === 'derank') {
		const roles = target.roles.cache.filter((role) => role.id !== interaction.guild.id && !role.managed && role.position < interaction.member.roles.highest.position);
		if (roles.size) await target.roles.remove(roles);
	}
	saveGuild(interaction.guild.id, data);
	return editV2(interaction, `Action **${action}** appliquée à <@${target.id}>.`);
}

client.once('ready', async () => {
	try {
		const rest = new REST({ version: '10' }).setToken(token);
		const route = deployGuildId
			? Routes.applicationGuildCommands(clientId, deployGuildId)
			: Routes.applicationCommands(clientId);
		await rest.put(route, { body: discordCommands });
		console.log(`Connecté en tant que ${client.user.tag}. ${commands.length + 1} commandes déployées.`);
	} catch (error) {
		console.error('Échec du déploiement des commandes Discord :', error);
	}
});

client.on('messageDelete', (message) => {
	if (!message.guild || message.author?.bot) return;
	serializeGuild(message.guild.id, () => {
		const data = loadGuild(message.guild.id);
		data.snipes[message.channel.id] = {
			authorId: message.author.id,
			content: message.content?.slice(0, 1500) || '',
			deletedAt: new Date().toISOString(),
		};
		saveGuild(message.guild.id, data);
	}).catch((error) => console.error('Impossible de sauvegarder le message supprimé :', error));
});

client.on('guildMemberAdd', (member) => {
	serializeGuild(member.guild.id, async () => {
		const data = loadGuild(member.guild.id);
		if (data.blacklist.some((entry) => entry.userId === member.id)) {
			await member.ban({ reason: 'Utilisateur blacklisté' });
		}
	}).catch((error) => console.error(`Erreur lors de la vérification de blacklist pour ${member.id}:`, error));
});

client.on('messageCreate', async (message) => {
	if (message.author.bot || !message.guild) return;
	try {
		const data = loadGuild(message.guild.id);
		if (!message.content.startsWith(data.prefix)) return;
		const tokens = splitArguments(message.content.slice(data.prefix.length).trim());
		const commandName = tokens.shift()?.toLowerCase();
		const definition = commands.find((entry) => entry.name === commandName);
		if (!definition) return;
		const values = await parsePrefixArguments(message, definition, tokens);
		await serializeGuild(message.guild.id, () => handleCommand({
			commandName,
			guild: message.guild,
			member: message.member,
			user: message.author,
			client,
			target: message,
			channel: message.channel,
			prefix: true,
			values,
		}));
	} catch (error) {
		console.error(`Erreur de commande préfixée dans ${message.guild.id}:`, error);
		await replyV2(message, `Une erreur est survenue : ${error.message}`).catch((replyError) => console.error('Impossible de notifier l’erreur de commande:', replyError));
	}
});

client.on('interactionCreate', async (interaction) => {
	try {
		if (interaction.isChatInputCommand()) {
			await serializeGuild(interaction.guildId, () => handleCommand({
				commandName: interaction.commandName,
				guild: interaction.guild,
				member: interaction.member,
				user: interaction.user,
				client,
				target: interaction,
				channel: interaction.channel,
				interaction,
				prefix: false,
			}));
			return;
		}
		if (interaction.isContextMenuCommand() && interaction.commandName === 'Modérer') {
			await serializeGuild(interaction.guildId, () => handleModerationContext(interaction));
			return;
		}
		if (interaction.isStringSelectMenu()) {
			if (interaction.customId === 'help:select') {
				const data = loadGuild(interaction.guildId);
				return editV2(interaction, categoryHelp(interaction.values[0], data.prefix || defaultPrefix), [helpSelect(interaction.values[0])]);
			}
			if (interaction.customId.startsWith('moderate:select:')) return serializeGuild(interaction.guildId, () => handleModerationSelect(interaction));
		}
		if (interaction.isButton() && interaction.customId.startsWith('confirm:')) return serializeGuild(interaction.guildId, () => handleConfirm(interaction));
	} catch (error) {
		console.error('Erreur interaction Discord :', error);
		const message = `Une erreur est survenue : ${error.message}`;
		if (interaction.isMessageComponent() && !interaction.replied && !interaction.deferred) {
			await replyV2(interaction, message, { ephemeral: true }).catch((replyError) => console.error('Impossible de notifier l’erreur interaction:', replyError));
		} else if (interaction.isMessageComponent()) {
			await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch((replyError) => console.error('Impossible de notifier l’erreur interaction:', replyError));
		} else {
			await replyV2(interaction, message, { ephemeral: true }).catch((replyError) => console.error('Impossible de notifier l’erreur interaction:', replyError));
		}
	}
});

if (!token || !clientId) {
	console.error('DISCORD_TOKEN et CLIENT_ID sont obligatoires dans le fichier .env.');
	process.exitCode = 1;
} else {
	client.login(token).catch((error) => {
		console.error('Connexion Discord échouée :', error);
		process.exitCode = 1;
	});
}

module.exports = { categoryHelp, parseDuration };
