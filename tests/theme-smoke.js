// Theme check: Reduce Motion (Admin toggle or iPad setting) stops sparkle/sign animations; tab bar targets stay >=48px.
// Run: python3 -m http.server 8765 (in preview/), then node theme-smoke.js
const puppeteer = require('puppeteer-core');
const KEY = process.env.TR_KEY || 'task-ripper-preview'; // TR_KEY=task-ripper-v1 when serving the live root copy
(async()=>{const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await b.newPage();await p.evaluateOnNewDocument(k=>{window.KEY=k;},KEY);
await p.goto('http://localhost:8765/index.html',{waitUntil:'networkidle2'});
const g=()=>p.evaluate(()=>({rm:document.documentElement.classList.contains('rm'),h1:getComputedStyle(document.querySelector('h1')).animationName,spark:getComputedStyle(document.querySelector('.spark')).animationName,minTab:Math.min(...[...document.querySelectorAll('#tabs button')].map(x=>x.getBoundingClientRect().height))}));
const a=await g(); await p.evaluate(()=>{const s=JSON.parse(localStorage.getItem(KEY));s.settings.reduceMotion=true;localStorage.setItem(KEY,JSON.stringify(s));}); await p.reload({waitUntil:'networkidle2'}); const c=await g();
await p.evaluate(()=>{const s=JSON.parse(localStorage.getItem(KEY));s.settings.reduceMotion=false;localStorage.setItem(KEY,JSON.stringify(s));});await p.reload();
await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]); const d=await g();
console.log(JSON.stringify({normal:a,adminToggle:c,iPadSetting:d}));await b.close();})();
