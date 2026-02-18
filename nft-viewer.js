// ── Config ────────────────────────────────────────────────────────────────────
const RPC_URL        = 'https://rpc.testnet.postfiat.org/';
const IPFS_GW        = 'https://ipfs.io/ipfs/';
const FETCH_LIMIT    = 400;

// ── State ─────────────────────────────────────────────────────────────────────
let allNFTs      = [];   // all parsed NFTs
let addressCache = {};   // issuerHex → XRPL r-address
let currentFilter = '';  // active wallet filter (XRPL address or '')
let currentSort   = 'seq-desc';

// ── XRPL Base58Check encoding ─────────────────────────────────────────────────
const B58_ALPHA = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

function base58Encode(bytes) {
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leadingZeros++;
  }
  let n = 0n;
  for (const b of bytes) {
    n = n * 256n + BigInt(b);
  }
  let result = '';
  while (n > 0n) {
    result = B58_ALPHA[Number(n % 58n)] + result;
    n = n / 58n;
  }
  return B58_ALPHA[0].repeat(leadingZeros) + result;
}

async function sha256(buffer) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
}

async function accountIdToAddress(hexId) {
  if (addressCache[hexId]) return addressCache[hexId];
  const id       = hexToBytes(hexId);
  const versioned = new Uint8Array([0, ...id]);
  const h1        = await sha256(versioned);
  const h2        = await sha256(h1);
  const checksum  = h2.slice(0, 4);
  const full      = new Uint8Array([...versioned, ...checksum]);
  const addr      = base58Encode(full);
  addressCache[hexId] = addr;
  return addr;
}

// ── Hex helpers ───────────────────────────────────────────────────────────────
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function hexToStr(hex) {
  let s = '';
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return s;
}

// ── NFT parsing ───────────────────────────────────────────────────────────────
function parseNFToken(token) {
  const id      = token.NFTokenID;
  const uriHex  = token.URI || '';
  // NFTokenID layout: Flags(4) + Fee(4) + IssuerAccountId(40) + Taxon(8) + Seq(8)
  const issuerHex = id.slice(8, 48);
  const seqHex    = id.slice(56, 64);
  const seq       = parseInt(seqHex, 16);
  const uri       = uriHex ? hexToStr(uriHex) : '';
  const imageUrl  = resolveImageUrl(uri);
  return { id, issuerHex, seq, uri, imageUrl };
}

function resolveImageUrl(uri) {
  if (uri.startsWith('ipfs://')) {
    const hash = uri.slice(7).trim();
    if (hash) return IPFS_GW + hash;
  }
  if (uri.startsWith('https://') || uri.startsWith('http://')) {
    return uri;
  }
  return null;
}

