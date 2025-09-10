/* ====== CONFIG ====== */
const SITE = {
  user: 'zuunaid',     // your GitHub username
  repo: 'Dhoirjo',     // your repository name
  branch: 'main',
  postsPerPage: 10
};

/* ====== LOCAL TEST SWITCH ====== */
const LOCAL = location.hostname === 'localhost' ||
              location.hostname === '127.0.0.1' ||
              location.protocol === 'file:';

/* ====== UTILS ====== */
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
function basePath(){
  const p = location.pathname;
  return p.endsWith('/') ? p : p.replace(/\/[^\/]*$/, '/');
}
function resolveAsset(src){
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src; // external
  if (src.startsWith('/')) src = src.slice(1); // strip leading slash
  return basePath() + src; // make it relative to current directory
}

/* Bengali digits */
const BN_DIGITS = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
function toBnDigits(str){ return String(str).replace(/\d/g, d => BN_DIGITS[d]); }

/* Date: Bengali digits + English month */
function formatBnDate(iso){
  const d = new Date(iso);
  const day = toBnDigits(d.getDate());
  const year = toBnDigits(d.getFullYear());
  const month = d.toLocaleString('en-US', { month: 'long' });
  return `${day} ${month} ${year}`;
}

/* Reading time */
function readingTime(text){
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / 200));
  return `${toBnDigits(mins)} মিনিট`;
}

/* Simple front-matter parser */
/* Robust front-matter parser (handles spaces, CRLF, BOM) */
function parseFrontMatter(md){
  // normalize line breaks and trim any BOM/leading spaces
  const src = md.replace(/\uFEFF/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimStart();

  // match ---\n … \n---
  const m = src.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { fm: {}, body: src }; // no front-matter → return whole as body

  const yaml = m[1];
  const body = src.slice(m[0].length);

  const fm = {};
  yaml.split('\n').forEach(line=>{
    // allow: key: value   or   key: "value"   or   key: 'value'
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if(!kv) return;
    const key = kv[1].trim();
    let val = kv[2].trim();

    // arrays like: [ "a", "b" ]  or ['a','b']
    if (val.startsWith('[') && val.endsWith(']')){
      try { fm[key] = JSON.parse(val.replace(/'/g,'"')); } catch { fm[key] = []; }
      return;
    }
    // strip surrounding quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))){
      val = val.slice(1,-1);
    }
    fm[key] = val;
  });

  return { fm, body };
}

/* Tiny Markdown → HTML (basic) */
function mdToHtml(md){
  let html = md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m,alt,src) =>
  `<img src="${resolveAsset(src)}" alt="${alt || ''}">`);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m,txt,href)=>
    `<a href="${href}" target="_blank" rel="noopener">${txt}</a>`);
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/^(?:-|\*)\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/gms, '<ul>$1</ul>');
  html = html.split('\n').map(line=>{
    if(!line.trim()) return '';
    if(/^<(h\d|ul|li|img|blockquote)/.test(line)) return line;
    return `<p>${line}</p>`;
  }).join('\n');
  return html;
}

/* Arabic auto-detect */
const AR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
function enhanceArabic(container){
  $$('.post-body p', container).forEach(p=>{
    const txt = p.textContent.trim();
    if (!txt) return;
    const arChars = (txt.match(new RegExp(AR_REGEX,'g')) || []).length;
    const ratio = arChars / txt.length;
    if (ratio > 0.6){
      p.classList.add('ar-separate');
      p.setAttribute('dir','rtl');
      return;
    }
    if (AR_REGEX.test(txt)){
      p.innerHTML = p.innerHTML.replace(/([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+)/g,
        '<span class="ar-inline">$1</span>');
    }
  });
}

/* Downscale images client-side */
async function downscaleImages(container, maxW=1600, quality=0.82){
  const imgs = $$('img', container);
  await Promise.all(imgs.map(img => new Promise(resolve=>{
    img.addEventListener('load', async ()=>{
      try{
        const w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxW){
          const scale = maxW / w;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          img.src = canvas.toDataURL('image/jpeg', quality);
        }
      }catch(e){}
      resolve();
    }, { once:true });
    if (img.complete) img.dispatchEvent(new Event('load'));
  })));
}

