const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const FX = require('./fixtures/tcgdex-sv08.json');
const P = path.join(__dirname, '../preview');

function boot(opts = {}) {
  const html = fs.readFileSync(path.join(P, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://muddrex.github.io/Task-Ripper/preview/', runScripts: 'outside-only', pretendToBeVisual: true });
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
  assert.match(d.title, /PREVIEW/);
  assert.ok(d.querySelector('.b-preview'));
  const tasks = d.querySelectorAll('[data-act=task]');
  assert.ok(tasks.length >= 2);
  assert.ok(d.querySelector('.task.prem'), 'a premium sample task');
  const saved = JSON.parse(ls.getItem('task-ripper-preview'));
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
  let D = JSON.parse(ls.getItem('task-ripper-preview'));
  assert.strictEqual(D.packs.length, 1); assert.strictEqual(D.completions.length, 1);
  const p = D.packs[0];
  assert.strictEqual(p.status, 'sealed'); assert.strictEqual(p.premium, true); assert.strictEqual(p.setId, 'sv08');
  assert.strictEqual(p.taskName, 'Clean your whole room'); assert.ok(p.at > 0); assert.strictEqual(p.completionId, D.completions[0].id);
  click(w, d.querySelector('[data-tab=backpack]'));
  const tile = d.querySelector('[data-act=open]'); assert.ok(tile);
  click(w, tile);
  await tick(200);
  D = JSON.parse(ls.getItem('task-ripper-preview'));
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
  D = JSON.parse(ls.getItem('task-ripper-preview'));
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
  const bad = writes.filter(x => x[0] !== 'set' || !['task-ripper-preview', 'task-ripper-tcgdex-cache'].includes(x[1]));
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
  const D = JSON.parse(ls.getItem('task-ripper-preview'));
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

test('backpack: newest packs first by default; Unopened filter hides opened packs', async () => {
  const { w, d } = boot();
  const D = w.__TR.D, t = D.tasks[0], T = Date.now();
  const a = w.TRE.earnPack(D, t, { id: 'sv08', name: 'Surging Sparks' }, T - 3 * 864e5);
  const b = w.TRE.earnPack(D, t, { id: 'sv10', name: 'Destined Rivals' }, T - 2 * 864e5);
  const c = w.TRE.earnPack(D, t, { id: 'sv08', name: 'Surging Sparks' }, T - 1 * 864e5);
  b.status = 'opened'; b.ripSeen = true; b.openedAt = T; b.cards = [];
  click(w, d.querySelector('[data-tab=backpack]'));
  const ids = () => [...d.querySelectorAll('#bpList [data-id]')].map(x => x.dataset.id);
  assert.deepStrictEqual(ids(), [c.id, b.id, a.id], 'newest earned first');
  click(w, d.querySelector('[data-bpshow=unopened]'));
  assert.deepStrictEqual(ids(), [c.id, a.id], 'opened pack hidden');
  assert.ok(d.querySelectorAll('#bpList [data-act=open]').length === 2);
  click(w, d.querySelector('[data-bpshow=opened]')); assert.deepStrictEqual(ids(), [b.id]);
  click(w, d.querySelector('[data-bpshow=all]'));
  const sel = d.querySelector('[data-bp=sort]'); sel.value = 'oldest'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.deepStrictEqual(ids(), [a.id, b.id, c.id]);
});

test('skip button never blocks cards being added', async () => {
  const { w, d, ls } = boot();
  w.TRE.earnPack(w.__TR.D, w.__TR.D.tasks[0], { id: 'sv08', name: 'Surging Sparks' }, Date.now());
  w.__TR.openPack(w.__TR.D.packs[0].id);
  await tick(200);
  click(w, d.querySelector('#ripSkip'));
  assert.ok(d.querySelector('#toBinder'));
  const D = JSON.parse(ls.getItem('task-ripper-preview'));
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
  const D = JSON.parse(ls.getItem('task-ripper-preview'));
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
