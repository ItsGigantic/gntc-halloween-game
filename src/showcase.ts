// URL flags for the showcase/capture mode and debugging. All default off.
const q = new URLSearchParams(location.search);
const bool = (k: string) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) || d : d);

export const FLAGS = {
  showcase: bool('showcase'),
  autopilot: bool('autopilot'),
  debug: bool('debug'),
  stats: bool('stats'),
  mute: bool('mute'),
  card: bool('card'),
  stone: q.get('stone') ?? 'grave_A',
  map: ((q.get('map') ?? 'a').toLowerCase() === 'b' ? 'b' : 'a') as 'a' | 'b',
  overhead: bool('overhead'),
  /** Render the Open Graph image and show it instead of the game. */
  og: bool('og'),
  timescale: num('timescale', 1),
  seed: num('seed', 0),
  aspect: (q.get('aspect') ?? '') as '' | '1:1' | '4:5' | '16:9' | '9:16',
};

export function aspectRatio(): number | null {
  const m = /^(\d+):(\d+)$/.exec(FLAGS.aspect);
  return m ? Number(m[1]) / Number(m[2]) : null;
}