/* ====== DATA LOADERS (LOCAL vs GITHUB) ====== */
async function listPosts(){
  if (LOCAL){
    // Try local manifest
    try{
      const res = await fetch('posts/index.json', { cache: 'no-store' });
      if(res.ok){
        const arr = await res.json();
        return arr.slice().sort().reverse();
      }
    }catch(e){}
    // Fallback: built-in sample (no files needed)
    return ['__inline-sample__'];
  }
  // GitHub mode
  const url = `https://api.github.com/repos/${SITE.user}/${SITE.repo}/contents/posts?ref=${SITE.branch}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Failed to list posts from GitHub');
  const items = await res.json();
  return items.filter(it => it.type==='file' && /\.md$/i.test(it.name))
              .map(it => it.name).sort().reverse();
}

async function fetchPostByName(name){
  if (LOCAL){
    if (name === '__inline-sample__'){
      // Minimal inline sample so local always renders something
      return `---
title: "লোকাল টেস্ট পোস্ট"
date: "2025-07-24"
category: "জীবন"
tags: ["টেস্ট"]
thumbnail: "/images/posts/flower.jpg"
excerpt: "এটি লোকাল মোডের জন্য একটি নমুনা পোস্ট।"
---
# লোকাল টেস্ট

এটি **লোকাল মোড** কাজ করছে কি না তা দেখার জন্য তৈরি।

Inline Arabic: إِنَّ اللَّهَ مَعَ الصَّابِرِينَ

Separate Arabic line:
إِنَّ اللَّهَ مَعَ الصَّابِرِينَ

![টেস্ট ইমেজ](../images/posts/flower.jpg)
`;
    }
    const res = await fetch(`posts/${name}`, { cache: 'no-store' });
    if(!res.ok) throw new Error('Local post not found: '+name);
    return await res.text();
  }
  // GitHub mode
  const raw = `https://raw.githubusercontent.com/${SITE.user}/${SITE.repo}/${SITE.branch}/posts/${name}`;
  const res = await fetch(raw, { cache: 'no-store' });
  if(!res.ok) throw new Error('Post not found: '+name);
  return await res.text();
}

function nameToSlug(name){ return name.replace(/\.md$/,''); }
function slugToName(slug){ return `${slug}.md`; }

/* Excerpt maker */
function makeExcerpt(text, words=38){
  const clean = text.replace(/[#>*_`]/g,'').replace(/\s+/g,' ').trim();
  const arr = clean.split(' ');
  if(arr.length <= words) return clean;
  return arr.slice(0, words).join(' ') + '…';
}
function getParam(key){ return new URL(location.href).searchParams.get(key); }

/* ====== Theme Toggle ====== */
function initTheme(){
  const root = document.documentElement;
  const btn = $('#themeToggle');
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark'){
    root.setAttribute('data-theme', saved);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
  if(btn){
    btn.addEventListener('click', ()=>{
      const cur = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', cur);
      localStorage.setItem('theme', cur);
    });
  }
}

/* ====== Search UI (glitch-free) ====== */
function initSearchUI(){
  const wrap  = document.querySelector('.search-wrap');
  const btn   = document.querySelector('#searchOpen');
  const input = document.querySelector('#searchInput');
  if(!wrap || !btn || !input) return;

  let justOpened = false;

  btn.addEventListener('pointerdown', (e)=>{
    const willOpen = !wrap.classList.contains('open');
    wrap.classList.toggle('open', willOpen);
    if (willOpen) {
      justOpened = true;
      setTimeout(()=> { justOpened = false; input.focus(); }, 0);
    } else {
      input.blur();
    }
    e.stopPropagation();
  });

  wrap.addEventListener('pointerdown', (e)=> {
    if (wrap.classList.contains('open')) e.stopPropagation();
  });

  document.addEventListener('pointerdown', (e)=>{
    if (justOpened) return;
    if (!wrap.contains(e.target) && wrap.classList.contains('open')) {
      wrap.classList.remove('open'); input.blur();
    }
  });

  input.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape'){
      wrap.classList.remove('open'); input.blur();
    }
  });
}

