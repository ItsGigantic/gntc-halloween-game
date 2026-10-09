import { model } from '../assets/loader';

export type Kind = 'candy' | 'prop' | 'skull' | 'scenery' | 'power';

export interface ItemDef {
  name: string;
  kind: Kind;
  /** Rough tier for spawning / regrowth. */
  tier: 0 | 1 | 2 | 3 | 4;
  points: number;
  /** Spawn weight within its tier. */
  weight: number;
  /** Override pickup radius (metres) when the bounding sphere is misleading. */
  pickRadius?: number;
  /** Override blocking radius (trees have thin trunks). */
  collideRadius?: number;
  /** Multiplier on volume gained (candy is "denser" so early growth feels good). */
  volumeMul?: number;
  /** Uniform scale applied to the model. */
  scale?: number;
  /** Sink the model this far into the ground (half-buried rocks). */
  sink?: number;
}

const candyNames = [
  'candy_blue_A', 'candy_blue_B', 'candy_brown_A', 'candy_brown_B', 'candy_brown_C',
  'candy_green_A', 'candy_green_B', 'candy_green_C', 'candy_orange_A', 'candy_orange_B',
  'candy_orange_C', 'candy_pink_A', 'candy_pink_B', 'candy_purple_A', 'candy_purple_B',
];
const lollipopNames = ['lollipop_blue', 'lollipop_brown', 'lollipop_green', 'lollipop_orange', 'lollipop_pink', 'lollipop_purple'];

