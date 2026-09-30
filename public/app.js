const LANG_KEY = 'pokemon-tcg-lang';

const state = {
  lang: localStorage.getItem(LANG_KEY) || 'fr',
  setsByLang: {},
  collection: new Map(), // cardId -> item
  collectionView: 'overview', // 'overview' | 'detail'
  collectionDetail: null, // { setId, lang, name, cards, ctx }
  collectionFilter: 'all', // 'all' | 'owned' | 'missing' | 'masterset'
  variantAvailability: new Map(), // cardId -> { normal, holo, reverse }
};

const els = {
  tabBtns: document.querySelectorAll('.tab-btn'),
  panels: document.querySelectorAll('.tab-panel'),
  langSelect: document.getElementById('lang-select'),

  searchInput: document.getElementById('search-input'),
  searchBtn: document.getElementById('search-btn'),
  setSearchInput: document.getElementById('set-search-input'),
  setSuggestions: document.getElementById('set-suggestions'),
  browseStatus: document.getElementById('browse-status'),
  cardGrid: document.getElementById('card-grid'),

  statsBar: document.getElementById('stats-bar'),
  collectionSetSearch: document.getElementById('collection-set-search'),
  collectionSetSuggestions: document.getElementById('collection-set-suggestions'),
  collectionBackBtn: document.getElementById('collection-back-btn'),
  collectionOfflineBtn: document.getElementById('collection-offline-btn'),
  filterBar: document.getElementById('collection-filter-bar'),
  filterBtns: document.querySelectorAll('.filter-btn'),
  collectionStatus: document.getElementById('collection-status'),
  collectionSetsGrid: document.getElementById('collection-sets-grid'),
  collectionGrid: document.getElementById('collection-grid'),

  toast: document.getElementById('toast'),
};

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 1800);
}

// Local sets point to a complete image file; TCGdex gives a base URL to suffix.
function isFullImageUrl(url) {
  return /\.(jpe?g|png|webp)(\?|$)/.test(url);
}

// TCGdex images go through our server, which keeps a copy so they survive a TCGdex outage.
function viaLocalCache(url) {
  return url.replace(/^https:\/\/assets\.tcgdex\.net\//, '/tcgdex-assets/');
}

function cardImageUrl(image, quality = 'low') {
  if (!image) return '';
  if (isFullImageUrl(image)) return image;
  return viaLocalCache(`${image}/${quality}.webp`);
}

function setLogoUrl(set) {
  if (!set || !set.logo) return null;
  if (isFullImageUrl(set.logo)) return set.logo;
  // Not every set has a .webp logo on TCGdex (some only exist as .png), so use .png here.
  return viaLocalCache(`${set.logo}.png`);
}

const VARIANT_DEFS = [
  { key: 'normal', label: 'Normale' },
  { key: 'holo', label: 'Holo' },
  { key: 'reverse', label: 'Reverse' },
  { key: 'pokeball', label: 'Poké Ball' },
  { key: 'masterball', label: 'Master Ball' },
];

function variantLabel(key) {
  return (VARIANT_DEFS.find((v) => v.key === key) || {}).label || key;
}

function totalQty(item) {
  if (!item || !item.variants) return 0;
  return VARIANT_DEFS.reduce((sum, v) => sum + (item.variants[v.key] || 0), 0);
}

// "Missing" means at least one confirmed-existing print (normal/holo/reverse) of this
// card has zero copies logged — so a card owned only in Normale but also sold in Reverse
// still counts as missing something. When we can't confirm the full variant list for a
// card, fall back to "owned nothing at all" so we never claim a print is missing without proof.
function isMissingSomething(brief, owned) {
  const availability = state.variantAvailability.get(brief.id);
  if (!availability) return !owned || totalQty(owned) === 0;
  return VARIANT_DEFS.some(({ key }) => availability[key] === true && (!owned || (owned.variants[key] || 0) === 0));
}

async function loadVariantAvailability(cardIds, lang) {
  const uncached = [...new Set(cardIds)].filter((id) => !state.variantAvailability.has(id));
  if (!uncached.length) return;
  try {
    const res = await fetch(`/api/cards/variants?ids=${encodeURIComponent(uncached.join(','))}&lang=${lang}`);
    if (!res.ok) throw new Error('request failed');
    const map = await res.json();
    // Anything the API couldn't confirm is stored as null ("unknown"), never guessed as true,
    // so createCardTile only ever offers a variant it can prove exists.
    uncached.forEach((id) => state.variantAvailability.set(id, map[id] ?? null));
  } catch (_) {
    uncached.forEach((id) => state.variantAvailability.set(id, null));
  }
}

function normalizeCode(s) {
  return (s || '').toLowerCase().trim().replace(/0(?=\d)/g, '');
}

function matchesSetQuery(set, query) {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return (
    set.name.toLowerCase().includes(q) ||
    normalizeCode(set.id).includes(normalizeCode(query))
  );
}

// ---------- Tabs ----------
els.tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    els.tabBtns.forEach((b) => b.classList.remove('active'));
    els.panels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'collection') enterCollectionTab();
  });
});

