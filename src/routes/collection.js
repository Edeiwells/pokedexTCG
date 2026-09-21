const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ items: db.getAll(), stats: db.stats() });
});

router.post('/', (req, res) => {
  const { id, variant } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Le champ "id" est requis' });
  }
  const qty = Number.isFinite(req.body.qty) && req.body.qty > 0 ? req.body.qty : 1;
  const card = db.addCard(req.body, qty, variant);
  res.json(card);
});

router.patch('/:cardId', (req, res) => {
  const { quantity, variant } = req.body;
  if (typeof quantity !== 'number') {
    return res.status(400).json({ error: 'Le champ "quantity" (nombre) est requis' });
  }
  const result = db.setVariantQuantity(req.params.cardId, variant, quantity);
  if (!result) {
    return res.status(404).json({ error: 'Carte non trouvée dans la collection' });
  }
  res.json(result);
});

router.delete('/:cardId', (req, res) => {
  db.removeCard(req.params.cardId);
  res.json({ ok: true });
});

module.exports = router;
