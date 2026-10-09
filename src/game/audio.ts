import { AudioEngine, midi } from './synth';
import { Music } from './music';

/**
 * Game audio: a tiny synth kit, a procedural music loop and a handful of soft, rounded
 * effects. Everything is quiet by design; the master sits well below full scale.
 */
class AudioBus {
  private engine: AudioEngine | null = null;
  music: Music | null = null;
  muted = false;
  /** Master volume. Keep low: these are small, cute sounds, not a soundtrack blast. */
  readonly master = 0.3;

  constructor() {
    try {
      this.muted = localStorage.getItem('gg.muted') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  /** Must be called from a user gesture at least once (browser autoplay policy). */
  unlock(): void {
    if (!this.engine) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.engine = new AudioEngine(ctx, this.muted ? 0 : this.master);
      this.music = new Music(this.engine);
    }
    const ctx = this.engine.ctx as AudioContext;
    if (ctx.state === 'suspended') void ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.engine) {
      const t = this.engine.ctx.currentTime;
      this.engine.master.gain.cancelScheduledValues(t);
      this.engine.master.gain.setTargetAtTime(m ? 0 : this.master, t, 0.05);
    }
    try {
      localStorage.setItem('gg.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  get ready(): boolean {
    return !!this.engine && !this.muted;
  }

  /** The engine, for effects and for the offline test harness. */
  get e(): AudioEngine | null {
    return this.engine;
  }
}

export const audio = new AudioBus();

/** Effect definitions as functions of (engine, time) so the same code renders offline. */
export const SOUNDS = {
  /**
   * Candy plink. Three layers make it read as "got something": a tiny soft contact tick, a sine
   * body, and a quieter perfect fifth. The pitch climbs a pentatonic scale with the combo so a
   * streak plays a little melody, with a few cents of drift so repeats don't sound stamped.
   */
  pickup(e: AudioEngine, t: number, combo = 0): void {
    const scale = [0, 2, 4, 7, 9, 12];
    const n = 65 + scale[Math.min(scale.length - 1, Math.floor(combo / 3))];
    const drift = (Math.random() - 0.5) * 10;
    e.noise(e.sfx, t, { gain: 0.05, decay: 0.018, cutoff: 1600 });
    e.note(e.sfx, midi(n), t, { type: 'sine', attack: 0.002, decay: 0.3, gain: 0.16, detune: drift, pan: 0.08 });
    e.note(e.sfx, midi(n + 7), t + 0.004, { type: 'sine', attack: 0.002, decay: 0.18, gain: 0.05, detune: drift });
    e.note(e.sfx, midi(n - 12), t, { type: 'triangle', attack: 0.004, decay: 0.12, gain: 0.05, cutoff: 1000 });
  },
  /** Bigger bite: the same voice, lower and longer, resolving up a fourth. */
  bigPickup(e: AudioEngine, t: number): void {
    e.noise(e.sfx, t, { gain: 0.06, decay: 0.02, cutoff: 1200 });
    e.note(e.sfx, midi(62), t, { type: 'sine', attack: 0.003, decay: 0.42, gain: 0.19 });
    e.note(e.sfx, midi(69), t, { type: 'sine', attack: 0.003, decay: 0.3, gain: 0.07 });
    e.note(e.sfx, midi(67), t + 0.12, { type: 'sine', attack: 0.003, decay: 0.6, gain: 0.17 });
    e.note(e.sfx, midi(74), t + 0.12, { type: 'sine', attack: 0.003, decay: 0.4, gain: 0.06 });
    e.note(e.sfx, midi(50), t, { type: 'triangle', attack: 0.006, decay: 0.3, gain: 0.07, cutoff: 800 });
  },
  /** Multiplier step: a quick rising triad, mid register. */
  comboUp(e: AudioEngine, t: number, step = 2): void {
    const base = 64 + Math.min(8, step * 2);
    [0, 4, 7].forEach((iv, i) => e.note(e.sfx, midi(base + iv), t + i * 0.06, { type: 'sine', attack: 0.008, decay: 0.32, gain: 0.12 }));
  },
  /** Crunch (crushing a skull when huge): a short low thud with a little grit. */
  crunch(e: AudioEngine, t: number): void {
    e.note(e.sfx, midi(45), t, { type: 'triangle', attack: 0.006, decay: 0.18, gain: 0.18, cutoff: 600, glideTo: midi(38) });
    e.noise(e.sfx, t, { gain: 0.06, decay: 0.07, cutoff: 900 });
  },
  /** Skull hit: a soft "bop" and a sad little downward bend. Rounded, not harsh. */
  hit(e: AudioEngine, t: number): void {
    e.note(e.sfx, midi(50), t, { type: 'triangle', attack: 0.006, decay: 0.24, gain: 0.2, cutoff: 550, glideTo: midi(43) });
    e.note(e.sfx, midi(64), t + 0.05, { type: 'sine', attack: 0.015, decay: 0.5, gain: 0.1, glideTo: midi(58) });
    e.noise(e.sfx, t, { gain: 0.04, decay: 0.05, cutoff: 700 });
  },
  /** Milestone: a gentle upward arpeggio, warm register. */
  milestone(e: AudioEngine, t: number): void {
    // Power-up: a quick climbing run (the mushroom feel), then the chord blooms and hangs.
    [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => e.note(e.sfx, midi(n), t + i * 0.045, { type: 'triangle', attack: 0.004, decay: 0.16, gain: 0.09, cutoff: 3200, pan: (i - 3) * 0.08 }));
    [62, 65, 69, 74, 77].forEach((n, i) => e.note(e.sfx, midi(n), t + 0.32 + i * 0.07, { type: 'sine', attack: 0.01, decay: 0.6 + i * 0.08, gain: 0.11, pan: (i - 2) * 0.15 }));
    e.note(e.sfx, midi(50), t + 0.32, { type: 'sine', attack: 0.02, decay: 0.9, gain: 0.07 });
  },
  /** Ghost arrives: an airy wobble, barely there. */
  ghost(e: AudioEngine, t: number): void {
    e.note(e.sfx, midi(69), t, { type: 'sine', attack: 0.3, decay: 0.3, sustain: 0.7, hold: 0.5, release: 0.6, gain: 0.1, vibratoHz: 6, vibratoCents: 30, glideTo: midi(67), pan: -0.3 });
  },
  /** UI tick: a soft, dull tap. */
  click(e: AudioEngine, t: number): void {
    e.note(e.sfx, midi(72), t, { type: 'sine', attack: 0.006, decay: 0.07, gain: 0.08 });
    e.note(e.sfx, midi(60), t, { type: 'triangle', attack: 0.006, decay: 0.05, gain: 0.04, cutoff: 800 });
  },
  /** Something rose out of the ground. */
  rise(e: AudioEngine, t: number): void {
    e.note(e.sfx, midi(48), t, { type: 'triangle', attack: 0.02, decay: 0.3, gain: 0.07, cutoff: 500, glideTo: midi(55) });
    e.noise(e.sfx, t, { gain: 0.03, decay: 0.12, cutoff: 500 });
  },
  /** Golden shield: a quick shimmer up the scale and a warm held chord. */
  power(e: AudioEngine, t: number): void {
    [57, 60, 64, 67, 69, 72, 76, 79, 81, 84].forEach((n, i) => e.note(e.sfx, midi(n), t + i * 0.038, { type: 'triangle', attack: 0.004, decay: 0.22, gain: 0.08, cutoff: 3600, pan: (i - 5) * 0.06 }));
    [57, 64, 69, 76].forEach((n, i) => e.note(e.sfx, midi(n), t + 0.4, { type: 'sine', attack: 0.02, decay: 1.1 + i * 0.1, gain: 0.09, pan: (i - 1.5) * 0.2 }));
  },
  /** Hop: a quick soft upward boop. */
  hop(e: AudioEngine, t: number): void {
    e.note(e.sfx, midi(60), t, { type: 'sine', attack: 0.004, decay: 0.14, gain: 0.1, glideTo: midi(67) });
  },
  /** Candy drop lands. */
  land(e: AudioEngine, t: number): void {
    e.note(e.sfx, midi(60), t, { type: 'sine', attack: 0.006, decay: 0.1, gain: 0.05 });
  },
};

function now(): number {
  return audio.e ? audio.e.ctx.currentTime + 0.01 : 0;
}

export const sfx = {
  pickup(combo: number, big = false): void {
    if (!audio.ready) return;
    big ? SOUNDS.bigPickup(audio.e!, now()) : SOUNDS.pickup(audio.e!, now(), combo);
  },
  comboUp(step: number): void {
    if (audio.ready) SOUNDS.comboUp(audio.e!, now(), step);
  },
  crunch(): void {
    if (audio.ready) SOUNDS.crunch(audio.e!, now());
  },
  bonk(): void {
    if (audio.ready) SOUNDS.hit(audio.e!, now());
  },
  milestone(): void {
    if (audio.ready) SOUNDS.milestone(audio.e!, now());
  },
  death(): void {
    // Music lifecycle must not depend on mute: a muted player can unmute on the game-over screen.
    if (audio.music) {
      audio.music.stop(0.9);
      if (audio.ready) audio.music.deathMotif();
    }
  },
  ghost(): void {
    if (audio.ready) SOUNDS.ghost(audio.e!, now());
  },
  click(): void {
    if (audio.ready) SOUNDS.click(audio.e!, now());
  },
  rise(): void {
    if (audio.ready) SOUNDS.rise(audio.e!, now());
  },
  land(): void {
    if (audio.ready) SOUNDS.land(audio.e!, now());
  },
  hop(): void {
    if (audio.ready) SOUNDS.hop(audio.e!, now());
  },
  power(): void {
    if (audio.ready) SOUNDS.power(audio.e!, now());
  },
};

export const musicControl = {
  start(): void {
    if (audio.music && !audio.music.isPlaying) audio.music.start();
  },
  stop(): void {
    audio.music?.stop();
  },
  intensity(v: number): void {
    audio.music?.setIntensity(v);
  },
  level(mult: number, seconds = 1.5): void {
    audio.music?.setLevel(mult, seconds);
  },
  star(on: boolean): void {
    audio.music?.setStar(on);
  },
  progress(p: number): void {
    audio.music?.setProgress(p);
  },
};