// ---------- Language ----------
els.langSelect.value = state.lang;
els.langSelect.addEventListener('change', () => {
  state.lang = els.langSelect.value;
  localStorage.setItem(LANG_KEY, state.lang);
  els.setSearchInput.value = '';
  els.searchInput.value = '';
  els.cardGrid.innerHTML = '';
  els.browseStatus.textContent = `Langue changée : recherche à nouveau une carte ou une extension.`;
});

// ---------- Collection state ----------
async function refreshCollectionMap() {
  const res = await fetch('/api/collection');
  const data = await res.json();
  state.collection = new Map(data.items.map((item) => [item.cardId, item]));
  return data;
}

async function refreshCollectionMapAndStats() {
  const data = await refreshCollectionMap();
  renderStats(data.stats);
  return data;
}

// ---------- Sets cache per language ----------
async function getSetsForLang(lang) {
  if (state.setsByLang[lang]) return state.setsByLang[lang];
  const res = await fetch(`/api/sets?lang=${lang}`);
  const sets = await res.json();
  const list = Array.isArray(sets) ? sets : sets.sets || [];
  state.setsByLang[lang] = list;
  return list;
}

// ---------- Reusable set search/autocomplete ----------
function setupSetPicker(inputEl, suggestionsEl, getLang, onSelect) {
  inputEl.addEventListener('input', async () => {
    const query = inputEl.value.trim();
    if (!query) {
      suggestionsEl.innerHTML = '';
      suggestionsEl.hidden = true;
      return;
    }
    const sets = await getSetsForLang(getLang());
    const matches = sets.filter((s) => matchesSetQuery(s, query)).slice(0, 20);
    suggestionsEl.innerHTML = '';
    if (!matches.length) {
      suggestionsEl.hidden = true;
      return;
    }
    matches.forEach((set) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = `<span class="suggestion-code">${set.id}</span><span class="suggestion-name">${set.name}</span>`;
      item.addEventListener('click', () => {
        inputEl.value = '';
        suggestionsEl.innerHTML = '';
        suggestionsEl.hidden = true;
        onSelect(set);
      });
      suggestionsEl.appendChild(item);
    });
    suggestionsEl.hidden = false;
  });

  document.addEventListener('click', (e) => {
    if (e.target !== inputEl) suggestionsEl.hidden = true;
  });
}

// ---------- Browse tab ----------
async function openBrowseSet(set) {
  els.searchInput.value = '';
  els.browseStatus.textContent = 'Chargement du set…';
  els.cardGrid.innerHTML = '';
  try {
    const res = await fetch(`/api/sets/${encodeURIComponent(set.id)}?lang=${state.lang}`);
    const full = await res.json();
    await refreshCollectionMap();
    const ctx = { setId: full.id, setName: full.name, lang: state.lang };
    const cards = full.cards || [];
    await loadVariantAvailability(cards.map((c) => c.id), state.lang);
    renderCards(cards, ctx);
    els.browseStatus.textContent = `${cards.length} carte(s) dans "${full.name}" (${state.lang.toUpperCase()})`;
  } catch (err) {
    els.browseStatus.textContent = `Erreur : ${err.message}`;
  }
}

setupSetPicker(els.setSearchInput, els.setSuggestions, () => state.lang, openBrowseSet);

