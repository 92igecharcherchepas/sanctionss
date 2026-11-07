const fs = require('node:fs');
const path = require('node:path');

const dataDirectory = path.join(__dirname, 'data');
const defaultPrefix = '-';

function defaultData() {
	return {
		prefix: defaultPrefix,
		sanctions: [],
		absences: [],
		blacklist: [],
		protectedMembers: [],
		roleLimits: {},
		access: {},
		settings: {},
		snipes: {},
	};
}

function dataPath(guildId) {
	return path.join(dataDirectory, `${guildId}.json`);
}

function loadGuild(guildId) {
	fs.mkdirSync(dataDirectory, { recursive: true });
	const file = dataPath(guildId);
	if (!fs.existsSync(file)) return defaultData();
	try {
		const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
		const defaults = defaultData();
		return {
			...defaults,
			...stored,
			sanctions: Array.isArray(stored.sanctions) ? stored.sanctions : [],
			absences: Array.isArray(stored.absences) ? stored.absences : [],
			blacklist: Array.isArray(stored.blacklist) ? stored.blacklist : [],
			protectedMembers: Array.isArray(stored.protectedMembers) ? stored.protectedMembers : [],
			roleLimits: stored.roleLimits && typeof stored.roleLimits === 'object' ? stored.roleLimits : {},
			access: stored.access && typeof stored.access === 'object' ? stored.access : {},
			settings: stored.settings && typeof stored.settings === 'object' ? stored.settings : {},
			snipes: stored.snipes && typeof stored.snipes === 'object' ? stored.snipes : {},
		};
	} catch (error) {
		throw new Error(`Impossible de lire la configuration du serveur ${guildId}: ${error.message}`);
	}
}

function saveGuild(guildId, data) {
	fs.mkdirSync(dataDirectory, { recursive: true });
	const file = dataPath(guildId);
	const temporaryFile = `${file}.tmp`;
	fs.writeFileSync(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
	fs.renameSync(temporaryFile, file);
}

function makeId(prefix = 'S') {
	return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

module.exports = { defaultPrefix, loadGuild, makeId, saveGuild };
