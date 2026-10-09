# Gigantic Gourd

A tiny katamari-style Halloween game: a jack-o-lantern rolls through a graveyard eating candy, growing as it goes. Three skull hits and you get a tombstone you can share. Built for Gigantic as a seasonal promo.

## Run it

```bash
npm install
npm run assets     # merges the models in assets-src/ into public/assets/halloween.glb (only needed after changing tools/build-assets.mjs)
npm run dev        # http://localhost:5173
```

Desktop: WASD / arrows, or drag with the mouse; Space hops. Mobile: drag anywhere, tap Hop. A golden shield drops in now and then: grab it for a few seconds of invincibility and one skull back.

## Build and host

Two routes, same build:

1. **On the Astro site (recommended).** `npm run build:site` builds with base path `/halloween/`. Copy `dist/` to the Astro project's `public/halloween/` and the game lives at `itsgigantic.com/halloween` with no iframe.
2. **Standalone.** `npm run build` and host `dist/` on Netlify / Cloudflare Pages / Vercel. Embed with a full-viewport `<iframe allow="fullscreen">` if it must sit inside another page.

Set the share URL in `src/config.ts` (`GAME_URL`) if the final path differs.

Analytics: the game pushes `gourd_start`, `gourd_game_over`, `gourd_tombstone_download`, `gourd_share` and `gourd_cta_click` to `window.dataLayer`, and posts the same events to the parent window when framed.

Fonts: the UI uses system fonts. The brand fonts (TWK Lausanne, Reckless) are licensed to the Gigantic site, so only add them if the game is served from itsgigantic.com; the CSS variables in `src/style.css` are ready for them.

## URL flags

| Flag | Effect |
|---|---|
| `?debug=1` | `R` restarts, `H` toggles the HUD, `window.__dbg` handles |
| `?stats=1` | fps / draw-call overlay |
| `?seed=123` | deterministic world layout |
| `?autopilot=1` | the pumpkin steers itself (the title screen uses this too) |
| `?showcase=1` | no title, no HUD, no joystick: clean capture |
| `?aspect=1:1` / `4:5` / `16:9` / `9:16` | letterbox the canvas for capture |
| `?timescale=0.5` | slow motion |
| `?mute=1` | start muted |

`H` toggles the HUD in showcase or debug mode.

## Social assets

1. Open e.g. `http://localhost:5173/?showcase=1&autopilot=1&aspect=1:1&seed=7` and size the browser window.
2. Record with macOS screen recording (Cmd+Shift+5).
3. `tools/make-social.sh recording.mov launch 3 12` writes `social/launch.mp4` and `social/launch.gif`.

LinkedIn feed posts don't animate uploaded GIFs: post the MP4, keep the GIF for Giphy or other channels.

## Tuning

Everything balance-related lives in `src/config.ts` and the item catalog in `src/game/items.ts` (points, pickup radii, spawn weights, size milestones). `GROWTH`, `maxGainFrac` and `gainSlope` control how fast the pumpkin grows; `powerSeconds` / `powerFirstAt` the shield.

Playtest harness: `?debug=1&autopilot=1&timescale=2&seed=N` plus `window.__dbg` (game, player, world, spawner). Note the handles are rebuilt on every run start, so re-read `window.__dbg` after `startRun`.

## Project layout

- `src/` game code (Vite + TypeScript + Three.js)
- `public/` static files: the merged glb, brand marks, fonts
- `assets-src/` the glTF source files the build uses, copied from the KayKit packs with their licences
- `tools/` the asset merge script and the social export script
- `_packs/` (ignored) the full KayKit downloads, kept locally only

## Credits

Models: KayKit Halloween Bits, Forest Nature Pack and Dungeon Pack (all CC0) by Kay Lousberg. Fonts: Bebas Neue, Creepster and DotGothic16 (SIL OFL, licences in `public/fonts`). Sound: all music and effects are synthesised with the Web Audio API (no audio files); `window.__audioTest()` in `?debug=1` renders them offline and reports levels. Engine: Three.js.

