// Merges the curated KayKit models (Halloween Bits, Forest Nature, Dungeon) into one glb.
// Each model becomes a top-level node named after its source file so the
// game can look meshes up by name. Run with: npm run assets
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, flatten, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Source models live in assets-src/ (only the files the game uses, copied from the KayKit packs; see assets-src/*/License.txt).
const SRC = resolve(root, 'assets-src/halloween-bits/gltf');
const FOREST = resolve(root, 'assets-src/forest-nature/gltf');
const DUNGEON = resolve(root, 'assets-src/dungeon/gltf');
const OUT = resolve(root, 'public/assets/halloween.glb');

// Curated list. Keep in sync with src/game/items.ts and src/game/world.ts.
export const MODELS = [
  // player
  'pumpkin_orange_jackolantern',
  // candy (T0)
  'candy_blue_A', 'candy_blue_B', 'candy_brown_A', 'candy_brown_B', 'candy_brown_C',
  'candy_green_A', 'candy_green_B', 'candy_green_C', 'candy_orange_A', 'candy_orange_B',
  'candy_orange_C', 'candy_pink_A', 'candy_pink_B', 'candy_purple_A', 'candy_purple_B',
  'candycorn',
  'lollipop_blue', 'lollipop_brown', 'lollipop_green', 'lollipop_orange', 'lollipop_pink',
  'lollipop_purple',
  'bone_A', 'bone_B', 'bone_C',
  // T1
  'candle', 'candle_melted', 'candle_thin', 'candle_triple', 'lantern_standing',
  'pumpkin_orange_small', 'pumpkin_yellow_small', 'pumpkin_orange', 'pumpkin_yellow',
  'pumpkin_yellow_jackolantern',
  'candy_bucket_A', 'candy_bucket_B', 'candy_bucket_A_decorated', 'candy_bucket_B_decorated',
  'skull', 'skull_candle', 'ribcage',
  // T2
  'gravestone', 'gravemarker_A', 'gravemarker_B', 'grave_A', 'grave_B', 'grave_A_destroyed',
  'bench', 'bench_decorated', 'haybale', 'pitchfork', 'sign_left', 'sign_right', 'sign_both',
  'fence_seperate', 'fence_seperate_broken', 'fence_pillar', 'fence_pillar_broken',
  'shrine_candles', 'plaque_candles', 'post_lantern', 'post_skull',
  // T3
  'tree_dead_small', 'tree_dead_medium', 'scarecrow', 'wagon', 'coffin', 'coffin_decorated',
  'pillar', 'tree_pine_orange_small', 'tree_pine_yellow_small',
  // T4
  'tree_dead_large', 'tree_dead_large_decorated', 'tree_pine_orange_medium',
  'tree_pine_yellow_medium', 'tree_pine_orange_large', 'tree_pine_yellow_large',
  'tractor', 'wagon_hay', 'arch', 'crypt', 'wooden_gate_halloween',
  // scenery only
  'fence', 'fence_broken', 'path_A', 'path_B', 'path_C', 'path_D', 'floor_dirt', 'floor_dirt_grave',
];

// Forest Nature Pack models, renamed to simple lowercase ids: [sourceFile, id].
export const FOREST_MODELS = [
  ['Rock_2_A_Color1', 'pebble_a'], ['Rock_3_A_Color1', 'pebble_b'], ['Rock_3_C_Color1', 'pebble_c'],
  ['Rock_3_A_Color1', 'rock_a'], ['Rock_3_B_Color1', 'rock_b'], ['Rock_3_C_Color1', 'rock_c'], ['Rock_3_D_Color1', 'rock_d'],
  ['Rock_3_E_Color1', 'rock_e'], ['Rock_3_F_Color1', 'rock_f'], ['Rock_3_G_Color1', 'rock_g'],
  ['Rock_3_I_Color1', 'boulder_a'], ['Rock_3_K_Color1', 'boulder_b'], ['Rock_3_L_Color1', 'boulder_c'],
  ['Rock_3_Q_Color1', 'crag_a'], ['Rock_2_F_Color1', 'crag_b'],
  ['Bush_2_A_Color1', 'bush_a'], ['Bush_2_B_Color1', 'bush_b'], ['Bush_4_A_Color1', 'bush_c'], ['Bush_4_B_Color1', 'bush_d'], ['Bush_3_A_Color1', 'bush_e'],
  ['Tree_Bare_1_A_Color1', 'bare_tree_a'], ['Tree_Bare_1_B_Color1', 'bare_tree_b'], ['Tree_Bare_2_A_Color1', 'bare_tree_c'], ['Tree_Bare_2_B_Color1', 'bare_tree_d'],
  ['Tree_1_A_Color1', 'leafy_tree_a'], ['Tree_2_A_Color1', 'leafy_tree_b'], ['Tree_4_A_Color1', 'leafy_tree_c'],
];

// Dungeon Pack: only what suits a graveyard and a farm.
export const DUNGEON_MODELS = [
  ['barrel_small', 'barrel'], ['barrel_large', 'big_barrel'], ['keg', 'keg'],
  ['box_small', 'crate'], ['box_large', 'big_crate'], ['crates_stacked', 'crate_stack'],
  ['trunk_small_A', 'trunk_small'], ['trunk_medium_A', 'trunk_medium'], ['trunk_large_A', 'trunk_large'],
  ['chest_gold', 'treasure_chest'], ['key', 'crypt_key'],
  ['bottle_A_green', 'potion_a'], ['bottle_B_green', 'potion_b'], ['bottle_C_brown', 'potion_c'],
  ['rubble_half', 'rubble'], ['rubble_large', 'ruins'],
  ['sword_shield_gold', 'shield'],
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const merged = new Document();
const scene = merged.createScene('halloween');

const SOURCES = [
  ...MODELS.map((name) => [resolve(SRC, `${name}.gltf`), name]),
  ...FOREST_MODELS.map(([file, name]) => [resolve(FOREST, `${file}.gltf`), name]),
  ...DUNGEON_MODELS.map(([file, name]) => [resolve(DUNGEON, `${file}.gltf`), name]),
];
for (const [path, name] of SOURCES) {
  const doc = await io.read(path);
  // Flatten per-model hierarchies so multi-part models (tractor, wagon) become
  // sibling meshes under one group node.
  await doc.transform(flatten());
  const map = mergeDocuments(merged, doc);
  const importedScene = map.get(doc.getRoot().listScenes()[0]);
  const group = merged.createNode(name);
  for (const child of importedScene.listChildren()) {
    importedScene.removeChild(child);
    group.addChild(child);
  }
  importedScene.dispose();
  scene.addChild(group);
}

merged.getRoot().setDefaultScene(scene);
await merged.transform(unpartition(), dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));

// Make sure the shared texture is a single image with nearest-ish sampling intent left to runtime.
const textures = merged.getRoot().listTextures();
await io.write(OUT, merged);
const kb = Math.round(statSync(OUT).size / 1024);
console.log(`wrote ${OUT} (${kb} KB) with ${SOURCES.length} models, ${textures.length} texture(s), ${merged.getRoot().listMaterials().length} material(s)`);
