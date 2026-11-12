// Real-browser TOUCH smoke test (iPad viewport, touch events, live TCGdex). Checks that a tap never dumps the
// whole pack, that each swipe reveals one card, and that zoom opens/closes. Runs once normally and once with
// prefers-reduced-motion: reduce (iPad Settings > Accessibility > Motion > Reduce Motion).
// Run: python3 -m http.server 8765 (in preview/), then node touch-smoke.js [outdir]
const puppeteer = require('puppeteer-core');
const out = process.argv[2] || '/tmp/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(browser, rm) {
  const tag = rm ? 'rm' : 'motion';
  const page = await browser.newPage();
  await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  if (rm) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.removeItem('task-ripper-preview'); }); await page.reload({ waitUntil: 'networkidle2' });
  const tapSel = async s => { const el = await page.$(s); if (!el) throw new Error("missing " + s + " " + JSON.stringify(await page.evaluate(() => ({ html: (document.querySelector("#stage")||{}).innerHTML, c: (document.querySelector("#ripCount")||{}).textContent })))); await el.evaluate(x => { const r = x.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) x.scrollIntoView({ block: "center" }); }); await sleep(100); const b = await el.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  for (let k = 0; k < 2; k++) { // earn two packs a day apart-ish (order check)
    await tapSel('.task'); await tapSel('[data-yes]');
    await page.waitForSelector('[data-set=sv08]:not([disabled])'); await sleep(k ? 300 : 3000); await tapSel('[data-set=sv08]'); await sleep(300);
  }
  await tapSel('[data-tab=backpack]'); await sleep(300);
  await page.screenshot({ path: `${out}/${tag}-1-backpack.png` });
  await tapSel('[data-act=open]');
  await page.waitForSelector('#tear', { timeout: 30000 }); await sleep(500);
  const state = () => page.evaluate(() => ({ tear: !!document.querySelector('#tear'), stack: !!document.querySelector('#fl'), count: (document.querySelector('#ripCount') || {}).textContent, recap: !!document.querySelector('#toBinder'), zoom: !!document.querySelector('.zoom') }));
  const res = { tag };
  const swipe = async (x0, x1, steps = 8, ms = 16) => { await page.touchscreen.touchStart(x0, 600); for (let i = 1; i <= steps; i++) { await page.touchscreen.touchMove(x0 + (x1 - x0) * i / steps, 600); await sleep(ms); } await page.touchscreen.touchEnd(); };
  if (!rm) {
    for (let i = 0; i < 3; i++) { await page.touchscreen.tap(410, 600); await sleep(150); }
    res.afterTaps = await state();
    await swipe(150, 700); await sleep(1500);
    res.afterTear = await state();
    await swipe(200, 650); await sleep(1300);
  } else {
    await page.touchscreen.tap(410, 600); await sleep(200); res.afterTap1 = await state();
    await page.touchscreen.tap(410, 600); await sleep(200);
  }
  res.firstCard = await state();
  await page.screenshot({ path: `${out}/${tag}-2-first-card.png` });
  await page.touchscreen.tap(410, 600); await sleep(600);
  res.tapCard = await state();
  await page.screenshot({ path: `${out}/${tag}-3-zoom-during-rip.png` });
  await tapSel('.zoomClose'); await sleep(200); res.zoomClosed = await state();
  const seen = [];
  for (let i = 0; i < 10; i++) {
    seen.push((await state()).count);
    if (rm && i % 2) await tapSel('.nextBtn'); else await swipe(300, 780, 6, 12);
    await sleep(rm ? 200 : 1100);
  }
  res.counts = seen; res.end = await state();
  await page.screenshot({ path: `${out}/${tag}-4-recap.png` });
  await tapSel('.recap [data-zi="9"]'); await sleep(800);
  res.recapZoom = await state();
  await page.screenshot({ path: `${out}/${tag}-5-recap-zoom.png` });
  await tapSel('.zoomClose'); await sleep(200);
  await tapSel('#toBinder'); await sleep(300);
  await tapSel('[data-bpshow=unopened]'); await sleep(200);
  res.unopenedTiles = await page.$$eval('#bpList [data-id]', a => a.length);
  await tapSel('[data-bpshow=all]'); await sleep(200);
  res.order = await page.evaluate(() => { const D = JSON.parse(localStorage.getItem('task-ripper-preview')); return [...document.querySelectorAll('#bpList [data-id]')].map(x => D.packs.find(p => p.id === x.dataset.id).at); });
  await page.screenshot({ path: `${out}/${tag}-6-backpack-after.png` });
  res.collection = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('task-ripper-preview')).collection).reduce((a, e) => a + e.count, 0));
  res.errors = errors; res.keys = await page.evaluate(() => Object.keys(localStorage));
  await page.close();
  return res;
}
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  for (const rm of [false, true]) console.log(JSON.stringify(await run(browser, rm)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
