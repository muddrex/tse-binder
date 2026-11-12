/* Task Ripper engine: pure logic (pack generation, prices, weeks, backups).
   No DOM and no storage access here, so it can be unit-tested in node. */
(function (root, factory) {
  var E = factory();
  if (typeof module === 'object' && module.exports) module.exports = E;
  else root.TRE = E;
})(this, function () {
  'use strict';
  var MAX_COPIES = 5;
  var TIERS = ['C', 'U', 'R', 'DR', 'UR', 'IR', 'SIR', 'HR'];
  var RANK = { C: 0, U: 1, R: 2, DR: 3, UR: 4, IR: 5, SIR: 6, HR: 7 };
  var NICE = ['DR', 'UR', 'IR', 'SIR', 'HR'];
  var TIER_LABEL = { C: 'Common', U: 'Uncommon', R: 'Rare', DR: 'Double Rare', UR: 'Ultra Rare', IR: 'Illustration Rare', SIR: 'Special Illustration Rare', HR: 'Hyper Rare' };
  // TCGdex rarity strings (exact, case-sensitive) -> our tiers. Unknown rarities count as Rare (filler foil).
  var RARITY_TO_TIER = {
    'Common': 'C', 'Uncommon': 'U', 'Rare': 'R', 'Rare Holo': 'R', 'Holo Rare': 'R', 'ACE SPEC Rare': 'R', 'Radiant Rare': 'R', 'Amazing Rare': 'R',
    'Double rare': 'DR', 'Holo Rare V': 'DR', 'Holo Rare VMAX': 'DR', 'Holo Rare VSTAR': 'DR',
    'Ultra Rare': 'UR', 'Full Art Trainer': 'UR', 'Shiny Ultra Rare': 'UR', 'Mega Attack Rare': 'UR',
    'Illustration rare': 'IR', 'Shiny rare': 'IR',
    'Special illustration rare': 'SIR',
    'Hyper rare': 'HR', 'Secret Rare': 'HR', 'Mega Hyper Rare': 'HR', 'Black White Rare': 'HR'
  };
  // Rarities we query TCGdex for when building a set pool (Scarlet & Violet and Mega Evolution eras).
  var QUERY_RARITIES = ['Common', 'Uncommon', 'Rare', 'Double rare', 'Ultra Rare', 'Illustration rare', 'Special illustration rare', 'Hyper rare', 'ACE SPEC Rare', 'Mega Hyper Rare', 'Black White Rare', 'Shiny rare', 'Shiny Ultra Rare'];

  // Boosted family odds from the design page.
  var REG_NICE = [['DR', 50], ['UR', 20], ['IR', 18], ['SIR', 8], ['HR', 4]];
  var SECOND_FOIL = [['R', 55], ['REV', 25], ['DR', 12], ['UR|IR', 6], ['SIR|HR', 2]];
  var PREM_LAST = [['UR', 40], ['IR', 32], ['SIR', 18], ['HR', 10]];
  var REVERSE_TIERS = [['C', 50], ['U', 35], ['R', 15]];

  function tierOf(rarity) { return RARITY_TO_TIER[rarity] || 'R'; }
  function isNice(tier) { return RANK[tier] >= RANK.DR; }

  function roll(table, rng) {
    var total = 0, i; for (i = 0; i < table.length; i++) total += table[i][1];
    var r = rng() * total;
    for (i = 0; i < table.length; i++) { r -= table[i][1]; if (r < 0) return table[i][0]; }
    return table[table.length - 1][0];
  }
  function splitPick(key, rng) {
    if (key.indexOf('|') < 0) return key;
    var parts = key.split('|');
    var w = {}; REG_NICE.forEach(function (x) { w[x[0]] = x[1]; });
    return roll(parts.map(function (p) { return [p, w[p] || 1]; }), rng);
  }

  // A tiny seeded RNG for tests and reproducible packs.
  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  function ownedCounts(collection) {
    var out = {}; Object.keys(collection || {}).forEach(function (id) { out[id] = (collection[id] && collection[id].count) || 0; }); return out;
  }

  function byTier(pool) {
    var m = {}; TIERS.forEach(function (t) { m[t] = []; });
    (pool.cards || []).forEach(function (c) { if (c.category === 'Energy') return; var t = c.tier || tierOf(c.rarity); (m[t] = m[t] || []).push(c); });
    return m;
  }

  // Order of rarities to try for a nice slot: rolled, then down to the floor, then up, then below the floor.
  function niceOrder(rolled, floor) {
    var r = RANK[rolled], f = RANK[floor], out = [rolled], i;
    for (i = r - 1; i >= f; i--) out.push(TIERS[i]);
    for (i = r + 1; i <= RANK.HR; i++) out.push(TIERS[i]);
    for (i = f - 1; i >= RANK.DR; i--) out.push(TIERS[i]);
    return out;
  }
  var FILLER_ORDER = { C: ['C', 'U', 'R'], U: ['U', 'C', 'R'], R: ['R', 'U', 'C'] };

  function setStatus(pool, collection) {
    var counts = ownedCounts(collection), eligible = 0, nice = 0, total = 0;
    (pool.cards || []).forEach(function (c) {
      if (c.category === 'Energy') return; total++;
      if ((counts[c.id] || 0) < MAX_COPIES) { eligible++; if (isNice(c.tier || tierOf(c.rarity))) nice++; }
    });
    return { total: total, eligible: eligible, niceEligible: nice, capped: eligible === 0, hitsMaxed: nice === 0 && eligible > 0 };
  }

  /* generatePack({pool, collection, premium, rng}) -> {cards, short, niceExhausted, warnings}
     pool: {setId, cards:[{id,name,localId,image,rarity,tier,category}]} with Energy already removed (also filtered here). */
  function generatePack(opts) {
    var pool = opts.pool, rng = opts.rng || Math.random, premium = !!opts.premium;
    var counts = ownedCounts(opts.collection), groups = byTier(pool), inPack = {}, niceExhausted = false;
    function avail(tier) { return (groups[tier] || []).filter(function (c) { return (counts[c.id] || 0) < MAX_COPIES; }); }
    function take(tier) {
      var a = avail(tier); if (!a.length) return null;
      var fresh = a.filter(function (c) { return !inPack[c.id]; });
      var list = fresh.length ? fresh : a;
      var c = list[Math.floor(rng() * list.length)];
      counts[c.id] = (counts[c.id] || 0) + 1; inPack[c.id] = true; return c;
    }
    function mk(c, slot, variant) {
      var tier = c.tier || tierOf(c.rarity);
      return { id: c.id, name: c.name, localId: c.localId, image: c.image, rarity: c.rarity, tier: tier, variant: variant, slot: slot, nice: isNice(tier), setId: pool.setId };
    }
    function drawNice(rolled, floor, slot) {
      var order = niceOrder(rolled, floor), i, c;
      for (i = 0; i < order.length; i++) { c = take(order[i]); if (c) return mk(c, slot, 'holo'); }
      niceExhausted = true; // whole nice pool capped: highest remaining eligible card
      var fb = ['R', 'U', 'C'];
      for (i = 0; i < fb.length; i++) { c = take(fb[i]); if (c) return mk(c, slot, fb[i] === 'R' ? 'holo' : 'normal'); }
      return null;
    }
    function drawFiller(tier, slot, variant) {
      var order = FILLER_ORDER[tier], i, c;
      for (i = 0; i < order.length; i++) { c = take(order[i]); if (c) return mk(c, slot, variant || (order[i] === 'R' ? 'holo' : 'normal')); }
      // Filler pool empty: nice slots were already honoured, so remaining nice cards may fill (lowest first).
      for (i = 0; i < NICE.length; i++) { c = take(NICE[i]); if (c) return mk(c, slot, variant || 'holo'); }
      return null;
    }
    var hits = [], fillers = [], i, x;
    if (premium) {
      hits.push(drawNice(roll(PREM_LAST, rng), 'UR', 'last'));
      hits.push(drawNice(roll(REG_NICE, rng), 'DR', 'nice2'));
      var nC = 3, nU = 3;
      for (i = 0; i < nC; i++) fillers.push(drawFiller('C', 'common', 'normal'));
      for (i = 0; i < nU; i++) fillers.push(drawFiller('U', 'uncommon', 'normal'));
      fillers.push(drawFiller(roll(REVERSE_TIERS, rng), 'reverse', 'reverse'));
      fillers.push(drawFiller('R', 'rareHolo', 'holo'));
    } else {
      hits.push(drawNice(roll(REG_NICE, rng), 'DR', 'nice'));
      var sf = roll(SECOND_FOIL, rng), sfCard;
      if (sf === 'R' || sf === 'REV') sfCard = null; else sfCard = drawNice(splitPick(sf, rng), 'DR', 'secondFoil');
      for (i = 0; i < 4; i++) fillers.push(drawFiller('C', 'common', 'normal'));
      for (i = 0; i < 3; i++) fillers.push(drawFiller('U', 'uncommon', 'normal'));
      fillers.push(drawFiller(roll(REVERSE_TIERS, rng), 'reverse', 'reverse'));
      if (sf === 'R') fillers.push(drawFiller('R', 'secondFoil', 'holo'));
      else if (sf === 'REV') fillers.push(drawFiller(roll(REVERSE_TIERS, rng), 'secondFoil', 'reverse'));
      else if (sfCard) hits.push(sfCard);
    }
    hits = hits.filter(Boolean); fillers = fillers.filter(Boolean);
    // Fillers: commons, uncommons, then reverse and foils, in slot order.
    var slotRank = { common: 0, uncommon: 1, reverse: 2, rareHolo: 3, secondFoil: 3 };
    fillers.sort(function (a, b) { return slotRank[a.slot] - slotRank[b.slot]; });
    // Hits at the back, stronger last. Premium: the Ultra Rare-or-better card is always last.
    hits.sort(function (a, b) { return RANK[a.tier] - RANK[b.tier] || (a.slot === 'last' ? 1 : b.slot === 'last' ? -1 : 0); });
    var cards = fillers.concat(hits);
    cards.forEach(function (c, idx) { c.pos = idx + 1; });
    var warnings = [];
    if (niceExhausted) warnings.push('This set\'s hits are maxed (5 copies of every Double Rare or better), so the hit slot used the best card left.');
    if (cards.length < 10) warnings.push('Short pack: only ' + cards.length + ' cards were left under the 5-copy rule.');
    return { cards: cards, short: cards.length < 10, niceExhausted: niceExhausted, warnings: warnings };
  }

  // Build a draw pool from TCGdex responses: /sets/{id}, Energy-category list, and one list per QUERY_RARITIES entry.
  function buildPool(setId, set, energyCards, rarityLists, now) {
    var energy = {}, rar = {};
    (energyCards || []).forEach(function (c) { energy[c.id] = 1; });
    QUERY_RARITIES.forEach(function (r, i) { ((rarityLists || [])[i] || []).forEach(function (c) { rar[c.id] = r; }); });
    var cards = (set.cards || []).filter(function (c) { return !energy[c.id]; }).map(function (c) {
      var r = rar[c.id] || ''; return { id: c.id, localId: c.localId, name: c.name, image: c.image || null, rarity: r || 'Unlisted', tier: r ? tierOf(r) : 'R' };
    });
    return { setId: setId, setName: set.name, logo: set.logo || null, symbol: set.symbol || null, total: (set.cardCount || {}).total, energyCount: Object.keys(energy).length, fetchedAt: now || Date.now(), cards: cards };
  }

  /* Prices. detail = compact pricing kept in the cache:
     {tcgplayer:{updated, normal:{marketPrice}, holofoil:{..}, 'reverse-holofoil':{..}}, cardmarket:{updated, trend, avg, 'trend-holo', 'avg-holo'}} */
  function compactPricing(card) {
    var p = card && card.pricing; if (!p) return null; var out = {};
    if (p.tcgplayer) {
      out.tcgplayer = { updated: p.tcgplayer.updated };
      Object.keys(p.tcgplayer).forEach(function (k) { var v = p.tcgplayer[k]; if (v && typeof v === 'object' && v.marketPrice != null) out.tcgplayer[k] = { marketPrice: v.marketPrice }; });
    }
    if (p.cardmarket) {
      var cm = p.cardmarket; out.cardmarket = { updated: cm.updated };
      ['trend', 'avg', 'trend-holo', 'avg-holo'].forEach(function (k) { if (cm[k] != null) out.cardmarket[k] = cm[k]; });
    }
    return out;
  }
  var TCGP_KEYS = { normal: ['normal', 'holofoil'], holo: ['holofoil', 'normal'], reverse: ['reverse-holofoil'] };
  function priceFor(pricing, variant) {
    if (!pricing) return null;
    var tp = pricing.tcgplayer, cm = pricing.cardmarket, keys, i;
    if (tp) {
      keys = (TCGP_KEYS[variant] || TCGP_KEYS.normal).slice();
      Object.keys(tp).forEach(function (k) { if (k !== 'updated' && keys.indexOf(k) < 0) keys.push(k); });
      for (i = 0; i < keys.length; i++) {
        var v = tp[keys[i]];
        if (v && typeof v.marketPrice === 'number' && v.marketPrice > 0) return { value: v.marketPrice, currency: 'USD', source: 'TCGplayer market (' + keys[i] + ')', exact: i === 0, updated: tp.updated };
      }
    }
    if (cm) {
      keys = variant === 'reverse' || variant === 'holo' ? ['trend-holo', 'avg-holo', 'trend', 'avg'] : ['trend', 'avg'];
      for (i = 0; i < keys.length; i++) if (typeof cm[keys[i]] === 'number' && cm[keys[i]] > 0) return { value: cm[keys[i]], currency: 'EUR', source: 'Cardmarket ' + keys[i], exact: false, updated: cm.updated };
    }
    return null;
  }
  function fmtMoney(p) { if (!p) return 'Unpriced'; return '≈ ' + (p.currency === 'USD' ? 'US$' : '€') + p.value.toFixed(2); }

  /* Weeks: Monday 00:00 to Sunday 23:59, Australia/Sydney. weekKey returns the Sydney date (YYYY-MM-DD) of that Monday. */
  var WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  var fmt = null;
  function sydParts(ts) {
    fmt = fmt || new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    var o = {}; fmt.formatToParts(new Date(ts)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, wd: WD[o.weekday] };
  }
  function sydDay(ts) { var p = sydParts(ts); return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'); }
  function weekKey(ts) {
    var p = sydParts(ts), dt = new Date(Date.UTC(p.y, p.m - 1, p.d) - p.wd * 86400000);
    return dt.toISOString().slice(0, 10);
  }

  /* Report. pools: {setId: pool}. */
  function report(D, pools, now) {
    var wk = weekKey(now);
    function blank() { return { tasks: 0, premiumTasks: 0, byTask: {}, packsRegular: 0, packsPremium: 0, cardsPulled: 0, newUniques: 0, newBySet: {} }; }
    var W = blank(), A = blank();
    (D.completions || []).forEach(function (c) {
      [A].concat(weekKey(c.at) === wk ? [W] : []).forEach(function (R) {
        R.tasks++; if (c.premium) R.premiumTasks++; R.byTask[c.taskName] = (R.byTask[c.taskName] || 0) + 1;
      });
    });
    (D.packs || []).forEach(function (p) {
      var inWkEarn = weekKey(p.at) === wk;
      [A].concat(inWkEarn ? [W] : []).forEach(function (R) { if (p.premium) R.packsPremium++; else R.packsRegular++; });
      if (p.status === 'opened' && p.cards) {
        var inWk = weekKey(p.openedAt || p.at) === wk;
        p.cards.forEach(function (c) {
          [A].concat(inWk ? [W] : []).forEach(function (R) {
            R.cardsPulled++; if (c.isNew) { R.newUniques++; R.newBySet[c.setId || p.setId] = (R.newBySet[c.setId || p.setId] || 0) + 1; }
          });
        });
      }
    });
    var col = D.collection || {}, uniqueOwned = Object.keys(col).filter(function (id) { return col[id].count > 0; }).length;
    var sets = (D.enabledSets || []).map(function (id) {
      var pool = pools[id]; if (!pool) return { setId: id, known: false };
      var total = 0, owned = 0;
      pool.cards.forEach(function (c) { if (c.category === 'Energy') return; total++; if (col[c.id] && col[c.id].count > 0) owned++; });
      return { setId: id, known: true, owned: owned, total: total, pct: total ? owned / total * 100 : 0, newThisWeek: W.newBySet[id] || 0 };
    });
    var known = sets.filter(function (s) { return s.known; });
    var oOwned = known.reduce(function (a, s) { return a + s.owned; }, 0), oTotal = known.reduce(function (a, s) { return a + s.total; }, 0);
    return { weekStart: wk, week: W, all: A, uniqueOwned: uniqueOwned, specials: (D.specials || []).length, sets: sets, overall: { owned: oOwned, total: oTotal, pct: oTotal ? oOwned / oTotal * 100 : 0, complete: known.length === sets.length } };
  }

  /* Data shape + backups. New fields must stay optional so old backups still load. */
  var DEFAULT_SETS = [
    { id: 'sv08', name: 'Surging Sparks', logo: 'https://assets.tcgdex.net/en/sv/sv08/logo' },
    { id: 'sv10', name: 'Destined Rivals', logo: 'https://assets.tcgdex.net/en/sv/sv10/logo' }
  ];
  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function defaults() {
    return {
      schema: 1, title: 'Task Ripper', pin: '1234',
      tasks: [
        { id: 'demo-bed', name: 'Make your bed', premium: false, active: true },
        { id: 'demo-teeth', name: 'Brush teeth (morning and night)', premium: false, active: true },
        { id: 'demo-reading', name: 'Read for 20 minutes', premium: false, active: true },
        { id: 'demo-room', name: 'Clean your whole room', premium: true, active: true }
      ],
      sets: DEFAULT_SETS.map(function (s) { return Object.assign({}, s); }),
      enabledSets: DEFAULT_SETS.map(function (s) { return s.id; }),
      demoDefaults: true,
      completions: [], packs: [], collection: {}, specials: [],
      settings: { reduceMotion: false }, lastBackupAt: null
    };
  }
  function normalize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    var out = Object.assign({}, raw);
    if (typeof out.title !== 'string') out.title = d.title;
    if (typeof out.pin !== 'string' || !out.pin) out.pin = d.pin;
    if (!Array.isArray(out.tasks)) out.tasks = raw.packs || raw.collection ? [] : d.tasks;
    out.tasks = out.tasks.filter(function (t) { return t && t.name; }).map(function (t) {
      return Object.assign({}, t, { id: String(t.id || uid('task')), name: String(t.name), premium: !!t.premium, active: t.active !== false });
    });
    if (!Array.isArray(out.sets)) out.sets = Array.isArray(raw.enabledSets) ? raw.enabledSets.map(function (id) { return { id: id, name: id }; }) : d.sets;
    if (!Array.isArray(out.enabledSets)) out.enabledSets = Array.isArray(raw.sets) ? out.sets.map(function (s) { return s.id; }) : d.enabledSets;
    if (!Array.isArray(out.completions)) out.completions = [];
    if (!Array.isArray(out.packs)) out.packs = [];
    out.packs = out.packs.filter(Boolean).map(function (p) { return Object.assign({ status: p.cards && p.cards.length ? 'opened' : 'sealed', premium: false }, p); });
    if (!out.collection || typeof out.collection !== 'object' || Array.isArray(out.collection)) out.collection = {};
    if (!Array.isArray(out.specials)) out.specials = [];
    out.settings = Object.assign({}, d.settings, out.settings && typeof out.settings === 'object' ? out.settings : {});
    if (out.lastBackupAt === undefined) out.lastBackupAt = null;
    if (out.demoDefaults === undefined) out.demoDefaults = false;
    out.schema = out.schema || 1;
    return out;
  }
  function makeBackup(D, now) { return { app: 'task-ripper', backupVersion: 1, exportedAt: new Date(now || Date.now()).toISOString(), data: D }; }
  function parseBackup(text) {
    var obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object') throw new Error('Not a Task Ripper backup');
    var data = obj.app === 'task-ripper' && obj.data ? obj.data : obj;
    if (data.app && data.app !== 'task-ripper') throw new Error('This backup is from a different app');
    if (!('tasks' in data) && !('packs' in data) && !('collection' in data)) throw new Error('This file has no Task Ripper tasks, packs or cards');
    return normalize(data);
  }

  // Commit an opened pack into the collection. Mutates D. Marks each card isNew / copy number.
  function commitPack(D, pack, result, now) {
    pack.cards = result.cards; pack.short = result.short; pack.niceExhausted = result.niceExhausted; pack.warnings = result.warnings;
    pack.status = 'opened'; pack.openedAt = now; pack.ripSeen = false;
    result.cards.forEach(function (c) {
      var e = D.collection[c.id];
      c.isNew = !e || !e.count;
      if (!e) e = D.collection[c.id] = { count: 0, favourite: false, name: c.name, setId: c.setId, localId: c.localId, image: c.image, rarity: c.rarity, tier: c.tier, firstAt: now, variants: {}, packs: [] };
      e.count++; e.variants[c.variant] = (e.variants[c.variant] || 0) + 1;
      if (e.packs.indexOf(pack.id) < 0) e.packs.push(pack.id);
      c.copy = e.count; c.maxed = e.count >= MAX_COPIES;
    });
    return pack;
  }
  function earnPack(D, task, set, now) {
    var comp = { id: uid('done'), taskId: task.id, taskName: task.name, premium: !!task.premium, at: now };
    var pack = { id: uid('pack'), completionId: comp.id, taskId: task.id, taskName: task.name, premium: !!task.premium, at: now, setId: set.id, setName: set.name, setLogo: set.logo || null, status: 'sealed' };
    D.completions.push(comp); D.packs.push(pack);
    return pack;
  }
  function doneToday(D, taskId, now) {
    var day = sydDay(now); return (D.completions || []).filter(function (c) { return c.taskId === taskId && sydDay(c.at) === day; }).length;
  }

  return {
    MAX_COPIES: MAX_COPIES, TIERS: TIERS, RANK: RANK, NICE: NICE, TIER_LABEL: TIER_LABEL, RARITY_TO_TIER: RARITY_TO_TIER, QUERY_RARITIES: QUERY_RARITIES,
    REG_NICE: REG_NICE, SECOND_FOIL: SECOND_FOIL, PREM_LAST: PREM_LAST,
    buildPool: buildPool, tierOf: tierOf, isNice: isNice, roll: roll, mulberry32: mulberry32, niceOrder: niceOrder, setStatus: setStatus, generatePack: generatePack,
    compactPricing: compactPricing, priceFor: priceFor, fmtMoney: fmtMoney, sydDay: sydDay, weekKey: weekKey, report: report,
    defaults: defaults, normalize: normalize, makeBackup: makeBackup, parseBackup: parseBackup, commitPack: commitPack, earnPack: earnPack, doneToday: doneToday, uid: uid
  };
});
