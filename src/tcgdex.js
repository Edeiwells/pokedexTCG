const BASE = 'https://api.tcgdex.net/v2';
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

const SUPPORTED_LANGS = new Set(['fr', 'ja']);
const DEFAULT_LANG = process.env.TCGDEX_LANG || 'fr';

function normalizeLang(lang) {
  return SUPPORTED_LANGS.has(lang) ? lang : DEFAULT_LANG;
}

const cache = new Map();

async function rawFetch(pathAndQuery) {
  const res = await fetch(`${BASE}${pathAndQuery}`);
  if (!res.ok) {
    throw new Error(`Erreur API TCGdex (${res.status}) sur ${pathAndQuery}`);
  }
  return res.json();
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

module.exports = {
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  normalizeLang,
  getSeries: (lang) => cachedFetch(`/${normalizeLang(lang)}/series`),
  getSets: (lang) => cachedFetch(`/${normalizeLang(lang)}/sets`),
  getSet: (lang, id) => cachedFetch(`/${normalizeLang(lang)}/sets/${encodeURIComponent(id)}`),
  getCard: (lang, id) => cachedFetch(`/${normalizeLang(lang)}/cards/${encodeURIComponent(id)}`),
  searchCards: (lang, name) =>
    rawFetch(`/${normalizeLang(lang)}/cards?name=${encodeURIComponent(name)}&pagination:itemsPerPage=60`),
};