export const ITEMS: ItemDef[] = [
  ...candyNames.map((name): ItemDef => ({ name, kind: 'candy', tier: 0, points: 10, weight: 3, pickRadius: 0.28, volumeMul: 2.4, scale: 0.6 })),
  { name: 'candycorn', kind: 'candy', tier: 0, points: 5, weight: 4, pickRadius: 0.16, volumeMul: 4, scale: 0.7 },
  ...lollipopNames.map((name): ItemDef => ({ name, kind: 'candy', tier: 0, points: 15, weight: 1.2, pickRadius: 0.3, volumeMul: 2.4, scale: 0.6 })),
  { name: 'bone_A', kind: 'prop', tier: 0, points: 5, weight: 0.8, pickRadius: 0.3 },
  { name: 'bone_B', kind: 'prop', tier: 0, points: 5, weight: 0.8, pickRadius: 0.28 },
  { name: 'bone_C', kind: 'prop', tier: 0, points: 5, weight: 0.6, pickRadius: 0.36 },
  // T1
  { name: 'candle', kind: 'prop', tier: 1, points: 10, weight: 2, pickRadius: 0.36, scale: 0.55 },
  { name: 'candle_melted', kind: 'prop', tier: 1, points: 10, weight: 1.5, pickRadius: 0.32, scale: 0.55 },
  { name: 'candle_thin', kind: 'prop', tier: 1, points: 10, weight: 1.5, pickRadius: 0.34, scale: 0.6 },
  { name: 'candle_triple', kind: 'prop', tier: 1, points: 20, weight: 1, pickRadius: 0.42, scale: 0.6 },
  { name: 'lantern_standing', kind: 'prop', tier: 1, points: 25, weight: 1.2, pickRadius: 0.5, scale: 0.7 },
  { name: 'pumpkin_orange_small', kind: 'prop', tier: 1, points: 20, weight: 2.5, pickRadius: 0.4 },
  { name: 'pumpkin_yellow_small', kind: 'prop', tier: 1, points: 20, weight: 2, pickRadius: 0.4 },
  { name: 'pumpkin_orange', kind: 'prop', tier: 1, points: 30, weight: 2, pickRadius: 0.62 },
  { name: 'pumpkin_yellow', kind: 'prop', tier: 1, points: 30, weight: 1.5, pickRadius: 0.62 },
  { name: 'pumpkin_yellow_jackolantern', kind: 'prop', tier: 1, points: 60, weight: 0.7, pickRadius: 0.85 },
  { name: 'candy_bucket_A', kind: 'candy', tier: 1, points: 100, weight: 0.6, pickRadius: 0.55, volumeMul: 2, scale: 0.65 },
  { name: 'candy_bucket_B', kind: 'candy', tier: 1, points: 100, weight: 0.6, pickRadius: 0.6, volumeMul: 2, scale: 0.65 },
  { name: 'candy_bucket_A_decorated', kind: 'candy', tier: 1, points: 150, weight: 0.3, pickRadius: 0.65, volumeMul: 2, scale: 0.65 },
  { name: 'candy_bucket_B_decorated', kind: 'candy', tier: 1, points: 150, weight: 0.3, pickRadius: 0.7, volumeMul: 2, scale: 0.65 },
  { name: 'skull', kind: 'skull', tier: 1, points: 0, weight: 1, pickRadius: 0.5, scale: 0.55 },
  { name: 'skull_candle', kind: 'skull', tier: 1, points: 0, weight: 0.4, pickRadius: 0.55, scale: 0.6 },
  { name: 'ribcage', kind: 'skull', tier: 1, points: 0, weight: 0.3, pickRadius: 0.5, scale: 0.7 },
  // T2
  { name: 'gravestone', kind: 'prop', tier: 2, points: 60, weight: 2, pickRadius: 1.0 },
  { name: 'gravemarker_A', kind: 'prop', tier: 2, points: 40, weight: 1.5, pickRadius: 0.7 },
  { name: 'gravemarker_B', kind: 'prop', tier: 2, points: 40, weight: 1.5, pickRadius: 0.7 },
  { name: 'grave_A', kind: 'prop', tier: 2, points: 80, weight: 1.5, pickRadius: 1.4 },
  { name: 'grave_B', kind: 'prop', tier: 2, points: 80, weight: 1.5, pickRadius: 1.4 },
  { name: 'grave_A_destroyed', kind: 'prop', tier: 2, points: 80, weight: 1, pickRadius: 1.4 },
  { name: 'bench', kind: 'prop', tier: 2, points: 50, weight: 1, pickRadius: 1.0, scale: 1.4 },
  { name: 'bench_decorated', kind: 'prop', tier: 2, points: 90, weight: 0.6, pickRadius: 1.2, scale: 1.4 },
  { name: 'haybale', kind: 'prop', tier: 2, points: 60, weight: 1.5, pickRadius: 1.1 },
  { name: 'pitchfork', kind: 'prop', tier: 2, points: 40, weight: 0.8, pickRadius: 0.9, scale: 1.3 },
  { name: 'sign_left', kind: 'prop', tier: 2, points: 40, weight: 0.5, pickRadius: 1.0, collideRadius: 0.3 },
  { name: 'sign_right', kind: 'prop', tier: 2, points: 40, weight: 0.5, pickRadius: 1.0, collideRadius: 0.3 },
  { name: 'sign_both', kind: 'prop', tier: 2, points: 50, weight: 0.4, pickRadius: 1.2, collideRadius: 0.3 },
  { name: 'fence_seperate', kind: 'prop', tier: 2, points: 50, weight: 0.8, pickRadius: 1.5 },
  { name: 'fence_seperate_broken', kind: 'prop', tier: 2, points: 50, weight: 0.8, pickRadius: 1.5 },
  { name: 'fence_pillar', kind: 'prop', tier: 2, points: 40, weight: 0.6, pickRadius: 0.9, collideRadius: 0.35 },
  { name: 'fence_pillar_broken', kind: 'prop', tier: 2, points: 30, weight: 0.6, pickRadius: 0.7, collideRadius: 0.35 },
  { name: 'shrine_candles', kind: 'prop', tier: 2, points: 90, weight: 0.6, pickRadius: 1.1, collideRadius: 0.6 },
  { name: 'plaque_candles', kind: 'prop', tier: 2, points: 70, weight: 0.6, pickRadius: 1.2 },
  { name: 'post_lantern', kind: 'prop', tier: 2, points: 70, weight: 0.6, pickRadius: 1.6, collideRadius: 0.3 },
  { name: 'post_skull', kind: 'prop', tier: 2, points: 70, weight: 0.5, pickRadius: 1.6, collideRadius: 0.3 },
  // T3
  { name: 'tree_dead_small', kind: 'prop', tier: 3, points: 120, weight: 1.5, pickRadius: 1.6, collideRadius: 0.35, scale: 1.5 },
  { name: 'tree_dead_medium', kind: 'prop', tier: 3, points: 160, weight: 1.2, pickRadius: 2.2, collideRadius: 0.35, scale: 1.5 },
  { name: 'scarecrow', kind: 'prop', tier: 3, points: 200, weight: 0.8, pickRadius: 1.5, collideRadius: 0.4, scale: 1.45 },
  { name: 'wagon', kind: 'prop', tier: 3, points: 250, weight: 0.6, pickRadius: 2.6 },
  { name: 'coffin', kind: 'prop', tier: 3, points: 150, weight: 0.8, pickRadius: 1.8, scale: 1.3 },
  { name: 'coffin_decorated', kind: 'prop', tier: 3, points: 180, weight: 0.5, pickRadius: 1.8, scale: 1.3 },
  { name: 'pillar', kind: 'prop', tier: 3, points: 120, weight: 0.5, pickRadius: 2.2, collideRadius: 0.5 },
  { name: 'tree_pine_orange_small', kind: 'prop', tier: 3, points: 150, weight: 1, pickRadius: 2.3, collideRadius: 0.45, scale: 1.4 },
  { name: 'tree_pine_yellow_small', kind: 'prop', tier: 3, points: 150, weight: 1, pickRadius: 2.3, collideRadius: 0.45, scale: 1.4 },
  // T4
  { name: 'tree_dead_large', kind: 'prop', tier: 4, points: 300, weight: 1, pickRadius: 2.8, collideRadius: 0.5, scale: 1.5 },
  { name: 'tree_dead_large_decorated', kind: 'prop', tier: 4, points: 400, weight: 0.6, pickRadius: 3.0, collideRadius: 0.5, scale: 1.5 },
  { name: 'tree_pine_orange_medium', kind: 'prop', tier: 4, points: 300, weight: 1, pickRadius: 3.2, collideRadius: 0.6, scale: 1.4 },
  { name: 'tree_pine_yellow_medium', kind: 'prop', tier: 4, points: 300, weight: 1, pickRadius: 3.2, collideRadius: 0.6, scale: 1.4 },
  { name: 'tree_pine_orange_large', kind: 'prop', tier: 4, points: 500, weight: 0.8, pickRadius: 4.0, collideRadius: 0.8, scale: 1.4 },
  { name: 'tree_pine_yellow_large', kind: 'prop', tier: 4, points: 500, weight: 0.8, pickRadius: 4.0, collideRadius: 0.8, scale: 1.4 },
  { name: 'tractor', kind: 'prop', tier: 4, points: 800, weight: 0.4, pickRadius: 2.6, scale: 1.3 },
  { name: 'wagon_hay', kind: 'prop', tier: 4, points: 600, weight: 0.5, pickRadius: 3.0 },
  { name: 'arch', kind: 'prop', tier: 4, points: 500, weight: 0.4, pickRadius: 3.0, collideRadius: 2.2 },
  { name: 'wooden_gate_halloween', kind: 'prop', tier: 4, points: 500, weight: 0.4, pickRadius: 3.2, collideRadius: 2.0 },
  { name: 'crypt', kind: 'prop', tier: 4, points: 2000, weight: 0.2, pickRadius: 5.4, collideRadius: 4.3 },
  // Forest Nature Pack: rounded rocks as pickups (half-buried), bushes, bare trees as big props.
  { name: 'pebble_a', kind: 'prop', tier: 0, points: 5, weight: 1, pickRadius: 0.14 },
  { name: 'pebble_b', kind: 'prop', tier: 0, points: 5, weight: 1, pickRadius: 0.14, scale: 0.4, sink: 0.25 },
  { name: 'pebble_c', kind: 'prop', tier: 0, points: 5, weight: 1, pickRadius: 0.14, scale: 0.4, sink: 0.25 },
  { name: 'rock_a', kind: 'prop', tier: 1, points: 15, weight: 1.2, pickRadius: 0.4, sink: 0.22 },
  { name: 'rock_b', kind: 'prop', tier: 1, points: 15, weight: 1.2, pickRadius: 0.4, sink: 0.22 },
  { name: 'rock_c', kind: 'prop', tier: 1, points: 15, weight: 1, pickRadius: 0.4, sink: 0.22 },
  { name: 'rock_d', kind: 'prop', tier: 1, points: 15, weight: 1, pickRadius: 0.4, sink: 0.22 },
  { name: 'rock_e', kind: 'prop', tier: 2, points: 40, weight: 1, pickRadius: 0.6, sink: 0.3 },
  { name: 'rock_f', kind: 'prop', tier: 2, points: 40, weight: 1, pickRadius: 0.6, sink: 0.3 },
  { name: 'rock_g', kind: 'prop', tier: 2, points: 60, weight: 0.8, pickRadius: 0.9, sink: 0.4 },
  { name: 'boulder_a', kind: 'prop', tier: 2, points: 90, weight: 0.7, pickRadius: 1.0, sink: 0.45 },
  { name: 'boulder_b', kind: 'prop', tier: 3, points: 150, weight: 0.6, pickRadius: 1.25, sink: 0.5 },
  { name: 'boulder_c', kind: 'prop', tier: 3, points: 150, weight: 0.6, pickRadius: 1.25, sink: 0.5 },
  { name: 'crag_a', kind: 'prop', tier: 4, points: 400, weight: 0.4, pickRadius: 2.3, sink: 0.7 },
  { name: 'crag_b', kind: 'prop', tier: 4, points: 400, weight: 0.4, pickRadius: 2.1 },
  // Dungeon Pack: farm stores, the crypt's hoard, witch's brew at the shrine, ruined masonry.
  { name: 'barrel', kind: 'prop', tier: 1, points: 30, weight: 1, pickRadius: 0.55 },
  { name: 'big_barrel', kind: 'prop', tier: 2, points: 70, weight: 0.6, pickRadius: 1.0 },
  { name: 'keg', kind: 'prop', tier: 2, points: 80, weight: 0.5, pickRadius: 1.05 },
  { name: 'crate', kind: 'prop', tier: 1, points: 30, weight: 1, pickRadius: 0.55 },
  { name: 'big_crate', kind: 'prop', tier: 2, points: 60, weight: 0.6, pickRadius: 0.8 },
  { name: 'crate_stack', kind: 'prop', tier: 3, points: 140, weight: 0.5, pickRadius: 1.2 },
  { name: 'trunk_small', kind: 'prop', tier: 1, points: 40, weight: 0.8, pickRadius: 0.36 },
  { name: 'trunk_medium', kind: 'prop', tier: 1, points: 60, weight: 0.6, pickRadius: 0.5 },
  { name: 'trunk_large', kind: 'prop', tier: 2, points: 90, weight: 0.5, pickRadius: 0.8 },
  { name: 'treasure_chest', kind: 'candy', tier: 2, points: 300, weight: 0.2, pickRadius: 0.95, volumeMul: 1.5 },
  { name: 'crypt_key', kind: 'prop', tier: 0, points: 25, weight: 0.4, pickRadius: 0.3 },
  // Power-up: a golden shield that floats in now and then (weight 0: the spawner places it by hand).
  { name: 'shield', kind: 'power', tier: 0, points: 250, weight: 0, pickRadius: 0.55, scale: 0.5 },
  { name: 'potion_a', kind: 'prop', tier: 0, points: 15, weight: 1, pickRadius: 0.25, scale: 0.7 },
  { name: 'potion_b', kind: 'prop', tier: 0, points: 15, weight: 1, pickRadius: 0.3, scale: 0.7 },
  { name: 'potion_c', kind: 'prop', tier: 1, points: 15, weight: 0.8, pickRadius: 0.36, scale: 0.7 },
  { name: 'rubble', kind: 'prop', tier: 3, points: 180, weight: 0.5, pickRadius: 1.9, collideRadius: 1.6 },
  { name: 'ruins', kind: 'prop', tier: 4, points: 500, weight: 0.3, pickRadius: 3.4, collideRadius: 3.0 },
  { name: 'bush_a', kind: 'prop', tier: 1, points: 20, weight: 1.2, pickRadius: 0.4, scale: 1.4 },
  { name: 'bush_b', kind: 'prop', tier: 1, points: 20, weight: 1.2, pickRadius: 0.4, scale: 1.4 },
  { name: 'bush_c', kind: 'prop', tier: 1, points: 20, weight: 1, pickRadius: 0.42, scale: 1.4 },
  { name: 'bush_d', kind: 'prop', tier: 1, points: 20, weight: 1, pickRadius: 0.42, scale: 1.4 },
  { name: 'bush_e', kind: 'prop', tier: 2, points: 50, weight: 0.8, pickRadius: 0.75, scale: 1.4 },
  { name: 'bare_tree_a', kind: 'prop', tier: 3, points: 120, weight: 1, pickRadius: 1.5, collideRadius: 0.3, scale: 1.5 },
  { name: 'bare_tree_b', kind: 'prop', tier: 3, points: 120, weight: 1, pickRadius: 1.5, collideRadius: 0.3, scale: 1.5 },
  { name: 'bare_tree_c', kind: 'prop', tier: 3, points: 160, weight: 0.8, pickRadius: 2.0, collideRadius: 0.3, scale: 1.5 },
  { name: 'bare_tree_d', kind: 'prop', tier: 3, points: 160, weight: 0.8, pickRadius: 2.0, collideRadius: 0.3, scale: 1.5 },
  { name: 'leafy_tree_a', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  { name: 'leafy_tree_b', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  { name: 'leafy_tree_c', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  // scenery (never picked up)
  { name: 'floor_dirt', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  { name: 'floor_dirt_grave', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  { name: 'fence', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  { name: 'fence_broken', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  { name: 'path_A', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  { name: 'path_B', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  { name: 'path_C', kind: 'scenery', tier: 0, points: 0, weight: 0 },
  { name: 'path_D', kind: 'scenery', tier: 0, points: 0, weight: 0 },
];

export const ITEM_BY_NAME = new Map(ITEMS.map((d) => [d.name, d]));

export function byTier(tier: number, kind?: Kind): ItemDef[] {
  return ITEMS.filter((d) => d.tier === tier && (kind ? d.kind === kind : d.kind !== 'scenery'));
}

/** Effective pickup radius: override or 80% of the bounding-sphere radius. */
export function pickRadiusOf(def: ItemDef): number {
  const s = def.scale ?? 1;
  return (def.pickRadius ?? model(def.name).radius * 0.8) * s;
}

export function collideRadiusOf(def: ItemDef): number {
  return def.collideRadius !== undefined ? def.collideRadius * (def.scale ?? 1) : pickRadiusOf(def) * 0.9;
}

/** Global growth factor: lower = slower growth. */
export const GROWTH = 0.55;

/** Volume added to the ball when eaten. */
export function volumeOf(def: ItemDef): number {
  const r = pickRadiusOf(def);
  return r * r * r * GROWTH * (def.volumeMul ?? 1);
}

/** Height so the model's bottom rests on the ground. */
export function restHeight(def: ItemDef): number {
  const s = def.scale ?? 1;
  return -model(def.name).box.min.y * s - (def.sink ?? 0) * s;
}

/** Size comparison milestones keyed by ball radius; each matches a model in the level (diameter = 2r in world units). */
export const MILESTONES: [number, string][] = [
  // Thresholds are the object's "equivalent radius": the larger of the radius of a sphere with
  // the model's bulk (box volume x how full the box is) and 85% of half its height, so flat
  // things count by bulk and tall thin things by height. That is how people judge "as big as".
  // Numbers from the glb bounds x catalog scale; see the comment on each line.
  [0, 'a pumpkin'],            // bulk 0.47 (the ball starts at 0.55)
  [0.7, 'a gravestone'],       // 1.4 x 1.6 x 0.4, by height 0.68
  [0.85, 'a treasure chest'],  // 1.7 x 1.3 x 1.45, bulk 0.85
  [1.05, 'a barrel'],          // big_barrel 1.8 x 2.0 x 1.8, bulk 1.05
  [1.3, 'a stack of crates'],  // 2.1 x 2.1 x 2.25, bulk 1.29
  [1.5, 'a coffin'],           // 2.6 x 1.7 x 3.9, bulk 1.52
  [2.15, 'a tractor'],         // 3.7 x 3.65 x 5.4, bulk 2.13
  [2.7, 'a dead tree'],        // tree_dead_medium 6.3 tall, by height 2.67
  [3.5, 'a pine tree'],        // tree_pine medium 8.2 tall, by height 3.49
  [4.2, 'the crypt'],          // 6 x 8 x 8, bulk 4.19
  [5.5, 'GIGANTIC'],
];

/** World units -> displayed metres (gravestone 2.2 units = 1.1 m). */
export const METRES_PER_UNIT = 0.5;

export function displaySize(radius: number): string {
  const m = radius * 2 * METRES_PER_UNIT;
  return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`;
}

/** Human label for a model name: candy_pink_A -> Pink candy. */
const LABELS: Record<string, string> = {
  candycorn: 'Candy corn', ribcage: 'Ribcage', skull: 'Skull', skull_candle: 'Skull candle', haybale: 'Hay bale',
  pitchfork: 'Pitchfork', scarecrow: 'Scarecrow', tractor: 'Tractor', crypt: 'Crypt', arch: 'Stone arch', pillar: 'Pillar',
  bench: 'Bench', bench_decorated: 'Decorated bench', coffin: 'Coffin', coffin_decorated: 'Decorated coffin',
  gravestone: 'Gravestone', wagon: 'Wagon', wagon_hay: 'Hay wagon', wooden_gate_halloween: 'Wooden gate',
  shrine_candles: 'Shrine', plaque_candles: 'Plaque', post_lantern: 'Lamp post', post_skull: 'Skull post',
  lantern_standing: 'Lantern', candle: 'Candle', candle_thin: 'Thin candle', candle_melted: 'Melted candle', candle_triple: 'Candles',
  fence_seperate: 'Fence', fence_seperate_broken: 'Broken fence', fence_pillar: 'Fence pillar', fence_pillar_broken: 'Broken pillar',
  sign_left: 'Signpost', sign_right: 'Signpost', sign_both: 'Signpost',
  crag_a: 'Crag', crag_b: 'Crag',
  barrel: 'Barrel', big_barrel: 'Big barrel', keg: 'Keg', crate: 'Crate', big_crate: 'Big crate', crate_stack: 'Stacked crates',
  trunk_small: 'Small trunk', trunk_medium: 'Trunk', trunk_large: 'Big trunk', treasure_chest: 'Treasure chest', shield: 'Golden shield', crypt_key: 'Crypt key',
  potion_a: 'Potion', potion_b: 'Potion', potion_c: 'Brew', rubble: 'Rubble', ruins: 'Ruins',
};
export function labelFor(name: string): string {
  if (LABELS[name]) return LABELS[name];
  const b = /^candy_bucket_[A-D](_decorated)?$/.exec(name); if (b) return b[1] ? 'Decorated candy bucket' : 'Candy bucket';
  let n = name.replace(/_[A-D](?=_|$)/, '');
  const m = /^candy_(\w+)$/.exec(n); if (m) return `${cap(m[1])} candy`;
  const l = /^lollipop_(\w+)$/.exec(n); if (l) return `${cap(l[1])} lollipop`;
  const bo = /^bone/.exec(n); if (bo) return 'Bone';
  const fr = /^(pebble|rock|boulder|bush)_/.exec(n); if (fr) return cap(fr[1]);
  if (/^bare_tree/.test(n)) return 'Bare tree';
  const pk = /^pumpkin_(\w+?)(_small)?(_jackolantern)?$/.exec(n);
  if (pk) return pk[3] ? `${cap(pk[1])} jack-o-lantern` : pk[2] ? `Small ${pk[1]} pumpkin` : `${cap(pk[1])} pumpkin`;
  const g = /^grave_?(marker)?(_destroyed)?$/.exec(n); if (g) return g[2] ? 'Broken grave' : g[1] ? 'Grave marker' : 'Grave';
  const t = /^tree_(dead|pine)_(\w+?)_(small|medium|large)(_decorated)?$/.exec(n);
  if (t) return `${t[3] === 'large' ? 'Big ' : t[3] === 'small' ? 'Small ' : ''}${t[1] === 'dead' ? 'dead tree' : 'pine tree'}`;
  const t2 = /^tree_dead_(small|medium|large)(_decorated)?$/.exec(n);
  if (t2) return `${t2[1] === 'large' ? 'Big ' : t2[1] === 'small' ? 'Small ' : ''}dead tree`;
  return cap(n.replace(/_/g, ' '));
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function milestoneFor(radius: number): string {
  let label = MILESTONES[0][1];
  for (const [r, l] of MILESTONES) if (radius >= r) label = l;
  return label;
}
