// ── State ─────────────────────────────────────────────────────────────────────
let allNFTs          = [];
let currentFilter    = '';   // wallet filter
let collectionFilter = '';   // collection filter
let currentSort      = 'age-desc';
let colorFilter      = new Set();
let visibleCount     = 0;

const PAGE_SIZE = 100;

// ── Collection helper ─────────────────────────────────────────────────────────
// Derives a human-readable collection name from an NFT object.
// Priority: explicit metadata field → name-pattern match → issuer prefix
function getCollection(nft) {
  if (nft.collection) return nft.collection;
  if (nft.name && nft.name.startsWith('PFT Profile')) return 'PFT Profiles';
  // Fallback: group unknowns by issuer so they at least cluster together
  return nft.issuer.slice(0, 8) + '…';
}

// ── Load data from pre-built JSON ─────────────────────────────────────────────
async function loadAllNFTs() {
  setStatus('connecting', 'Loading NFT data…');
  try {
    const res  = await fetch('nft-data.json?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    allNFTs = (data.nfts || []).filter(n => n.imageUrl);
    populateWalletFilter();
    populateCollectionFilter();
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

// ── Collection filter dropdown ────────────────────────────────────────────────
function populateCollectionFilter() {
  const select = document.getElementById('collectionFilter');
  const counts  = {};
  allNFTs.forEach(n => {
    const col = getCollection(n);
    counts[col] = (counts[col] || 0) + 1;
  });

  const collections = Object.keys(counts).sort();

  // Hide the whole control group if there's only one collection
  const group = document.getElementById('collectionFilterGroup');
  if (collections.length <= 1) {
    group.style.display = 'none';
    return;
  }

  for (const col of collections) {
    const opt = document.createElement('option');
    opt.value       = col;
    opt.textContent = `${col} (${counts[col]})`;
    select.appendChild(opt);
  }
}

// ── Age sort key ──────────────────────────────────────────────────────────────
function getAgeSortKey(nft) {
  const dateMatch = nft.name && nft.name.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    return dateMatch[1] + '_' + String(nft.seq).padStart(10, '0');
  }
  const numMatch = nft.name && nft.name.match(/#(\d+)/);
  const num = numMatch ? parseInt(numMatch[1]) : 0;
  return '0000-00-00_' + String(num).padStart(10, '0');
}

// ── Filter & sort ─────────────────────────────────────────────────────────────
function getFilteredSorted() {
  let nfts = currentFilter
    ? allNFTs.filter(n => n.issuer === currentFilter)
    : allNFTs;

  if (collectionFilter) {
    nfts = nfts.filter(n => getCollection(n) === collectionFilter);
  }

  if (colorFilter.size > 0) {
    nfts = nfts.filter(n => (n.colors || []).some(c => colorFilter.has(c)));
  }

  switch (currentSort) {
    case 'age-asc':  nfts = [...nfts].sort((a, b) => getAgeSortKey(a).localeCompare(getAgeSortKey(b))); break;
    case 'age-desc': nfts = [...nfts].sort((a, b) => getAgeSortKey(b).localeCompare(getAgeSortKey(a))); break;
    case 'wallet':   nfts = [...nfts].sort((a, b) => a.issuer.localeCompare(b.issuer) || a.seq - b.seq); break;
    case 'id':       nfts = [...nfts].sort((a, b) => a.id.localeCompare(b.id)); break;
  }
  return nfts;
}

// ── Render grid (full reset) ───────────────────────────────────────────────────
function renderNFTs() {
  const nfts = getFilteredSorted();
  const grid = document.getElementById('nftGrid');

  visibleCount = 0;
  grid.innerHTML = '';

  if (nfts.length === 0) {
    grid.innerHTML = `
      <div class="nft-empty">
        <div class="nft-empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <div>No NFTs found</div>
        <div class="nft-empty-sub">Try a different filter</div>
      </div>`;
    updateCount(0, 0);
    document.getElementById('loadMoreWrap').style.display = 'none';
    return;
  }

  appendCards(nfts, Math.min(PAGE_SIZE, nfts.length));
}

// ── Append next batch of cards ─────────────────────────────────────────────────
function appendCards(nfts, upTo) {
  const grid = document.getElementById('nftGrid');
  const frag = document.createDocumentFragment();
  for (let i = visibleCount; i < upTo; i++) {
    frag.appendChild(createNFTCard(nfts[i]));
  }
  visibleCount = upTo;
  grid.appendChild(frag);

  updateCount(visibleCount, nfts.length);

  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (visibleCount < nfts.length) {
    loadMoreWrap.style.display = 'flex';
    document.getElementById('loadMoreBtn').textContent =
      `Load More (${nfts.length - visibleCount} remaining)`;
  } else {
    loadMoreWrap.style.display = 'none';
  }
}

function updateCount(shown, total) {
  const count = document.getElementById('nftCount');
  count.textContent = shown < total
    ? `Showing ${shown} of ${total} NFTs`
    : `${total} NFTs`;
}

// ── Card factory ──────────────────────────────────────────────────────────────
function createNFTCard(nft) {
  const shortId   = nft.id.slice(0, 8) + '…' + nft.id.slice(-6);
  const shortAddr = nft.issuer.slice(0, 6) + '…' + nft.issuer.slice(-4);

  const card = document.createElement('div');
  card.className = 'nft-card';

  // Navigate to detail page on click (but not when clicking the issuer button)
  card.addEventListener('click', e => {
    if (e.target.closest('.nft-issuer-btn')) return;
    window.location.href = 'nft-detail.html?id=' + encodeURIComponent(nft.id);
  });

  // Image wrapper
  const imgWrap = document.createElement('div');
  imgWrap.className = 'nft-img-wrap';

  const ph = document.createElement('div');
  ph.className = 'nft-img-ph';
  ph.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  imgWrap.appendChild(ph);

  const img = document.createElement('img');
  img.src       = nft.imageUrl;
  img.alt       = nft.name || 'NFT';
  img.loading   = 'lazy';
  img.className = 'nft-img';
  img.addEventListener('load',  () => { img.classList.add('nft-img--loaded'); ph.style.display = 'none'; });
  img.addEventListener('error', () => { img.style.display = 'none'; });
  imgWrap.appendChild(img);

  card.appendChild(imgWrap);

  // Metadata
  const meta = document.createElement('div');
  meta.className = 'nft-meta';

  // Name or ID row
  const idRow = document.createElement('div');
  idRow.className = 'nft-meta-row';
  const displayName  = nft.name ? nft.name : shortId;
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

// ── Color chip toggle (single-select) ────────────────────────────────────────
function toggleColor(color, btn) {
  if (colorFilter.has(color)) {
    colorFilter.clear();
    btn.classList.remove('active');
  } else {
    colorFilter.clear();
    document.querySelectorAll('.color-chip').forEach(b => b.classList.remove('active'));
    colorFilter.add(color);
    btn.classList.add('active');
  }
  renderNFTs();
}

// ── Event wiring ──────────────────────────────────────────────────────────────
document.getElementById('walletFilter').addEventListener('change', e => {
  currentFilter = e.target.value;
  renderNFTs();
});

document.getElementById('collectionFilter').addEventListener('change', e => {
  collectionFilter = e.target.value;
  renderNFTs();
});

document.getElementById('sortBy').addEventListener('change', e => {
  currentSort = e.target.value;
  renderNFTs();
});

document.getElementById('clearFilter').addEventListener('click', () => {
  currentFilter    = '';
  collectionFilter = '';
  colorFilter.clear();
  document.getElementById('walletFilter').value    = '';
  document.getElementById('collectionFilter').value = '';
  document.querySelectorAll('.color-chip').forEach(btn => btn.classList.remove('active'));
  renderNFTs();
});

document.getElementById('loadMoreBtn').addEventListener('click', () => {
  const nfts = getFilteredSorted();
  const upTo = Math.min(visibleCount + PAGE_SIZE, nfts.length);
  appendCards(nfts, upTo);
});

// ── Mouse parallax ────────────────────────────────────────────────────────────
document.addEventListener('mousemove', e => {
  const glow = document.querySelector('.bg-glow');
  if (!glow) return;
  glow.style.transform = `translate(${(e.clientX / window.innerWidth) * 10 - 5}px, ${(e.clientY / window.innerHeight) * 10 - 5}px)`;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
loadAllNFTs();