/* ====== Hamburger Menu ====== */
function initMenu(){
  const wrap = document.querySelector('.menu');
  const btn  = document.querySelector('#menuBtn');
  const panel = document.querySelector('#menuPanel');
  if(!wrap || !btn || !panel) return;

  const close = ()=>{
    wrap.classList.remove('open');
    btn.setAttribute('aria-expanded','false');
  };

  btn.addEventListener('click', (e)=>{
    const willOpen = !wrap.classList.contains('open');
    wrap.classList.toggle('open', willOpen);
    btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen){
      const first = panel.querySelector('a');
      first && first.focus();
    }
    e.stopPropagation();
  });

  panel.addEventListener('click', (e)=> e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') close(); });
}

/* ====== HOME ====== */
async function initHome(){
  initSearchUI();
  initMenu();

  document.addEventListener('scroll', ()=>{
    if (window.scrollY > 4) document.body.classList.add('scrolled');
    else document.body.classList.remove('scrolled');
  });

  const view = getParam('view');
  const listing = $('#listing');
  const pagination = $('#pagination');
  const taxCloud = $('#taxCloud');

  try{
    const names = await listPosts();
    const posts = [];
    for (const name of names){
      const md = await fetchPostByName(name);
      const { fm, body } = parseFrontMatter(md);
      const slug = name === '__inline-sample__' ? 'sample' : nameToSlug(name);
      const title = fm.title || slug;
      const date = fm.date || '2025-01-01';
      const category = fm.category || 'বিবিধ';
      const tags = Array.isArray(fm.tags) ? fm.tags : [];
      const thumb = fm.thumbnail || '';
      const excerpt = fm.excerpt || makeExcerpt(body, 38);

      posts.push({ slug, title, date, category, tags, thumb, excerpt, body });
    }
    // sort posts: newest first
posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    // taxonomy views
    const qCat = getParam('c');
    const qTag = getParam('t');
    const q = getParam('q');

    if (view==='categories'){
      taxCloud.hidden = false;
      listing.innerHTML = '';
      pagination.innerHTML = '';
      renderCategoryCloud(posts, taxCloud);
      return;
    }
    if (view==='tags'){
      taxCloud.hidden = false;
      listing.innerHTML = '';
      pagination.innerHTML = '';
      renderTagCloud(posts, taxCloud);
      return;
    }

    let filtered = posts.slice();

    if(qCat) filtered = filtered.filter(p => p.category === qCat);
    if(qTag) filtered = filtered.filter(p => p.tags.includes(qTag));

    const input = $('#searchInput');
    if (input){
      input.addEventListener('input', ()=>{
        const s = input.value.trim();
        const f = s ? posts.filter(p =>
          (p.title+p.excerpt+(p.tags||[]).join(' ')).includes(s)) : posts.slice();
        drawList(f); drawPagination(f);
      });
      if(q){ input.value = q; input.dispatchEvent(new Event('input')); return; }
    }

    drawList(filtered);
    drawPagination(filtered);

    function drawList(arr){
      listing.innerHTML = '';
      const page = parseInt(getParam('page') || '1', 10);
      const start = (page-1)*SITE.postsPerPage;
      const items = arr.slice(start, start+SITE.postsPerPage);
      for (const p of items){
        const card = document.createElement('article');
        card.className = 'post-card';

        const thumb = p.thumb ? `
  <a class="thumb" href="post.html?slug=${encodeURIComponent(p.slug)}">
    <img src="${resolveAsset(p.thumb)}" alt="">
  </a>` : `<div class="thumb" style="display:none"></div>`;

        const meta = `
          <div class="meta">
            <span class="date">${formatBnDate(p.date)}</span>
            <span class="dot">·</span>
            <span class="read">${readingTime(p.body)}</span>
            <span class="dot">·</span>
            <a class="cat-chip" href="index.html?c=${encodeURIComponent(p.category)}">${p.category}</a>
          </div>`;

        card.innerHTML = `
  ${thumb}
  <div class="content">
    <h2 class="title"><a href="post.html?slug=${encodeURIComponent(p.slug)}">${p.title}</a></h2>
    <p class="excerpt">${p.excerpt}</p>
    <a class="btn-outline-black" href="post.html?slug=${encodeURIComponent(p.slug)}">আরো পড়ুন</a>
    ${meta}
  </div>`;
        listing.appendChild(card);
        const img = card.querySelector('.thumb img');
if (img) {
  img.addEventListener('error', () => {
    const t = img.closest('.thumb');
    if (t) t.style.display = 'none';
  });
}
      }
      listing.innerHTML = listing.innerHTML.replace(/\d/g, d=>BN_DIGITS[d]);
    }

    function drawPagination(arr){
      pagination.innerHTML = '';
      const pageCount = Math.max(1, Math.ceil(arr.length / SITE.postsPerPage));
      const cur = parseInt(getParam('page') || '1', 10);

      for(let i=1;i<=pageCount;i++){
        const a = document.createElement(i===cur?'span':'a');
        a.textContent = toBnDigits(i);
        if(i===cur) a.className = 'active';
        else{
          const u = new URL(location.href);
          u.searchParams.set('page', i);
          a.href = u.toString();
        }
        pagination.appendChild(a);
      }
    }

  }catch(err){
    $('#listing').innerHTML = `<p>কন্টেন্ট লোড করা যায়নি। পরে আবার চেষ্টা করুন।</p>`;
    console.error(err);
  }
}

