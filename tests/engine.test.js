const test = require('node:test');
const assert = require('node:assert');
const E = require('../preview/engine.js');
const FX = require('./fixtures/tcgdex-sv08.json');

function realPool() {
  const set = FX['/sets/sv08'];
  const energy = FX['/cards?set.id=eq:sv08&category=eq:Energy'];
  const lists = E.QUERY_RARITIES.map(r => FX['/cards?set.id=eq:sv08&rarity=eq:' + encodeURIComponent(r)]);
  return E.buildPool('sv08', set, energy, lists, 0);
}
// Synthetic pool: n cards per tier.
function synth(spec) {
  const cards = []; let k = 1;
  Object.keys(spec).forEach(t => { for (let i = 0; i < spec[t]; i++) { const id = 'syn-' + (k++); cards.push({ id, localId: String(k), name: t + i, image: null, rarity: E.TIER_LABEL[t], tier: t }); } });
  return { setId: 'syn', setName: 'Synthetic', cards };
}
function capAll(pool, pred) { const col = {}; pool.cards.filter(pred).forEach(c => { col[c.id] = { count: 5 }; }); return col; }
const R = E.RANK;

test('pool from real TCGdex data skips Energy and maps rarities', () => {
  const pool = realPool();
  const energyIds = FX['/cards?set.id=eq:sv08&category=eq:Energy'].map(c => c.id);
  assert.ok(energyIds.length >= 1);
  assert.strictEqual(pool.cards.length, FX['/sets/sv08'].cards.length - energyIds.length);
  energyIds.forEach(id => assert.ok(!pool.cards.find(c => c.id === id), 'energy ' + id + ' excluded'));
  const tiers = new Set(pool.cards.map(c => c.tier));
  ['C', 'U', 'R', 'DR', 'UR', 'IR', 'SIR', 'HR'].forEach(t => assert.ok(tiers.has(t), 'has tier ' + t));
  assert.strictEqual(pool.cards.filter(c => c.rarity === 'Unlisted').length, 0, 'every card has a known rarity');
});

test('regular packs: 10 cards, no energy, nice card last, fillers first', () => {
  const pool = realPool(), rng = E.mulberry32(1);
  let secondNice = 0;
  for (let n = 0; n < 2000; n++) {
    const res = E.generatePack({ pool, collection: {}, premium: false, rng });
    assert.strictEqual(res.cards.length, 10); assert.strictEqual(res.short, false);
    const t = res.cards.map(c => c.tier);
    assert.ok(R[t[9]] >= R.DR, 'last card is Double Rare or better');
    t.slice(0, 4).forEach(x => assert.strictEqual(x, 'C'));
    t.slice(4, 7).forEach(x => assert.strictEqual(x, 'U'));
    assert.strictEqual(res.cards[7].variant, 'reverse');
    assert.ok(['C', 'U', 'R'].includes(t[7]));
    if (R[t[8]] >= R.DR) { secondNice++; assert.ok(R[t[8]] <= R[t[9]], 'stronger hit last'); }
    // nothing nice before the last two
    t.slice(0, 8).forEach(x => assert.ok(R[x] < R.DR));
    assert.ok(!res.cards.some(c => c.category === 'Energy'));
  }
  const rate = secondNice / 2000;
  assert.ok(rate > 0.15 && rate < 0.25, 'about 1 in 5 regular packs have a second hit, got ' + rate);
});

test('regular nice-slot odds roughly follow the boosted table', () => {
  const pool = realPool(), rng = E.mulberry32(7), counts = {};
  const N = 5000;
  for (let n = 0; n < N; n++) {
    const res = E.generatePack({ pool, collection: {}, premium: false, rng });
    const hit = res.cards.find(c => c.slot === 'nice'); counts[hit.tier] = (counts[hit.tier] || 0) + 1;
  }
  const exp = { DR: .5, UR: .2, IR: .18, SIR: .08, HR: .04 };
  Object.keys(exp).forEach(t => assert.ok(Math.abs(counts[t] / N - exp[t]) < 0.025, t + ' ' + counts[t] / N));
});