async function runSearch() {
  const name = els.searchInput.value.trim();
  if (!name) return;
  els.setSearchInput.value = '';
  els.browseStatus.textContent = 'Recherche…';
  els.cardGrid.innerHTML = '';
  try {
    const res = await fetch(`/api/cards/search?name=${encodeURIComponent(name)}&lang=${state.lang}`);
    const cards = await res.json();
    const list = Array.isArray(cards) ? cards : cards.cards || [];
    await refreshCollectionMap();
    await loadVariantAvailability(list.map((c) => c.id), state.lang);
    renderCards(list, { lang: state.lang });
    els.browseStatus.textContent = `${list.length} résultat(s) pour "${name}" (${state.lang.toUpperCase()})`;
  } catch (err) {
    els.browseStatus.textContent = `Erreur : ${err.message}`;
  }
}
els.searchBtn.addEventListener('click', runSearch);
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearch();
});

function renderCards(cards, ctx) {
  els.cardGrid.innerHTML = '';
  cards.forEach((brief) => {
    els.cardGrid.appendChild(createCardTile(brief, ctx, () => renderCards(cards, ctx)));
  });
}

function createCardTile(brief, ctx, rerender) {
  const owned = state.collection.get(brief.id);
  const card = document.createElement('div');
  card.className = owned && totalQty(owned) > 0 ? 'card-item' : 'card-item missing';

  if (owned && totalQty(owned) > 0) {
    const badge = document.createElement('div');
    badge.className = 'qty-badge';
    badge.textContent = `×${totalQty(owned)}`;
    card.appendChild(badge);
  }

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.src = cardImageUrl(brief.image);
  img.alt = brief.name;
  img.onerror = () => { img.style.visibility = 'hidden'; };
  card.appendChild(img);

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = brief.name;
  name.title = brief.name;
  card.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `#${brief.localId ?? '?'}`;
  card.appendChild(meta);

  const availability = state.variantAvailability.get(brief.id); // object | null (unconfirmed) | undefined (not loaded yet)

  if (availability === null) {
    const warning = document.createElement('div');
    warning.className = 'variant-warning';
    warning.textContent = 'Variantes non vérifiées (API indisponible)';
    card.appendChild(warning);
  }

  const variantRows = document.createElement('div');
  variantRows.className = 'variant-rows';
  VARIANT_DEFS.forEach(({ key, label }) => {
    const count = owned ? owned.variants[key] || 0 : 0;
    // Only offer a variant TCGdex explicitly confirms exists for this print, or one the
    // collection already has copies logged under (real recorded data, never a guess).
    const shouldShow = (availability && availability[key] === true) || count > 0;
    if (!shouldShow) return;

    const row = document.createElement('div');
    row.className = 'variant-row';

    const lbl = document.createElement('span');
    lbl.className = 'variant-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const controls = document.createElement('div');
    controls.className = 'qty-controls';

    const minusBtn = document.createElement('button');
    minusBtn.textContent = '−';
    minusBtn.disabled = count <= 0;
    minusBtn.addEventListener('click', () => changeVariantQty(brief, ctx, key, count - 1, rerender));

    const val = document.createElement('span');
    val.className = 'qty-value';
    val.textContent = count;

    const plusBtn = document.createElement('button');
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => changeVariantQty(brief, ctx, key, count + 1, rerender));

    controls.append(minusBtn, val, plusBtn);
    row.appendChild(controls);
    variantRows.appendChild(row);
  });
  card.appendChild(variantRows);

  return card;
}

