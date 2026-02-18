#!/usr/bin/env node
// Fetches all NFT pages from Post Fiat Testnet and writes nft-data.json.
// Runs server-side (GitHub Actions) — no CORS restrictions.

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const RPC_URL    = 'https://rpc.testnet.postfiat.org/';
const IPFS_GW    = 'https://ipfs.io/ipfs/';
const FETCH_LIMIT = 400;

// ── XRPL Base58Check ──────────────────────────────────────────────────────────
const B58_ALPHA = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

function base58Encode(bytes) {
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leadingZeros++;
  }
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let result = '';
  while (n > 0n) {
    result = B58_ALPHA[Number(n % 58n)] + result;
    n = n / 58n;
  }
  return B58_ALPHA[0].repeat(leadingZeros) + result;
}

function accountIdToAddress(hexId) {
  const id       = Buffer.from(hexId, 'hex');
  const versioned = Buffer.concat([Buffer.from([0x00]), id]);
  const h1        = crypto.createHash('sha256').update(versioned).digest();
  const h2        = crypto.createHash('sha256').update(h1).digest();
  const full      = Buffer.concat([versioned, h2.slice(0, 4)]);
  return base58Encode(new Uint8Array(full));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function hexToStr(hex) {
  return Buffer.from(hex, 'hex').toString('utf8');
}

function resolveImageUrl(uri) {
  if (uri.startsWith('ipfs://')) {
    const hash = uri.slice(7).trim();
    if (hash) return IPFS_GW + hash;
  }
  if (uri.startsWith('https://') || uri.startsWith('http://')) return uri;
  return null;
}

// ── RPC ───────────────────────────────────────────────────────────────────────
function rpcPost(method, params) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify({ method, params: [params] });
    const url     = new URL(RPC_URL);
    const options = {
      hostname: url.hostname,
      port:     443,
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching NFT data from Post Fiat Testnet…');

  const allNFTs      = [];
  const addressCache = {};
  let   marker       = null;
  let   page         = 0;

  do {
    const params = { type: 'nft_page', limit: FETCH_LIMIT, ledger_index: 'validated' };
    if (marker) params.marker = marker;

    const data = await rpcPost('ledger_data', params);
    if (data.result.error) throw new Error(data.result.error_message || data.result.error);

    for (const entry of (data.result.state || [])) {
      for (const t of (entry.NFTokens || [])) {
        const token     = t.NFToken;
        const id        = token.NFTokenID;
        const uriHex    = token.URI || '';
        const issuerHex = id.slice(8, 48);
        const seq       = parseInt(id.slice(56, 64), 16);
        const uri       = uriHex ? hexToStr(uriHex) : '';
        const imageUrl  = resolveImageUrl(uri);

        if (!addressCache[issuerHex]) {
          addressCache[issuerHex] = accountIdToAddress(issuerHex);
        }

        allNFTs.push({ id, issuer: addressCache[issuerHex], seq, uri, imageUrl });
      }
    }

    marker = data.result.marker || null;
    page++;
    console.log(`  Page ${page}: ${allNFTs.length} NFTs collected`);
  } while (marker);

  const output = {
    fetched_at: new Date().toISOString(),
    count:      allNFTs.length,
    nfts:       allNFTs,
  };

  const outPath = path.join(__dirname, '..', 'nft-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output));
  console.log(`Done! Saved ${allNFTs.length} NFTs to nft-data.json`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
