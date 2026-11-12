/* Task Ripper PREVIEW app (UI). Pure rules live in engine.js. */
(function () {
  'use strict';
  var E = window.TRE;
  // PROMOTION: change K to 'task-ripper-v1' when this copy is promoted to live.
  var K = 'task-ripper-preview';
  // API cache only (set lists, card lists, prices). Not part of backups; safe to clear.
  var CK = 'task-ripper-tcgdex-cache';
  var API = 'https://api.tcgdex.net/v2/en';
  var POOL_TTL = 7 * 864e5, DETAIL_TTL = 864e5, SETLIST_TTL = 7 * 864e5;
  var EXCLUDE_SETS = { sve: 1, mee: 1, svp: 1, mep: 1, mfb: 1 };
  // Set-themed colours for the drawn wrapper (approximate, chosen to echo each real booster).
  var COLOURS = {
    'sv01': ['#c8102e', '#5b2a86'], 'sv02': ['#1b7f5a', '#e0b13a'], 'sv03': ['#1a1a1a', '#ff7a00'], 'sv03.5': ['#e63946', '#2b2d42'],
    'sv04': ['#4a1c7c', '#d4a017'], 'sv04.5': ['#2b2d42', '#ffcf3f'], 'sv05': ['#0077b6', '#7b2cbf'], 'sv06': ['#2d6a4f', '#9d4edd'],
    'sv06.5': ['#14213d', '#6a0dad'], 'sv07': ['#023e8a', '#f4d35e'], 'sv08': ['#ffb703', '#e85d04'], 'sv08.5': ['#b5179e', '#4cc9f0'],
    'sv09': ['#0096c7', '#ff9f1c'], 'sv10': ['#9d0208', '#1b0306'], 'sv10.5b': ['#111111', '#5a5a5a'], 'sv10.5w': ['#e9ecef', '#4361ee'],
    'me01': ['#6a4c93', '#ff595e'], 'me02': ['#3c096c', '#ff6d00'], 'me02.5': ['#ffb703', '#023047'], 'me03': ['#457b9d', '#e9c46a'],
    'me04': ['#6d1a36', '#ffba08'], 'me05': ['#0b090a', '#7209b7'], 'me06': ['#2a9d8f', '#264653'], '30th': ['#c9a227', '#1d3557']
  };

  var D = load(), C = loadCache(), tab = 'tasks', adminOK = false, adminTab = 'tasks', bf = { set: 'all', fav: false, tier: 'all', sort: 'number', q: '', missing: false };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function load() { try { return E.normalize(JSON.parse(localStorage.getItem(K) || 'null')); } catch (e) { return E.normalize(null); } }
  function save() { localStorage.setItem(K, JSON.stringify(D)); }
  function loadCache() { try { var c = JSON.parse(localStorage.getItem(CK) || 'null'); return c && typeof c === 'object' ? Object.assign({ pools: {}, details: {}, setList: null }, c) : { pools: {}, details: {}, setList: null }; } catch (e) { return { pools: {}, details: {}, setList: null }; } }
  var cacheTimer = null;
  function saveCache() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(function () {
      try { localStorage.setItem(CK, JSON.stringify(C)); }
      catch (e) { C.details = {}; try { localStorage.setItem(CK, JSON.stringify(C)); } catch (e2) { /* cache is optional */ } }
    }, 300);
  }
  function when(ts) { return new Date(ts).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' Sydney'; }
  function whenDate(ts) { return ts ? new Date(ts).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' Sydney' : ''; }
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  function reduceMotion() { return !!D.settings.reduceMotion || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function setMeta(id) { return D.sets.find(function (s) { return s.id === id; }) || (C.pools[id] && { id: id, name: C.pools[id].setName, logo: C.pools[id].logo }) || { id: id, name: id }; }
  function img(card, q) { return card && card.image ? card.image + '/' + (q || 'low') + '.webp' : ''; }

  /* ---------- TCGdex ---------- */
  function getJSON(path) {
    return fetch(API + path).then(function (r) { if (!r.ok) throw new Error('TCGdex ' + r.status); return r.json(); });
  }
  function limit(tasks, n) {
    var i = 0, out = new Array(tasks.length);
    function worker() { if (i >= tasks.length) return Promise.resolve(); var k = i++; return tasks[k]().then(function (v) { out[k] = v; return worker(); }); }
    var ws = []; for (var j = 0; j < Math.min(n, tasks.length); j++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  }
  var poolLoading = {};
  function loadPool(setId, force) {
    var cached = C.pools[setId];
    if (cached && !force && Date.now() - cached.fetchedAt < POOL_TTL) return Promise.resolve(cached);
    if (poolLoading[setId]) return poolLoading[setId];
    var q = function (extra) { return function () { return getJSON('/cards?set.id=eq:' + encodeURIComponent(setId) + extra); }; };
    var tasks = [function () { return getJSON('/sets/' + encodeURIComponent(setId)); }, q('&category=eq:Energy')]
      .concat(E.QUERY_RARITIES.map(function (r) { return q('&rarity=eq:' + encodeURIComponent(r)); }));
    poolLoading[setId] = limit(tasks, 4).then(function (res) {
      var set = res[0], pool = E.buildPool(setId, set, res[1], res.slice(2), Date.now());
      C.pools[setId] = pool; saveCache(); delete poolLoading[setId];
      var m = D.sets.find(function (s) { return s.id === setId; }); if (m) { m.name = set.name; m.logo = set.logo || m.logo; m.symbol = set.symbol || null; save(); }
      return pool;
    }, function (err) { delete poolLoading[setId]; if (cached) return cached; throw err; });
    return poolLoading[setId];
  }
  function loadDetail(id) {
    var d = C.details[id];
    if (d && Date.now() - d.at < DETAIL_TTL) return Promise.resolve(d);
    return getJSON('/cards/' + encodeURIComponent(id)).then(function (c) {
      var out = { at: Date.now(), pricing: E.compactPricing(c), variants: c.variants || null, category: c.category };
      C.details[id] = out; saveCache(); return out;
    }, function () { return d || null; });
  }
  function loadSetList() {
    if (C.setList && Date.now() - C.setList.at < SETLIST_TTL) return Promise.resolve(C.setList.sets);
    return Promise.all([getJSON('/series/me'), getJSON('/series/sv')]).then(function (rs) {
      var sets = [];
      rs.forEach(function (s) { (s.sets || []).slice().reverse().forEach(function (x) { if (!EXCLUDE_SETS[x.id] && x.logo) sets.push({ id: x.id, name: x.name, logo: x.logo, total: (x.cardCount || {}).total, series: s.name }); }); });
      C.setList = { at: Date.now(), sets: sets }; saveCache(); return sets;
    }, function (e) { if (C.setList) return C.setList.sets; throw e; });
  }
  function preload(urls, ms) {
    return Promise.race([Promise.all(urls.filter(Boolean).map(function (u) { return new Promise(function (res) { var i = new Image(); i.onload = i.onerror = function () { res(); }; i.src = u; }); })), new Promise(function (res) { setTimeout(res, ms); })]);
  }
  function bestPrice(entry, id) {
    var d = C.details[id]; if (!d || !d.pricing) return null;
    var best = null; Object.keys((entry && entry.variants) || { normal: 1 }).forEach(function (v) { var p = E.priceFor(d.pricing, v); if (p && (!best || p.value > best.value)) best = p; });
    return best;
  }

  /* ---------- pack wrapper ---------- */
  function hashColour(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return ['hsl(' + h + ',70%,42%)', 'hsl(' + ((h + 60) % 360) + ',70%,25%)']; }
  function packHTML(setId, premium, cls) {
    var m = setMeta(setId), col = COLOURS[setId] || hashColour(setId);
    var logo = m.logo ? '<img class="logo" alt="' + esc(m.name) + '" src="' + esc(m.logo) + '.webp" onerror="if(!this.dataset.f){this.dataset.f=1;this.src=\'' + esc(m.logo) + '.png\'}else{this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'logoText\',textContent:this.alt}))}">' : '<div class="logoText">' + esc(m.name) + '</div>';
    return '<div class="pack ' + (cls || '') + '" style="--c1:' + col[0] + ';--c2:' + col[1] + '"><div class="crimp t"></div>' + (premium ? '<div class="ribbon">PREMIUM</div>' : '') + logo + '<div class="glow"></div><div class="sub">' + (premium ? 'PREMIUM · ' : '') + '10 CARDS</div><div class="crimp b"></div></div>';
  }

  /* ---------- modals ---------- */
  function modal(html, onMount) {
    var root = $('#modalRoot'); var m = document.createElement('div'); m.className = 'modal'; m.innerHTML = '<div class="modalBox">' + html + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
    root.appendChild(m); if (onMount) onMount(m); return m;
  }

  /* ---------- views ---------- */
  function render() {
    document.title = (D.title || 'Task Ripper') + ' PREVIEW';
    $('#title').textContent = D.title || 'Task Ripper';
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    var sealed = D.packs.filter(function (p) { return p.status === 'sealed' || (p.status === 'opened' && p.ripSeen === false); }).length;
    $('#tabs [data-tab=backpack]').textContent = 'Backpack' + (sealed ? ' (' + sealed + ')' : '');
    var v = $('#view');
    if (tab === 'tasks') v.innerHTML = viewTasks();
    else if (tab === 'backpack') v.innerHTML = viewBackpack();
    else if (tab === 'binder') { v.innerHTML = viewBinder(); fetchBinderPrices(); }
    else if (tab === 'progress') v.innerHTML = viewProgress();
    else if (tab === 'admin') v.innerHTML = adminOK ? viewAdmin() : '<div class="card"><h2>Admin</h2><p class="muted">Parents only.</p><button class="btn primary" data-act="pin">Enter PIN</button></div>';
  }

  function viewTasks() {
    var list = D.tasks.filter(function (t) { return t.active; });
    var now = Date.now();
    return '<div class="card"><h2>Your tasks</h2><p class="muted">Done a task? Tap it, confirm, and pick a pack for your backpack.</p>' +
      (list.length ? list.map(function (t) {
        var n = E.doneToday(D, t.id, now);
        return '<button class="task ' + (t.premium ? 'prem' : '') + '" data-act="task" data-id="' + esc(t.id) + '"><span>' + esc(t.name) + (n ? ' <span class="badge">✓ ' + n + '× today</span>' : '') + '</span><span class="badge ' + (t.premium ? 'b-prem' : '') + '">' + (t.premium ? '★ Premium pack' : 'Pack') + '</span></button>';
      }).join('') : '<p class="muted">No tasks yet. A parent can add some in Admin.</p>') + '</div>';
  }

  function onTask(id) {
    var t = D.tasks.find(function (x) { return x.id === id; }); if (!t) return;
    var n = E.doneToday(D, t.id, Date.now());
    modal('<h2>' + esc(t.name) + '</h2>' + (t.premium ? '<p><span class="badge b-prem">★ Premium task: earns a premium pack</span></p>' : '') +
      '<p>Did you finish this task today?</p>' + (n ? '<p class="muted">Already confirmed ' + n + ' time' + (n > 1 ? 's' : '') + ' today.</p>' : '') +
      '<div class="row"><button class="btn primary" data-yes>Yes, I did it</button><button class="btn" data-close>Not yet</button></div>', function (m) {
        $('[data-yes]', m).onclick = function () { m.remove(); pickSet(t); };
      });
  }

  function statusFor(setId) {
    var pool = C.pools[setId]; if (!pool) return null; return E.setStatus(pool, D.collection);
  }
  function pickSet(t) {
    var sets = D.enabledSets.map(setMeta);
    var m = modal('<h2>Choose your pack</h2><p class="muted">For: ' + esc(t.name) + (t.premium ? ' · <b>Premium pack</b>' : '') + '</p>' +
      (sets.length ? '<div class="packs" id="pickList"></div>' : '<p>No sets are switched on. Ask a parent to pick some in Admin.</p>') +
      '<p><button class="btn" data-close>Cancel</button></p>', function (m) { draw(m); });
    function draw(m) {
      var el = $('#pickList', m); if (!el) return;
      el.innerHTML = sets.map(function (s) {
        var st = statusFor(s.id), note = '', dis = false;
        if (st && st.capped) { note = '<span class="badge b-max">Set capped: every card at 5 copies</span>'; dis = true; }
        else if (st && st.hitsMaxed) note = '<span class="badge b-warn">Hits maxed: no ex or better left</span>';
        else if (st && st.eligible < 10) note = '<span class="badge b-warn">Almost capped: short pack</span>';
        return '<button class="packTile ' + (dis ? 'disabled' : '') + '" data-set="' + esc(s.id) + '" ' + (dis ? 'disabled' : '') + '>' + packHTML(s.id, t.premium) + '<b>' + esc(s.name) + '</b>' + note + '</button>';
      }).join('');
      $$('[data-set]', el).forEach(function (b) {
        b.onclick = function () {
          var s = setMeta(b.dataset.set);
          var pack = E.earnPack(D, t, s, Date.now()); save(); m.remove();
          toast((pack.premium ? 'Premium ' : '') + s.name + ' pack added to your backpack!'); render();
        };
      });
    }
    sets.forEach(function (s) { if (!C.pools[s.id]) loadPool(s.id).then(function () { if (m.isConnected) draw(m); }, function () {}); });
  }

  function viewBackpack() {
    var sealed = D.packs.filter(function (p) { return p.status === 'sealed'; }).sort(function (a, b) { return a.at - b.at; });
    var unfinished = D.packs.filter(function (p) { return p.status === 'opened' && p.ripSeen === false; });
    var opened = D.packs.filter(function (p) { return p.status === 'opened'; }).sort(function (a, b) { return (b.openedAt || 0) - (a.openedAt || 0); });
    return '<div class="card"><h2>Backpack</h2>' + (sealed.length || unfinished.length ? '<p class="muted">Tap a pack to rip it.</p><div class="packs">' +
      unfinished.concat(sealed).map(function (p) {
        return '<button class="packTile" data-act="open" data-id="' + esc(p.id) + '">' + packHTML(p.setId, p.premium) + '<b>' + esc(p.setName) + '</b>' + (p.premium ? '<span class="badge b-prem">Premium</span>' : '<span class="badge">Regular</span>') + (p.status === 'opened' ? '<span class="badge b-warn">Finish ripping</span>' : '') + '<span class="small muted">' + esc(p.taskName) + '<br>' + esc(when(p.at)) + '</span></button>';
      }).join('') + '</div>' : '<p class="muted">No sealed packs. Finish a task to earn one!</p>') + '</div>' +
      '<div class="card"><h2>Opened packs</h2>' + (opened.length ? opened.slice(0, 40).map(packHistoryRow).join('') : '<p class="muted">None yet.</p>') + '</div>';
  }
  function packHistoryRow(p) {
    return '<details style="margin:8px 0"><summary style="min-height:44px;cursor:pointer"><b>' + esc(p.setName) + '</b> ' + (p.premium ? '<span class="badge b-prem">Premium</span>' : '<span class="badge">Regular</span>') + ' <span class="muted small">from "' + esc(p.taskName) + '", earned ' + esc(when(p.at)) + (p.openedAt ? ', opened ' + esc(when(p.openedAt)) : '') + '</span>' + (p.short ? ' <span class="badge b-warn">Short pack</span>' : '') + '</summary>' +
      '<div class="recap" style="padding:8px 0">' + (p.cards || []).map(function (c) { return slotHTML(c, null, true); }).join('') + '</div></details>';
  }

  function slotHTML(c, entry, small) {
    var tier = c.tier || E.tierOf(c.rarity);
    var tags = '';
    if (small && c.isNew) tags += '<span class="badge b-new">NEW</span> ';
    if (small && c.maxed) tags += '<span class="badge b-max">5/5 max</span> ';
    else if (small && !c.isNew && c.copy) tags += '<span class="badge">Copy ' + c.copy + '</span> ';
    if (c.variant === 'reverse') tags += '<span class="badge">Reverse</span>';
    return '<div class="slot"><div class="pic">' + (c.image ? '<img loading="lazy" alt="' + esc(c.name) + '" src="' + esc(img(c)) + '">' : '<div class="muted" style="padding:10px">' + esc(c.name) + '</div>') + '</div><div class="nm">' + esc(c.name) + '</div><div class="meta">' + esc(E.TIER_LABEL[tier]) + ' · #' + esc(c.localId) + '</div>' + (tags ? '<div style="margin-top:4px">' + tags + '</div>' : '') + '</div>';
  }

  /* ---------- binder ---------- */
  function binderCards() {
    var col = D.collection, ids = Object.keys(col).filter(function (id) { return col[id].count > 0; });
    var rows = ids.map(function (id) { var e = col[id]; return { id: id, e: e, price: bestPrice(e, id) }; });
    if (bf.set !== 'all') rows = rows.filter(function (r) { return r.e.setId === bf.set; });
    if (bf.fav) rows = rows.filter(function (r) { return r.e.favourite; });
    if (bf.tier !== 'all') rows = rows.filter(function (r) { return r.e.tier === bf.tier; });
    if (bf.q) { var q = bf.q.toLowerCase(); rows = rows.filter(function (r) { return String(r.e.name).toLowerCase().indexOf(q) >= 0; }); }
    var num = function (r) { return (r.e.setId || '') + ':' + String(r.e.localId || '').padStart(4, '0'); };
    var sorts = {
      number: function (a, b) { return num(a) < num(b) ? -1 : num(a) > num(b) ? 1 : 0; },
      rarity: function (a, b) { return E.RANK[b.e.tier] - E.RANK[a.e.tier] || sorts.number(a, b); },
      value: function (a, b) { if (!a.price && !b.price) return sorts.number(a, b); if (!a.price) return 1; if (!b.price) return -1; return b.price.value - a.price.value; },
      newest: function (a, b) { return (b.e.firstAt || 0) - (a.e.firstAt || 0); }
    };
    rows.sort(sorts[bf.sort] || sorts.number);
    return rows;
  }
  function viewBinder() {
    var setIds = {}; Object.keys(D.collection).forEach(function (id) { setIds[D.collection[id].setId] = 1; }); D.enabledSets.forEach(function (id) { setIds[id] = 1; });
    var rows = binderCards(), pool = bf.set !== 'all' ? C.pools[bf.set] : null;
    var head = '';
    if (bf.set !== 'all') {
      if (pool) { var owned = pool.cards.filter(function (c) { return D.collection[c.id] && D.collection[c.id].count > 0; }).length, tot = pool.cards.length, pct = tot ? owned / tot * 100 : 0; head = '<p><b>' + esc(pool.setName) + '</b>: ' + owned + ' / ' + tot + ' cards (' + pct.toFixed(1) + '%), Energy not counted</p><div class="bar"><i style="width:' + pct + '%"></i></div>'; }
      else { head = '<p class="muted">Loading set list…</p>'; loadPool(bf.set).then(function () { if (tab === 'binder') render(); }, function () {}); }
    }
    var tiles = rows.map(function (r) {
      var e = r.e;
      return '<div class="slot" ><button class="ghost" style="all:unset;display:block;cursor:pointer;width:100%" data-act="card" data-id="' + esc(r.id) + '"><div class="pic"><img loading="lazy" alt="' + esc(e.name) + '" src="' + esc(img(e)) + '"><span class="count">×' + e.count + (e.count >= 5 ? ' max' : '') + '</span></div><div class="nm">' + esc(e.name) + '</div><div class="meta">' + esc(E.TIER_LABEL[e.tier] || e.rarity) + ' · ' + esc(setMeta(e.setId).name) + ' #' + esc(e.localId) + '</div><div class="meta">' + (r.price ? esc(E.fmtMoney(r.price)) : 'Unpriced') + '</div></button><button class="fav ' + (e.favourite ? 'on' : '') + '" data-act="fav" data-id="' + esc(r.id) + '" aria-label="Favourite">' + (e.favourite ? '★' : '☆') + '</button></div>';
    });
    if (bf.missing && pool && bf.tier === 'all' && !bf.fav && !bf.q) {
      pool.cards.filter(function (c) { return !(D.collection[c.id] && D.collection[c.id].count > 0); }).forEach(function (c) {
        tiles.push('<div class="slot missing"><div class="pic">#' + esc(c.localId) + '</div><div class="nm muted">Not yet</div><div class="meta">' + esc(E.TIER_LABEL[c.tier]) + '</div></div>');
      });
    }
    return '<div class="card"><h2>Binder</h2><div class="row">' +
      '<select data-bf="set"><option value="all">All sets</option>' + Object.keys(setIds).map(function (id) { return '<option value="' + esc(id) + '"' + (bf.set === id ? ' selected' : '') + '>' + esc(setMeta(id).name) + '</option>'; }).join('') + '</select>' +
      '<select data-bf="tier"><option value="all">Any rarity</option>' + E.TIERS.map(function (t) { return '<option value="' + t + '"' + (bf.tier === t ? ' selected' : '') + '>' + E.TIER_LABEL[t] + '</option>'; }).join('') + '</select>' +
      '<select data-bf="sort">' + [['number', 'Sort: card number'], ['rarity', 'Sort: rarity'], ['value', 'Sort: value'], ['newest', 'Sort: newest']].map(function (o) { return '<option value="' + o[0] + '"' + (bf.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<label class="check"><input type="checkbox" data-bf="fav"' + (bf.fav ? ' checked' : '') + '> Favourites only</label>' +
      (bf.set !== 'all' ? '<label class="check"><input type="checkbox" data-bf="missing"' + (bf.missing ? ' checked' : '') + '> Show missing</label>' : '') +
      '<input data-bf="q" placeholder="Search name" value="' + esc(bf.q) + '" style="flex:1;min-width:150px">' +
      '</div>' + head + '<p class="muted small">Values are approximate TCGplayer market prices in US dollars for the version you pulled (Cardmarket euros if there is no TCGplayer price). Unpriced cards sort last. Prices load from TCGdex when online.</p>' +
      (tiles.length ? '<div class="binder">' + tiles.join('') + '</div>' : '<p class="muted">No cards here yet.</p>') + '</div>' +
      '<div class="card"><h3>Special prompt cards</h3><p class="muted">Coming in a later version: make-your-own cards, approved by a parent. They will live on their own page and are not counted in set percentages.</p></div>';
  }
  var priceFetching = false, priceTried = {};
  function fetchBinderPrices() {
    if (priceFetching) return;
    var ids = Object.keys(D.collection).filter(function (id) { var d = C.details[id]; return !priceTried[id] && (!d || Date.now() - d.at > DETAIL_TTL); });
    ids.forEach(function (id) { priceTried[id] = 1; });
    if (!ids.length) return; priceFetching = true;
    limit(ids.map(function (id) { return function () { return loadDetail(id); }; }), 3).then(function () { priceFetching = false; if (tab === 'binder' && !$('.modal')) render(); }, function () { priceFetching = false; });
  }
  function cardDetail(id) {
    var e = D.collection[id]; if (!e) return;
    var p = bestPrice(e, id), packs = D.packs.filter(function (pk) { return (e.packs || []).indexOf(pk.id) >= 0; });
    modal('<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:12px"><img alt="' + esc(e.name) + '" src="' + esc(img(e, 'high')) + '" style="width:100%;max-width:360px;margin:auto;border-radius:12px"><div><h2>' + esc(e.name) + '</h2><p>' + esc(setMeta(e.setId).name) + ' #' + esc(e.localId) + ' · ' + esc(E.TIER_LABEL[e.tier] || e.rarity) + '</p><p>You have <b>' + e.count + '</b> ' + (e.count >= 5 ? '(max 5 reached: it will not appear in new packs)' : '(max 5)') + '. Versions: ' + Object.keys(e.variants || {}).map(function (v) { return esc(v) + ' ×' + e.variants[v]; }).join(', ') + '</p>' +
      '<p>' + (p ? '<b>' + esc(E.fmtMoney(p)) + '</b> <span class="muted small">' + esc(p.source) + (p.updated ? ', updated ' + esc(whenDate(p.updated)) : '') + '</span>' : '<span class="muted">Unpriced (TCGdex has no price for this card yet)</span>') + '</p>' +
      '<h3>Came from</h3>' + (packs.length ? packs.map(function (pk) { return '<div class="small">• ' + esc(pk.setName) + (pk.premium ? ' premium' : '') + ' pack for "' + esc(pk.taskName) + '", ' + esc(when(pk.openedAt || pk.at)) + '</div>'; }).join('') : '<p class="muted">Unknown</p>') +
      '<div class="row" style="margin-top:14px"><button class="btn" data-favd>' + (e.favourite ? '★ Favourite' : '☆ Add to favourites') + '</button><button class="btn" data-close>Close</button></div></div></div>', function (m) {
        $('[data-favd]', m).onclick = function () { e.favourite = !e.favourite; save(); m.remove(); render(); cardDetail(id); };
      });
  }

  /* ---------- progress ---------- */
  function viewProgress(inAdmin) {
    var R = E.report(D, C.pools, Date.now());
    D.enabledSets.forEach(function (id) { if (!C.pools[id]) loadPool(id).then(function () { if (tab === 'progress' || tab === 'admin') render(); }, function () {}); });
    function block(title, X, week) {
      return '<div class="card"><h2>' + title + '</h2><div class="stats">' +
        '<div class="stat">Tasks done<b>' + X.tasks + '</b><span class="small muted">' + X.premiumTasks + ' premium</span></div>' +
        '<div class="stat">Packs earned<b>' + (X.packsRegular + X.packsPremium) + '</b><span class="small muted">' + X.packsRegular + ' regular, ' + X.packsPremium + ' premium</span></div>' +
        '<div class="stat">Cards pulled<b>' + X.cardsPulled + '</b><span class="small muted">including duplicates</span></div>' +
        '<div class="stat">New cards<b>' + X.newUniques + '</b><span class="small muted">' + (week ? 'first time pulled this week' : 'unique cards owned: ' + R.uniqueOwned) + '</span></div></div>' +
        (Object.keys(X.byTask).length ? '<h3>By task</h3><table>' + Object.keys(X.byTask).map(function (n) { return '<tr><td>' + esc(n) + '</td><td>' + X.byTask[n] + '</td></tr>'; }).join('') + '</table>' : '') + '</div>';
    }
    var sets = '<div class="card"><h2>Percent of each set</h2><p class="muted small">Unique cards owned ÷ every card TCGdex lists for the set, including secret rares. Energy cards are left out.</p>' +
      R.sets.map(function (s) {
        var nm = esc(setMeta(s.setId).name);
        if (!s.known) return '<p>' + nm + ': <span class="muted">loading card list…</span></p>';
        return '<p><b>' + nm + '</b>: ' + s.owned + ' / ' + s.total + ' (' + s.pct.toFixed(1) + '%)' + (s.newThisWeek ? ' · +' + s.newThisWeek + ' this week' : '') + '</p><div class="bar"><i style="width:' + s.pct + '%"></i></div>';
      }).join('') + (R.sets.length ? '<p style="margin-top:14px"><b>Overall (switched-on sets)</b>: ' + R.overall.owned + ' / ' + R.overall.total + ' (' + R.overall.pct.toFixed(1) + '%)' + (R.overall.complete ? '' : ' <span class="muted small">(some sets still loading)</span>') + '</p>' : '<p class="muted">No sets switched on.</p>') +
      '<p class="muted small">Special prompt cards owned: ' + R.specials + ' (counted separately, coming later).</p></div>';
    return block('This week <span class="muted small">(from Mon ' + esc(R.weekStart) + ', Sydney time)</span>', R.week, true) + block('All time', R.all, false) + sets;
  }

  /* ---------- admin ---------- */
  function viewAdmin() {
    var tabs = [['tasks', 'Tasks'], ['sets', 'Sets'], ['history', 'Pack history'], ['report', 'Report'], ['backup', 'Backup'], ['settings', 'Settings'], ['prompts', 'Prompt cards']];
    var body = '';
    var since = D.lastBackupAt ? Math.floor((Date.now() - D.lastBackupAt) / 864e5) : null;
    var backupWarn = (D.packs.length && (since === null || since > 14)) ? '<div class="card" style="border-color:#f6b73c"><b>Backup reminder:</b> ' + (since === null ? 'no backup has been made on this iPad yet.' : 'last backup was ' + since + ' days ago.') + ' <button class="btn" data-admintab="backup">Back up now</button></div>' : '';
    if (adminTab === 'tasks') {
      body = '<div class="card"><h2>Tasks</h2>' + (D.demoDefaults ? '<p class="badge b-warn">Preview sample tasks: change, rename or retire them freely.</p>' : '') +
        '<p class="muted">Reusable tasks with no dates. Premium tasks earn a premium pack (two hits, the last one Ultra Rare or better).</p>' +
        '<div class="row"><input id="newTask" placeholder="New task, e.g. Practise piano" style="flex:1;min-width:200px"><label class="check"><input type="checkbox" id="newPrem"> Premium</label><button class="btn primary" data-act="addTask">Add task</button></div>' +
        '<table style="margin-top:12px"><tr><th>Task</th><th>Premium</th><th>Active</th></tr>' + D.tasks.map(function (t) {
          return '<tr><td><input data-tname="' + esc(t.id) + '" value="' + esc(t.name) + '" style="width:100%"></td><td><label class="check"><input type="checkbox" data-tprem="' + esc(t.id) + '"' + (t.premium ? ' checked' : '') + '></label></td><td><label class="check"><input type="checkbox" data-tact="' + esc(t.id) + '"' + (t.active ? ' checked' : '') + '> ' + (t.active ? 'On' : 'Retired') + '</label></td></tr>';
        }).join('') + '</table><p class="muted small">Renaming a task does not change the name saved on packs already earned. Retire a task instead of deleting it so history stays.</p></div>';
    } else if (adminTab === 'sets') {
      body = '<div class="card"><h2>Sets players can choose</h2>' + (D.demoDefaults ? '<p class="badge b-warn">Preview defaults: Surging Sparks and Destined Rivals are switched on just so you can try a rip. This is not a final choice.</p>' : '') +
        '<div id="setList"><p class="muted">Loading sets from TCGdex…</p></div><p><button class="btn" data-act="refreshData">Refresh card data and prices</button></p></div>';
      setTimeout(drawSetList, 0);
    } else if (adminTab === 'history') {
      var ps = D.packs.slice().sort(function (a, b) { return b.at - a.at; });
      body = '<div class="card"><h2>Pack history</h2><p class="muted">Every pack and the task that earned it.</p>' + (ps.length ? '<table><tr><th>Earned</th><th>Task</th><th>Pack</th><th>Status</th></tr>' + ps.map(function (p) {
        return '<tr><td class="small">' + esc(when(p.at)) + '</td><td>' + esc(p.taskName) + '</td><td>' + esc(p.setName) + (p.premium ? ' <span class="badge b-prem">Premium</span>' : '') + '</td><td class="small">' + (p.status === 'opened' ? 'Opened ' + esc(when(p.openedAt)) + '<br>' + (p.cards || []).map(function (c) { return esc(c.name) + (c.nice ? ' ★' : ''); }).join(', ') : 'Sealed') + '</td></tr>';
      }).join('') + '</table>' : '<p class="muted">No packs yet.</p>') + '</div>';
    } else if (adminTab === 'report') {
      body = viewProgress(true);
    } else if (adminTab === 'backup') {
      body = '<div class="card"><h2>Backup</h2><p>Export saves everything on this iPad (tasks, packs, binder, favourites) as a file. On iPad, tap <b>Export backup</b>, then <b>Save to Files</b>, and choose <b>iCloud Drive</b>.</p>' +
        '<p class="muted small">Last backup: ' + (D.lastBackupAt ? esc(when(D.lastBackupAt)) : 'never') + '. Safari tab and Home Screen icon keep separate saves, so back up from the one the kids use.</p>' +
        '<div class="row"><button class="btn primary" data-act="export">Export backup</button><button class="btn" data-act="download">Download file instead</button><label class="btn" style="display:inline-flex;align-items:center">Import backup…<input type="file" id="importFile" accept="application/json,.json" style="display:none"></label></div></div>';
    } else if (adminTab === 'settings') {
      body = '<div class="card"><h2>Settings</h2><div class="grid"><label>App title <input id="setTitle" value="' + esc(D.title) + '"></label><label>New PIN <input id="setPin" inputmode="numeric" placeholder="4+ digits"></label>' +
        '<label class="check"><input type="checkbox" id="setRM"' + (D.settings.reduceMotion ? ' checked' : '') + '> Reduce motion (skip the rip animation and go straight to the cards)</label>' +
        '<button class="btn primary" data-act="saveSettings">Save settings</button></div><p class="muted small">Saved on this device under its own key (' + K + '). Quest Tracker data is never touched.</p></div>';
    } else if (adminTab === 'prompts') {
      body = '<div class="card"><h2>Special prompt cards</h2><p>Coming in phase 2. The plan: a child writes a prompt, you approve it here, then you ask Lead Coder to make an original picture. Nothing is generated automatically and no API key is used.</p></div>';
    }
    return backupWarn + '<div class="card"><div class="row spread"><h2 style="margin:0">Admin</h2><button class="btn" data-act="lock">Lock</button></div><div class="row" style="margin-top:12px">' + tabs.map(function (t) { return '<button class="btn ' + (adminTab === t[0] ? 'primary' : '') + '" data-admintab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></div>' + body;
  }
  function drawSetList() {
    var el = $('#setList'); if (!el) return;
    loadSetList().then(function (sets) {
      var el2 = $('#setList'); if (!el2) return;
      el2.innerHTML = '<div class="packs">' + sets.map(function (s) {
        var on = D.enabledSets.indexOf(s.id) >= 0;
        if (!D.sets.find(function (x) { return x.id === s.id; })) D.sets.push({ id: s.id, name: s.name, logo: s.logo });
        return '<label class="packTile" style="cursor:pointer">' + packHTML(s.id, false) + '<b>' + esc(s.name) + '</b><span class="small muted">' + esc(s.series) + ' · ' + (s.total || '?') + ' cards</span><span class="check"><input type="checkbox" data-setid="' + esc(s.id) + '"' + (on ? ' checked' : '') + '> Available</span></label>';
      }).join('') + '</div>';
    }, function () { var e2 = $('#setList'); if (e2) e2.innerHTML = '<p>Could not reach TCGdex. Check the internet connection and try again.</p>' + D.enabledSets.map(function (id) { return '<p>✓ ' + esc(setMeta(id).name) + '</p>'; }).join(''); });
  }
  function backupFile() {
    var name = 'task-ripper-preview-backup-' + E.sydDay(Date.now()) + '.json';
    var text = JSON.stringify(E.makeBackup(D, Date.now()), null, 1);
    return { name: name, text: text };
  }
  function download(f) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([f.text], { type: 'application/json' })); a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function markBackup() { D.lastBackupAt = Date.now(); save(); render(); }
  function doExport(forceDownload) {
    var f = backupFile();
    var file = typeof File === 'function' ? new File([f.text], f.name, { type: 'application/json' }) : null;
    if (!forceDownload && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Task Ripper backup' }).then(function () { markBackup(); toast('Backup shared'); }, function (e) { if (e && e.name !== 'AbortError') { download(f); markBackup(); } });
    } else { download(f); markBackup(); toast('Backup downloaded. Move it to iCloud Drive in the Files app.'); }
  }
  function doImport(file) {
    var r = new FileReader();
    r.onload = function () {
      var nd; try { nd = E.parseBackup(String(r.result)); } catch (e) { alert('Could not read that backup: ' + e.message); return; }
      var cards = Object.keys(nd.collection).length;
      if (!confirm('Replace everything on this iPad with this backup?\n\n' + nd.tasks.length + ' tasks, ' + nd.packs.length + ' packs, ' + cards + ' different cards.\n\nTip: export a backup first if you are unsure.')) return;
      D = nd; save(); toast('Backup imported'); render();
    };
    r.readAsText(file);
  }

  /* ---------- the rip ---------- */
  function openPack(id) {
    var p = D.packs.find(function (x) { return x.id === id; }); if (!p) return;
    var ov = document.createElement('div'); ov.className = 'rip';
    ov.innerHTML = '<div class="bar2"><div><b>' + esc(p.setName) + '</b> ' + (p.premium ? '<span class="badge b-prem">Premium</span>' : '') + '<div class="small muted">for "' + esc(p.taskName) + '"</div></div><div class="counter" id="ripCount"></div><div class="row"><button class="btn" id="ripSkip">Skip to cards</button><button class="btn ghost" id="ripClose" aria-label="Close">✕</button></div></div><div class="stage" id="stage"></div>';
    document.body.appendChild(ov);
    var stage = $('#stage', ov), state = { i: 0 };
    $('#ripClose', ov).onclick = function () { ov.remove(); render(); };
    $('#ripSkip', ov).onclick = function () { if (p.status === 'opened') recap(); };
    stage.innerHTML = '<div style="text-align:center">' + packHTML(p.setId, p.premium, 'bigpack') + '<p class="muted">Getting cards ready…</p></div>';
    var ready = p.status === 'opened' ? Promise.resolve() : loadPool(p.setId).then(function (pool) {
      var res = E.generatePack({ pool: pool, collection: D.collection, premium: p.premium });
      if (!res.cards.length) throw new Error('Every card in this set is already at 5 copies.');
      E.commitPack(D, p, res, Date.now()); save(); // saved before any animation: skipping can never lose cards
    });
    ready.then(function () {
      p.cards.forEach(function (c) { loadDetail(c.id); });
      return preload(p.cards.map(function (c) { return img(c, 'high'); }), 8000);
    }).then(function () {
      if (!ov.isConnected) return;
      if (reduceMotion()) recap(); else sealedStage();
    }, function (err) {
      stage.innerHTML = '<div class="card" style="max-width:420px;text-align:center"><h2>Could not open yet</h2><p>' + esc(err.message || err) + '</p><p class="muted">The card list for a set needs the internet the first time. Your pack is still sealed in the backpack.</p><button class="btn primary" id="ripBack">Back</button></div>';
      $('#ripBack', ov).onclick = function () { ov.remove(); render(); };
    });

    function hint(t) { var h = $('.hint', stage); if (!h) { h = document.createElement('div'); h.className = 'hint'; stage.appendChild(h); } h.textContent = t; }
    // One set of pointer listeners on the stage; each rip step swaps in its own move/end handlers.
    var cur = null, sx = 0, sy = 0, hist = [], active = false;
    function drag(el, onMove, onEnd) { cur = { move: onMove, end: onEnd }; }
    stage.addEventListener('pointerdown', function (e) { if (!cur) return; active = true; sx = e.clientX; sy = e.clientY; hist = [{ x: e.clientX, y: e.clientY, t: e.timeStamp || Date.now() }]; if (stage.setPointerCapture && e.pointerId != null) try { stage.setPointerCapture(e.pointerId); } catch (x) {} });
    stage.addEventListener('pointermove', function (e) { if (!active || !cur) return; var t = e.timeStamp || Date.now(); hist.push({ x: e.clientX, y: e.clientY, t: t }); while (hist.length > 2 && t - hist[0].t > 90) hist.shift(); cur.move(e.clientX - sx, e.clientY - sy); });
    function up(e) { if (!active || !cur) return; active = false; var a = hist[0], b = hist[hist.length - 1], dt = Math.max(1, b.t - a.t); cur.end(e.clientX - sx, e.clientY - sy, (b.x - a.x) / dt, (b.y - a.y) / dt); }
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    function anim(el, frames, ms) { if (el.animate) { var a = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }); return a.finished || new Promise(function (r) { a.onfinish = r; }); } el.style.transform = frames[frames.length - 1].transform || ''; return Promise.resolve(); }
    function W() { return stage.clientWidth || 360; }

    function sealedStage() {
      stage.innerHTML = '<div class="deck" style="width:auto;aspect-ratio:auto"><div style="position:relative" id="pk">' + packHTML(p.setId, p.premium, 'bigpack') + '<div class="tear" id="tear">' + packHTML(p.setId, p.premium) + '</div><div class="tearline" id="tl" style="width:0"></div></div></div>';
      var tear = $('#tear', stage), tl = $('#tl', stage), pk = $('#pk', stage), done = false;
      // Show only the top strip of the duplicate wrapper inside the tear piece.
      hint('Swipe across the top to tear it open');
      drag(stage, function (dx) {
        if (done) return; var p2 = Math.min(1, Math.abs(dx) / (W() * 0.55));
        tl.style.width = (p2 * 100) + '%';
        tear.style.transform = 'rotate(' + (-p2 * 10 * Math.sign(dx || 1)) + 'deg) translateY(' + (-p2 * 14) + 'px)';
      }, function (dx, dy, vx) {
        if (done) return; var p2 = Math.abs(dx) / (W() * 0.55);
        if (p2 >= 1 || (p2 > 0.3 && Math.abs(vx) > 0.6)) {
          done = true; var ms = Math.max(200, Math.min(900, 300 / Math.max(Math.abs(vx), 0.3)));
          anim(tear, [{ transform: tear.style.transform || 'none' }, { transform: 'translate(' + (Math.sign(dx || 1) * W()) + 'px,-200px) rotate(' + (-40 * Math.sign(dx || 1)) + 'deg)' }], ms)
            .then(function () { return anim(pk, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(60%)', opacity: 0 }], 450); })
            .then(stackStage);
        } else { tear.style.transform = ''; tl.style.width = '0'; }
      });
    }
    function stackStage() {
      var c0 = p.cards[0];
      stage.innerHTML = '<div class="deck" id="dk"><div class="stackShadow"></div><div class="flipper" id="fl"><div class="face cardback"></div><div class="face front">' + tcgHTML(c0) + '</div></div></div>';
      var fl = $('#fl', stage), dk = $('#dk', stage), done = false;
      anim(dk, [{ transform: 'translateY(40%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], 450);
      hint('All face down. Swipe to flip the whole stack over');
      drag(stage, function (dx) { if (done) return; var a = Math.max(0, Math.min(180, Math.abs(dx) / W() * 300)); fl.style.transform = 'rotateY(' + (a * Math.sign(dx || 1)) + 'deg)'; }, function (dx, dy, vx) {
        if (done) return; var a = Math.abs(dx) / W() * 300, s = Math.sign(dx || 1);
        if (a > 90 || Math.abs(vx) > 0.7) {
          done = true; var ms = Math.max(180, Math.min(1000, 260 / Math.max(Math.abs(vx), 0.25)));
          anim(fl, [{ transform: fl.style.transform || 'rotateY(0)' }, { transform: 'rotateY(' + (180 * s) + 'deg)' }], ms).then(function () { state.i = 0; revealStage(); });
        } else fl.style.transform = '';
      });
    }
    function tcgHTML(c) { if (!c) return ''; return '<div class="tcg ' + (c.variant === 'reverse' ? 'rev ' : '') + (c.nice ? 'nice' : '') + '"><img alt="' + esc(c.name) + '" src="' + esc(img(c, 'high')) + '"></div>'; }
    function revealStage() {
      var i = state.i, n = p.cards.length, cur = p.cards[i], nxt = p.cards[i + 1];
      if (i >= n) return recap();
      $('#ripCount', ov).textContent = (i + 1) + ' / ' + n;
      stage.innerHTML = '<div class="deck"><div class="stackShadow"></div>' + (nxt ? '<div class="c" id="under" style="transform:scale(.94);filter:brightness(.45)">' + tcgHTML(nxt) + '</div>' : '') + '<div class="c" id="top">' + tcgHTML(cur) + '</div><div class="cardLabel">' + esc(E.TIER_LABEL[cur.tier]) + (cur.variant === 'reverse' ? ' · Reverse holo' : '') + (cur.nice ? ' ★' : '') + (cur.isNew ? ' · NEW' : '') + '</div></div>';
      var top = $('#top', stage), under = $('#under', stage), done = false;
      hint(i === n - 1 ? 'Last card! Swipe it away to see all your cards' : (nxt && nxt.nice ? 'Something shiny is underneath… swipe slowly' : 'Swipe the card away'));
      drag(stage, function (dx, dy) {
        if (done) return; var dist = Math.sqrt(dx * dx + dy * dy), pr = Math.min(1, dist / (W() * 0.6));
        top.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (dx / 18) + 'deg)';
        if (under) { under.style.transform = 'scale(' + (0.94 + 0.06 * pr) + ')'; under.style.filter = 'brightness(' + (0.45 + 0.55 * pr) + ')'; }
      }, function (dx, dy, vx, vy) {
        if (done) return; var dist = Math.sqrt(dx * dx + dy * dy), v = Math.sqrt(vx * vx + vy * vy);
        if (dist > W() * 0.28 || (v > 0.5 && dist > 20)) {
          done = true; var dirx = dist ? dx / dist : 1, diry = dist ? dy / dist : 0, far = W() * 1.3;
          var ms = Math.max(140, Math.min(1100, (far - dist) / Math.max(v, 0.35)));
          if (under) anim(under, [{ transform: under.style.transform || 'scale(.94)', filter: under.style.filter || 'brightness(.45)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], ms);
          anim(top, [{ transform: top.style.transform || 'none' }, { transform: 'translate(' + (dirx * far) + 'px,' + (diry * far) + 'px) rotate(' + (dirx * 35) + 'deg)' }], ms).then(function () { state.i++; revealStage(); });
        } else {
          top.style.transform = ''; if (under) { under.style.transform = 'scale(.94)'; under.style.filter = 'brightness(.45)'; }
        }
      });
    }
    function recap() {
      $('#ripCount', ov).textContent = ''; $('#ripSkip', ov).classList.add('hidden');
      stage.style.touchAction = 'auto'; stage.style.display = 'block'; stage.style.placeItems = 'normal'; stage.style.overflow = 'auto';
      cur = null; active = false;
      var newCount = p.cards.filter(function (c) { return c.isNew; }).length;
      stage.innerHTML = '<div style="padding:0 16px"><h2>Your ' + p.cards.length + ' cards</h2><p class="muted">' + newCount + ' new for your binder. Hits are at the end.</p>' + (p.warnings || []).map(function (w) { return '<p class="badge b-warn">' + esc(w) + '</p>'; }).join(' ') + '</div><div class="recap">' + p.cards.map(function (c) { return '<div style="' + (c.nice ? 'box-shadow:0 0 22px #ffd86b99;border-radius:14px' : '') + '">' + slotHTML(c, null, true) + '</div>'; }).join('') + '</div><div style="padding:16px 16px calc(20px + env(safe-area-inset-bottom))"><button class="btn primary" id="toBinder" style="width:100%;font-size:20px;min-height:60px">Add to binder</button></div>';
      $('#toBinder', ov).onclick = function () { p.ripSeen = true; save(); ov.remove(); tab = 'backpack'; render(); toast(p.cards.length + ' cards added to your binder'); };
    }
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab],[data-act],[data-admintab]'); if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo && window.scrollTo(0, 0); return; }
    if (t.dataset.admintab) { adminTab = t.dataset.admintab; render(); return; }
    var a = t.dataset.act, id = t.dataset.id;
    if (a === 'task') onTask(id);
    else if (a === 'open') openPack(id);
    else if (a === 'card') cardDetail(id);
    else if (a === 'fav') { var en = D.collection[id]; if (en) { en.favourite = !en.favourite; save(); render(); } }
    else if (a === 'pin') {
      modal('<h2>Parent PIN</h2><input id="pinIn" type="password" inputmode="numeric" autocomplete="off" style="width:100%"><p class="muted small">Preview default is 1234. Change it in Settings.</p><div class="row"><button class="btn primary" data-ok>Unlock</button><button class="btn" data-close>Cancel</button></div>', function (m) {
        var go = function () { if ($('#pinIn', m).value === D.pin) { adminOK = true; m.remove(); render(); } else { $('#pinIn', m).value = ''; toast('Wrong PIN'); } };
        $('[data-ok]', m).onclick = go; $('#pinIn', m).onkeydown = function (ev) { if (ev.key === 'Enter') go(); }; setTimeout(function () { $('#pinIn', m).focus(); }, 50);
      });
    }
    else if (a === 'lock') { adminOK = false; render(); }
    else if (a === 'addTask') { var nm = $('#newTask').value.trim(); if (!nm) return; D.tasks.push({ id: E.uid('task'), name: nm, premium: $('#newPrem').checked, active: true }); save(); render(); }
    else if (a === 'export') doExport(false);
    else if (a === 'download') doExport(true);
    else if (a === 'saveSettings') {
      var ti = $('#setTitle').value.trim(), pin = $('#setPin').value.trim();
      if (ti) D.title = ti; if (pin) { if (!/^\d{4,8}$/.test(pin)) { toast('PIN must be 4 to 8 digits'); return; } D.pin = pin; }
      D.settings.reduceMotion = $('#setRM').checked; save(); toast('Saved'); render();
    }
    else if (a === 'refreshData') { C = { pools: {}, details: {}, setList: null }; saveCache(); toast('Card data will reload from TCGdex'); render(); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.bf) { bf[t.dataset.bf] = t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.bf === 'set') bf.missing = false; render(); return; }
    if (t.dataset.tname) { var x = D.tasks.find(function (k) { return k.id === t.dataset.tname; }); if (x && t.value.trim()) { x.name = t.value.trim(); D.demoDefaults = false; save(); } }
    else if (t.dataset.tprem) { var y = D.tasks.find(function (k) { return k.id === t.dataset.tprem; }); if (y) { y.premium = t.checked; save(); render(); } }
    else if (t.dataset.tact) { var z = D.tasks.find(function (k) { return k.id === t.dataset.tact; }); if (z) { z.active = t.checked; save(); render(); } }
    else if (t.dataset.setid) {
      var sid = t.dataset.setid, i = D.enabledSets.indexOf(sid);
      if (t.checked && i < 0) D.enabledSets.push(sid); if (!t.checked && i >= 0) D.enabledSets.splice(i, 1);
      D.demoDefaults = false; save(); if (t.checked) loadPool(sid).catch(function () {});
    }
    else if (t.id === 'importFile' && t.files && t.files[0]) doImport(t.files[0]);
  });
  document.addEventListener('input', function (e) { if (e.target.dataset.bf === 'q') { bf.q = e.target.value; clearTimeout(window.__trq); window.__trq = setTimeout(function () { render(); var q = $('[data-bf=q]'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 400); } });

  if (!localStorage.getItem(K)) save();
  render();
  window.__TR = { get D() { return D; }, get C() { return C; }, K: K, CK: CK, openPack: openPack, render: render, loadPool: loadPool, setTab: function (t) { tab = t; render(); } };
})();
