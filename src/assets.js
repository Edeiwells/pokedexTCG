const fs = require('fs');
const path = require('path');

// Card images and set logos from assets.tcgdex.net, saved to disk the first time they are
// requested and served from there afterwards, so they stay available if TCGdex goes down.
const ASSETS_BASE = 'https://assets.tcgdex.net';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ASSETS_CACHE_DIR = path.join(DATA_DIR, 'cache', 'assets');

// Only plain TCGdex asset paths (e.g. fr/sv/sv08/001/low.webp): no "..", no query string.
const VALID_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.(webp|png|jpg)$/;

function isValidAssetPath(assetPath) {
  return VALID_PATH.test(assetPath) && !assetPath.split('/').includes('..');
}

// Returns the local file for this asset, downloading it first if needed; null if TCGdex
// doesn't have it (or is unreachable and it was never saved).
async function ensureAsset(assetPath) {
  const file = path.join(ASSETS_CACHE_DIR, assetPath);
  if (fs.existsSync(file)) return file;
  let res;
  try {
    res = await fetch(`${ASSETS_BASE}/${assetPath}`, { signal: AbortSignal.timeout(15000) });
  } catch (_) {
    return null;
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) return null;
  const data = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write then rename, so an interrupted download never leaves a truncated image behind.
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
  return file;
}

async function assetHandler(req, res) {
  const assetPath = req.params[0];
  if (!isValidAssetPath(assetPath)) return res.status(400).end();
  const file = await ensureAsset(assetPath);
  if (!file) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=604800');
  res.sendFile(file);
}

module.exports = { ensureAsset, assetHandler };