function renderCategoryCloud(posts, el){
  const cats = new Map();
  posts.forEach(p=> cats.set(p.category, (cats.get(p.category)||0)+1));
  el.innerHTML = `<h2>ক্যাটাগরি</h2>` +
    Array.from(cats.entries()).sort()
    .map(([c,n]) => `<a href="index.html?c=${encodeURIComponent(c)}">${c} (${toBnDigits(n)})</a>`).join(' ');
}

function renderTagCloud(posts, el){
  const tags = new Map();
  posts.forEach(p=> (p.tags||[]).forEach(t=> tags.set(t,(tags.get(t)||0)+1)));
  el.innerHTML = `<h2>ট্যাগ</h2>` +
    Array.from(tags.entries()).sort()
    .map(([t,n]) => `<a href="index.html?t=${encodeURIComponent(t)}">#${t} (${toBnDigits(n)})</a>`).join(' ');
}

/* ====== POST ====== */
async function initPost(){
  initMenu();

  document.addEventListener('scroll', ()=>{
    if (window.scrollY > 4) document.body.classList.add('scrolled');
    else document.body.classList.remove('scrolled');
  });

  const slug = getParam('slug') || (LOCAL ? 'sample' : '');
  if(!slug){
    $('#postTitle').textContent = 'পোস্ট পাওয়া যায়নি';
    return;
  }
  await renderMoreSection(slug);
  try{
    const mdName = slug === 'sample' && LOCAL ? '__inline-sample__' : slugToName(slug);
    const md = await fetchPostByName(mdName);
    const { fm, body } = parseFrontMatter(md);
    const html = mdToHtml(body);

    $('#postTitle').textContent = fm.title || slug;
    $('#postMeta').textContent = `${formatBnDate(fm.date || '2025-01-01')} · ${readingTime(body)}`;

    if (fm.thumbnail){
  $('#postCoverImg').src = resolveAsset(fm.thumbnail);
  $('#postCoverImg').alt = fm.title || '';
  $('#postCover').hidden = false;
}

    const bodyEl = $('#postBody');
    bodyEl.innerHTML = html;

    enhanceArabic(document);
    await downscaleImages(bodyEl, 1600, 0.82);

    convertDigitsExceptArabic(bodyEl);

    const tags = Array.isArray(fm.tags) ? fm.tags : [];
    if(tags.length){
      const t = $('#postTags');
      t.hidden = false;
      t.innerHTML = tags.map(tag => `<a class="cat-chip" href="index.html?t=${encodeURIComponent(tag)}">#${tag}</a>`).join(' ');
    }

    const share = $('#shareRow');
    const url = location.href;
    const text = encodeURIComponent(fm.title || 'ধৈর্য');
    share.innerHTML = [
      `<a target="_blank" rel="noopener" href="https://wa.me/?text=${text}%20${encodeURIComponent(url)}">WhatsApp</a>`,
      `<a target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">Facebook</a>`,
      `<a target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(url)}">X</a>`,
      `<a target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${text}">Telegram</a>`
    ].join(' · ');
    share.hidden = false;
// === Related posts ===
async function renderMoreSection(currentSlug){
  try{
    const names = await listPosts();
    const posts = [];

    for (const name of names){
      const slug = nameToSlug(name);
      if (slug === currentSlug) continue; // skip current post

      const md = await fetchPostByName(name);
      const { fm, body } = parseFrontMatter(md);
      posts.push({
        slug,
        title: fm.title || slug,
        date: fm.date || '1970-01-01',
        thumb: (fm.thumbnail || '').trim(),
        excerpt: fm.excerpt || makeExcerpt(body, 26)
      });
    }

    // newest first, then pick 4
    posts.sort((a,b)=> new Date(b.date) - new Date(a.date));
    const pick = posts.slice(0, 4);

    const grid = document.getElementById('moreGrid');
    if (!grid) return;

    grid.innerHTML = pick.map(p => {
      const hasThumb = !!p.thumb;
      return `
        <article class="more-card${hasThumb ? '' : ' no-thumb'}">
          ${hasThumb ? `
            <a class="more-thumb" href="post.html?slug=${encodeURIComponent(p.slug)}">
              <img src="${resolveAsset(p.thumb)}" alt=""
                   onerror="this.closest('.more-thumb').remove(); this.remove();">
            </a>
          ` : ``}
          <h3 class="more-title">
            <a href="post.html?slug=${encodeURIComponent(p.slug)}">${p.title}</a>
          </h3>
          <p class="more-excerpt">${p.excerpt}</p>
        </article>
      `;
    }).join('');

    // convert digits → Bengali
    grid.innerHTML = grid.innerHTML.replace(/\d/g, d => BN_DIGITS[d]);

  }catch(e){
    console.error('More section failed:', e);
  }
}
  // pick 3 other random posts, not the current one
  const others = posts.filter(p => p.slug !== slug).sort(()=>0.5 - Math.random()).slice(0,3);

  if (others.length){
    const section = $('#relatedPosts');
    const grid = section.querySelector('.related-grid');
    grid.innerHTML = others.map(p => `
      <a class="related-card" href="post.html?slug=${encodeURIComponent(p.slug)}">
        ${p.thumb ? `<div class="thumb"><img src="${resolveAsset(p.thumb)}" alt=""></div>` : `<div class="thumb" style="display:none"></div>`}
        <div class="info">
          <h3 class="title">${p.title}</h3>
          <p class="excerpt">${p.excerpt}</p>
        </div>
      </a>
    `).join('');
    section.hidden = false;
  }
}catch(e){ console.error('Related posts failed', e); }
  }catch(err){
    $('#postTitle').textContent = 'পোস্ট লোড ব্যর্থ';
    console.error(err);
  }
}

