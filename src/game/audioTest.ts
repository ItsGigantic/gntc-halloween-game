import { AudioEngine } from './synth';
import { Music } from './music';
import { SOUNDS } from './audio';

/**
 * Offline audio test: renders every effect and a stretch of music through an
 * OfflineAudioContext and reports levels. Nothing is played through speakers.
 */
export interface LevelReport {
  name: string;
  peakDb: number;
  rmsDb: number;
  seconds: number;
  clipped: boolean;
  /** Share of energy above ~2 kHz (0..1): a crude sharpness score. */
  bright: number;
}

function analyse(buf: AudioBuffer, name: string): LevelReport {
  let peak = 0, sum = 0, hiSum = 0, n = 0, lastLoud = 0;
  // One-pole highpass near 2 kHz for the brightness share.
  const rc = 1 / (2 * Math.PI * 2000);
  const dt = 1 / buf.sampleRate;
  const alpha = rc / (rc + dt);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    let prevIn = 0, prevOut = 0;
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
      sum += v * v;
      const hp = alpha * (prevOut + d[i] - prevIn);
      prevIn = d[i];
      prevOut = hp;
      hiSum += hp * hp;
      n++;
      if (v > 0.001) lastLoud = Math.max(lastLoud, i);
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -120);
  return { name, peakDb: +db(peak).toFixed(1), rmsDb: +db(rms).toFixed(1), seconds: +(lastLoud / buf.sampleRate).toFixed(2), clipped: peak >= 0.999, bright: +(sum > 0 ? hiSum / sum : 0).toFixed(2) };
}

async function render(name: string, seconds: number, master: number, fn: (e: AudioEngine) => void): Promise<LevelReport> {
  const ctx = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  const e = new AudioEngine(ctx, master);
  fn(e);
  const buf = await ctx.startRendering();
  return analyse(buf, name);
}

export async function runAudioTest(master: number): Promise<LevelReport[]> {
  const out: LevelReport[] = [];
  const sfxCases: [string, (e: AudioEngine) => void][] = [
    ['pickup combo 0', (e) => SOUNDS.pickup(e, 0.05, 0)],
    ['pickup combo 20', (e) => SOUNDS.pickup(e, 0.05, 20)],
    ['pickup x8 burst (10 in 0.5s)', (e) => { for (let i = 0; i < 10; i++) SOUNDS.pickup(e, 0.05 + i * 0.05, i * 3); }],
    ['bigPickup', (e) => SOUNDS.bigPickup(e, 0.05)],
    ['comboUp', (e) => SOUNDS.comboUp(e, 0.05, 4)],
    ['crunch', (e) => SOUNDS.crunch(e, 0.05)],
    ['hit', (e) => SOUNDS.hit(e, 0.05)],
    ['milestone', (e) => SOUNDS.milestone(e, 0.05)],
    ['ghost', (e) => SOUNDS.ghost(e, 0.05)],
    ['click', (e) => SOUNDS.click(e, 0.05)],
    ['rise', (e) => SOUNDS.rise(e, 0.05)],
    ['land', (e) => SOUNDS.land(e, 0.05)],
  ];
  for (const [name, fn] of sfxCases) out.push(await render(name, 3, master, fn));
  out.push(await render('music 8 bars (quiet)', 18, master, (e) => { const m = new Music(e); e.music.gain.value = 0.6; m.fill(0.05, 8); }));
  out.push(await render('music 8 bars + full arp', 18, master, (e) => { const m = new Music(e); e.music.gain.value = 0.6; m.setIntensity(1); m.fill(0.05, 8); }));
  out.push(await render('death motif', 4, master, (e) => { const m = new Music(e); m.deathMotif(0.05); }));
  out.push(await render('everything at once (music + 6 sfx)', 6, master, (e) => {
    const m = new Music(e); e.music.gain.value = 0.6; m.setIntensity(1); m.fill(0.05, 3);
    SOUNDS.bigPickup(e, 0.5); SOUNDS.milestone(e, 0.6); SOUNDS.hit(e, 1.0); SOUNDS.comboUp(e, 1.2, 6); SOUNDS.pickup(e, 1.3, 10); SOUNDS.ghost(e, 1.4);
  }));
  return out;
}
