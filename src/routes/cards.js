const express = require('express');
const tcgdex = require('../tcgdex');

const router = express.Router();

router.get('/search', async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: 'Le paramètre "name" est requis' });
  }
  try {
    const cards = await tcgdex.searchCards(req.query.lang, name);
    res.json(cards);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// TCGdex's flat `variants.reverse` covers every reverse print, whatever its foil. The
// detailed list tells them apart: a plain reverse has no foil, while Poké Ball / Master Ball
// reverses carry foil "pokeball"/"Pokéball" and "masterball" (spelling varies by language).
function variantAvailability(card) {
  const flat = card.variants || {};
  const detailed = card.variants_detailed;
  if (!detailed || !detailed.length) {
    return { normal: !!flat.normal, holo: !!flat.holo, reverse: !!flat.reverse, pokeball: false, masterball: false };
  }
  const reverseFoils = detailed
    .filter((v) => (v.type || '').toLowerCase() === 'reverse')
    .map((v) => (v.foil || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, ''));
  return {
    normal: !!flat.normal,
    holo: !!flat.holo,
    reverse: reverseFoils.includes(''),
    pokeball: reverseFoils.includes('pokeball'),
    masterball: reverseFoils.includes('masterball'),
  };
}

router.get('/variants', async (req, res) => {
  const { ids, lang } = req.query;
  if (!ids) {
    return res.status(400).json({ error: 'Le paramètre "ids" est requis' });
  }
  const idList = [...new Set(ids.split(',').map((s) => s.trim()).filter(Boolean))];
  const result = {};
  const CONCURRENCY = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < idList.length) {
      const id = idList[cursor++];
      try {
        const card = await tcgdex.getCard(lang, id);
        // TCGdex marks a variant entry "generated" when no contributor has actually
        // confirmed that print for this card (it's a placeholder guess, usually seen on
        // older/less-catalogued sets). Treat that the same as "couldn't confirm" instead
        // of trusting it, so the UI never presents a guess as a fact.
        const detailed = card.variants_detailed || [];
        const isGenerated = detailed.some((v) => v.variantId === 'generated');
        result[id] = isGenerated ? null : variantAvailability(card);
      } catch (err) {
        // Could not confirm this card's real variants from TCGdex: report "unknown"
        // rather than guessing, so the UI never claims a variant exists without proof.
        result[id] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, idList.length) }, worker));
  res.json(result);
});

router.get('/:id', async (req, res) => {
  try {
    const card = await tcgdex.getCard(req.query.lang, req.params.id);
    res.json(card);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