async function changeVariantQty(brief, ctx, variant, newQty, rerender) {
  const owned = state.collection.get(brief.id);
  try {
    if (!owned || totalQty(owned) === 0) {
      if (newQty <= 0) return;
      await addToCollection(brief, ctx, variant, newQty);
    } else {
      const res = await fetch(`/api/collection/${encodeURIComponent(brief.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant, quantity: newQty }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(`Erreur : ${err.error || res.statusText}`);
      }
    }
  } catch (err) {
    showToast(`Erreur : ${err.message}`);
  }
  await refreshCollectionMapAndStats();
  rerender();
}

async function addToCollection(brief, ctx, variant = 'normal', qty = 1) {
  const lang = ctx.lang || state.lang;
  let full = brief;
  try {
    const res = await fetch(`/api/cards/${encodeURIComponent(brief.id)}?lang=${lang}`);
    if (res.ok) full = await res.json();
  } catch (_) {
    // fallback to the brief data already at hand
  }

  const payload = {
    id: brief.id,
    name: full.name || brief.name,
    image: full.image || brief.image,
    localId: full.localId || brief.localId,
    setId: ctx.setId || (full.set && full.set.id) || null,
    setName: ctx.setName || (full.set && full.set.name) || null,
    rarity: full.rarity || null,
    category: full.category || null,
    lang,
    variant,
    qty,
  };
  const res = await fetch('/api/collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    showToast(`${brief.name} (${variantLabel(variant)}) ajouté à la collection`);
  } else {
    const err = await res.json().catch(() => ({}));
    showToast(`Erreur : ${err.error || res.statusText}`);
  }
}

// ---------- Collection tab ----------
async function enterCollectionTab() {
  const data = await refreshCollectionMap();
  renderStats(data.stats);
  if (state.collectionView === 'detail' && state.collectionDetail) {
    renderCollectionCards();
  } else {
    renderCollectionOverview(data.items);
  }
}

function renderStats(stats) {
  els.statsBar.innerHTML = '';
  const cards = [
    { label: 'Cartes possédées (total)', value: stats.totalCards },
    { label: 'Cartes uniques', value: stats.uniqueCards },
    { label: 'Extensions représentées', value: stats.setCount },
  ];
  cards.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'stat-card';
    div.innerHTML = `<div class="value">${c.value}</div><div class="label">${c.label}</div>`;
    els.statsBar.appendChild(div);
  });
}

function groupOwnedBySet(items) {
  const groups = new Map(); // key setId::lang -> group
  items.forEach((item) => {
    if (!item.setId) return;
    const key = `${item.setId}::${item.lang || 'fr'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        setId: item.setId,
        setName: item.setName || item.setId,
        lang: item.lang || 'fr',
        uniqueCount: 0,
        totalQty: 0,
        localIds: [],
      });
    }
    const g = groups.get(key);
    g.uniqueCount += 1;
    g.totalQty += totalQty(item);
    g.localIds.push(item.localId);
  });
  return Array.from(groups.values());
}

function isBaseSetNumber(localId, official) {
  const n = Number(localId);
  return /^\d+$/.test(localId || '') && n >= 1 && n <= official;
}

function progressRow(label, owned, total, kind) {
  const pct = Math.min(100, (owned / total) * 100);
  return `
    <div class="progress-row">
      <div class="progress-label"><span>${label}</span><span>${owned}/${total}</span></div>
      <div class="progress"><div class="progress-bar ${kind}" style="width:${pct}%"></div></div>
    </div>`;
}

