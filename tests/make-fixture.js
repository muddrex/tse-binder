// One-off: records the TCGdex API responses the app makes for one set, so tests run offline.
const E = require('../preview/engine.js');
const fs = require('fs');
const API = 'https://api.tcgdex.net/v2/en';
(async () => {
  const set = process.argv[2] || 'sv08';
  const paths = ['/sets/' + set, '/cards?set.id=eq:' + set + '&category=eq:Energy'].concat(E.QUERY_RARITIES.map(r => '/cards?set.id=eq:' + set + '&rarity=eq:' + encodeURIComponent(r)));
  const out = {};
  for (const p of paths) { const r = await fetch(API + p); out[p] = await r.json(); }
  const sample = out['/sets/' + set].cards[0].id;
  out['/cards/' + sample] = await (await fetch(API + '/cards/' + sample)).json();
  fs.writeFileSync(__dirname + '/fixtures/tcgdex-' + set + '.json', JSON.stringify(out));
  console.log('saved', Object.keys(out).length, 'responses');
})();
