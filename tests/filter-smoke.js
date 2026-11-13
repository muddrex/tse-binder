// Real-browser TOUCH check of Backpack filters, Admin set order and Binder default sort (iPad viewport, live TCGdex).
// Rips one pack with taps (Reduce Motion), closes the recap with the X (no "Add to binder"), then taps each filter.
// Run: python3 -m http.server 8765 (in preview/), then node filter-smoke.js [outdir]
const puppeteer = require('puppeteer-core');
const KEY = process.env.TR_KEY || 'task-ripper-preview'; // TR_KEY=task-ripper-v1 when serving the live root copy
const out = process.argv[2] || '/tmp/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.evaluateOnNewDocument(k => { window.KEY = k; }, KEY); // in-page KEY
  await page.setViewport({ width: 820, height: 1180, hasTouch: true, isMobile: true });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.removeItem(KEY)); await page.reload({ waitUntil: 'networkidle2' });
  const tap = async s => { const el = await page.$(s); if (!el) throw new Error('missing ' + s); await el.evaluate(x => x.scrollIntoView({ block: 'center' })); await sleep(80); const b = await el.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(250); };
  for (let k = 0; k < 2; k++) { await tap('.task'); await tap('[data-yes]'); await page.waitForSelector('[data-set=sv08]:not([disabled])', { timeout: 30000 }); await tap('[data-set=sv08]'); }
  await tap('[data-tab=backpack]');
  await tap('[data-act=open]'); await page.waitForSelector('#tear', { timeout: 30000 }); await sleep(300);
  await page.touchscreen.tap(410, 600); await sleep(300); await page.touchscreen.tap(410, 600); await sleep(300);
  for (let i = 0; i < 10; i++) await tap('.nextBtn');
  await page.waitForSelector('#toBinder'); await tap('#ripClose');
  const ids = () => page.$$eval('#bpList [data-id]', x => x.map(e => e.dataset.act));
  const res = {};
  for (const k of ['unopened', 'opened', 'all']) { await tap('[data-bpshow=' + k + ']'); res[k] = await ids(); }
  await tap('[data-bpshow=opened]'); await page.screenshot({ path: `${out}/filter-opened.png` });
  await tap('[data-tab=binder]'); await sleep(500);
  res.binderSort = await page.$eval('[data-bf=sort]', s => s.value);
  res.binderTiers = await page.$$eval('.binder .slot', x => x.length);
  await tap('[data-tab=admin]'); await tap('[data-act=pin]'); await page.type('#pinIn', '1234'); await tap('[data-ok]');
  await tap('[data-admintab=sets]'); await page.waitForSelector('#setList [data-setid]', { timeout: 30000 });
  res.sets = await page.$$eval('#setList [data-setid]', x => x.map(e => e.dataset.setid));
  await page.screenshot({ path: `${out}/admin-sets.png` });
  res.errors = errors;
  console.log(JSON.stringify(res));
  const ok = JSON.stringify(res.unopened) === '["open"]' && JSON.stringify(res.opened) === '["packcards"]' && res.all.length === 2 && res.binderSort === 'rarity' && res.sets[0].startsWith('me') && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); process.exit(ok ? 0 : 1);
})();
