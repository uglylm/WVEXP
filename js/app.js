/* ============================================================================
   TemplateVault — app.js
   ----------------------------------------------------------------------------
   HOW THE CATALOG WORKS (edit data/templates.json on GitHub — nothing else):

     FREE template:
       1. thumbs/{id}.webp   → one scrolling capture (animated webp or gif)
       2. prompts/{id}.txt   → the AI prompt the "Copy prompt" button pastes
       3. one JSON entry with "price": 0

     PAID template:
       1. thumbs/{id}.webp
       2. JSON entry with "price": 49 and "stripe": "https://buy.stripe.com/…"
       (no prompt file needed — the buyer gets it by email from Stripe)

     AD CARD (whole card is one clickable image):
       one entry in the "ads" array: { "thumb": "ads/x.webp", "url": "https://…" }
       Ads auto-insert after every 8th template card.
   ============================================================================ */
'use strict';

const DATA_URL   = 'data/templates.json';
const PROMPT_DIR = 'prompts/';
const BATCH      = 24;
const AD_EVERY   = 8;   // show an ad after every N template cards

let TEMPLATES = [];
let ADS       = [];

/* ---------- element refs ---------- */
const grid        = document.getElementById('grid');
const countEl     = document.getElementById('count');
const loadMoreBtn = document.getElementById('loadMore');
const catFilter   = document.getElementById('catFilter');
const typeFilter  = document.getElementById('typeFilter');
const sortSel     = document.getElementById('sort');
const qInput      = document.getElementById('q');
const toastEl     = document.getElementById('toast');
const modal       = document.getElementById('modal');
const modalCode   = document.getElementById('modalCode');
const modalTitle  = document.getElementById('modalTitle');
const previewModal = document.getElementById('previewModal');

const state = { q:'', type:'all', cat:'all', sort:'featured', shown:BATCH };
let filtered = [];
const promptCache = new Map();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const isFree = t => !t.price || Number(t.price) <= 0;
const slugOf = t => t.id || String(t.title || 'template').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const thumbOf = t => t.thumb || `thumbs/${slugOf(t)}.webp`;
const promptPathOf = t => t.prompt || `${PROMPT_DIR}${slugOf(t)}.txt`;

document.getElementById('yr').textContent = new Date().getFullYear();

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, kind){
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (kind === 'err' ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3800);
}

