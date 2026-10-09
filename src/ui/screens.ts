import type { HudState, RunStats } from '../game/game';
import { IS_TOUCH } from '../config';

export interface ScreenHooks {
  onPlay(name: string): void;
  onAgain(): void;
  onMute(muted: boolean): void;
  onShare(): void;
  onDownload(): void;
}

// Pixel-art skull, 13x12: K = outline, W = bone, . = transparent.
const SKULL_BITS = [
  '...KKKKKKK...',
  '..KWWWWWWWK..',
  '.KWWWWWWWWWK.',
  'KWWWWWWWWWWWK',
  'KWWWWWWWWWWWK',
  'KWKKWWWWKKKWK',
  'KWKKWWKWKKKWK',
  'KWWWWWWWWWWWK',
  'KWWWWWWWWWKKK',
  '.KWWWWWWWWKK.',
  '.KWKWKWKWWKK.',
  '..KKKKKKKKK..',
];
const SKULL = `<svg viewBox="0 0 13 12" shape-rendering="crispEdges" aria-hidden="true">${SKULL_BITS.map((row, y) =>
  [...row].map((c, x) => (c === '.' ? '' : `<rect class="${c === 'K' ? 'k' : 's'}" x="${x}" y="${y}" width="1" height="1"/>`)).join('')).join('')}</svg>`;
const SPEAKER_ON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>`;
const SPEAKER_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9l5 6M21 9l-5 6"/></svg>`;

export class Screens {
  private root: HTMLElement;
  private title: HTMLElement;
  private death: HTMLElement;
  private hud: HTMLElement;
  private banner: HTMLElement;
  private scoreEl: HTMLElement;
  private multEl: HTMLElement;
  private comboEl: HTMLElement;
  private livesEl: HTMLElement;
  private chargeEl: HTMLElement;
  private sizeEl: HTMLElement;
  private muteBtn: HTMLButtonElement;
  private nameInput: HTMLInputElement;
  private bestEl: HTMLElement;
  private stoneImg: HTMLImageElement;
  private deathTitle: HTMLElement;
  private shareBtn: HTMLButtonElement;
  private lastScore = -1;
  private lastMult = -1;
  private lastLives = -1;
  private lastSize = '';
  muted = false;