test('premium packs: two hits last, final card Ultra Rare or better, 3C 3U reverse rare-holo', () => {
  const pool = realPool(), rng = E.mulberry32(2);
  for (let n = 0; n < 2000; n++) {
    const res = E.generatePack({ pool, collection: {}, premium: true, rng });
    assert.strictEqual(res.cards.length, 10);
    const t = res.cards.map(c => c.tier);
    assert.ok(R[t[9]] >= R.UR, 'premium last is UR+');
    assert.ok(R[t[8]] >= R.DR, 'premium second-last is DR+');
    assert.ok(R[t[8]] <= R[t[9]]);
    assert.deepStrictEqual(t.slice(0, 6), ['C', 'C', 'C', 'U', 'U', 'U']);
    assert.strictEqual(res.cards[6].variant, 'reverse');
    assert.strictEqual(t[7], 'R'); assert.strictEqual(res.cards[7].variant, 'holo');
  }
});

test('max 5 copies: capped cards never appear; normal and reverse share the cap', () => {
  const pool = realPool(), rng = E.mulberry32(3);
  const col = {};
  // cap every common except two, and every Double rare except one
  const commons = pool.cards.filter(c => c.tier === 'C'), drs = pool.cards.filter(c => c.tier === 'DR');
  commons.slice(2).forEach(c => col[c.id] = { count: 5, variants: { normal: 3, reverse: 2 } });
  drs.slice(1).forEach(c => col[c.id] = { count: 5 });
  const capped = new Set(Object.keys(col));
  for (let n = 0; n < 300; n++) {
    const res = E.generatePack({ pool, collection: col, premium: false, rng });
    res.cards.forEach(c => assert.ok(!capped.has(c.id), 'capped card ' + c.id + ' appeared'));
    // the two remaining commons can only appear up to 5 total within the pack given count 0
    assert.strictEqual(res.cards.length, 10);
  }
  // a card at 4 copies can be pulled at most once more in one pack
  const one = {}; pool.cards.forEach(c => { if (c.tier === 'C') one[c.id] = { count: 5 }; });
  one[commons[0].id] = { count: 4 };
  for (let n = 0; n < 100; n++) {
    const res = E.generatePack({ pool, collection: one, premium: false, rng });
    assert.ok(res.cards.filter(c => c.id === commons[0].id).length <= 1);
  }
});

test('nice slot drops to next eligible nice rarity when the rolled one is capped', () => {
  const pool = realPool(), rng = E.mulberry32(4);
  const col = capAll(pool, c => ['DR', 'UR', 'IR', 'SIR'].includes(c.tier)); // only HR left among hits
  for (let n = 0; n < 50; n++) {
    const res = E.generatePack({ pool, collection: col, premium: false, rng });
    assert.strictEqual(res.cards[9].tier, 'HR'); assert.strictEqual(res.niceExhausted, false);
  }
  assert.deepStrictEqual(E.niceOrder('UR', 'DR'), ['UR', 'DR', 'IR', 'SIR', 'HR']);
  assert.deepStrictEqual(E.niceOrder('UR', 'UR'), ['UR', 'IR', 'SIR', 'HR', 'DR']);
  // premium: with all UR+ capped, last card falls back to a Double Rare rather than a filler
  const col2 = capAll(pool, c => R[c.tier] >= R.UR);
  const res = E.generatePack({ pool, collection: col2, premium: true, rng });
  assert.strictEqual(res.cards[9].tier, 'DR'); assert.strictEqual(res.cards[8].tier, 'DR');
});

test('whole nice pool capped: warn, fill hit slots with highest remaining (rare holo first)', () => {
  const pool = realPool(), rng = E.mulberry32(5);
  const col = capAll(pool, c => R[c.tier] >= R.DR);
  const st = E.setStatus(pool, col); assert.strictEqual(st.hitsMaxed, true); assert.strictEqual(st.capped, false);
  const res = E.generatePack({ pool, collection: col, premium: true, rng });
  assert.strictEqual(res.niceExhausted, true); assert.ok(res.warnings.length >= 1);
  assert.strictEqual(res.cards.length, 10);
  assert.strictEqual(res.cards[9].tier, 'R'); assert.strictEqual(res.cards[8].tier, 'R');
});

