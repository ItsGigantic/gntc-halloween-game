import { AudioEngine, midi } from './synth';

/**
 * A procedural loop: a slow waltz in A minor for music box, soft pad, plucked bass and a
 * whisper of theremin. Scheduled a little ahead of time so it survives frame hitches; the
 * same scheduler can fill an OfflineAudioContext for testing.
 */
const BPM_MIN = 72;
const BPM_MAX = 104;

// Eight-bar phrase. Melody as [midi, beatsLong] triples per bar (3 beats), bass root per bar, chord tones per bar.
const PHRASE = [
  { chord: [57, 60, 64], bass: 45, mel: [[69, 1], [72, 1], [76, 1]] },
  { chord: [57, 60, 64], bass: 45, mel: [[76, 1], [74, 1], [72, 1]] },
  { chord: [53, 57, 60], bass: 41, mel: [[65, 1], [69, 1], [72, 1]] },
  { chord: [53, 57, 60], bass: 41, mel: [[72, 1], [74, 1], [72, 1]] },
  { chord: [50, 53, 57], bass: 38, mel: [[74, 1], [77, 1], [81, 1]] },
  { chord: [50, 53, 57], bass: 38, mel: [[81, 1], [79, 1], [77, 1]] },
  { chord: [52, 56, 59], bass: 40, mel: [[76, 1], [71, 1], [68, 1]] },
  { chord: [52, 56, 59], bass: 40, mel: [[71, 3]] },
];

export class Music {
  private nextBar = 0;       // index into the endless bar stream
  private nextTime = 0;      // ctx time of the next bar
  private timer: number | null = null;
  private intensity = 0;
  private arpGain: GainNode;
  private playing = false;
  private bpm = BPM_MIN;
  private bpmTarget = BPM_MIN;
  /** Star power: the waltz races and the arp line comes in full while it lasts. */
  private starMode = false;

  /** Multiplier on the bed level: soft on the title screen, full in play. */
  private mult = 1;

  constructor(private engine: AudioEngine, private level = 0.6) {
    this.arpGain = engine.ctx.createGain();
    this.arpGain.gain.value = 0;
    this.arpGain.connect(engine.music);
  }

  /** 0..1 growth progress: the waltz starts slow and builds, never racing; shrinking eases it back. */
  setProgress(p: number): void {
    const k = Math.pow(Math.max(0, Math.min(1, p)), 0.8);
    this.bpmTarget = BPM_MIN + (BPM_MAX - BPM_MIN) * k;
  }

  private beat(): number {
    return 60 / this.bpm;
  }

  setStar(on: boolean): void {
    if (this.starMode === on) return;
    this.starMode = on;
    const t = this.engine.ctx.currentTime;
    this.arpGain.gain.cancelScheduledValues(t);
    this.arpGain.gain.setTargetAtTime(on ? 1 : this.intensity * 0.8, t, 0.25);
  }

  /** 0..1: adds a sparkling counter line as the combo heats up. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    const t = this.engine.ctx.currentTime;
    this.arpGain.gain.cancelScheduledValues(t);
    this.arpGain.gain.setTargetAtTime(this.intensity * 0.8, t, 0.6);
  }

  start(at = this.engine.ctx.currentTime + 0.1): void {
    if (this.playing) return;
    this.playing = true;
    this.nextTime = at;
    this.engine.music.gain.cancelScheduledValues(at);
    this.engine.music.gain.setValueAtTime(0.0001, at);
    this.engine.music.gain.exponentialRampToValueAtTime(this.level * this.mult, at + 2.5);
    if (typeof window !== 'undefined') this.timer = window.setInterval(() => this.pump(), 60);
  }

  /** Fade the bed to a fraction of its full level (0.45 on the title screen, 1 in play). */
  setLevel(mult: number, seconds = 1.5): void {
    this.mult = mult;
    if (!this.playing) return;
    const g = this.engine.music.gain;
    const t = this.engine.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.exponentialRampToValueAtTime(Math.max(0.0001, this.level * mult), t + seconds);
  }

