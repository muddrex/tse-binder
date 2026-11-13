// Real-browser smoke test against live TCGdex: iPad-size viewport with touch, screenshots of each step.
// Run: python3 -m http.server 8765 (in preview/), then node browser-smoke.js [outdir]
const puppeteer = require('puppeteer-core');
const KEY = process.env.TR_KEY || 'task-ripper-preview'; // TR_KEY=task-ripper-v1 when serving the live root copy
const out = process.argv[2] || '/tmp/shots';
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.evaluateOnNewDocument(k => { window.KEY = k; }, KEY); // in-page KEY
  await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: out + '/1-tasks.png' });
  await page.click('.task.prem'); await page.click('[data-yes]');
  await page.waitForSelector('[data-set=sv08]'); await new Promise(r => setTimeout(r, 4000));
  await page.screenshot({ path: out + '/2-picker.png' });
  await page.click('[data-set=sv08]');
  await page.click('[data-tab=backpack]'); await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: out + '/3-backpack.png' });
  await page.click('[data-act=open]');
  await page.waitForSelector('#tear', { timeout: 30000 }); await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: out + '/4-sealed.png' });
  async function swipe(x0, x1, steps, stepMs) {
    await page.mouse.move(x0, 600); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, 600); await new Promise(r => setTimeout(r, stepMs)); }
    await page.mouse.up();
  }
  await swipe(200, 360, 6, 30); await new Promise(r => setTimeout(r, 50));
  await page.screenshot({ path: out + '/4b-midtear.png' });
  await swipe(150, 700, 10, 15); await new Promise(r => setTimeout(r, 1600));
  await page.screenshot({ path: out + '/5-stack.png' });
  // half flip, screenshot mid-gesture
  await page.mouse.move(200, 600); await page.mouse.down(); for (let i = 1; i <= 5; i++) { await page.mouse.move(200 + 25 * i, 600); await new Promise(r => setTimeout(r, 30)); }
  await page.screenshot({ path: out + '/5b-midflip.png' });
  for (let i = 1; i <= 8; i++) { await page.mouse.move(325 + 40 * i, 600); await new Promise(r => setTimeout(r, 15)); }
  await page.mouse.up(); await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: out + '/6-first-card.png' });
  for (let i = 0; i < 9; i++) {
    if (i === 8) { // slow peel on the last hit
      await page.mouse.move(400, 600); await page.mouse.down(); for (let k = 1; k <= 6; k++) { await page.mouse.move(400 + 20 * k, 600); await new Promise(r => setTimeout(r, 60)); }
      await page.screenshot({ path: out + '/7-slow-peel.png' });
      for (let k = 1; k <= 10; k++) { await page.mouse.move(520 + 25 * k, 600); await new Promise(r => setTimeout(r, 40)); }
      await page.mouse.up(); await new Promise(r => setTimeout(r, 1500));
      await page.screenshot({ path: out + '/8-last-card.png' });
    } else { await swipe(400, 800, 6, 10); await new Promise(r => setTimeout(r, 700)); }
  }
  await swipe(400, 800, 6, 10); await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: out + '/9-recap.png' });
  await page.click('#toBinder');
  await page.click('[data-tab=binder]'); await new Promise(r => setTimeout(r, 6000));
  await page.select('[data-bf=sort]', 'value'); await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: out + '/10-binder.png' });
  await page.click('[data-tab=progress]'); await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: out + '/11-progress.png', fullPage: true });
  await page.click('[data-tab=admin]'); await page.click('[data-act=pin]'); await page.type('#pinIn', '1234'); await page.click('[data-ok]');
  await page.click('[data-admintab=sets]'); await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: out + '/12-admin-sets.png' });
  await page.setViewport({ width: 1180, height: 820, hasTouch: true, isMobile: true });
  await page.click('[data-tab=backpack]'); await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: out + '/13-landscape.png' });
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const D = await page.evaluate(() => JSON.parse(localStorage.getItem(KEY)));
  console.log(JSON.stringify({ errors, keys, cards: D.packs[0].cards.map(c => c.tier + ':' + c.name + ':' + c.variant) }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