test('fillers do not steal hits while fillers remain; short pack when < 10 eligible; capped set', () => {
  const pool = synth({ C: 2, U: 1, R: 0, DR: 1, UR: 0, IR: 0, SIR: 0, HR: 0 });
  // Each card can appear once per pack (fresh preferred) but then repeats up to cap; cap 5 so give counts 4 to force one each.
  const col = {}; pool.cards.forEach(c => col[c.id] = { count: 4 });
  const res = E.generatePack({ pool, collection: col, premium: false, rng: E.mulberry32(6) });
  assert.strictEqual(res.cards.length, 4); assert.strictEqual(res.short, true);
  assert.ok(res.warnings.some(w => /Short pack/.test(w)));
  assert.strictEqual(res.cards[res.cards.length - 1].tier, 'DR', 'the one hit is still last');
  assert.strictEqual(new Set(res.cards.map(c => c.id)).size, 4, 'no sixth copy padding');
  const full = {}; pool.cards.forEach(c => full[c.id] = { count: 5 });
  const st = E.setStatus(pool, full); assert.strictEqual(st.capped, true);
  assert.strictEqual(E.generatePack({ pool, collection: full, premium: false }).cards.length, 0);
});

test('earnPack snapshots the task; commitPack records cards, isNew, copies', () => {
  const D = E.defaults(), task = D.tasks.find(t => t.premium), now = Date.parse('2026-11-12T03:00:00Z');
  const p = E.earnPack(D, task, { id: 'sv08', name: 'Surging Sparks', logo: 'x' }, now);
  assert.strictEqual(p.status, 'sealed'); assert.strictEqual(p.taskId, task.id); assert.strictEqual(p.taskName, task.name);
  assert.strictEqual(p.premium, true); assert.strictEqual(p.setId, 'sv08'); assert.strictEqual(p.at, now);
  assert.strictEqual(D.completions.length, 1); assert.strictEqual(D.completions[0].id, p.completionId);
  task.name = 'Renamed'; assert.strictEqual(p.taskName, 'Clean your whole room', 'old name kept');
  const res = E.generatePack({ pool: realPool(), collection: D.collection, premium: p.premium, rng: E.mulberry32(9) });
  E.commitPack(D, p, res, now + 1000);
  assert.strictEqual(p.status, 'opened'); assert.strictEqual(p.cards.length, 10);
  const total = Object.values(D.collection).reduce((a, e) => a + e.count, 0); assert.strictEqual(total, 10);
  p.cards.forEach(c => { assert.ok(D.collection[c.id].packs.includes(p.id)); });
  assert.ok(p.cards.every(c => c.isNew || c.copy > 1));
  assert.strictEqual(E.doneToday(D, task.id, now), 1);
});

test('prices: pulled variant first, fallbacks, unpriced is null (never $0)', () => {
  const card = FX[Object.keys(FX).find(k => k.startsWith('/cards/'))];
  const pr = E.compactPricing(card);
  const n = E.priceFor(pr, 'normal'), r = E.priceFor(pr, 'reverse');
  assert.ok(n && n.currency === 'USD');
  assert.ok(r && r.currency === 'USD');
  assert.strictEqual(E.priceFor(null, 'normal'), null);
  assert.strictEqual(E.priceFor({ tcgplayer: { updated: 'x', normal: { marketPrice: 0 } } }, 'normal'), null);
  const fb = E.priceFor({ tcgplayer: { updated: 'x', holofoil: { marketPrice: 2.5 } } }, 'reverse');
  assert.strictEqual(fb.value, 2.5); assert.strictEqual(fb.exact, false);
  const eur = E.priceFor({ cardmarket: { updated: 'y', trend: 1.2, avg: 1 } }, 'normal');
  assert.deepStrictEqual([eur.value, eur.currency], [1.2, 'EUR']);
  assert.strictEqual(E.fmtMoney(null), 'Unpriced');
});