// ── RPC ───────────────────────────────────────────────────────────────────────
async function rpcPost(method, params) {
  const res = await fetch(RPC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ method, params: [params] }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ── Load all NFTs ─────────────────────────────────────────────────────────────
async function loadAllNFTs() {
  setStatus('connecting', 'Connecting to Post Fiat Testnet…');
  try {
    let marker = null;
    do {
      const params = { type: 'nft_page', limit: FETCH_LIMIT, ledger_index: 'validated' };
      if (marker) params.marker = marker;
      const data = await rpcPost('ledger_data', params);
      if (data.result.error) throw new Error(data.result.error_message || data.result.error);
      for (const entry of (data.result.state || [])) {
        for (const t of (entry.NFTokens || [])) {
          allNFTs.push(parseNFToken(t.NFToken));
        }
      }
      marker = data.result.marker || null;
      setStatus('connecting', `Loading… ${allNFTs.length} NFTs found`);
    } while (marker);

    // Resolve all account IDs to XRPL r-addresses
    await resolveAllAddresses();
    populateWalletFilter();
    renderNFTs();
    setStatus('live', `${allNFTs.length} NFTs on Post Fiat Testnet`);
  } catch (err) {
    console.error('NFT load error:', err);
    setStatus('error', 'Failed to load NFTs');
    document.getElementById('nftGrid').innerHTML = `
      <div class="nft-empty">
        <div class="nft-empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div>Failed to connect to Post Fiat Testnet</div>
        <div class="nft-empty-sub">Check your connection and try refreshing the page</div>
      </div>`;
  }
}

async function resolveAllAddresses() {
  const unique = [...new Set(allNFTs.map(n => n.issuerHex).filter(h => !addressCache[h]))];
  await Promise.all(unique.map(h => accountIdToAddress(h)));
}

// ── Status badge ──────────────────────────────────────────────────────────────
function setStatus(state, text) {
  const dot   = document.getElementById('nftDot');
  const label = document.getElementById('nftStatusLabel');
  dot.className = 'ws-dot';
  if (state === 'connecting') dot.classList.add('ws-dot--connecting');
  else if (state === 'live')  dot.classList.add('ws-dot--live');
  else if (state === 'error') dot.classList.add('ws-dot--error');
  label.textContent = text || state.toUpperCase();
}

// ── Wallet filter dropdown ────────────────────────────────────────────────────
function populateWalletFilter() {
  const select = document.getElementById('walletFilter');
  const counts = {};
  allNFTs.forEach(n => {
    const addr = addressCache[n.issuerHex] || n.issuerHex;
    counts[addr] = (counts[addr] || 0) + 1;
  });
  const wallets = Object.keys(counts).sort();
  for (const addr of wallets) {
    const opt = document.createElement('option');
    opt.value       = addr;
    opt.textContent = addr.slice(0, 8) + '…' + addr.slice(-4) + ` (${counts[addr]})`;
    select.appendChild(opt);
  }
}

// ── Filter & sort ─────────────────────────────────────────────────────────────
function getFilteredSorted() {
  let nfts = currentFilter
    ? allNFTs.filter(n => addressCache[n.issuerHex] === currentFilter)
    : allNFTs;

  switch (currentSort) {
    case 'seq-asc':
      nfts = [...nfts].sort((a, b) => a.seq - b.seq);
      break;
    case 'seq-desc':
      nfts = [...nfts].sort((a, b) => b.seq - a.seq);
      break;
    case 'wallet':
      nfts = [...nfts].sort((a, b) => {
        const addrA = addressCache[a.issuerHex] || a.issuerHex;
        const addrB = addressCache[b.issuerHex] || b.issuerHex;
        return addrA.localeCompare(addrB) || a.seq - b.seq;
      });
      break;
    case 'id':
      nfts = [...nfts].sort((a, b) => a.id.localeCompare(b.id));
      break;
  }
  return nfts;
}

// ── Render grid ───────────────────────────────────────────────────────────────
function renderNFTs() {
  const nfts  = getFilteredSorted();
  const grid  = document.getElementById('nftGrid');
  const count = document.getElementById('nftCount');

  count.textContent = currentFilter
    ? `${nfts.length} of ${allNFTs.length} NFTs`
    : `${nfts.length} NFTs`;

  if (nfts.length === 0) {
    grid.innerHTML = `
      <div class="nft-empty">
        <div class="nft-empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <div>No NFTs found for this wallet</div>
        <div class="nft-empty-sub">Try selecting a different wallet or clearing the filter</div>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const nft of nfts) {
    frag.appendChild(createNFTCard(nft));
  }
  grid.innerHTML = '';
  grid.appendChild(frag);
}

function createNFTCard(nft) {
  const addr      = addressCache[nft.issuerHex] || nft.issuerHex;
  const shortId   = nft.id.slice(0, 8) + '…' + nft.id.slice(-6);
  const shortAddr = addr.slice(0, 6) + '…' + addr.slice(-4);

  const card = document.createElement('div');
  card.className = 'nft-card';

  // Image wrapper
  const imgWrap = document.createElement('div');
  imgWrap.className = 'nft-img-wrap';

  // Placeholder icon (shown until image loads or on error)
  const ph = document.createElement('div');
  ph.className = 'nft-img-ph';
  ph.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  imgWrap.appendChild(ph);

  if (nft.imageUrl) {
    const img = document.createElement('img');
    img.src     = nft.imageUrl;
    img.alt     = 'NFT';
    img.loading = 'lazy';
    img.className = 'nft-img';
    img.addEventListener('load', () => {
      img.classList.add('nft-img--loaded');
      ph.style.display = 'none';
    });
    img.addEventListener('error', () => {
      img.style.display = 'none';
    });
    imgWrap.appendChild(img);
  }
  card.appendChild(imgWrap);

  // Metadata
  const meta = document.createElement('div');
  meta.className = 'nft-meta';

  // NFT ID row
  const idRow = document.createElement('div');
  idRow.className = 'nft-meta-row';
  const idLabel = document.createElement('span');
  idLabel.className = 'nft-meta-label';
  idLabel.textContent = 'ID';
  const idVal = document.createElement('span');
  idVal.className = 'nft-meta-value nft-meta-mono';
  idVal.title     = nft.id;
  idVal.textContent = shortId;
  idRow.appendChild(idLabel);
  idRow.appendChild(idVal);
  meta.appendChild(idRow);

  // Issuer row
  const issuerRow = document.createElement('div');
  issuerRow.className = 'nft-meta-row';
  const issuerLabel = document.createElement('span');
  issuerLabel.className = 'nft-meta-label';
  issuerLabel.textContent = 'Issuer';
  const issuerBtn = document.createElement('button');
  issuerBtn.className   = 'nft-issuer-btn';
  issuerBtn.title       = addr;
  issuerBtn.textContent = shortAddr;
  issuerBtn.addEventListener('click', () => filterByWallet(addr));
  issuerRow.appendChild(issuerLabel);
  issuerRow.appendChild(issuerBtn);
  meta.appendChild(issuerRow);

  // URI row (if present and not ipfs)
  if (nft.uri && !nft.uri.startsWith('ipfs://')) {
    const uriRow = document.createElement('div');
    uriRow.className = 'nft-meta-row';
    const uriLabel = document.createElement('span');
    uriLabel.className = 'nft-meta-label';
    uriLabel.textContent = 'URI';
    const uriLink = document.createElement('a');
    uriLink.className = 'nft-meta-value nft-meta-mono nft-uri-link';
    uriLink.href      = nft.uri;
    uriLink.target    = '_blank';
    uriLink.rel       = 'noopener noreferrer';
    uriLink.title     = nft.uri;
    uriLink.textContent = nft.uri.slice(0, 16) + '…';
    uriRow.appendChild(uriLabel);
    uriRow.appendChild(uriLink);
    meta.appendChild(uriRow);
  }

  card.appendChild(meta);
  return card;
}

// ── Filter by wallet (from card click) ────────────────────────────────────────
function filterByWallet(addr) {
  currentFilter = addr;
  const sel = document.getElementById('walletFilter');
  sel.value = addr;
  renderNFTs();
}

// ── Event wiring ──────────────────────────────────────────────────────────────
document.getElementById('walletFilter').addEventListener('change', e => {
  currentFilter = e.target.value;
  renderNFTs();
});

document.getElementById('sortBy').addEventListener('change', e => {
  currentSort = e.target.value;
  renderNFTs();
});

document.getElementById('clearFilter').addEventListener('click', () => {
  currentFilter = '';
  document.getElementById('walletFilter').value = '';
  renderNFTs();
});

// ── Mouse parallax (same as homepage) ─────────────────────────────────────────
document.addEventListener('mousemove', e => {
  const glow = document.querySelector('.bg-glow');
  if (!glow) return;
  glow.style.transform = `translate(${(e.clientX / window.innerWidth) * 10 - 5}px, ${(e.clientY / window.innerHeight) * 10 - 5}px)`;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
loadAllNFTs();
