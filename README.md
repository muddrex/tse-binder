# tse-binder (Task Ripper)

A family chore tracker: finish a task, earn a virtual card pack, rip it with a swipe, and fill a binder.
Personal family app. Not affiliated with or endorsed by The Pokémon Company, Nintendo, Creatures or GAME FREAK.

**Live app:** https://muddrex.github.io/tse-binder/

Preview (where changes are tried first): https://muddrex.github.io/tse-binder/preview/

Custom prompt cards are still coming soon.

## Two copies

| Copy | Files | Saved data key |
|---|---|---|
| Live (repo root) | `index.html`, `engine.js`, `app.js`, `assets/` | `task-ripper-v1` |
| Preview | `preview/index.html`, `preview/engine.js`, `preview/app.js`, `preview/assets/` | `task-ripper-preview` |

The two copies keep separate saves, so preview test packs never show up on the live site.

**Future changes go to `preview/` first.** Once a preview is approved, run `tools/promote.sh` to copy it to the root.
The script only changes the live copy's save key, backup filename and PREVIEW labels; `preview/` is left as it is.

## Open it locally

Plain HTML/CSS/JS, no build step.

```
python3 -m http.server 8765          # live copy, from the repo root
cd preview && python3 -m http.server 8765   # or the preview copy
# then open http://localhost:8765/
```

The first time a set is used, the device needs internet to load card lists, pictures and prices from the free [TCGdex](https://tcgdex.dev) API (no key). After that, card lists are cached on the device.

- Admin PIN (default): `1234`
- API cache key: `task-ripper-tcgdex-cache` (shared by both copies; safe to clear; not in backups)
- Backups: live saves `task-ripper-backup-<date>.json`, preview saves `task-ripper-preview-backup-<date>.json`
- It never reads or writes Quest Tracker data (`quest-tracker-v2`, `quest-tracker-preview`).

Sample tasks and the two enabled sets (Surging Sparks, Destined Rivals) are starting defaults. Change them in Admin.

## Tests

```
cd tests
npm install                      # jsdom (+ puppeteer-core for the browser smoke tests)
node --test                      # engine + jsdom app tests against preview/, offline (fixtures/tcgdex-sv08.json)
TR_COPY=live node --test         # same tests against the live root copy (key task-ripper-v1)
node touch-smoke.js              # real Chrome with touch, normal + Reduce Motion: Rip It card back, one card per swipe, zoom, backpack filter
node theme-smoke.js              # boutique theme animations stop under Reduce Motion; tab targets >= 48px
node filter-smoke.js             # Backpack filters, Admin set order, Binder default sort
node browser-smoke.js            # optional: live TCGdex, screenshots to /tmp/shots
```

The smoke tests expect a server on port 8765 (in `preview/`, or the repo root for the live copy).
For the live copy, set `TR_KEY=task-ripper-v1` before running them.
