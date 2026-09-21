const express = require('express');
const tcgdex = require('../tcgdex');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const sets = await tcgdex.getSets(req.query.lang);
    res.json(sets);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const set = await tcgdex.getSet(req.query.lang, req.params.id);
    res.json(set);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
