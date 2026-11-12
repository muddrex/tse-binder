# tse-binder (Task Ripper preview)

A family chore tracker: finish a task, earn a virtual card pack, rip it with a swipe, and fill a binder.
Personal family app. Not affiliated with or endorsed by The Pokémon Company, Nintendo, Creatures or GAME FREAK.

**Status: preview only.** The app itself is not live at the repo root. Try the preview at:

https://muddrex.github.io/tse-binder/preview/

## Open it locally

The app is plain HTML/CSS/JS with no build step: `preview/index.html`, `preview/engine.js`, `preview/app.js`.

```
cd preview
python3 -m http.server 8765
# then open http://localhost:8765/
```

The first time a set is used, the device needs internet to load card lists, pictures and prices from the free [TCGdex](https://tcgdex.dev) API (no key). After that, card lists are cached on the device.

- Admin PIN (preview default): `1234`
- Saved data key: `task-ripper-preview` (live will be `task-ripper-v1`; see the PROMOTION comment in `app.js`)
- API cache key: `task-ripper-tcgdex-cache` (safe to clear; not in backups)
- It never reads or writes Quest Tracker data (`quest-tracker-v2`, `quest-tracker-preview`).

Sample tasks and the two enabled sets (Surging Sparks, Destined Rivals) are preview defaults only. Change them in Admin.

## Tests

```
cd tests
npm install            # jsdom (+ puppeteer-core for the optional browser smoke test)
node --test            # engine + jsdom app tests, offline (uses fixtures/tcgdex-sv08.json)
node browser-smoke.js  # optional: real Chrome, live TCGdex, saves screenshots to /tmp/shots
node touch-smoke.js    # optional: real Chrome with touch, normal + Reduce Motion: one card per swipe, zoom, backpack filter
```