  constructor(ui: HTMLElement, private hooks: ScreenHooks, base: string) {
    this.root = ui;
    ui.insertAdjacentHTML(
      'beforeend',
      `
      <div id="hud" class="hidden">
        <div class="score-wrap">
          <div class="score"><span id="score">0</span><span id="mult" class="mult">x1</span></div>
          <div class="combo"><i id="comboBar"></i></div>
        </div>
        <div id="lives" class="lives" aria-label="Skull hits left">${SKULL}${SKULL}${SKULL}</div>
        <div id="charge" class="charge" aria-label="Shield time left"><span>Shielded</span><i><b></b></i></div>
        <div id="size" class="size"><span><small>As big as</small><b>a pumpkin</b></span></div>
        <button id="mute" class="icon-btn" aria-label="Toggle sound"></button>
      </div>
      <div id="banner"></div>
      <section id="title" class="screen">
        <div class="card">
          <img class="mark" src="${base}brand/logo-halloween.png" onerror="this.onerror=null;this.src='${base}brand/icon.svg';this.classList.add('fallback')" alt="Gigantic" width="104" height="104" />
          <h1>Gigantic<br />Gourd</h1>
          <p class="tag">Roll around the graveyard eating candy, and steer clear of the skulls.</p>
          <label class="name"><span class="label">Name</span>
            <input id="name" type="text" maxlength="16" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore placeholder="Your name" enterkeyhint="go" /></label>
          <button id="play" class="btn">Play</button>
          <p id="best" class="best"></p>
          <p class="hint">${IS_TOUCH ? 'Drag anywhere to move, tap Hop to jump.' : 'Move with WASD, the arrow keys, or by dragging. Space to hop.'} Three skull hits and it's over.</p>
          <a class="credit" href="https://www.itsgigantic.com/?utm_source=gourd&utm_medium=game&utm_campaign=halloween" target="_blank" rel="noopener">Made with <svg class="heart" viewBox="0 0 24 24" aria-label="love"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.4 2.6 4.8 6.2 4.2c2-.3 3.9.6 5.8 2.6 1.9-2 3.8-2.9 5.8-2.6 3.6.6 5.3 4.2 3.8 7.5C19.5 16.4 12 21 12 21z"/></svg> by Gigantic</a>
        </div>
      </section>
      <section id="death" class="screen hidden">
        <div class="card death-card">
          <h2 id="deathTitle">Game over</h2>
          <img id="stone" alt="Your tombstone" />
          <div class="row">
            <button id="download" class="btn secondary">Save image</button>
            <button id="share" class="btn secondary">Share</button>
          </div>
          <button id="again" class="btn">Play again</button>
          <a class="credit" href="https://www.itsgigantic.com/?utm_source=gourd&utm_medium=game&utm_campaign=halloween" target="_blank" rel="noopener">Made with <svg class="heart" viewBox="0 0 24 24" aria-label="love"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.4 2.6 4.8 6.2 4.2c2-.3 3.9.6 5.8 2.6 1.9-2 3.8-2.9 5.8-2.6 3.6.6 5.3 4.2 3.8 7.5C19.5 16.4 12 21 12 21z"/></svg> by Gigantic</a>
        </div>
      </section>`,
    );
    const $ = <T extends HTMLElement>(id: string) => ui.querySelector<T>(`#${id}`)!;
    this.title = $('title');
    this.death = $('death');
    this.hud = $('hud');
    this.banner = $('banner');
    this.scoreEl = $('score');
    this.multEl = $('mult');
    this.comboEl = $('comboBar');
    this.livesEl = $('lives');
    this.chargeEl = $('charge');
    this.sizeEl = $('size');
    this.muteBtn = $('mute');
    this.nameInput = $('name');
    this.bestEl = $('best');
    this.stoneImg = $('stone');
    this.deathTitle = $('deathTitle');
    this.shareBtn = $('share');

    try {
      this.nameInput.value = localStorage.getItem('gg.name') ?? '';
    } catch {
      /* ignore */
    }
    const play = () => {
      const name = this.nameInput.value.trim().slice(0, 16);
      try {
        localStorage.setItem('gg.name', name);
      } catch {
        /* ignore */
      }
      hooks.onPlay(name);
    };
    $('play').addEventListener('click', play);
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') play();
      e.stopPropagation();
    });
    $('again').addEventListener('click', () => hooks.onAgain());
    $('download').addEventListener('click', () => hooks.onDownload());
    this.shareBtn.addEventListener('click', () => hooks.onShare());
    this.muteBtn.addEventListener('click', () => this.setMuted(!this.muted, true));
  }

  setMuted(m: boolean, notify = false): void {
    this.muted = m;
    this.muteBtn.innerHTML = m ? SPEAKER_OFF : SPEAKER_ON;
    if (notify) this.hooks.onMute(m);
  }

  setShareAvailable(v: boolean): void {
    this.shareBtn.classList.toggle('hidden', !v);
  }

  get name(): string {
    return this.nameInput.value.trim().slice(0, 16);
  }

  showTitle(best: { score: number; name: string; milestone: string } | null): void {
    this.bestEl.innerHTML = best ? `Your best so far is <b>${best.score.toLocaleString('en-US')}</b>` : '';
    this.bestEl.classList.toggle('hidden', !best);
    this.title.classList.remove('hidden');
    this.death.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.root.classList.add('dim');
  }

  showHud(): void {
    this.title.classList.add('hidden');
    this.death.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.root.classList.remove('dim');
    this.lastScore = this.lastMult = this.lastLives = -1;
    this.lastSize = '';
    for (const f of this.livesEl.children) f.classList.remove('out');
  }

  hideHud(): void {
    this.hud.classList.add('hidden');
  }

  updateHud(h: HudState): void {
    // Roll the counter toward the real score so big gains tick up visibly.
    if (h.score !== this.lastScore) {
      const diff = h.score - this.lastScore;
      const step = this.lastScore < 0 ? diff : Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * 0.25));
      this.lastScore = Math.abs(step) >= Math.abs(diff) ? h.score : this.lastScore + step;
      this.scoreEl.textContent = this.lastScore.toLocaleString('en-US');
    }
    if (h.multiplier !== this.lastMult) {
      this.multEl.textContent = `x${h.multiplier}`;
      this.multEl.classList.toggle('hot', h.multiplier >= 4);
      this.multEl.classList.remove('bump');
      void this.multEl.offsetWidth;
      this.multEl.classList.add('bump');
      this.lastMult = h.multiplier;
    }
    this.comboEl.style.transform = `scaleX(${Math.max(0, Math.min(1, h.comboFrac))})`;
    this.comboEl.classList.toggle('urgent', h.comboFrac > 0 && h.comboFrac < 0.3 && h.multiplier > 1);
    this.chargeEl.classList.toggle('on', h.charge > 0);
    if (h.charge > 0) (this.chargeEl.querySelector('b') as HTMLElement).style.transform = `scaleX(${h.charge.toFixed(3)})`;
    if (h.lives !== this.lastLives) {
      const flames = this.livesEl.children;
      for (let i = 0; i < flames.length; i++) flames[i].classList.toggle('out', i >= h.lives);
      if (h.lives > this.lastLives && this.lastLives > 0) {
        const back = flames[h.lives - 1];
        back.classList.remove('back');
        void (back as HTMLElement).offsetWidth;
        back.classList.add('back');
      }
      this.livesEl.classList.toggle('last', h.lives === 1);
      this.lastLives = h.lives;
    }
    if (h.milestone !== this.lastSize) {
      const pill = this.sizeEl.firstElementChild as HTMLElement;
      pill.querySelector('b')!.textContent = h.milestone;
      if (this.lastSize) {
        pill.classList.remove('swell');
        void pill.offsetWidth;
        pill.classList.add('swell');
      }
      this.lastSize = h.milestone;
    }
  }

  /** Quick pulse on the score when something is eaten. */
  bumpScore(): void {
    this.scoreEl.classList.remove('bump');
    void this.scoreEl.offsetWidth;
    this.scoreEl.classList.add('bump');
  }

  private markers: HTMLDivElement[] = [];
  /** Edge-of-screen markers for threats that are off camera. `pts` are NDC x/y and whether they're in front. */
  updateMarkers(pts: { x: number; y: number; front: boolean }[]): void {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    const pad = 28;
    let used = 0;
    for (const p of pts) {
      let nx = p.front ? p.x : -p.x;
      let ny = p.front ? p.y : -p.y;
      const onScreen = p.front && Math.abs(nx) < 0.95 && Math.abs(ny) < 0.95;
      if (onScreen) continue;
      // Project onto the screen edge.
      const m = Math.max(Math.abs(nx), Math.abs(ny)) || 1;
      nx /= m; ny /= m;
      const sx = (nx * 0.5 + 0.5) * w, sy = (-ny * 0.5 + 0.5) * h;
      const cx = Math.min(w - pad, Math.max(pad, sx)), cy = Math.min(h - pad, Math.max(pad, sy));
      const ang = Math.atan2(sy - h / 2, sx - w / 2);
      let el = this.markers[used];
      if (!el) {
        el = document.createElement('div');
        el.className = 'marker';
        el.innerHTML = '<i></i><span></span>';
        this.root.appendChild(el);
        this.markers[used] = el;
      }
      el.style.transform = `translate(-50%,-50%) translate(${cx}px,${cy}px)`;
      (el.firstElementChild as HTMLElement).style.transform = `rotate(${ang}rad)`;
      el.classList.add('on');
      used++;
      if (used >= 6) break;
    }
    for (let i = used; i < this.markers.length; i++) this.markers[i].classList.remove('on');
  }

  flashMilestone(label: string): void {
    this.flash("You're now as big as", label);
  }

  /** A short centred callout: a small lead line and a big spooky word. */
  flash(small: string, big: string): void {
    this.banner.innerHTML = `<div class="ms"><small>${small}</small><b>${big}</b></div>`;
    this.banner.classList.remove('on');
    void this.banner.offsetWidth; // restart the animation
    this.banner.classList.add('on');
  }

  showDeath(pngUrl: string, stats: RunStats, isBest: boolean): void {
    this.stoneImg.src = pngUrl;
    this.deathTitle.textContent = isBest && stats.score > 0 ? 'New best' : 'Game over';
    this.hud.classList.add('hidden');
    this.death.classList.remove('hidden');
    this.root.classList.add('dim');
  }
}
