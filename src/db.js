const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'collection.json');

const VARIANTS = ['normal', 'holo', 'reverse'];

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, '{}');
  }
}

function normalizeVariant(variant) {
  return VARIANTS.includes(variant) ? variant : 'normal';
}

function emptyVariants() {
  return { normal: 0, holo: 0, reverse: 0 };
}

function totalQuantity(item) {
  return VARIANTS.reduce((sum, v) => sum + (item.variants?.[v] || 0), 0);
}

// Older entries only had a flat "quantity" field (no variant breakdown).
// Treat that historical quantity as "normal" prints so no owned card is lost.
function migrate(data) {
  let changed = false;
  for (const item of Object.values(data)) {
    if (!item.variants) {
      item.variants = { normal: item.quantity || 0, holo: 0, reverse: 0 };
      delete item.quantity;
      changed = true;
    }
  }
  return changed;
}

function load() {
  ensureFile();
  const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  if (migrate(data)) {
    persist(data);
  }
  return data;
}

function persist(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function getAll() {
  return Object.values(load());
}

function addCard(card, qty, variant) {
  const v = normalizeVariant(variant);
  const data = load();
  const existing = data[card.id];
  if (existing) {
    existing.variants[v] = (existing.variants[v] || 0) + qty;
  } else {
    const variants = emptyVariants();
    variants[v] = qty;
    data[card.id] = {
      cardId: card.id,
      name: card.name || card.id,
      image: card.image || null,
      localId: card.localId || null,
      setId: card.setId || null,
      setName: card.setName || null,
      lang: card.lang || 'fr',
      rarity: card.rarity || null,
      category: card.category || null,
      variants,
      addedAt: new Date().toISOString(),
    };
  }
  persist(data);
  return data[card.id];
}

function setVariantQuantity(cardId, variant, quantity) {
  const v = normalizeVariant(variant);
  const data = load();
  if (!data[cardId]) return null;
  data[cardId].variants[v] = Math.max(0, quantity);
  if (totalQuantity(data[cardId]) <= 0) {
    delete data[cardId];
    persist(data);
    return { cardId, removed: true };
  }
  persist(data);
  return data[cardId];
}

function removeCard(cardId) {
  const data = load();
  delete data[cardId];
  persist(data);
}

function stats() {
  const all = getAll();
  const totalCards = all.reduce((sum, c) => sum + totalQuantity(c), 0);
  const uniqueCards = all.length;
  const bySet = {};
  const setsSeen = new Set();
  for (const c of all) {
    const key = `${c.setName || 'Set inconnu'} (${(c.lang || 'fr').toUpperCase()})`;
    bySet[key] = (bySet[key] || 0) + totalQuantity(c);
    if (c.setId) setsSeen.add(`${c.setId}::${c.lang || 'fr'}`);
  }
  return { totalCards, uniqueCards, setCount: setsSeen.size, bySet };
}

module.exports = { VARIANTS, getAll, addCard, setVariantQuantity, removeCard, stats };