  stop(fade = 1.2): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const t = this.engine.ctx.currentTime;
    this.engine.music.gain.cancelScheduledValues(t);
    this.engine.music.gain.setValueAtTime(this.engine.music.gain.value, t);
    this.engine.music.gain.exponentialRampToValueAtTime(0.0001, t + fade);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Keep ~0.5 s of music queued. */
  private pump(): void {
    const ahead = this.engine.ctx.currentTime + 0.5;
    while (this.nextTime < ahead) {
      // Ease the tempo one bar at a time so changes are musical rather than sudden.
      const target = this.starMode ? Math.min(BPM_MAX * 1.45, this.bpmTarget * 1.45) : this.bpmTarget;
      this.bpm += (target - this.bpm) * (this.starMode ? 0.7 : 0.35);
      this.scheduleBar(this.nextBar++, this.nextTime);
      this.nextTime += this.beat() * 3;
    }
  }

  /** Fill `bars` bars starting at `t` (used by the offline test). */
  fill(t: number, bars: number): number {
    let at = t;
    for (let i = 0; i < bars; i++) {
      this.scheduleBar(i, at);
      at += this.beat() * 3;
    }
    return at;
  }

  private scheduleBar(index: number, t: number): void {
    const e = this.engine;
    const BEAT = this.beat();
    const BAR = BEAT * 3;
    const bar = PHRASE[index % PHRASE.length];
    const pass = Math.floor(index / PHRASE.length);
    const octave = pass % 2 === 1 ? 12 : 0; // second time through, the box plays an octave up
    // Bass: a soft pluck on beat one.
    e.note(e.music, midi(bar.bass), t, { type: 'triangle', attack: 0.01, decay: 0.5, gain: 0.22, cutoff: 500 });
    // Pad: chord tones on beats two and three, breathy and quiet.
    for (const beat of [1, 2]) {
      for (const n of bar.chord) {
        e.note(e.music, midi(n), t + beat * BEAT, { type: 'triangle', attack: 0.06, decay: 0.3, gain: 0.045, cutoff: 900, detune: (n % 2 ? 4 : -4) });
      }
      // Tiny woodblock tick under the pad.
      e.noise(e.music, t + beat * BEAT, { gain: 0.035, decay: 0.03, cutoff: 2600, highpass: 1200 });
    }
    // Melody: music box (sine + a quiet octave partial).
    let bt = t;
    for (const [n, len] of bar.mel) {
      e.note(e.music, midi(n + octave), bt, { type: 'sine', attack: 0.004, decay: 0.9 * len, gain: 0.2, pan: 0.15 });
      e.note(e.music, midi(n + octave + 12), bt, { type: 'sine', attack: 0.004, decay: 0.35, gain: 0.05, pan: 0.15 });
      bt += len * BEAT;
    }
    // Arpeggio layer (combo): eighth-note chord tones, gated by arpGain.
    for (let k = 0; k < 6; k++) {
      const n = bar.chord[k % bar.chord.length] + 24;
      e.note(this.arpGain, midi(n), t + k * (BEAT / 2), { type: 'sine', attack: 0.003, decay: 0.18, gain: 0.12, pan: -0.25 });
    }
    // Theremin whisper every four bars: a long, wavering note gliding down a semitone.
    if (index % 4 === 0) {
      e.note(e.music, midi(81), t, { type: 'sine', attack: 0.8, decay: 0.5, sustain: 0.8, hold: BAR * 2, release: 1.2, gain: 0.03, vibratoHz: 5.5, vibratoCents: 18, glideTo: midi(80), pan: -0.4 });
    }
  }

  /** Four falling notes for the end of a run. */
  deathMotif(at = this.engine.ctx.currentTime + 0.05): void {
    const e = this.engine;
    const seq = [76, 72, 68, 64];
    seq.forEach((n, i) => e.note(e.sfx, midi(n), at + i * 0.32, { type: 'sine', attack: 0.01, decay: 0.7, gain: 0.16, pan: (i - 1.5) * 0.2 }));
    e.note(e.sfx, midi(40), at + 1.3, { type: 'triangle', attack: 0.02, decay: 1.6, gain: 0.14, cutoff: 400 });
  }
}

