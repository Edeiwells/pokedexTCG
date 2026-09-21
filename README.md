# Ma Collection Pokémon

Petite application pour lister les cartes Pokémon que tu possèdes et compter combien tu en as, en s'appuyant sur l'API [TCGdex](https://tcgdex.dev/fr) pour les données/images des cartes.

## Fonctionnalités

- Parcourir les cartes par set, ou les rechercher par nom.
- Ajouter une carte à sa collection (avec quantité).
- Voir sa collection : nombre total de cartes, nombre de cartes uniques, répartition par set.
- Modifier la quantité ou retirer une carte de la collection.

## Lancer avec Docker

```bash
docker compose up -d --build
```

Puis ouvrir [http://localhost:3000](http://localhost:3000).

Ta collection est stockée dans `./data/collection.json`, monté en volume : elle survit donc aux redémarrages/rebuilds du conteneur.

Pour arrêter :

```bash
docker compose down
```

## Configuration

Variables d'environnement (définies dans `docker-compose.yml`) :

- `TCGDEX_LANG` : langue des données TCGdex (`fr` par défaut).
- `PORT` : port d'écoute du serveur (3000 par défaut).

## Développement sans Docker

```bash
npm install
npm start
```

Nécessite Node.js 20+.