async function renderCollectionOverview(items) {
  state.collectionView = 'overview';
  state.collectionDetail = null;
  els.collectionBackBtn.hidden = true;
  els.collectionOfflineBtn.hidden = true;
  els.filterBar.hidden = true;
  els.collectionGrid.hidden = true;
  els.collectionGrid.innerHTML = '';
  els.collectionSetsGrid.hidden = false;

  const groups = groupOwnedBySet(items);
  if (!groups.length) {
    els.collectionStatus.textContent =
      'Ta collection est vide pour le moment. Utilise "Parcourir" ou la recherche d\'extension ci-dessus pour ajouter des cartes.';
    els.collectionSetsGrid.innerHTML = '';
    return;
  }
  els.collectionStatus.textContent = '';

  const langs = [...new Set(groups.map((g) => g.lang))];
  const countsByKey = {};
  for (const lang of langs) {
    const sets = await getSetsForLang(lang);
    sets.forEach((s) => {
      countsByKey[`${s.id}::${lang}`] = s.cardCount || {};
    });
  }

  els.collectionSetsGrid.innerHTML = '';
  groups
    .sort((a, b) => a.setName.localeCompare(b.setName))
    .forEach((g) => {
      const { official, total } = countsByKey[`${g.setId}::${g.lang}`] || {};
      // Base set: cards numbered up to the official count. Everything past it (secret, full
      // art, gold, lettered cards...) only counts toward the master set.
      const baseOwned = official ? g.localIds.filter((id) => isBaseSetNumber(id, official)).length : 0;
      const logoSet = (state.setsByLang[g.lang] || []).find((s) => s.id === g.setId);
      const logoUrl = setLogoUrl(logoSet);

      const tile = document.createElement('div');
      tile.className = 'set-tile';
      tile.innerHTML = `
        <div class="qty-badge">×${g.totalQty}</div>
        ${logoUrl ? `<img src="${logoUrl}" alt="${g.setName}" class="set-logo" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className:'set-logo placeholder'}))" />` : `<div class="set-logo placeholder"></div>`}
        <div class="set-tile-name" title="${g.setName}">${g.setName}</div>
        <div class="set-tile-meta">${g.lang.toUpperCase()} · ${g.uniqueCount} carte(s) unique(s)</div>
        <div class="tile-progress">
          ${official ? progressRow('Set de base', baseOwned, official, 'base') : ''}
          ${total ? progressRow('Master set', g.uniqueCount, total, 'master') : ''}
        </div>
      `;
      tile.addEventListener('click', () => openCollectionDetail(g.setId, g.lang));
      els.collectionSetsGrid.appendChild(tile);
    });
}

async function openCollectionDetail(setId, lang) {
  state.collectionView = 'detail';
  state.collectionFilter = 'all';
  els.filterBtns.forEach((b) => b.classList.toggle('active', b.dataset.filter === 'all'));

  els.collectionSetsGrid.hidden = true;
  els.collectionGrid.hidden = false;
  els.collectionBackBtn.hidden = false;
  els.collectionOfflineBtn.hidden = false;
  els.filterBar.hidden = false;
  els.collectionStatus.textContent = 'Chargement…';
  els.collectionGrid.innerHTML = '';

  try {
    const res = await fetch(`/api/sets/${encodeURIComponent(setId)}?lang=${lang}`);
    const set = await res.json();
    const ctx = { setId: set.id, setName: set.name, lang };
    state.collectionDetail = { setId: set.id, lang, name: set.name, cards: set.cards || [], ctx };
    await loadVariantAvailability((set.cards || []).map((c) => c.id), lang);
    renderCollectionCards();
    els.collectionStatus.textContent = `${set.name} (${lang.toUpperCase()}) · ${(set.cards || []).length} carte(s) au total`;
  } catch (err) {
    els.collectionStatus.textContent = `Erreur : ${err.message}`;
  }
}

els.collectionBackBtn.addEventListener('click', async () => {
  const data = await refreshCollectionMapAndStats();
  renderCollectionOverview(data.items);
});

els.collectionOfflineBtn.addEventListener('click', async () => {
  const { setId, lang, name } = state.collectionDetail || {};
  if (!setId) return;
  const btn = els.collectionOfflineBtn;
  btn.disabled = true;
  btn.textContent = '⏳ Téléchargement…';
  try {
    const res = await fetch(`/api/sets/${encodeURIComponent(setId)}/offline?lang=${lang}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    showToast(
      data.failed
        ? `${name} : ${data.failed} élément(s) non récupéré(s), réessaie plus tard`
        : `${name} disponible hors ligne (${data.cards} cartes, ${data.images} images)`
    );
  } catch (err) {
    showToast(`Erreur : ${err.message}`);
  }
  btn.disabled = false;
  btn.textContent = '⬇ Garder hors ligne';
});

els.filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    els.filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.collectionFilter = btn.dataset.filter;
    renderCollectionCards();
  });
});

setupSetPicker(els.collectionSetSearch, els.collectionSetSuggestions, () => state.lang, async (set) => {
  await refreshCollectionMapAndStats();
  openCollectionDetail(set.id, state.lang);
});

function renderCollectionCards() {
  const { cards, ctx } = state.collectionDetail;
  const filtered = cards.filter((brief) => {
    const owned = state.collection.get(brief.id);
    if (state.collectionFilter === 'owned') return !!owned && totalQty(owned) > 0;
    if (state.collectionFilter === 'missing') return !owned || totalQty(owned) === 0;
    if (state.collectionFilter === 'masterset') return isMissingSomething(brief, owned);
    return true;
  });

  els.collectionGrid.innerHTML = '';
  filtered.forEach((brief) => {
    els.collectionGrid.appendChild(createCardTile(brief, ctx, () => renderCollectionCards()));
  });
}

// ---------- Init ----------
getSetsForLang(state.lang);
refreshCollectionMap();
