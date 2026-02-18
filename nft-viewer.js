// ── State ─────────────────────────────────────────────────────────────────────
let allNFTs      = [];
let currentFilter = '';
let currentSort   = 'seq-desc';

// ── Load data from pre-built JSON ─────────────────────────────────────────────
async function loadAllNFTs() {
  setStatus('connecting', 'Loading NFT data…');
  try {
    const res  = await fetch('nft-data.json?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    allNFTs = data.nfts || [];
    populateWalletFilter();
    renderNFTs();
    setStatus('live', `${allNFTs.length} NFTs · Updated ${formatAge(data.fetched_at)}`);
  } catch (err) {
    console.error('NFT load error:', err);
    setStatus('error', 'Failed to load NFT data');
    document.getElementById('nftGrid').innerHTML = `
      <div class="nft-empty">
        <div class="nft-empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div>Failed to load NFT data</div>
        <div class="nft-empty-sub">Try refreshing the page</div>
      </div>`;
  }
}

function formatAge(isoString) {
  if (!isoString) return 'unknown time ago';
  const mins = Math.round((Date.now() - new Date(isoString)) / 60000);
  if (mins < 2)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
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
  allNFTs.forEach(n => { counts[n.issuer] = (counts[n.issuer] || 0) + 1; });
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
    ? allNFTs.filter(n => n.issuer === currentFilter)
    : allNFTs;

  switch (currentSort) {
    case 'seq-asc':  nfts = [...nfts].sort((a, b) => a.seq - b.seq); break;
    case 'seq-desc': nfts = [...nfts].sort((a, b) => b.seq - a.seq); break;
    case 'wallet':   nfts = [...nfts].sort((a, b) => a.issuer.localeCompare(b.issuer) || a.seq - b.seq); break;
    case 'id':       nfts = [...nfts].sort((a, b) => a.id.localeCompare(b.id)); break;
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
  for (const nft of nfts) frag.appendChild(createNFTCard(nft));
  grid.innerHTML = '';
  grid.appendChild(frag);
}

function createNFTCard(nft) {
  const shortId   = nft.id.slice(0, 8) + '…' + nft.id.slice(-6);
  const shortAddr = nft.issuer.slice(0, 6) + '…' + nft.issuer.slice(-4);

  const card = document.createElement('div');
  card.className = 'nft-card';

  // Image wrapper
  const imgWrap = document.createElement('div');
  imgWrap.className = 'nft-img-wrap';

  const ph = document.createElement('div');
  ph.className = 'nft-img-ph';
  ph.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  imgWrap.appendChild(ph);

  if (nft.imageUrl) {
    const img = document.createElement('img');
    img.src       = nft.imageUrl;
    img.alt       = 'NFT';
    img.loading   = 'lazy';
    img.className = 'nft-img';
    img.addEventListener('load',  () => { img.classList.add('nft-img--loaded'); ph.style.display = 'none'; });
    img.addEventListener('error', () => { img.style.display = 'none'; });
    imgWrap.appendChild(img);
  }
  card.appendChild(imgWrap);

  // Metadata
  const meta = document.createElement('div');
  meta.className = 'nft-meta';

  // Name or ID row
  const idRow = document.createElement('div');
  idRow.className = 'nft-meta-row';
  const displayName = nft.name ? nft.name : shortId;
  const displayTitle = nft.name ? `${nft.name}\n${nft.id}` : nft.id;
  idRow.innerHTML = `<span class="nft-meta-label">${nft.name ? 'Name' : 'ID'}</span><span class="nft-meta-value nft-meta-mono" title="${displayTitle}">${displayName}</span>`;
  meta.appendChild(idRow);

  // Issuer row
  const issuerRow = document.createElement('div');
  issuerRow.className = 'nft-meta-row';
  const issuerLabel = document.createElement('span');
  issuerLabel.className   = 'nft-meta-label';
  issuerLabel.textContent = 'Issuer';
  const issuerBtn = document.createElement('button');
  issuerBtn.className   = 'nft-issuer-btn';
  issuerBtn.title       = nft.issuer;
  issuerBtn.textContent = shortAddr;
  issuerBtn.addEventListener('click', () => filterByWallet(nft.issuer));
  issuerRow.appendChild(issuerLabel);
  issuerRow.appendChild(issuerBtn);
  meta.appendChild(issuerRow);

  card.appendChild(meta);
  return card;
}

// ── Filter by wallet (from card click) ────────────────────────────────────────
function filterByWallet(addr) {
  currentFilter = addr;
  document.getElementById('walletFilter').value = addr;
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

// ── Mouse parallax ────────────────────────────────────────────────────────────
document.addEventListener('mousemove', e => {
  const glow = document.querySelector('.bg-glow');
  if (!glow) return;
  glow.style.transform = `translate(${(e.clientX / window.innerWidth) * 10 - 5}px, ${(e.clientY / window.innerHeight) * 10 - 5}px)`;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
loadAllNFTs();
