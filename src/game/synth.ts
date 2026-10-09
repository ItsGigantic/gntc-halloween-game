/**
 * Tiny Web Audio instrument kit. Everything in the game is synthesised from oscillators and
 * noise, so there are no audio files and every sound can be rendered offline for testing.
 */
export interface NoteOpts {
  type?: OscillatorType;
  attack?: number;   // seconds
  decay?: number;    // seconds to fall to the sustain level
  sustain?: number;  // 0..1 of peak
  release?: number;  // seconds after `hold`
  hold?: number;     // seconds at sustain
  gain?: number;     // peak gain
  detune?: number;   // cents
  cutoff?: number;   // lowpass Hz
  q?: number;
  vibratoHz?: number;
  vibratoCents?: number;
  pan?: number;      // -1..1
  glideTo?: number;  // Hz to glide to over the note
}

export class AudioEngine {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly music: GainNode;
  readonly sfx: GainNode;
  private reverb: ConvolverNode;
  private reverbSend: GainNode;

  constructor(ctx: BaseAudioContext, masterGain = 1) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = masterGain;
    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music.gain.value = 1;
    this.sfx.gain.value = 1.6;
    // A short, dark hall so plinks and pads sit in the same space.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = AudioEngine.impulse(ctx, 1.9, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.28;
    // Effects pass through a soft lowpass so nothing pokes; the reverb tail is darkened the same way.
    const sfxTone = ctx.createBiquadFilter();
    sfxTone.type = 'lowpass';
    sfxTone.frequency.value = 2600;
    sfxTone.Q.value = 0.5;
    this.sfx.connect(sfxTone);
    sfxTone.connect(this.master);
    sfxTone.connect(this.reverbSend);
    this.music.connect(this.master);
    this.music.connect(this.reverbSend);
    const tailTone = ctx.createBiquadFilter();
    tailTone.type = 'lowpass';
    tailTone.frequency.value = 2200;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(tailTone);
    tailTone.connect(this.master);
    this.master.connect(ctx.destination);
  }

  static impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** One enveloped oscillator note on a bus. Returns the end time. */
  note(bus: GainNode, freq: number, t: number, o: NoteOpts = {}): number {
    const ctx = this.ctx;
    const attack = o.attack ?? 0.005, decay = o.decay ?? 0.12, sustain = o.sustain ?? 0, hold = o.hold ?? 0, release = o.release ?? 0.15;
    const peak = o.gain ?? 0.2;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    const end = t + attack + decay + hold + release;
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, end);
    let node: AudioNode = osc;
    if (o.vibratoHz) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.vibratoHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = o.vibratoCents ?? 8;
      lfo.connect(lfoGain).connect(osc.detune);
      lfo.start(t);
      lfo.stop(end + 0.05);
    }
    if (o.cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.cutoff;
      f.Q.value = o.q ?? 0.7;
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0005, peak * Math.max(sustain, 0.001)), t + attack + decay);
    if (hold > 0) g.gain.setValueAtTime(Math.max(0.0005, peak * Math.max(sustain, 0.001)), t + attack + decay + hold);
    g.gain.exponentialRampToValueAtTime(0.0005, end);
    node.connect(g);
    if (o.pan !== undefined && 'createStereoPanner' in ctx) {
      const p = (ctx as AudioContext).createStereoPanner();
      p.pan.value = o.pan;
      g.connect(p).connect(bus);
    } else {
      g.connect(bus);
    }
    osc.start(t);
    osc.stop(end + 0.05);
    return end;
  }

  /** A short filtered noise burst (ticks, puffs, dust). */
  noise(bus: GainNode, t: number, o: { gain?: number; decay?: number; cutoff?: number; highpass?: number; q?: number } = {}): void {
    const ctx = this.ctx;
    const decay = o.decay ?? 0.08;
    const len = Math.floor(ctx.sampleRate * (decay + 0.02));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 99;
    for (let i = 0; i < len; i++) d[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let node: AudioNode = src;
    if (o.highpass) {
      const h = ctx.createBiquadFilter();
      h.type = 'highpass';
      h.frequency.value = o.highpass;
      node.connect(h);
      node = h;
    }
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.cutoff ?? 1800;
    f.Q.value = o.q ?? 0.8;
    node.connect(f);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    f.connect(g).connect(bus);
    src.start(t);
    src.stop(t + decay + 0.02);
  }
}

export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
