#!/usr/bin/env node
// Reads nft-data.json, tags each NFT's dominant colors using OpenRouter vision API,
// caches results in nft-colors.json, and writes colors back into nft-data.json.
// Only untagged NFTs are sent to the API — already-cached entries are skipped.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const MODEL          = 'anthropic/claude-3-5-haiku';
const BATCH_SIZE     = 5;
const VALID_COLORS   = new Set(['red', 'blue', 'green', 'white', 'black']);

if (!OPENROUTER_KEY) {
  console.error('OPENROUTER_API_KEY env var is required');
  process.exit(1);
}

// ── OpenRouter API call ────────────────────────────────────────────────────────
function orPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: 'openrouter.ai',
      path:     '/api/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer':   'https://jollydinger.com',
        'X-Title':        'JollyDinger NFT Color Tagger',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message + ' body: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Returns array of matching colors, [] if none, null if API error (will not be cached)
async function tagColor(imageUrl) {
  try {
    const result = await orPost({
      model:      MODEL,
      max_tokens: 20,
      messages: [{
        role:    'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: 'Look at this NFT image. Focus on the central character or avatar — their color is the dominant color of the image.\n\nAssign color tags using these rules:\n1. Identify the single dominant color of the central character/avatar and assign that tag. Choose from: red, blue, green, white, black.\n2. Only assign two tags if the image is very close to a 50/50 split between two colors (e.g. half blue half green) — this should be rare.\n3. Additionally assign "red" if there are any clearly red objects or an explicitly red background in the image, regardless of the dominant color.\n\nRespond with only the color name(s) separated by commas (e.g. "blue" or "blue, red"), or "none" if none of the five colors apply.' },
        ],
      }],
    });
    const text = result.choices?.[0]?.message?.content?.toLowerCase().trim() || 'none';
    if (text === 'none') return [];
    return text.split(',').map(s => s.trim()).filter(c => VALID_COLORS.has(c));
  } catch (err) {
    console.warn(`\n  Warning: failed to tag ${imageUrl.slice(-40)}: ${err.message}`);
    return null; // null = error, will not be cached (retried next run)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const nftPath   = path.join(__dirname, '..', 'nft-data.json');
  const colorPath = path.join(__dirname, '..', 'nft-colors.json');

  const nftData    = JSON.parse(fs.readFileSync(nftPath, 'utf8'));
  const colorCache = fs.existsSync(colorPath)
    ? JSON.parse(fs.readFileSync(colorPath, 'utf8'))
    : {};

  const untagged = nftData.nfts.filter(n => n.imageUrl && !(n.id in colorCache));
  console.log(`Color cache: ${Object.keys(colorCache).length} entries cached. ${untagged.length} NFTs to tag.`);

  let tagged = 0;
  for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
    const batch   = untagged.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(n => tagColor(n.imageUrl)));
    for (let j = 0; j < batch.length; j++) {
      if (results[j] !== null) {         // null = API error, skip caching so it retries next run
        colorCache[batch[j].id] = results[j];
        tagged++;
      }
    }
    process.stdout.write(`\r  Tagged: ${Math.min(i + BATCH_SIZE, untagged.length)}/${untagged.length}   `);
  }
  if (untagged.length > 0) console.log();
  console.log(`Tagged ${tagged} new NFTs.`);

  // Save updated cache
  fs.writeFileSync(colorPath, JSON.stringify(colorCache, null, 2));
  console.log('Saved nft-colors.json');

  // Merge colors back into nft-data.json
  for (const nft of nftData.nfts) {
    nft.colors = colorCache[nft.id] ?? [];
  }
  fs.writeFileSync(nftPath, JSON.stringify(nftData));
  console.log('Updated nft-data.json with color tags');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
