// Display-case theme screenshots: every main tab at iPad portrait, Tasks at iPad landscape and phone width; checks cases never take taps.
// Run: python3 -m http.server 8765 (in preview/), then node cases-shots.js [outdir]
const puppeteer = require('puppeteer-core');
const out = process.argv[2] || '/tmp/shots';
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.setViewport({ width: 820, height: 1180, hasTouch: true, isMobile: true });
  await p.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle2' });
  const info = await p.evaluate(() => {
    const fx = document.querySelector('.shopfx'); const r = document.querySelector('.cab.right').getBoundingClientRect();
    const t = [...document.querySelectorAll('.task')].map(x => x.getBoundingClientRect());
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { pe: getComputedStyle(fx).pointerEvents, z: getComputedStyle(fx).zIndex, cab: [Math.round(r.left), Math.round(r.width)], taskW: Math.round(t[0].width), taskH: t.map(x => Math.round(x.height)), hitIsCase: !!hit.closest('.shopfx') };
  });
  await p.screenshot({ path: out + '/p-tasks.png' });
  for (const tab of ['backpack', 'binder', 'progress', 'admin']) { await p.click('[data-tab=' + tab + ']'); await wait(1500); await p.screenshot({ path: out + '/p-' + tab + '.png' }); }
  await p.setViewport({ width: 1180, height: 820, hasTouch: true, isMobile: true }); await p.click('[data-tab=tasks]'); await wait(500);
  await p.screenshot({ path: out + '/l-tasks.png' });
  await p.click('[data-tab=binder]'); await wait(1500); await p.screenshot({ path: out + '/l-binder.png' });
  await p.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true }); await p.click('[data-tab=tasks]'); await wait(500);
  await p.screenshot({ path: out + '/phone-tasks.png' });
  const rm = await p.evaluate(() => { document.documentElement.classList.add('rm'); return getComputedStyle(document.querySelector('.glare')).display; });
  console.log(JSON.stringify({ errors, info, glareUnderReduceMotion: rm }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
