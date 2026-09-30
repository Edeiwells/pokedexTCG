const express = require('express');
const tcgdex = require('../tcgdex');
const { ensureAsset } = require('../assets');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const sets = await tcgdex.getSets(req.query.lang);
    res.json(sets);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Release dates for a list of "lang:setId" keys (the sets list from TCGdex doesn't carry them).
router.get('/release-dates', async (req, res) => {
  const keys = [...new Set(String(req.query.keys || '').split(',').filter(Boolean))];
  const result = {};
  await Promise.all(keys.map(async (key) => {
    const sep = key.indexOf(':');
    try {
      const set = await tcgdex.getSet(key.slice(0, sep), key.slice(sep + 1));
      result[key] = set.releaseDate || null;
    } catch (_) {
      result[key] = null;
    }
  }));
  res.json(result);
});

router.get('/:id', async (req, res) => {
  try {
    const set = await tcgdex.getSet(req.query.lang, req.params.id);
    res.json(set);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const TCGDEX_ASSETS = 'https://assets.tcgdex.net/';

// Saves everything needed to use this set without TCGdex: the set, every card's details
// (used for variants) and every card image and logo. Anything already saved is reused.
router.post('/:id/offline', async (req, res) => {
  const { lang } = req.query;
  try {
    const set = await tcgdex.getSet(lang, req.params.id);
    const cards = set.cards || [];
    const assetPaths = cards
      .filter((c) => c.image && c.image.startsWith(TCGDEX_ASSETS))
      .map((c) => `${c.image.slice(TCGDEX_ASSETS.length)}/low.webp`);
    const sets = await tcgdex.getSets(lang);
    const listed = sets.find((s) => s.id === set.id);
    if (listed && listed.logo && listed.logo.startsWith(TCGDEX_ASSETS)) {
      assetPaths.push(`${listed.logo.slice(TCGDEX_ASSETS.length)}.png`);
    }

    const tasks = [
      ...cards.map((c) => () => tcgdex.getCard(lang, c.id)),
      ...assetPaths.map((p) => async () => {
        if (!(await ensureAsset(p))) throw new Error(p);
      }),
    ];
    let failed = 0;
    let cursor = 0;
    async function worker() {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        await task().catch(() => { failed += 1; });
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    res.json({ cards: cards.length, images: assetPaths.length, failed });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