/* Convert digits → Bengali except Arabic blocks */
function convertDigitsExceptArabic(root){
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node){
      if (node.parentElement && (node.parentElement.classList.contains('ar-inline') || node.parentElement.classList.contains('ar-separate'))){
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while(walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => n.nodeValue = toBnDigits(n.nodeValue));
}
async function renderMoreSection(currentSlug){
  try{
    const names = await listPosts();
    const posts = [];

    for (const name of names){
      const slug = nameToSlug(name);
      if (slug === currentSlug) continue; // skip current

      const md = await fetchPostByName(name);
      const { fm, body } = parseFrontMatter(md);
      posts.push({
        slug,
        title: fm.title || slug,
        date: fm.date || '1970-01-01',
        thumb: fm.thumbnail || '',
        excerpt: fm.excerpt || makeExcerpt(body, 26)
      });
    }

    // Newest first
    posts.sort((a,b)=> new Date(b.date) - new Date(a.date));

    // Pick top 4
    const pick = posts.slice(0, 4);
    const grid = document.getElementById('moreGrid');
    if (!grid) return;

    grid.innerHTML = pick.map(p => `
      <article class="more-card">
        ${p.thumb ? `
  <a class="more-thumb" href="post.html?slug=${encodeURIComponent(p.slug)}">
    <img src="${resolveAsset(p.thumb)}" alt="">
  </a>
` : ``}
        <h3 class="more-title">
          <a href="post.html?slug=${encodeURIComponent(p.slug)}">${p.title}</a>
        </h3>
        <p class="more-excerpt">${p.excerpt}</p>
      </article>
    `).join('');

    // Bengali digits
    grid.innerHTML = grid.innerHTML.replace(/\d/g, d => BN_DIGITS[d]);

  }catch(e){
    console.error('More section failed:', e);
  }
}

/* Expose */
window.Blog = { initHome, initPost };





