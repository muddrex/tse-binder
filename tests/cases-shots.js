// Boutique backdrop screenshots: every main tab at iPad portrait, Tasks at iPad landscape and phone width; checks the photo layer never takes taps,
// sits under the task list, ends above the tab bar, loads the right photo per orientation, and that the old CSS cases are gone.
// Run: python3 -m http.server 8765 (in preview/), then node cases-shots.js [outdir]
const puppeteer = require('puppeteer-core');
const out = process.argv[2] || '/tmp/shots';
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.setViewport({ width: 820, height: 1180, hasTouch: true, isMobile: true });
  await p.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle2' });
  const probe = () => p.evaluate(() => {
    const fx = document.querySelector('.shopbg'); const cs = getComputedStyle(fx); const card = document.querySelector('.card.taskcard');
    const t = [...document.querySelectorAll('.task')].map(x => x.getBoundingClientRect()); const r = card.getBoundingClientRect();
    const hit = document.elementFromPoint(window.innerWidth - 40, window.innerHeight / 2);
    const tabTop = document.querySelector('#tabs').getBoundingClientRect().top;
    return { pe: cs.pointerEvents, z: cs.zIndex, img: (cs.backgroundImage.match(/boutique-bg-\w+/) || [''])[0], bgBottom: Math.round(fx.getBoundingClientRect().bottom), tabTop: Math.round(tabTop),
      oldCases: document.querySelectorAll('.shopfx,.cab,.dpack').length, panel: [Math.round(r.left), Math.round(r.right)], panelShadow: getComputedStyle(card).boxShadow.split('inset').length - 1,
      taskW: Math.round(t[0].width), taskH: t.map(x => Math.round(x.height)), hitIsBg: !!(hit && hit.closest('.shopbg')), taskOnTop: document.elementFromPoint(t[0].left + 30, t[0].top + t[0].height / 2).closest('.task') !== null };
  });
  const info = { portrait: await probe() };
  await p.screenshot({ path: out + '/p-tasks.png' });
  for (const tab of ['backpack', 'binder', 'progress', 'admin']) { await p.click('[data-tab=' + tab + ']'); await wait(1500); await p.screenshot({ path: out + '/p-' + tab + '.png' }); }
  await p.setViewport({ width: 1180, height: 820, hasTouch: true, isMobile: true }); await p.click('[data-tab=tasks]'); await wait(500);
  info.landscape = await probe(); await p.screenshot({ path: out + '/l-tasks.png' });
  await p.click('[data-tab=binder]'); await wait(1500); await p.screenshot({ path: out + '/l-binder.png' });
  await p.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true }); await p.click('[data-tab=tasks]'); await wait(500);
  info.phone = await probe(); await p.screenshot({ path: out + '/phone-tasks.png' });
  const rm = await p.evaluate(() => { document.documentElement.classList.add('rm'); const a = [...document.querySelectorAll('.shopbg,.card,.task')].map(e => getComputedStyle(e).animationName); return a.every(n => n === 'none'); });
  console.log(JSON.stringify({ errors, info, noPanelAnimationUnderReduceMotion: rm }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