/* ---------- clipboard ---------- */
async function copyText(text){
  if (navigator.clipboard && window.isSecureContext){
    try { await navigator.clipboard.writeText(text); return true; } catch(_) {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly','');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch(_) {}
  ta.remove();
  return ok;
}

/* ============================================================================
   FILTER CONTROLS
   ============================================================================ */
function buildStats(){
  const total = TEMPLATES.length;
  const free  = TEMPLATES.filter(isFree).length;
  document.getElementById('stats').innerHTML =
    `<span class="chip"><i></i>${free} free prompts</span>` +
    `<span class="chip p"><i></i>${total - free} premium</span>` +
    `<span class="dot">•</span><span><b>${total}</b> templates total</span>`;
}

function buildCategories(){
  const cats = [...new Set(TEMPLATES.map(t => t.category).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b));
  catFilter.innerHTML =
    `<button class="pill active" data-cat="all">All</button>` +
    cats.map(c => `<button class="pill" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}

typeFilter.addEventListener('click', e => {
  const btn = e.target.closest('button[data-type]');
  if (!btn) return;
  typeFilter.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
  state.type = btn.dataset.type;
  apply();
});

catFilter.addEventListener('click', e => {
  const btn = e.target.closest('button[data-cat]');
  if (!btn) return;
  catFilter.querySelectorAll('.pill').forEach(b => b.classList.toggle('active', b === btn));
  state.cat = btn.dataset.cat;
  apply();
});

sortSel.addEventListener('change', () => { state.sort = sortSel.value; apply(); });

let qTimer;
qInput.addEventListener('input', () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { state.q = qInput.value; apply(); }, 150);
});

/* ============================================================================
   FILTER / SORT / RENDER
   ============================================================================ */
function apply(){
  const q = state.q.trim().toLowerCase();

  filtered = TEMPLATES.filter(t => {
    if (state.type === 'free' && !isFree(t)) return false;
    if (state.type === 'paid' && isFree(t))  return false;
    if (state.cat !== 'all' && t.category !== state.cat) return false;
    if (q){
      const hay = [t.title, t.category, t.id, (t.tags || []).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const byName = (a,b) => String(a.title).localeCompare(String(b.title));
  if (state.sort === 'az')              filtered.sort(byName);
  else if (state.sort === 'price-asc')  filtered.sort((a,b) => (a.price||0) - (b.price||0) || byName(a,b));
  else if (state.sort === 'price-desc') filtered.sort((a,b) => (b.price||0) - (a.price||0) || byName(a,b));

  state.shown = BATCH;
  render();
}

function cardHTML(t){
  const free = isFree(t);
  const id   = slugOf(t);
  const tags = (t.tags || []).slice(0,3).join(' · ');
  const src  = esc(thumbOf(t));

  const badge = free
    ? `<span class="badge free">Free</span>`
    : `<span class="badge paid">Premium</span>`;

  const actions = free
    ? `<button class="btn ghost" data-preview="${esc(id)}" type="button">Preview</button>
       <button class="btn primary" data-copy="${esc(id)}" type="button">Copy prompt</button>`
    : `<button class="btn ghost" data-preview="${esc(id)}" type="button">Preview</button>
       <a class="btn buy" href="${esc(t.stripe || '#')}" target="_blank" rel="noopener">Buy $${esc(t.price)}</a>`;

  return `
  <article class="card">
    <button class="thumb" data-preview="${esc(id)}" type="button" aria-label="Preview ${esc(t.title)}">
      ${badge}
      <img class="shot" src="${src}" alt="${esc(t.title)} preview"
           loading="lazy" decoding="async" width="640" height="400">
    </button>
    <div class="body">
      <h3 title="${esc(t.title)}">${esc(t.title)}</h3>
      <div class="meta">
        <span class="cat">${esc(t.category || 'Template')}</span>
        ${tags ? `<span class="sep">•</span><span class="tags">${esc(tags)}</span>` : ''}
      </div>
      <div class="actions">${actions}</div>
    </div>
  </article>`;
}

/* Ad card: whole card is one image; clicking anywhere opens the URL */
function adHTML(ad){
  return `
  <a class="card ad-card" href="${esc(ad.url || '#')}" target="_blank" rel="noopener sponsored"
     aria-label="${esc(ad.title || 'Advertisement')}">
    <span class="ad-tag">Ad</span>
    <img src="${esc(ad.thumb)}" alt="${esc(ad.title || 'Advertisement')}" loading="lazy" decoding="async">
  </a>`;
}

/* Interleave ads after every AD_EVERYth template card */
function buildDisplayList(){
  const out = [];
  let adIdx = 0;
  filtered.forEach((t, i) => {
    out.push(t);
    if (ADS.length && (i + 1) % AD_EVERY === 0 && adIdx < ADS.length){
      out.push({ __ad: ADS[adIdx++] });
    }
  });
  return out.slice(0, state.shown);
}

function render(){
  const slice = buildDisplayList();
  const templateCountInView = slice.filter(x => !x.__ad).length;

  grid.innerHTML = slice.length
    ? slice.map(x => x.__ad ? adHTML(x.__ad) : cardHTML(x)).join('')
    : `<div class="empty">
         <strong>No templates match that.</strong>
         Try a different search, or clear the filters.
       </div>`;

  countEl.textContent = filtered.length
    ? `Showing ${templateCountInView} of ${filtered.length} template${filtered.length === 1 ? '' : 's'}`
    : '';

  loadMoreBtn.hidden = templateCountInView >= filtered.length;
}

loadMoreBtn.addEventListener('click', () => {
  state.shown += BATCH;
  render();
});

/* ============================================================================
   IMAGE FALLBACK (missing screenshot → elegant letter placeholder)
   ============================================================================ */
document.addEventListener('error', e => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.classList.contains('shot')) return;
  const wrap = img.closest('.thumb');
  if (!wrap || wrap.dataset.fb) return;
  wrap.dataset.fb = '1';
  wrap.dataset.initial = (img.alt || 'T').trim().charAt(0).toUpperCase();
  wrap.classList.add('fallback');
}, true);

/* ============================================================================
   PRODUCT PREVIEW MODAL — single enlarged scrolling image + one action
   ============================================================================ */
function openPreview(id){
  const t = TEMPLATES.find(x => slugOf(x) === id);
  if (!t) return;

  document.getElementById('previewImg').src = thumbOf(t);
  document.getElementById('previewImg').alt = `${t.title} preview`;
  document.getElementById('previewTitle').textContent = t.title;

  const actions = document.getElementById('previewActions');
  if (isFree(t)){
    actions.innerHTML =
      `<button class="btn primary" data-copy="${esc(id)}" type="button">Copy AI prompt</button>`;
  } else {
    actions.innerHTML =
      `<a class="btn buy" href="${esc(t.stripe || '#')}" target="_blank" rel="noopener">Buy $${esc(t.price)}</a>`;
  }

  previewModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closePreview(){
  previewModal.hidden = true;
  if (modal.hidden) document.body.style.overflow = '';
}

document.getElementById('previewClose').addEventListener('click', closePreview);
previewModal.addEventListener('click', e => { if (e.target === previewModal) closePreview(); });

/* ============================================================================
   GLOBAL CLICK — preview + copy (works in grid AND inside preview modal)
   ============================================================================ */
document.addEventListener('click', e => {
  const prev = e.target.closest('[data-preview]');
  if (prev){
    e.preventDefault();
    openPreview(prev.dataset.preview);
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy){
    e.preventDefault();
    copyPrompt(copy.dataset.copy, copy);
  }
});

/* ============================================================================
   COPY AI PROMPT
   ============================================================================ */
async function copyPrompt(id, btn){
  const t = TEMPLATES.find(x => slugOf(x) === id);
  if (!t) return;
  if (!isFree(t)){
    toast('This one is premium — buy it to get the prompt.', 'err');
    return;
  }

  const path = promptPathOf(t);
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Copying…';

  try {
    let text = promptCache.get(id);
    if (text == null){
      const res = await fetch(path, { cache: 'force-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      text = await res.text();
      promptCache.set(id, text);
    }

    const ok = await copyText(text);

    if (ok){
      btn.classList.add('copied');
      btn.textContent = '✓ Copied';
      toast(`Copied the “${t.title}” prompt — paste it into your AI builder.`);
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = original;
        btn.disabled = false;
      }, 1900);
    } else {
      openTextModal(t, text);
      btn.innerHTML = original;
      btn.disabled = false;
    }
  } catch (err) {
    console.error('[TemplateVault] prompt copy failed:', err);
    toast(`Could not load ${path} — upload that file to GitHub.`, 'err');
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

/* ============================================================================
   TEXT FALLBACK MODAL (clipboard blocked)
   ============================================================================ */
let modalText = '';

function openTextModal(t, text){
  modalText = text;
  modalTitle.textContent = `${slugOf(t)}/prompt.txt — ${text.length.toLocaleString()} chars`;
  modalCode.value = text;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => { modalCode.focus(); modalCode.select(); }, 40);
}

function closeTextModal(){
  modal.hidden = true;
  if (previewModal.hidden) document.body.style.overflow = '';
}

document.getElementById('modalClose').addEventListener('click', closeTextModal);
document.getElementById('modalClose2').addEventListener('click', closeTextModal);
modal.addEventListener('click', e => { if (e.target === modal) closeTextModal(); });
document.getElementById('modalCopy').addEventListener('click', async () => {
  modalCode.select();
  const ok = await copyText(modalText);
  toast(ok ? 'Copied to clipboard.' : 'Still blocked — copy manually.', ok ? '' : 'err');
  if (ok) closeTextModal();
});

/* ============================================================================
   KEYBOARD SHORTCUTS
   ============================================================================ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    if (!previewModal.hidden){ closePreview(); return; }
    if (!modal.hidden){ closeTextModal(); return; }
  }
  if (e.key === '/' &&
      document.activeElement !== qInput &&
      !/input|textarea/i.test(document.activeElement.tagName) &&
      previewModal.hidden && modal.hidden){
    e.preventDefault();
    qInput.focus();
  }
});

/* ============================================================================
   BOOT — load catalog from data/templates.json
   ============================================================================ */
(async function boot(){
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    TEMPLATES = Array.isArray(data.templates) ? data.templates : [];
    ADS       = Array.isArray(data.ads)       ? data.ads       : [];
  } catch (err) {
    console.error('[TemplateVault] could not load ' + DATA_URL, err);
    grid.innerHTML = `<div class="empty">
        <strong>Couldn't load data/templates.json.</strong>
        Make sure the file exists in your repo and GitHub Pages is enabled.
      </div>`;
    return;
  }
  buildStats();
  buildCategories();
  apply();
})();