test('weeks run Monday 00:00 to Sunday 23:59 Sydney time, across daylight saving', () => {
  // Sunday 23:59 AEDT (UTC+11) = 12:59Z Sunday; Monday 00:00 AEDT = 13:00Z Sunday
  assert.strictEqual(E.weekKey(Date.parse('2026-11-15T12:59:00Z')), '2026-11-09');
  assert.strictEqual(E.weekKey(Date.parse('2026-11-15T13:00:00Z')), '2026-11-16');
  assert.strictEqual(E.weekKey(Date.parse('2026-11-08T13:00:00Z')), '2026-11-09');
  // winter (AEST, UTC+10)
  assert.strictEqual(E.weekKey(Date.parse('2026-06-14T13:59:00Z')), '2026-06-08');
  assert.strictEqual(E.weekKey(Date.parse('2026-06-14T14:00:00Z')), '2026-06-15');
});

test('report: weekly and all-time tasks, packs, cards, new uniques, set percent excludes Energy', () => {
  const D = E.defaults(), pool = realPool(), now = Date.parse('2026-11-12T03:00:00Z'), lastWeek = now - 7 * 864e5;
  D.enabledSets = ['sv08'];
  const t = D.tasks[0], tp = D.tasks.find(x => x.premium);
  const p1 = E.earnPack(D, t, { id: 'sv08', name: 'Surging Sparks' }, lastWeek);
  E.commitPack(D, p1, E.generatePack({ pool, collection: D.collection, rng: E.mulberry32(11) }), lastWeek + 10);
  const p2 = E.earnPack(D, tp, { id: 'sv08', name: 'Surging Sparks' }, now);
  E.commitPack(D, p2, E.generatePack({ pool, collection: D.collection, premium: true, rng: E.mulberry32(12) }), now + 10);
  E.earnPack(D, t, { id: 'sv08', name: 'Surging Sparks' }, now);
  const rep = E.report(D, { sv08: pool }, now + 100);
  assert.strictEqual(rep.week.tasks, 2); assert.strictEqual(rep.all.tasks, 3);
  assert.strictEqual(rep.week.premiumTasks, 1); assert.strictEqual(rep.week.packsPremium, 1); assert.strictEqual(rep.week.packsRegular, 1);
  assert.strictEqual(rep.week.cardsPulled, 10); assert.strictEqual(rep.all.cardsPulled, 20);
  const uniq = Object.keys(D.collection).length;
  assert.strictEqual(rep.all.newUniques, uniq); assert.strictEqual(rep.uniqueOwned, uniq);
  const s = rep.sets[0]; assert.strictEqual(s.total, pool.cards.length); assert.strictEqual(s.owned, uniq);
  assert.ok(Math.abs(s.pct - uniq / pool.cards.length * 100) < 1e-9);
  assert.strictEqual(s.newThisWeek, rep.week.newUniques);
});

test('backups: minimal and older JSON load, wrapper round-trips, other apps rejected', () => {
  const min = E.parseBackup(JSON.stringify({ tasks: [{ name: 'Feed the dog' }] }));
  assert.strictEqual(min.tasks.length, 1); assert.strictEqual(min.tasks[0].premium, false); assert.strictEqual(min.tasks[0].active, true);
  assert.ok(min.tasks[0].id); assert.deepStrictEqual(min.packs, []); assert.deepStrictEqual(min.collection, {});
  assert.strictEqual(min.pin, '1234'); assert.ok(Array.isArray(min.enabledSets));
  const old = E.parseBackup(JSON.stringify({ packs: [{ id: 'p1', setId: 'sv08', setName: 'SS', taskName: 'x', at: 1, cards: [{ id: 'sv08-001' }] }], collection: { 'sv08-001': { count: 1 } }, futureField: 42 }));
  assert.strictEqual(old.packs[0].status, 'opened'); assert.strictEqual(old.futureField, 42, 'unknown fields kept');
  const D = E.defaults(); D.tasks.push({ id: 'z', name: 'Z', premium: true, active: true });
  const rt = E.parseBackup(JSON.stringify(E.makeBackup(D, 0)));
  assert.deepStrictEqual(rt.tasks, D.tasks);
  assert.throws(() => E.parseBackup(JSON.stringify({ title: 'Quest', weeks: 10, normalTasks: [] })));
  assert.throws(() => E.parseBackup('not json'));
});
