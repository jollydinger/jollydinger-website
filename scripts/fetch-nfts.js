#!/usr/bin/env node
// Fetches all NFT pages from Post Fiat Testnet, resolves IPFS metadata,
// and writes nft-data.json. Runs server-side (GitHub Actions) — no CORS.

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const RPC_URL     = 'https://rpc.testnet.postfiat.org/';
const PFT_GW      = 'https://pft-ipfs-testnet-node-1.fly.dev/ipfs/';
const FETCH_LIMIT = 400;
const META_BATCH  = 20;   // parallel metadata fetches
const META_TIMEOUT = 12000; // ms per metadata fetch

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
  const id        = Buffer.from(hexId, 'hex');
  const versioned = Buffer.concat([Buffer.from([0x00]), id]);
  const h1        = crypto.createHash('sha256').update(versioned).digest();
  const h2        = crypto.createHash('sha256').update(h1).digest();
  const full      = Buffer.concat([versioned, h2.slice(0, 4)]);
  return base58Encode(new Uint8Array(full));
}

// ── CID validation ────────────────────────────────────────────────────────────
// Valid CIDs start with "baf" (CIDv1) or are proper base58 CIDv0 (Qm + base58 only)
const BASE58_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

function isValidCID(cid) {
  if (cid.startsWith('baf')) return true;                      // CIDv1
  if (cid.startsWith('Qm') && BASE58_RE.test(cid)) return true; // CIDv0
  return false;
}

function ipfsToGateway(uri) {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice(7).trim();
    return isValidCID(cid) ? PFT_GW + cid : null;
  }
  if (uri.startsWith('https://') || uri.startsWith('http://')) return uri;
  return null;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpGet(url, timeoutMs = META_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, res => {
      // Follow one level of redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return resolve(httpGet(res.headers.location, timeoutMs));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'] || '', body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.setTimeout(timeoutMs);
  });
}

function rpcPost(method, params) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify({ method, params: [params] });
    const url     = new URL(RPC_URL);
    const options = {
      hostname: url.hostname,
      port:     443,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Metadata resolution ───────────────────────────────────────────────────────
// Returns { imageUrl, name, description } or nulls if unresolvable
async function resolveMetadata(metaUrl) {
  try {
    const res = await httpGet(metaUrl);
    const ct  = res.contentType.toLowerCase();

    if (ct.includes('image/')) {
      // URI points directly to an image
      return { imageUrl: metaUrl, name: null, description: null };
    }

    if (ct.includes('json') || ct.includes('text/plain')) {
      let json;
      try { json = JSON.parse(res.body); } catch { return { imageUrl: null, name: null, description: null }; }
      const imageUrl = ipfsToGateway(json.image || '');
      return { imageUrl, name: json.name || null, description: json.description || null };
    }
  } catch {
    // timeout, network error, etc.
  }
  return { imageUrl: null, name: null, description: null };
}

// Run promises in batches to avoid hammering the gateway
async function batchedMap(items, fn, batchSize) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    process.stdout.write(`\r  Metadata: ${Math.min(i + batchSize, items.length)}/${items.length}   `);
  }
  console.log();
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching NFT pages from Post Fiat Testnet…');

  const rawNFTs      = [];
  const addressCache = {};
  let   marker       = null;
  let   page         = 0;

  // Step 1: Collect all NFTs from ledger
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
        const uri       = uriHex ? Buffer.from(uriHex, 'hex').toString('utf8') : '';
        const metaUrl   = ipfsToGateway(uri);

        if (!addressCache[issuerHex]) {
          addressCache[issuerHex] = accountIdToAddress(issuerHex);
        }

        rawNFTs.push({ id, issuer: addressCache[issuerHex], seq, uri, metaUrl });
      }
    }

    marker = data.result.marker || null;
    page++;
    console.log(`  Page ${page}: ${rawNFTs.length} NFTs collected`);
  } while (marker);

  // Step 2: Resolve metadata for NFTs with valid CIDs
  const resolvable = rawNFTs.filter(n => n.metaUrl);
  const skipped    = rawNFTs.length - resolvable.length;
  console.log(`\nResolving metadata for ${resolvable.length} NFTs (${skipped} skipped — invalid CID)…`);

  const metaResults = await batchedMap(resolvable, n => resolveMetadata(n.metaUrl), META_BATCH);

  // Step 3: Build final output
  const allNFTs = rawNFTs.map(nft => {
    const idx  = resolvable.indexOf(nft);
    const meta = idx >= 0 ? metaResults[idx] : { imageUrl: null, name: null, description: null };
    return {
      id:          nft.id,
      issuer:      nft.issuer,
      seq:         nft.seq,
      uri:         nft.uri,
      imageUrl:    meta.imageUrl,
      name:        meta.name,
      description: meta.description,
    };
  });

  const withImages = allNFTs.filter(n => n.imageUrl).length;
  console.log(`Done! ${allNFTs.length} NFTs total, ${withImages} with resolved images.`);

  const output = {
    fetched_at: new Date().toISOString(),
    count:      allNFTs.length,
    nfts:       allNFTs,
  };

  const outPath = path.join(__dirname, '..', 'nft-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output));
  console.log(`Saved to nft-data.json`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
