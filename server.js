const express = require('express');
const path = require('path');

const setsRouter = require('./src/routes/sets');
const cardsRouter = require('./src/routes/cards');
const collectionRouter = require('./src/routes/collection');
const { assetHandler } = require('./src/assets');

const app = express();
app.use(express.json());

app.use('/api/sets', setsRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/collection', collectionRouter);
app.get('/tcgdex-assets/*', assetHandler);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Pokemon collection app listening on port ${PORT}`);
});
