'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('../utils/logger');

/**
 * Serwis dystrybucji modow. Kazdy mod zyje w katalogu
 * `data/mods/<id>/` i sklada sie z:
 *   - `mod.json`            — metadane (nazwa, opis, autor, emoji, itp.)
 *   - `versions/<mc>.jar`   — jar-ka na wersje Minecrafta `<mc>` (np. `26.2.jar`)
 *
 * Uzytkownik dodaje nowe mody / wersje po prostu wrzucajac pliki do
 * odpowiednich folderow — bot odczyta je przy nastepnym wywolaniu komendy
 * `/mod`, bez restartu (poza deploy-commands jesli dodajemy zupelnie nowy
 * mod, ale sama lista wersji jest odswiezana za kazdym razem).
 */

const NAMESPACE = 'mod';

const MODS_DIR = path.join(__dirname, '..', '..', 'data', 'mods');

/**
 * Kanoniczny porzadek wersji Minecrafta ktore obslugujemy w komendzie /mod.
 * Nowsze na gorze — tak samo pojawiaja sie w select menu. Kazda z tych
 * wersji moze miec (albo nie miec) jar-ki na dysku; komenda oznacza brakujace
 * jako "wkrotce" i nie pozwala ich wybrac.
 */
const MC_VERSIONS = ['26.3', '26.2', '26.1', '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4'];

function ensureDir() {
	if (!fs.existsSync(MODS_DIR)) {
		try {
			fs.mkdirSync(MODS_DIR, { recursive: true });
		} catch (error) {
			logger.warn(`Nie moglem utworzyc ${MODS_DIR}: ${error.message}`);
		}
	}
}

/** Zwraca liste modow posortowana alfabetycznie po nazwie. */
function listMods() {
	ensureDir();
	if (!fs.existsSync(MODS_DIR)) return [];

	const entries = fs.readdirSync(MODS_DIR, { withFileTypes: true });
	const mods = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const mod = readMod(entry.name);
		if (mod) mods.push(mod);
	}
	mods.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
	return mods;
}

/** Zwraca metadane pojedynczego moda albo null jesli katalog nie istnieje. */
function readMod(modId) {
	const dir = path.join(MODS_DIR, modId);
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;

	const metaPath = path.join(dir, 'mod.json');
	let meta = {};
	if (fs.existsSync(metaPath)) {
		try {
			meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
		} catch (error) {
			logger.warn(`Nie udalo sie sparsowac ${metaPath}: ${error.message}`);
		}
	}

	return {
		id: modId,
		name: meta.name || modId,
		author: meta.author || null,
		emoji: meta.emoji || '📦',
		description: meta.description || null,
		loader: meta.loader || null,
		latestVersion: meta.latestVersion || null,
		repo: meta.repo || null,
	};
}

/**
 * Zwraca liste obiektow { mc, available, jarPath, size } — po jednej dla
 * kazdej wersji Minecrafta z {@link MC_VERSIONS}, w tej samej kolejnosci.
 * `available` = true jesli plik jara istnieje w `versions/<mc>.jar`.
 */
function listVersions(modId) {
	const versionsDir = path.join(MODS_DIR, modId, 'versions');
	const rows = [];
	for (const mc of MC_VERSIONS) {
		const jarPath = path.join(versionsDir, `${mc}.jar`);
		const available = fs.existsSync(jarPath);
		let size = null;
		if (available) {
			try {
				size = fs.statSync(jarPath).size;
			} catch (error) {
				// ignore, plik zniknal miedzy stat a stat
			}
		}
		rows.push({ mc, available, jarPath, size });
	}
	return rows;
}

function getJarPath(modId, mc) {
	return path.join(MODS_DIR, modId, 'versions', `${mc}.jar`);
}

module.exports = {
	NAMESPACE,
	MC_VERSIONS,
	MODS_DIR,
	listMods,
	readMod,
	listVersions,
	getJarPath,
};
