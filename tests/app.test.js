const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const FX = require('./fixtures/tcgdex-sv08.json');
// TR_COPY=live runs the same tests against the live copy at the repo root (key task-ripper-v1).
const LIVE = process.env.TR_COPY === 'live';
const P = path.join(__dirname, LIVE ? '..' : '../preview');
const KEY = LIVE ? 'task-ripper-v1' : 'task-ripper-preview';

function boot(opts = {}) {
  const html = fs.readFileSync(path.join(P, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { url: LIVE ? 'https://muddrex.github.io/tse-binder/' : 'https://muddrex.github.io/Task-Ripper/preview/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (!w.structuredClone) w.structuredClone = v => JSON.parse(JSON.stringify(v)); // test-only polyfill
  const writes = [];
  const ls = w.localStorage;
  // Quest Tracker data that must never be touched.
  ls.setItem('quest-tracker-v2', '{"sentinel":"live"}');
  ls.setItem('quest-tracker-preview', '{"sentinel":"preview"}');
  (opts.seed || []).forEach(([k, v]) => ls.setItem(k, v));
  const proto = Object.getPrototypeOf(ls);
  const origSet = proto.setItem, origRemove = proto.removeItem, origClear = proto.clear;
  proto.setItem = function (k, v) { writes.push(['set', k]); return origSet.call(this, k, v); };
  proto.removeItem = function (k) { writes.push(['remove', k]); return origRemove.call(this, k); };
  proto.clear = function () { writes.push(['clear']); return origClear.call(this); };
  const calls = [];
  w.fetch = (url) => {
    calls.push(url);
    const p = url.replace('https://api.tcgdex.net/v2/en', '');
    const decoded = Object.keys(FX).find(k => k === p || decodeURIComponent(k) === decodeURIComponent(p));
    let body = decoded ? FX[decoded] : null;
    if (!body && p.startsWith('/cards/')) body = { id: p.slice(7), category: 'Pokemon', variants: { normal: true, reverse: true }, pricing: { tcgplayer: { updated: '2026-11-11T23:49:50.897Z', normal: { marketPrice: 1.5 } } } };
    if (!body && p.startsWith('/cards?')) body = [];
    if (!body) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
  };
  w.Image = class { set src(v) { setTimeout(() => this.onload && this.onload(), 0); } };
  w.matchMedia = () => ({ matches: false });
  w.scrollTo = () => {};
  w.confirm = () => true; w.alert = (m) => { w.__alert = m; };
  w.eval(fs.readFileSync(path.join(P, 'engine.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(P, 'app.js'), 'utf8'));
  return { w, d: w.document, writes, calls, ls };
}
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

test('first run: preview badge, demo tasks, own storage key', async () => {
  const { w, d, ls } = boot();
  if (LIVE) { assert.doesNotMatch(d.title, /PREVIEW/); assert.ok(!d.querySelector('.b-preview')); assert.strictEqual(ls.getItem('task-ripper-preview'), null, 'live never writes the preview key'); }
  else { assert.match(d.title, /PREVIEW/); assert.ok(d.querySelector('.b-preview')); }
  const tasks = d.querySelectorAll('[data-act=task]');
  assert.ok(tasks.length >= 2);
  assert.ok(d.querySelector('.task.prem'), 'a premium sample task');
  const saved = JSON.parse(ls.getItem(KEY));
  assert.deepStrictEqual(saved.enabledSets, ['sv08', 'sv10']); assert.strictEqual(saved.demoDefaults, true);
});

test('confirm task -> choose set -> sealed pack in backpack -> rip (reduce motion) -> binder', async () => {
  const { w, d, ls, writes } = boot();
  w.__TR.D.settings.reduceMotion = true;
  const prem = d.querySelector('.task.prem');
  click(w, prem);
  click(w, d.querySelector('[data-yes]'));
  await tick(50);
  const pick = d.querySelector('[data-set=sv08]'); assert.ok(pick, 'set picker shows Surging Sparks');
  click(w, pick);
  let D = JSON.parse(ls.getItem(KEY));
  assert.strictEqual(D.packs.length, 1); assert.strictEqual(D.completions.length, 1);
  const p = D.packs[0];
  assert.strictEqual(p.status, 'sealed'); assert.strictEqual(p.premium, true); assert.strictEqual(p.setId, 'sv08');
  assert.strictEqual(p.taskName, 'Clean your whole room'); assert.ok(p.at > 0); assert.strictEqual(p.completionId, D.completions[0].id);
  click(w, d.querySelector('[data-tab=backpack]'));
  const tile = d.querySelector('[data-act=open]'); assert.ok(tile);
  click(w, tile);
  await tick(200);
  D = JSON.parse(ls.getItem(KEY));
  assert.strictEqual(D.packs[0].status, 'opened'); assert.strictEqual(D.packs[0].cards.length, 10);
  assert.ok(D.packs[0].cards.every(c => c.setId === 'sv08'));
  assert.ok(Object.keys(D.collection).length >= 1);
  // Reduce Motion still rips one card at a time (no dumping all 10 at once)
  assert.ok(!d.querySelector('#toBinder'), 'reduce motion must not jump to the recap');
  const stage0 = d.querySelector('#stage');
  const tapRM = () => { for (const ty of ['pointerdown', 'pointerup']) { const e = new w.Event(ty, { bubbles: true }); e.clientX = 100; e.clientY = 100; e.pointerId = 1; stage0.dispatchEvent(e); } };
  assert.ok(d.querySelector('#tear')); tapRM(); await tick(150);
  assert.ok(d.querySelector('#fl'), 'tap opens to the face-down stack'); tapRM(); await tick(150);
  for (let i = 0; i < 10; i++) {
    assert.ok(d.querySelector('#top'), 'one card showing: ' + (i + 1));
    assert.strictEqual(d.querySelector('#ripCount').textContent, (i + 1) + ' / 10');
    click(w, d.querySelector('.nextBtn')); await tick(150);
  }
  const recap = d.querySelector('#toBinder'); assert.ok(recap, 'recap only after the last card');
  click(w, recap);
  D = JSON.parse(ls.getItem(KEY));
  assert.strictEqual(D.packs[0].ripSeen, true);
  click(w, d.querySelector('[data-tab=binder]'));
  await tick(100);
  assert.ok(d.querySelectorAll('.binder .slot').length >= 1);
  // favourite + filter
  const favBtn = d.querySelector('[data-act=fav]'); click(w, favBtn);
  const favOnly = d.querySelector('[data-bf=fav]'); favOnly.checked = true; favOnly.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.strictEqual(d.querySelectorAll('.binder .slot').length, 1);
  // value sort shows a priced card from the mocked detail
  const sort = d.querySelector('[data-bf=sort]'); sort.value = 'value'; sort.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match(d.querySelector('.binder').textContent, /US\$|Unpriced/);
  click(w, d.querySelector('[data-tab=progress]'));
  assert.match(d.querySelector('#view').textContent, /Tasks done\s*1/);
  assert.match(d.querySelector('#view').textContent, /Surging Sparks.*\d+ \/ \d+/);
  const bad = writes.filter(x => x[0] !== 'set' || ![KEY, 'task-ripper-tcgdex-cache'].includes(x[1]));
  assert.deepStrictEqual(bad, [], 'only Task Ripper keys written');
  assert.strictEqual(ls.getItem('quest-tracker-v2'), '{"sentinel":"live"}');
  assert.strictEqual(ls.getItem('quest-tracker-preview'), '{"sentinel":"preview"}');
});

test('swipe rip: tear, flip, swipe through all cards to recap', async () => {
  const { w, d, ls } = boot();
  const t = w.__TR.D.tasks[0];
  w.TRE.earnPack(w.__TR.D, t, { id: 'sv08', name: 'Surging Sparks' }, Date.now());
  w.__TR.openPack(w.__TR.D.packs[0].id);
  await tick(200);
  const stage = d.querySelector('#stage');
  Object.defineProperty(stage, 'clientWidth', { value: 400 });
  const swipe = (dx) => {
    const ev = (type, x) => { const e = new w.Event(type, { bubbles: true }); e.clientX = x; e.clientY = 300; e.pointerId = 1; stage.dispatchEvent(e); };
    ev('pointerdown', 10); ev('pointermove', 10 + dx / 2); ev('pointermove', 10 + dx); ev('pointerup', 10 + dx);
  };
  assert.ok(d.querySelector('#tear'), 'sealed wrapper with tear strip');
  swipe(300); await tick(150);
  assert.ok(d.querySelector('#fl'), 'face-down stack after tear');
  swipe(300); await tick(150);
  for (let i = 0; i < 10; i++) { assert.ok(d.querySelector('#top'), 'card ' + (i + 1)); swipe(300); await tick(150); }
  assert.ok(d.querySelector('#toBinder'), 'recap after last card');
  const D = JSON.parse(ls.getItem(KEY));
  assert.strictEqual(D.packs[0].cards.length, 10);
  assert.ok(w.TRE.RANK[D.packs[0].cards[9].tier] >= w.TRE.RANK.DR);
});

function ptr(w, stage) {
  const ev = (type, x, y = 300) => { const e = new w.Event(type, { bubbles: true }); e.clientX = x; e.clientY = y; e.pointerId = 1; stage.dispatchEvent(e); };
  return {
    tap: () => { ev('pointerdown', 50); ev('pointerup', 51); },
    swipe: (dx) => { ev('pointerdown', 10); ev('pointermove', 10 + dx / 2); ev('pointermove', 10 + dx); ev('pointerup', 10 + dx); },
    cancel: (dx) => { ev('pointerdown', 10); ev('pointermove', 10 + dx); ev('pointercancel', 0, 0); }
  };
}
async function ripReady() {
  const b = boot();
  b.w.TRE.earnPack(b.w.__TR.D, b.w.__TR.D.tasks[0], { id: 'sv08', name: 'Surging Sparks' }, Date.now());
  b.w.__TR.openPack(b.w.__TR.D.packs[0].id);
  await tick(200);
  const stage = b.d.querySelector('#stage'); Object.defineProperty(stage, 'clientWidth', { value: 400 });
  return Object.assign(b, { stage, P: ptr(b.w, stage) });
}

test('taps never skip ahead: one card at a time, even with iPad Reduce Motion on', async () => {
  for (const rmMode of [false, true]) {
    const { w, d, P } = await ripReady.call(null);
    if (rmMode) { w.matchMedia = () => ({ matches: true }); }
    // (Reduce Motion is read when the pack opens; re-open with it on)
    if (rmMode) { d.querySelector('.rip').remove(); w.__TR.openPack(w.__TR.D.packs[0].id); await tick(200); }
    const stage = d.querySelector('#stage'); Object.defineProperty(stage, 'clientWidth', { value: 400 });
    const p = ptr(w, stage);
    assert.ok(d.querySelector('#tear'), 'opening a pack shows the sealed wrapper, not the recap');
    assert.ok(!d.querySelector('#toBinder'));
    if (!rmMode) {
      p.tap(); p.tap(); p.tap();
      assert.ok(d.querySelector('#tear'), 'taps do not tear the pack');
      p.cancel(400); assert.ok(d.querySelector('#tear'), 'a cancelled touch snaps back');
      p.swipe(300); await tick(150);
      assert.ok(d.querySelector('#fl')); p.tap(); assert.ok(d.querySelector('#fl'), 'tap does not flip');
      p.swipe(300); await tick(150);
      assert.ok(d.querySelector('#top')); assert.strictEqual(d.querySelector('#ripCount').textContent, '1 / 10');
      p.cancel(400); await tick(150); assert.strictEqual(d.querySelector('#ripCount').textContent, '1 / 10');
      p.swipe(300); await tick(150); assert.strictEqual(d.querySelector('#ripCount').textContent, '2 / 10', 'one swipe = one card');
    } else {
      p.tap(); await tick(150); assert.ok(d.querySelector('#fl'), 'reduce motion: tap opens'); p.tap(); await tick(150);
      assert.strictEqual(d.querySelector('#ripCount').textContent, '1 / 10');
      p.swipe(300); await tick(150); assert.strictEqual(d.querySelector('#ripCount').textContent, '2 / 10');
      click(w, d.querySelector('.nextBtn')); await tick(150); assert.strictEqual(d.querySelector('#ripCount').textContent, '3 / 10');
    }
    assert.ok(!d.querySelector('#toBinder'), 'still mid-rip');
  }
});

test('zoom: tap the face-up card during the rip, and any card on the recap; easy to close', async () => {
  const { w, d, P } = await ripReady();
  P.swipe(300); await tick(150); P.swipe(300); await tick(150);
  P.tap(); // tap the face-up card
  let z = d.querySelector('.zoom'); assert.ok(z, 'zoom opens on tap during rip');
  assert.match(z.querySelector('img').getAttribute('src'), /\/high\.webp$/);
  assert.strictEqual(d.querySelector('#ripCount').textContent, '1 / 10', 'zoom tap does not advance');
  await tick(400);
  click(w, z.querySelector('.zoomClose')); assert.ok(!d.querySelector('.zoom'), 'big X closes');
  click(w, d.querySelector('#ripZoom')); assert.ok(d.querySelector('.zoom'), 'zoom button'); await tick(400);
  click(w, d.querySelector('.zoom')); assert.ok(!d.querySelector('.zoom'), 'tapping the backdrop closes');
  click(w, d.querySelector('#ripSkip'));
  const btns = d.querySelectorAll('.recap [data-zi]'); assert.strictEqual(btns.length, 10);
  click(w, btns[9]); z = d.querySelector('.zoom'); assert.ok(z);
  const last = w.__TR.D.packs[0].cards[9];
  assert.match(z.textContent, new RegExp(last.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(z.textContent, /10 \/ 10/);
  await tick(400);
  click(w, z.querySelector('[data-zprev]')); assert.match(d.querySelector('.zoom').textContent, /9 \/ 10/);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); assert.ok(!d.querySelector('.zoom'), 'Escape closes');
  assert.ok(d.querySelector('#toBinder'), 'recap still there after closing zoom');
  // opened pack in the backpack: tap shows cards, tap card zooms
  click(w, d.querySelector('#toBinder'));
  click(w, d.querySelector('[data-act=packcards]'));
  click(w, d.querySelector('.modal [data-zi="0"]')); assert.ok(d.querySelector('.zoom'), 'zoom from backpack opened pack');
});

// Rip a pack through the real UI (Reduce Motion so taps step through). stopAt: 'mid' leaves after 3 cards,
// 'recap' leaves on the recap with the X (no Add to binder), 'binder' taps Add to binder.
async function ripVia(w, d, packId, stopAt) {
  w.__TR.D.settings.reduceMotion = true;
  click(w, d.querySelector('[data-tab=backpack]'));
  click(w, d.querySelector('[data-bpshow=all]'));
  click(w, d.querySelector('[data-act=open][data-id="' + packId + '"]'));
  await tick(200);
  const stage = d.querySelector('#stage');
  const tap = () => { for (const ty of ['pointerdown', 'pointerup']) { const e = new w.Event(ty, { bubbles: true }); e.clientX = 100; e.clientY = 100; e.pointerId = 1; stage.dispatchEvent(e); } };
  tap(); await tick(120); tap(); await tick(120);
  const n = stopAt === 'mid' ? 3 : 10;
  for (let i = 0; i < n; i++) { click(w, d.querySelector('.nextBtn')); await tick(120); }
  if (stopAt === 'binder') click(w, d.querySelector('#toBinder'));
  else click(w, d.querySelector('#ripClose'));
  await tick(20);
}

test('backpack: newest packs first; All / Unopened / Opened follow the real rip flow', async () => {
  const { w, d, ls } = boot();
  const D = w.__TR.D, t = D.tasks[0], T = Date.now();
  const set = { id: 'sv08', name: 'Surging Sparks' };
  const a = w.TRE.earnPack(D, t, set, T - 4 * 864e5); // ripped, closed with X on the recap
  const b = w.TRE.earnPack(D, t, set, T - 3 * 864e5); // ripped, Add to binder
  const c = w.TRE.earnPack(D, t, set, T - 2 * 864e5); // left mid-rip
  const s = w.TRE.earnPack(D, t, set, T - 1 * 864e5); // still sealed
  await ripVia(w, d, a.id, 'recap');
  await ripVia(w, d, b.id, 'binder');
  await ripVia(w, d, c.id, 'mid');
  assert.ok(!d.querySelector('.rip'), 'rip overlay closed');
  click(w, d.querySelector('[data-tab=backpack]'));
  click(w, d.querySelector('[data-bpshow=all]'));
  const ids = () => [...d.querySelectorAll('#bpList [data-id]')].map(x => x.dataset.id);
  assert.deepStrictEqual(ids(), [s.id, c.id, b.id, a.id], 'All: newest earned first');
  click(w, d.querySelector('[data-bpshow=unopened]'));
  assert.deepStrictEqual(ids(), [s.id, c.id], 'Unopened: sealed + started-but-unfinished');
  assert.ok(d.querySelector('[data-bpshow=unopened]').classList.contains('on'));
  assert.match(d.querySelector('[data-bpshow=unopened]').textContent, /Unopened \(2\)/);
  assert.match(d.querySelector('[data-id="' + c.id + '"]').textContent, /Finish ripping/);
  click(w, d.querySelector('[data-bpshow=opened]'));
  assert.deepStrictEqual(ids(), [b.id, a.id], 'Opened: fully ripped, even when closed with X on the recap');
  assert.match(d.querySelector('[data-bpshow=opened]').textContent, /Opened \(2\)/);
  assert.ok([...d.querySelectorAll('#bpList [data-act]')].every(x => x.dataset.act === 'packcards'));
  // filter + sort combo
  const sel = d.querySelector('[data-bp=sort]'); sel.value = 'oldest'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.deepStrictEqual(ids(), [a.id, b.id], 'Opened + oldest first');
  click(w, d.querySelector('[data-bpshow=unopened]')); assert.deepStrictEqual(ids(), [c.id, s.id]);
  click(w, d.querySelector('[data-bpshow=all]')); assert.deepStrictEqual(ids(), [a.id, b.id, c.id, s.id]);
  // a tap whose target is the label's text node (iPad Safari can report that) still switches the filter
  const txt = d.querySelector('[data-bpshow=opened]').firstChild; assert.strictEqual(txt.nodeType, 3);
  txt.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.deepStrictEqual(ids(), [a.id, b.id]);
  // finishing the half-ripped pack moves it to Opened; saved state agrees
  await ripVia(w, d, c.id, 'recap');
  click(w, d.querySelector('[data-bpshow=opened]'));
  assert.deepStrictEqual(ids(), [a.id, b.id, c.id]);
  const saved = JSON.parse(ls.getItem(KEY));
  assert.deepStrictEqual(saved.packs.map(p => w.TRE.packState(p)), ['opened', 'opened', 'opened', 'sealed']);
  assert.match(d.querySelector('[data-tab=backpack]').textContent, /Backpack \(1\)/);
});

test('backpack: packs stuck as "Finish ripping" by older builds load as Opened', async () => {
  const T = Date.now();
  const old = { schema: 1, tasks: [{ id: 't1', name: 'Dishes' }], enabledSets: ['sv08'], collection: {},
    packs: [
      { id: 'p1', setId: 'sv08', setName: 'Surging Sparks', taskName: 'Dishes', at: T - 3000, status: 'opened', ripSeen: false, openedAt: T - 2000, cards: [{ id: 'sv08-001', name: 'X', tier: 'C' }] },
      { id: 'p2', setId: 'sv08', setName: 'Surging Sparks', taskName: 'Dishes', at: T - 1000, status: 'sealed' }] };
  const { w, d } = boot({ seed: [[KEY, JSON.stringify(old)]] });
  click(w, d.querySelector('[data-tab=backpack]'));
  const ids = () => [...d.querySelectorAll('#bpList [data-id]')].map(x => x.dataset.id);
  click(w, d.querySelector('[data-bpshow=unopened]')); assert.deepStrictEqual(ids(), ['p2']);
  click(w, d.querySelector('[data-bpshow=opened]')); assert.deepStrictEqual(ids(), ['p1']);
  assert.strictEqual(w.__TR.D.schema, 2);
  // a schema-2 pack really left mid-rip stays unfinished
  const n = w.TRE.normalize({ schema: 2, packs: [{ id: 'q', status: 'opened', ripSeen: false, cards: [{}] }] });
  assert.strictEqual(w.TRE.packState(n.packs[0]), 'ripping');
});

test('admin: sets listed newest first by TCGdex releaseDate', async () => {
  const { w, d } = boot();
  const base = w.fetch;
  const brief = (id, name) => ({ id, name, logo: 'https://assets.tcgdex.net/en/x/' + id + '/logo', cardCount: { total: 100 } });
  const extra = {
    '/series/me': { name: 'Mega Evolution', sets: [brief('me01', 'Mega Evolution'), brief('me02', 'Phantasmal Flames'), brief('me02.5', 'Ascended Heroes')] },
    '/series/sv': { name: 'Scarlet & Violet', sets: [brief('sv08', 'Surging Sparks'), brief('sv08.5', 'Prismatic Evolutions'), brief('sv10', 'Destined Rivals'), brief('sv09', 'Journey Together')] },
    '/sets?sort:field=releaseDate&sort:order=DESC': ['me02.5', 'B2', 'me02', 'me01', 'A4', 'sv10', 'sv09', 'sv08.5', 'sv08'].map(id => ({ id, name: id }))
  };
  w.fetch = (url) => { const p = url.replace('https://api.tcgdex.net/v2/en', ''); return extra[p] ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(extra[p]) }) : base(url); };
  click(w, d.querySelector('[data-tab=admin]')); click(w, d.querySelector('[data-act=pin]'));
  d.querySelector('#pinIn').value = '1234'; click(w, d.querySelector('[data-ok]'));
  const setsTab = d.querySelector('[data-admintab=sets]'); assert.ok(setsTab, 'sets admin tab'); click(w, setsTab);
  await tick(80);
  const order = [...d.querySelectorAll('#setList [data-setid]')].map(x => x.dataset.setid);
  assert.deepStrictEqual(order, ['me02.5', 'me02', 'me01', 'sv10', 'sv09', 'sv08.5', 'sv08']);
  // engine helper: undated sets keep their order after dated ones
  assert.deepStrictEqual(w.TRE.sortSetsNewest([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a']).map(s => s.id), ['c', 'a', 'b']);
});

test('binder: default sort is rarity, rarest first, card number breaks ties; other sorts still there', async () => {
  const { w, d } = boot();
  const D = w.__TR.D, T = Date.now();
  const mk = (id, localId, tier) => { D.collection[id] = { count: 1, favourite: false, name: id, setId: 'sv08', localId, tier, firstAt: T, variants: { normal: 1 }, packs: [] }; };
  mk('sv08-010', '010', 'C'); mk('sv08-200', '200', 'SIR'); mk('sv08-050', '050', 'DR'); mk('sv08-005', '005', 'C');
  mk('sv08-240', '240', 'HR'); mk('sv08-180', '180', 'IR'); mk('sv08-150', '150', 'UR'); mk('sv08-030', '030', 'U'); mk('sv08-040', '040', 'R');
  click(w, d.querySelector('[data-tab=binder]')); await tick(30);
  assert.strictEqual(d.querySelector('[data-bf=sort]').value, 'rarity');
  const order = () => [...d.querySelectorAll('.binder [data-act=card]')].map(x => x.dataset.id).filter((v, i, a) => a.indexOf(v) === i);
  assert.deepStrictEqual(order(), ['sv08-240', 'sv08-200', 'sv08-180', 'sv08-150', 'sv08-050', 'sv08-040', 'sv08-030', 'sv08-005', 'sv08-010']);
  const opts = [...d.querySelectorAll('[data-bf=sort] option')].map(o => o.value);
  assert.deepStrictEqual(opts.slice().sort(), ['newest', 'number', 'rarity', 'value']);
  const sel = d.querySelector('[data-bf=sort]'); sel.value = 'number'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.strictEqual(order()[0], 'sv08-005');
});

test('skip button never blocks cards being added', async () => {
  const { w, d, ls } = boot();
  w.TRE.earnPack(w.__TR.D, w.__TR.D.tasks[0], { id: 'sv08', name: 'Surging Sparks' }, Date.now());
  w.__TR.openPack(w.__TR.D.packs[0].id);
  await tick(200);
  click(w, d.querySelector('#ripSkip'));
  assert.ok(d.querySelector('#toBinder'));
  const D = JSON.parse(ls.getItem(KEY));
  assert.strictEqual(Object.values(D.collection).reduce((a, e) => a + e.count, 0), 10);
});

test('import a minimal backup JSON through Admin; never touches Quest Tracker', async () => {
  const { w, d, ls, writes } = boot();
  click(w, d.querySelector('[data-tab=admin]'));
  click(w, d.querySelector('[data-act=pin]'));
  d.querySelector('#pinIn').value = '1234'; click(w, d.querySelector('[data-ok]'));
  click(w, d.querySelector('[data-admintab=backup]'));
  const input = d.querySelector('#importFile');
  const file = new w.File([JSON.stringify({ tasks: [{ name: 'Feed the dog', premium: true }] })], 'b.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick(100);
  const D = JSON.parse(ls.getItem(KEY));
  assert.strictEqual(D.tasks.length, 1); assert.strictEqual(D.tasks[0].name, 'Feed the dog'); assert.strictEqual(D.tasks[0].premium, true);
  assert.deepStrictEqual(D.packs, []);
  assert.strictEqual(ls.getItem('quest-tracker-v2'), '{"sentinel":"live"}');
  assert.strictEqual(ls.getItem('quest-tracker-preview'), '{"sentinel":"preview"}');
  assert.ok(!writes.some(x => /quest/.test(x[1] || '') || x[0] !== 'set'));
  // a Quest Tracker backup is refused
  const qt = new w.File([JSON.stringify({ title: 'The Grand Quest', weeks: 12, normalTasks: [] })], 'q.json');
  const input2 = d.querySelector('#importFile');
  Object.defineProperty(input2, 'files', { value: [qt] });
  input2.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick(100);
  assert.match(w.__alert || '', /Could not read/);
});

test('wrong PIN keeps Admin locked; capped set cannot be chosen', async () => {
  const { w, d } = boot();
  click(w, d.querySelector('[data-tab=admin]'));
  click(w, d.querySelector('[data-act=pin]'));
  d.querySelector('#pinIn').value = '0000'; click(w, d.querySelector('[data-ok]'));
  assert.ok(!d.querySelector('[data-admintab]'));
  // cap every sv08 card
  await w.__TR.loadPool('sv08');
  w.__TR.C.pools.sv08.cards.forEach(c => { w.__TR.D.collection[c.id] = { count: 5, setId: 'sv08', tier: c.tier, name: c.name, variants: {} }; });
  click(w, d.querySelector('[data-tab=tasks]'));
  click(w, d.querySelector('[data-act=task]'));
  click(w, d.querySelector('[data-yes]'));
  await tick(50);
  const b = d.querySelector('[data-set=sv08]');
  assert.ok(b.disabled); assert.match(b.textContent, /capped/i);
});
