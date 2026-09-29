const fs = require('fs');
const path = require('path');

const BASE = 'https://api.tcgdex.net/v2';
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

const SUPPORTED_LANGS = new Set(['fr', 'ja', 'zh-cn', 'ko']);
const DEFAULT_LANG = process.env.TCGDEX_LANG || 'fr';

function normalizeLang(lang) {
  return SUPPORTED_LANGS.has(lang) ? lang : DEFAULT_LANG;
}

const cache = new Map();

// Every successful TCGdex response is also saved to disk, and served from there when
// TCGdex is down, so everything already viewed keeps working without the API.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const API_CACHE_DIR = path.join(DATA_DIR, 'cache', 'api');

function diskCacheFile(pathAndQuery) {
  return path.join(API_CACHE_DIR, `${encodeURIComponent(pathAndQuery)}.json`);
}

function readDiskCache(pathAndQuery) {
  try {
    return JSON.parse(fs.readFileSync(diskCacheFile(pathAndQuery), 'utf-8'));
  } catch (_) {
    return undefined;
  }
}

function writeDiskCache(pathAndQuery, data) {
  try {
    fs.mkdirSync(API_CACHE_DIR, { recursive: true });
    fs.writeFileSync(diskCacheFile(pathAndQuery), JSON.stringify(data));
  } catch (err) {
    console.warn(`Cache disque impossible pour ${pathAndQuery} : ${err.message}`);
  }
}

async function rawFetch(pathAndQuery) {
  let res;
  try {
    res = await fetch(`${BASE}${pathAndQuery}`, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    res = null; // network error or timeout: TCGdex unreachable
  }
  if (res && res.ok) {
    const data = await res.json();
    writeDiskCache(pathAndQuery, data);
    return data;
  }
  // A 4xx is a real answer (e.g. unknown card); only fall back when TCGdex itself fails.
  if (!res || res.status >= 500) {
    const saved = readDiskCache(pathAndQuery);
    if (saved !== undefined) return saved;
  }
  const status = res ? res.status : 'injoignable';
  throw new Error(`Erreur API TCGdex (${status}) sur ${pathAndQuery}`);
}

async function cachedFetch(pathAndQuery) {
  const hit = cache.get(pathAndQuery);
  if (hit && Date.now() - hit.time < CACHE_TTL) {
    return hit.data;
  }
  const data = await rawFetch(pathAndQuery);
  cache.set(pathAndQuery, { data, time: Date.now() });
  return data;
}

// ---------- Local sets ----------
// Some sets exist on TCGdex without any card list (e.g. most Korean sets) or without a logo.
// A JSON file in src/local-sets/<lang>/<SETID>.json fills those gaps: its set fields (logo,
// name...) override TCGdex's, and its `cards` are used only when TCGdex has none.
const LOCAL_DIR = path.join(__dirname, 'local-sets');

function loadLocalSets() {
  const byLang = {};
  if (!fs.existsSync(LOCAL_DIR)) return byLang;
  for (const lang of fs.readdirSync(LOCAL_DIR)) {
    const dir = path.join(LOCAL_DIR, lang);
    if (!fs.statSync(dir).isDirectory()) continue;
    byLang[lang] = {};
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const set = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      byLang[lang][set.id] = set;
    }
  }
  return byLang;
}

const localSets = loadLocalSets();

function localSet(lang, id) {
  return (localSets[lang] || {})[id] || null;
}

function localCard(lang, cardId) {
  const setId = cardId.slice(0, cardId.lastIndexOf('-'));
  const set = localSet(lang, setId);
  const card = set && set.cards && set.cards.find((c) => c.id === cardId);
  if (!card) return null;
  return { ...card, set: { id: set.id, name: set.name, cardCount: set.cardCount } };
}

function setBrief(set) {
  const { cards, cardImages, source, ...brief } = set;
  return brief;
}

// `cardImages` ({ localId: url }) fills in images TCGdex is missing for cards it does list.
function withLocalImage(lang, card, setId = card.set ? card.set.id : card.id.slice(0, card.id.lastIndexOf('-'))) {
  if (card.image) return card;
  const set = localSet(lang, setId);
  const image = set && set.cardImages && set.cardImages[card.localId];
  return image ? { ...card, image } : card;
}

// Asian set code -> equivalent French set, whose logo is shown by default (the tile still
// shows the real language). Sets without an equivalent keep their own logo.
const frEquivalents = JSON.parse(fs.readFileSync(path.join(LOCAL_DIR, 'fr-equivalents.json'), 'utf-8'));

async function withFrenchLogos(lang, sets) {
  if (lang === 'fr') return sets;
  const frLogos = new Map((await getSets('fr')).map((s) => [s.id, s.logo]));
  return sets.map((s) => {
    const frLogo = frLogos.get(frEquivalents[s.id]);
    return frLogo ? { ...s, logo: frLogo } : s;
  });
}

async function getSets(lang) {
  const l = normalizeLang(lang);
  const remote = await cachedFetch(`/${l}/sets`);
  const known = new Set(remote.map((s) => s.id));
  const extra = Object.values(localSets[l] || {}).filter((s) => !known.has(s.id)).map(setBrief);
  const sets = [...remote.map((s) => ({ ...s, ...setBrief(localSet(l, s.id) || {}) })), ...extra];
  return withFrenchLogos(l, sets);
}

async function getSet(lang, id) {
  const l = normalizeLang(lang);
  const local = localSet(l, id);
  let remote = null;
  try {
    remote = await cachedFetch(`/${l}/sets/${encodeURIComponent(id)}`);
  } catch (err) {
    if (!local || !local.cards) throw err;
  }
  if (!local) return remote;
  const merged = { ...remote, ...setBrief(local) };
  if (remote && remote.cards && remote.cards.length) {
    // TCGdex has the real card list: keep its own count too.
    const cards = remote.cards.map((c) => withLocalImage(l, c, id));
    return { ...merged, cardCount: remote.cardCount, cards };
  }
  return { ...merged, cards: local.cards || (remote && remote.cards) || [] };
}

async function getCard(lang, id) {
  const l = normalizeLang(lang);
  return localCard(l, id) || withLocalImage(l, await cachedFetch(`/${l}/cards/${encodeURIComponent(id)}`));
}

async function searchCards(lang, name) {
  const l = normalizeLang(lang);
  const q = name.toLowerCase();
  const local = Object.values(localSets[l] || {}).flatMap((s) =>
    (s.cards || []).filter((c) => c.name.toLowerCase().includes(q))
  );
  const remote = await rawFetch(`/${l}/cards?name=${encodeURIComponent(name)}&pagination:itemsPerPage=60`);
  const seen = new Set(remote.map((c) => c.id));
  return [...remote.map((c) => withLocalImage(l, c)), ...local.filter((c) => !seen.has(c.id))];
}

module.exports = {
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  normalizeLang,
  getSeries: (lang) => cachedFetch(`/${normalizeLang(lang)}/series`),
  getSets,
  getSet,
  getCard,
  searchCards,
};
