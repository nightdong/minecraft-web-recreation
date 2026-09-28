import * as THREE from 'three';
import { B, blocks, items, textureFor } from '../core/blocks.js';
import { hash, seedNumber, clamp } from '../core/noise.js';
import { atlasUV } from './atlas-uv.js';
import { ADVENTURE_TEXTURES, paintAdventureTexture, paintAdventureItem } from './adventure-textures.js';
import { HOSTILE_TEXTURES, paintHostileTexture } from './hostile-art.js';
import { paintTerrainTexture } from './terrain-art.js';
import { mechanismParts } from './mechanisms.js';

const SIZE = 16, CELL = 32, COLUMNS = 16;
const rgb = (r, g, b, a = 1) => `rgba(${clamp(Math.round(r), 0, 255)},${clamp(Math.round(g), 0, 255)},${clamp(Math.round(b), 0, 255)},${a})`;
const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const palette = { wood: [163, 130, 78], stone: [151, 151, 151], iron: [217, 220, 217], diamond: [65, 217, 200], gold: [242, 206, 57], leather: [158, 93, 53] };

/** Independently painted 16x16 assets. The atlas has extruded borders to avoid mip bleeding. */
export class TextureAtlas {
  constructor() {
    this.tiles = new Map(); this.tileCanvases = new Map(); this.icons = new Map(); this.iconURLs = new Map(); this.itemTextures = new Map();
    const names = new Set();
    for (const b of blocks) if (b) for (const t of Array.isArray(b.texture) ? b.texture : [b.texture]) names.add(t);
    names.add('farmland_wet');
    for (const name of ADVENTURE_TEXTURES) names.add(name);
    for (const name of HOSTILE_TEXTURES) names.add(name);
    for (const name of ['skin', 'shirt', 'trousers', 'steve_face', 'steve_back', 'zombie_face', 'zombie_skin', 'pig', 'pig_face', 'cow', 'cow_face', 'sheep', 'sheep_face', 'chicken', 'chicken_face', 'creeper', 'creeper_face', 'skeleton', 'skeleton_face']) names.add(name);
    const animated = ['water', 'lava', 'portal', 'fire', 'end_portal'];
    for (const name of animated) names.delete(name);
    const staticRows = Math.ceil(names.size / COLUMNS);
    // Bake all animation frames once. Every two complete rows hold a 32-frame
    // strip, with the same eight-texel extrusion as ordinary block textures.
    this.canvas = canvas(COLUMNS * CELL, (staticRows + animated.length * 2) * CELL);
    this.ctx = this.canvas.getContext('2d'); this.ctx.imageSmoothingEnabled = false;
    let i = 0;
    for (const name of names) { this.tiles.set(name, i++); this.paint(name, 0); }
    animated.forEach((name, index) => {
      const first = (staticRows + index * 2) * COLUMNS; this.tiles.set(name, first);
      for (let frame = 0; frame < 32; frame++) this.paint(name, frame, first + frame);
    });
    this.animationTop = { value: 1 - staticRows * CELL / this.canvas.height };
    this.animationOffset = { value: new THREE.Vector2() };
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestMipmapLinearFilter; this.texture.generateMipmaps = true;
    this.texture.anisotropy = 4; this.lastFrame = -1;
  }
  paint(name, frame, tileIndex = this.tiles.get(name)) {
    const c = canvas(16), ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const seed = seedNumber(name), rnd = (x, y, n = 0) => hash(x, y, n, seed);
    const px = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); };
    const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    const noise = (color, amount = 18, cluster = 0) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const n = (rnd(x, y) - .5) * amount + (rnd(x >> 1, y >> 1, 7) - .5) * cluster;
        px(x, y, rgb(color[0] + n, color[1] + n, color[2] + n));
      }
    };
    const copy = source => ctx.drawImage(this.tileCanvases.get(source) || c, 0, 0);
    const stone = () => {
      noise([126, 126, 126], 24, 23);
      for (let k = 0; k < 16; k++) { const x = Math.floor(rnd(k, 20) * 15), y = Math.floor(rnd(k, 21) * 16); rect(x, y, 1 + Math.floor(rnd(k, 22) * 3), 1, rnd(k, 23) > .5 ? '#939393' : '#717171'); }
    };
    if (name === 'redstone_dust') {
      noise([237, 227, 217], 22, 12);
    } else if (name === 'redstone_lamp' || name === 'redstone_lamp_on') {
      const on = name.endsWith('_on'); noise(on ? [228, 176, 97] : [80, 57, 34], 24, 24);
      for (const p of [0, 7, 15]) { rect(p, 0, 1, 16, '#38261d'); rect(0, p, 16, 1, '#38261d'); }
      for (const x of [2, 10]) for (const y of [2, 10]) { rect(x, y, 4, 4, on ? '#fff0b3' : '#946b3b'); px(x, y, on ? '#fffbe0' : '#b78b54'); }
    } else if (name === 'lever_handle') {
      noise([152, 111, 60], 20, 8); rect(0, 0, 2, 16, '#614526'); rect(13, 0, 3, 16, '#8a653c'); rect(3, 0, 2, 16, '#d0a165');
    } else if (name === 'repeater_top') {
      noise([171, 169, 162], 12, 8); rect(7, 1, 2, 14, '#91322e');
      for (const y of [2, 5, 8, 11]) { rect(5, y, 6, 1, '#69685f'); rect(6, y + 1, 4, 1, '#dfd7c1'); }
      rect(3, 13, 10, 2, '#8b2927');
    } else if (name.startsWith('piston_')) {
      const front = name === 'piston_front', bottom = name === 'piston_bottom';
      if (bottom) stone(); else noise(front ? [172, 139, 85] : [140, 133, 113], 20, 12);
      if (front) {
        for (const y of [0, 5, 10, 15]) rect(0, y, 16, 1, '#6f542d');
        for (const x of [0, 12]) for (const y of [0, 12]) { rect(x, y, 4, 4, '#595b55'); rect(x + 1, y + 1, 2, 2, '#d4d5c4'); }
      } else if (!bottom) { rect(0, 0, 16, 4, '#b89356'); rect(0, 4, 16, 2, '#675135'); for (const x of [0, 13]) rect(x, 6, 3, 10, '#777a72'); rect(5, 7, 6, 8, '#bcbca7'); }
    } else if (name === 'redstone_torch' || name === 'redstone_torch_off') {
      rect(7, 6, 2, 10, '#a47b40'); rect(7, 7, 1, 9, '#d1a36a');
      rect(6, 2, 4, 5, name.endsWith('_off') ? '#5e2823' : '#d72d22'); rect(7, 2, 2, 3, name.endsWith('_off') ? '#773b30' : '#ffbb72');
    } else if (paintHostileTexture(ctx, name) || paintTerrainTexture(ctx, name) || paintAdventureTexture(ctx, name, frame)) {
      // Independently rasterized adventure textures share ordinary atlas padding.
    } else if (name === 'dirt' || name === 'grass_side') {
      noise([132, 94, 65], 35, 24);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (rnd(x, y, 3) < .15) px(x, y, '#6e6c60');
      if (name === 'grass_side') for (let x = 0; x < 16; x++) {
        const edge = 3 + Math.floor(rnd(x, 24) * 3);
        for (let y = 0; y <= edge; y++) { const n = (rnd(x, y) - .5) * 35; px(x, y, rgb(95 + n, 145 + n, 46 + n)); }
        px(x, edge + 1, '#776344');
      }
    } else if (name === 'grass_top') {
      noise([106, 157, 53], 34, 22);
      for (let k = 0; k < 34; k++) { const x = Math.floor(rnd(k, 30) * 16), y = Math.floor(rnd(k, 31) * 16); px(x, y, '#8aaa50'); }
    } else if (name === 'stone' || name.endsWith('_ore')) {
      stone();
      if (name.endsWith('_ore')) {
        const ore = { coal: [47, 47, 47], iron: [193, 153, 127], gold: [239, 201, 52], diamond: [81, 222, 211], redstone: [188, 33, 31], lapis: [52, 79, 172] }[name.split('_')[0]];
        for (const [x, y] of [[2, 2], [10, 1], [6, 6], [12, 9], [2, 11], [8, 13]]) {
          rect(x - 1, y, 3, 2, rgb(...ore.map(v => v * .54))); rect(x, y, 2, 2, rgb(...ore));
          px(x + 1, y, rgb(...ore.map(v => v * 1.2))); px(x, y + 2, rgb(...ore.map(v => v * .76)));
        }
      }
    } else if (name.includes('cobblestone')) {
      const points = [[1, 2], [6, 1], [12, 2], [3, 7], [10, 7], [15, 8], [1, 13], [7, 13], [13, 13]];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let best = 99, next = 99, k = 0;
        points.forEach(([cx, cy], j) => {
          const dx = Math.min(Math.abs(x - cx), 16 - Math.abs(x - cx)), dy = Math.min(Math.abs(y - cy), 16 - Math.abs(y - cy));
          const d = Math.sqrt(dx * dx + dy * dy * 1.15);
          if (d < best) { next = best; best = d; k = j; } else next = Math.min(next, d);
        });
        let v = next - best < .7 ? 61 : 116 + rnd(k, 77) * 39 + (rnd(x, y) - .5) * 19;
        if (next - best > .7 && next - best < 1.4) v += 22;
        if (name === 'mossy_cobblestone' && rnd(x >> 1, y >> 1, 99) > .57) px(x, y, rgb(v * .55, v * .78, v * .38));
        else px(x, y, rgb(v, v, v));
      }
    } else if (name === 'bedrock') { noise([67, 67, 67], 73, 55); }
    else if (name === 'sand') noise([219, 211, 161], 20, 10);
    else if (name === 'gravel') noise([129, 122, 117], 50, 65);
    else if (name.endsWith('_log')) {
      const birch = name.startsWith('birch'), spruce = name.startsWith('spruce');
      const base = birch ? [211, 211, 204] : spruce ? [79, 59, 37] : [103, 81, 46];
      noise(base, birch ? 15 : 22, 12);
      if (birch) {
        for (let k = 0; k < 12; k++) { const x = Math.floor(rnd(k, 50) * 16), y = Math.floor(rnd(k, 51) * 16); rect(x, y, 2 + Math.floor(rnd(k, 52) * 4), 1 + Math.floor(rnd(k, 53) * 2), '#34342f'); }
      } else for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if (x % 3 === 0 || rnd(x, y >> 2, 14) > .77) {
        const n = (rnd(x, y >> 1, 2) - .5) * 20, k = x % 3 === 0 ? .68 : 1.23; px(x, y, rgb(...base.map(v => v * k + n)));
      }
    } else if (name.endsWith('_end')) {
      const base = name.startsWith('birch') ? [201, 185, 135] : name.startsWith('spruce') ? [122, 91, 56] : [164, 131, 78];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const n = (rnd(x, y) - .5) * 15, m = ring > 6.5 ? .55 : Math.floor(ring) % 2 ? 1 : .77;
        px(x, y, rgb(...base.map(v => v * m + n)));
      }
    } else if (name.endsWith('_planks')) {
      const base = name.startsWith('birch') ? [194, 180, 124] : name.startsWith('spruce') ? [115, 86, 49] : [164, 131, 79];
      noise(base, 12, 9);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (y % 4 === 0) px(x, y, rgb(...base.map(v => v * .65)));
        else if (y % 4 === 1) px(x, y, rgb(...base.map(v => v * 1.08)));
        else if (x === ((Math.floor(y / 4) % 2) * 8 + 2)) px(x, y, rgb(...base.map(v => v * .72)));
        else if (rnd(x, y, 18) > .75) rect(x, y, 2, 1, rgb(...base.map(v => v * .91)));
      }
    } else if (name.endsWith('_leaves')) {
      const base = name.startsWith('spruce') ? [54, 91, 56] : name.startsWith('birch') ? [105, 141, 53] : [64, 119, 37];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (rnd(x, y, 3) < .18 && rnd(x >> 1, y >> 1, 5) < .62) continue;
        const n = (rnd(x, y) - .5) * 40 + (rnd(x >> 1, y >> 1, 9) - .5) * 30;
        px(x, y, rgb(...base.map(v => v + n)));
      }
    } else if (name === 'fire') {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const phase = frame * Math.PI / 16;
        const sway = Math.sin(x * 1.7 + phase * 3) * 3 + Math.sin(x * .75 - phase * 2) * 2;
        const top = 3 + sway + rnd(x >> 1, frame % 16, 41) * 4;
        if (y < top || rnd(x, (y + frame) & 15, 3) > .95 && y < 12) continue;
        const heat = clamp((y - top) / (16 - top), 0, 1);
        px(x, y, heat > .7 ? rgb(255, 243, 128) : heat > .35 ? rgb(255, 181 + heat * 60, 26) : rgb(242, 81 + heat * 210, 6));
      }
    } else if (name === 'water' || name === 'lava' || name === 'portal') {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const phase = frame * Math.PI / 16;
        const wave = Math.sin(x * .85 + Math.sin(y * .7 + phase) * 2 + phase) + Math.cos(y * 1.2 - phase + x * .32);
        const v = wave * 11 + (rnd((x + (frame >> 1)) & 15, y) - .5) * 9;
        px(x, y, name === 'water' ? rgb(48 + v * .4, 82 + v * .7, 188 + v) : name === 'lava' ? rgb(236 + v, 108 + v * 3, 11 + v * .4) : rgb(96 + v * 2, 22 + v * .4, 163 + v * 2));
      }
    } else if (name === 'glass' || name === 'ice') {
      if (name === 'ice') noise([151, 188, 237], 15, 10);
      rect(0, 0, 16, 1, '#badde3'); rect(0, 15, 16, 1, '#91bec7'); rect(0, 0, 1, 16, '#bce0e7'); rect(15, 0, 1, 16, '#9dc6d0');
      for (let k = 0; k < 4; k++) { px(3 + k, 7 - k, '#d6eef1'); px(9 + k, 13 - k, '#d6eef1'); }
      px(4, 4, '#ffffff'); px(11, 10, '#ffffff');
    } else if (name === 'snow') noise([236, 244, 247], 12, 4);
    else if (name === 'wool' || name === 'red_wool' || name === 'bed_top' || name === 'bed_head' || name === 'bed_side') {
      noise(name === 'wool' ? [228, 228, 228] : [163, 39, 39], 18, 14);
      if (name === 'bed_head') { rect(1, 0, 14, 6, '#e9e6df'); rect(2, 1, 12, 4, '#ffffff'); }
      if (name === 'bed_side') { rect(0, 11, 16, 5, '#9a773e'); rect(2, 13, 12, 3, 'rgba(0,0,0,0)'); }
    } else if (name === 'obsidian') noise([33, 24, 47], 18, 36);
    else if (name === 'netherrack') noise([115, 51, 51], 32, 51);
    else if (name === 'soul_sand') {
      noise([82, 64, 50], 23, 26);
      for (const [x, y] of [[2, 3], [10, 1], [7, 10]]) { rect(x, y, 1, 2, '#352d27'); rect(x + 3, y, 1, 2, '#352d27'); rect(x + 1, y + 3, 2, 2, '#352d27'); }
    } else if (name === 'clay') noise([160, 166, 179], 13, 7);
    else if (name === 'farmland' || name === 'farmland_wet') {
      const wet = name === 'farmland_wet'; noise(wet ? [65, 44, 25] : [133, 94, 58], 20, 10);
      for (let y = 0; y < 16; y += 4) { rect(0, y, 16, 1, wet ? '#322014' : '#634321'); rect(0, y + 1, 16, 1, wet ? '#543820' : '#9b6e43'); }
    } else if (name.startsWith('cactus')) {
      noise([61, 128, 38], 22, 12);
      if (name === 'cactus_side') for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (x % 4 === 0) px(x, y, '#225a25'); if (x % 4 === 2 && y % 5 === 1) { px(x, y, '#cad0a8'); px(x, y + 1, '#174521'); }
      } else { rect(2, 2, 12, 12, '#629b42'); rect(5, 5, 6, 6, '#bfd185'); }
    } else if (name.startsWith('sandstone')) {
      noise([213, 204, 154], 14, 8);
      if (name === 'sandstone_side') { for (const y of [3, 11]) rect(0, y, 16, 1, '#b3a775'); rect(8, 4, 1, 7, '#c1b584'); }
      if (name === 'sandstone_bottom') noise([198, 185, 133], 32, 18);
    } else if (name === 'bricks' || name === 'stone_bricks' || name === 'stone_slab') {
      const red = name === 'bricks'; noise(red ? [158, 84, 64] : [128, 128, 128], 24, 13);
      const rows = red ? 4 : 8;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const seam = y % rows === 0 || (x + Math.floor(y / rows) * 4) % 8 === 0;
        if (seam) px(x, y, red ? '#b9b5a7' : '#585858'); else if (y % rows === 1) px(x, y, red ? '#b56c52' : '#a4a4a4');
      }
    } else if (name.startsWith('furnace')) {
      stone(); rect(0, 0, 16, 1, '#a4a4a4'); rect(0, 15, 16, 1, '#5c5c5c');
      if (name === 'furnace_front' || name === 'furnace_lit') {
        rect(2, 3, 12, 4, '#474747'); rect(3, 3, 10, 3, '#242424');
        rect(2, 9, 12, 6, '#555555'); rect(3, 10, 10, 4, '#242424');
        if (name === 'furnace_lit') for (let y = 10; y < 14; y++) for (let x = 3; x < 13; x++) px(x, y, rnd(x, y) > .45 ? '#ffcc35' : '#ed7320');
      } else { rect(1, 2, 14, 1, '#737373'); rect(1, 12, 14, 1, '#696969'); }
    } else if (name.startsWith('crafting')) {
      noise([145, 110, 62], 18, 8); rect(0, 0, 16, 1, '#4a321e'); rect(0, 15, 16, 1, '#4a321e'); rect(0, 0, 1, 16, '#4a321e'); rect(15, 0, 1, 16, '#4a321e');
      if (name === 'crafting_top') {
        rect(2, 2, 12, 12, '#a67f48');
        for (const p of [2, 6, 10, 14]) { rect(p, 2, 1, 12, '#50331e'); rect(2, p, 12, 1, '#50331e'); }
      } else {
        rect(1, 1, 14, 3, '#b68b51'); rect(2, 6, 2, 8, '#54371d'); rect(12, 6, 2, 8, '#54371d');
        rect(6, 5, 2, 7, '#d0c7b4'); rect(5, 4, 5, 2, '#776c5a'); rect(10, 8, 1, 5, '#53371f'); rect(9, 6, 4, 3, '#a9a29a');
      }
    } else if (name.startsWith('chest')) {
      noise([168, 115, 45], 17, 8); rect(0, 0, 16, 2, '#3b2b13'); rect(0, 14, 16, 2, '#3b2b13'); rect(0, 0, 2, 16, '#3b2b13'); rect(14, 0, 2, 16, '#3b2b13');
      rect(2, 2, 12, 1, '#d39a43');
      if (name !== 'chest_top') { rect(2, 6, 12, 2, '#4a3217'); rect(2, 8, 12, 1, '#c48932'); }
      if (name === 'chest_front') { rect(7, 6, 3, 5, '#282725'); rect(7, 6, 2, 4, '#c6c6b5'); px(8, 9, '#72736b'); }
    } else if (name === 'bookshelf') {
      copy('oak_planks');
      const bookColors = ['#9d3930', '#406d3a', '#4a629d', '#97773e', '#7c4d79', '#bbad74'];
      for (let row = 0; row < 2; row++) {
        rect(0, row * 8 + 1, 16, 6, '#36271a');
        for (let x = 0; x < 16; x += 2) { rect(x, row * 8 + 1, 1 + (x % 3 === 0 ? 1 : 0), 6, bookColors[(x + row * 3) % bookColors.length]); px(x, row * 8 + 2, '#c7b893'); }
      }
    } else if (name.startsWith('tnt')) {
      noise([188, 57, 40], 22, 13);
      for (let x = 0; x < 16; x += 4) rect(x, 0, 1, 16, '#873122');
      if (name === 'tnt_side') {
        rect(0, 5, 16, 6, '#e2dcc7');
        for (const x of [1, 11]) { rect(x, 6, 4, 1, '#342e29'); rect(x + 1, 6, 1, 4, '#342e29'); }
        rect(6, 6, 1, 4, '#342e29'); rect(9, 6, 1, 4, '#342e29'); px(7, 7, '#342e29'); px(8, 8, '#342e29');
      } else { rect(7, 6, 3, 3, '#4b3c2b'); px(8, 5, '#d0bd89'); }
    } else if (name.startsWith('pumpkin')) {
      noise([196, 120, 22], 23, 10); for (let x = 1; x < 16; x += 4) rect(x, 0, 1, 16, '#a36316');
      if (name === 'pumpkin_top') rect(6, 6, 4, 4, '#6c6032');
      if (name === 'pumpkin_face') { rect(3, 4, 3, 3, '#573c19'); rect(10, 4, 3, 3, '#573c19'); rect(4, 10, 8, 2, '#573c19'); rect(6, 8, 3, 3, '#573c19'); }
    } else if (name.endsWith('_block') || name === 'glowstone') {
      const key = name.split('_')[0], base = palette[key] || (key === 'coal' ? [31, 31, 31] : key === 'redstone' ? [165, 26, 15] : [195, 148, 81]);
      noise(base, name === 'glowstone' ? 65 : 15, name === 'glowstone' ? 60 : 10);
      if (name === 'glowstone') { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (rnd(x, y, 3) > .58) px(x, y, '#f5dda2'); }
      else { rect(0, 0, 16, 1, rgb(...base.map(v => v * 1.18))); rect(0, 0, 1, 16, rgb(...base.map(v => v * 1.18))); rect(0, 15, 16, 1, rgb(...base.map(v => v * .7))); rect(15, 0, 1, 16, rgb(...base.map(v => v * .7))); }
    } else if (name.startsWith('door')) {
      noise([157, 117, 57], 15, 12);
      rect(0, 0, 2, 16, '#725224'); rect(14, 0, 2, 16, '#725224'); rect(0, 0, 16, 2, '#725224'); rect(0, 14, 16, 2, '#725224');
      if (name === 'door_top') { for (const x of [3, 9]) for (const y of [3, 9]) { ctx.clearRect(x, y, 4, 4); rect(x - 1, y, 1, 4, '#b88c4a'); } }
      else { rect(3, 3, 9, 9, '#8e642d'); rect(4, 4, 7, 7, '#ae803f'); rect(12, 2, 2, 2, '#443924'); }
    } else if (name === 'ladder') {
      for (const x of [2, 12]) { rect(x, 0, 2, 16, '#654921'); rect(x, 0, 1, 16, '#b28b4b'); }
      for (const y of [2, 6, 10, 14]) { rect(1, y, 14, 2, '#694d29'); rect(1, y, 14, 1, '#c49b56'); }
    } else if (['tall_grass', 'poppy', 'dandelion', 'sapling', 'sugar_cane', 'mushroom', 'torch'].includes(name) || name.startsWith('wheat')) {
      if (name === 'torch') { rect(7, 5, 2, 11, '#87602e'); rect(7, 8, 1, 8, '#c49449'); rect(7, 2, 2, 5, '#fff38b'); rect(6, 3, 1, 3, '#ef9627'); rect(9, 4, 1, 2, '#ef9627'); }
      else if (name === 'mushroom') { rect(7, 9, 2, 6, '#d2c2a3'); rect(4, 5, 8, 5, '#b52c25'); rect(6, 4, 4, 1, '#d94334'); px(5, 6, '#e3d7c0'); px(9, 5, '#e3d7c0'); px(8, 8, '#e3d7c0'); }
      else if (name === 'sugar_cane') {
        for (const x of [3, 7, 12]) { rect(x, 0, 2, 16, '#81ab43'); rect(x, 0, 1, 16, '#afcc67'); for (const y of [3, 8, 13]) rect(x, y, 2, 1, '#52762e'); rect(x + 2, 5, 2, 1, '#70a139'); }
      } else if (name === 'sapling') {
        rect(7, 8, 2, 8, '#6c522c'); rect(5, 4, 7, 7, '#4d812a'); rect(3, 6, 10, 3, '#518b2f'); rect(6, 2, 4, 5, '#659939');
        for (let k = 0; k < 16; k++) px(4 + Math.floor(rnd(k, 4) * 8), 3 + Math.floor(rnd(k, 5) * 7), '#78a848');
      } else if (name === 'poppy' || name === 'dandelion') {
        rect(7, 6, 1, 10, '#417a2b'); rect(8, 11, 3, 1, '#619839'); rect(5, 9, 2, 1, '#50882c');
        if (name === 'poppy') { rect(5, 3, 5, 4, '#c42c26'); rect(4, 4, 2, 2, '#eb483a'); rect(8, 3, 3, 3, '#da382c'); px(7, 6, '#5e301f'); }
        else { rect(5, 4, 6, 3, '#ebc92c'); rect(6, 3, 4, 5, '#f4db35'); px(7, 5, '#f7ed71'); }
      } else {
        const stage = name.startsWith('wheat') ? Number(name.slice(5)) : -1;
        for (let x = 1; x < 15; x++) {
          const h = stage < 0 ? 4 + Math.floor(rnd(x, 11) * 10) : 2 + Math.floor(stage * 1.45) + Math.floor(rnd(x, 11) * 3);
          const color = stage >= 5 ? rgb(155 + stage * 6, 139 + stage * 4, 44) : rgb(62 + rnd(x, 4) * 34, 111 + rnd(x, 5) * 36, 35);
          for (let y = 15; y >= 16 - h; y--) { const lean = stage < 0 ? Math.floor((15 - y) / 4) * (x > 7 ? 1 : -1) : 0; px(x + lean, y, color); }
          if (stage > 3 && x % 3 === 1) { rect(x - 1, 16 - h, 3, 3, color); px(x, 15 - h, '#d4bd60'); }
        }
      }
    } else {
      // Mob skins, with rectangular details designed for block-model UV mapping.
      const colors = { skin: [173, 127, 99], shirt: [33, 159, 167], trousers: [63, 61, 149], steve_face: [179, 137, 110], steve_back: [64, 44, 25], zombie_skin: [75, 112, 53], zombie_face: [77, 117, 53], pig: [220, 146, 150], pig_face: [225, 151, 155], cow: [79, 57, 43], cow_face: [83, 63, 48], sheep: [226, 224, 215], sheep_face: [174, 157, 136], chicken: [230, 230, 221], chicken_face: [240, 239, 225], creeper: [92, 150, 61], creeper_face: [95, 151, 61], skeleton: [180, 176, 162], skeleton_face: [185, 181, 168] };
      noise(colors[name] || [145, 100, 68], name.startsWith('creeper') ? 62 : 17, name.startsWith('creeper') ? 37 : 13);
      if (name.startsWith('cow')) for (let k = 0; k < 14; k++) rect(Math.floor(rnd(k, 50) * 16), Math.floor(rnd(k, 51) * 16), 2 + Math.floor(rnd(k, 52) * 4), 2, '#d3cdc2');
      if (name.endsWith('_face')) {
        if (name === 'creeper_face') { rect(2, 4, 4, 4, '#183016'); rect(10, 4, 4, 4, '#183016'); rect(6, 8, 4, 3, '#183016'); rect(4, 10, 8, 4, '#183016'); rect(4, 14, 3, 2, '#183016'); rect(9, 14, 3, 2, '#183016'); }
        else if (name === 'skeleton_face') { rect(2, 5, 4, 4, '#3f3d36'); rect(10, 5, 4, 4, '#3f3d36'); rect(7, 8, 2, 3, '#625b4f'); rect(3, 12, 10, 2, '#6b6458'); }
        else {
          rect(2, 6, 3, 2, '#f2eee4'); rect(11, 6, 3, 2, '#f2eee4'); rect(3, 6, 2, 2, name === 'steve_face' ? '#55518d' : '#25251f'); rect(11, 6, 2, 2, name === 'steve_face' ? '#55518d' : '#25251f');
          if (name === 'pig_face') { rect(5, 9, 6, 4, '#e9afb0'); rect(6, 10, 1, 2, '#a76873'); rect(9, 10, 1, 2, '#a76873'); }
          if (name === 'steve_face') { rect(0, 0, 16, 3, '#422c1b'); rect(0, 3, 2, 3, '#422c1b'); rect(14, 3, 2, 3, '#422c1b'); rect(5, 11, 6, 4, '#654430'); rect(7, 9, 3, 3, '#9e684e'); rect(7, 12, 3, 1, '#c98e74'); }
          if (name === 'zombie_face') { rect(1, 1, 14, 2, '#3d6132'); rect(5, 12, 6, 2, '#36532b'); }
          if (name === 'cow_face') { rect(3, 10, 10, 5, '#b5a395'); rect(4, 11, 2, 2, '#514236'); rect(10, 11, 2, 2, '#514236'); }
          if (name === 'sheep_face') { rect(5, 11, 6, 4, '#66584a'); rect(7, 11, 2, 2, '#cfaca6'); }
          if (name === 'chicken_face') { rect(4, 9, 8, 3, '#d8ac3b'); rect(6, 12, 4, 4, '#b33429'); }
        }
      }
    }
    if (frame === 0) this.tileCanvases.set(name, c);
    const i = tileIndex, ax = (i % COLUMNS) * CELL, ay = Math.floor(i / COLUMNS) * CELL;
    // Eight texels of edge extrusion permit clean mipmaps down to distant blocks.
    this.ctx.clearRect(ax, ay, CELL, CELL); this.ctx.drawImage(c, ax + 8, ay + 8);
    for (let n = 0; n < 8; n++) {
      this.ctx.drawImage(c, 0, 0, 16, 1, ax + 8, ay + n, 16, 1);
      this.ctx.drawImage(c, 0, 15, 16, 1, ax + 8, ay + 24 + n, 16, 1);
      this.ctx.drawImage(c, 0, 0, 1, 16, ax + n, ay + 8, 1, 16);
      this.ctx.drawImage(c, 15, 0, 1, 16, ax + 24 + n, ay + 8, 1, 16);
    }
    for (const [sx, sy, dx, dy] of [[0, 0, 0, 0], [15, 0, 24, 0], [0, 15, 0, 24], [15, 15, 24, 24]]) this.ctx.drawImage(c, sx, sy, 1, 1, ax + dx, ay + dy, 8, 8);
  }
  uv(name, crop = [0, 0, 1, 1]) {
    return atlasUV(this.tiles, this.canvas.width, this.canvas.height, name, crop);
  }
  animate(seconds) {
    const frame = Math.floor(seconds * 20); if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    const cell = frame & 31;
    this.animationOffset.value.set((cell & 15) / COLUMNS, cell >= 16 ? -CELL / this.canvas.height : 0);
  }
  icon(id) {
    if (this.icons.has(id)) return this.icons.get(id);
    const out = canvas(32), ctx = out.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const item = items[id]; if (!item) return out;
    if (item.block !== undefined) {
      const b = blocks[id];
      if (['lever', 'button', 'plate', 'repeater'].includes(b.shape)) this.drawMechanismIcon(ctx, id);
      else if (['cross', 'crop', 'torch', 'ladder', 'door'].includes(b.shape)) {
        ctx.drawImage(this.tileCanvases.get(b.shape === 'door' ? 'door_top' : textureFor(id, 4)), 2, 0, 28, 32);
        if (b.shape === 'door') ctx.drawImage(this.tileCanvases.get('door_bottom'), 7, 16, 18, 16);
      } else {
        const half = ['slab', 'bed', 'snow'].includes(b.shape), height = half ? 8 : 15;
        const topY = half ? 9 : 1;
        const face = (tex, matrix, shade = 0) => {
          ctx.save(); ctx.setTransform(...matrix); ctx.drawImage(this.tileCanvases.get(tex), 0, 0, 16, 16);
          if (shade) { ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.globalCompositeOperation = 'source-atop'; ctx.fillRect(0, 0, 16, 16); }
          ctx.restore();
        };
        face(textureFor(id, 4), [14 / 16, 7 / 16, 0, height / 16, 2, topY + 7], .20);
        face(textureFor(id, 5), [14 / 16, -7 / 16, 0, height / 16, 16, topY + 14], .36);
        face(textureFor(id, 2), [14 / 16, 7 / 16, -14 / 16, 7 / 16, 16, topY], 0);
      }
    } else ctx.drawImage(this.itemSprite(item), 0, 0, 32, 32);
    this.icons.set(id, out); return out;
  }
  drawMechanismIcon(ctx, id) {
    const faces = [
      [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
      [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]
    ], quads = [];
    for (const part of mechanismParts(id) || []) for (let f = 0; f < 6; f++) {
      const vertices = faces[f].map(v => { const p = v.map((n, axis) => part.bounds[axis] + n * (part.bounds[axis + 3] - part.bounds[axis])); return part.transform ? part.transform(p) : p; });
      const a = new THREE.Vector3(...vertices[1]).sub(new THREE.Vector3(...vertices[0])), b = new THREE.Vector3(...vertices[2]).sub(new THREE.Vector3(...vertices[0]));
      const normal = a.cross(b); if (normal.x + normal.y + normal.z <= 0) continue;
      const texture = typeof part.texture === 'string' ? part.texture : part.texture?.[f] || textureFor(id, f);
      quads.push({ vertices, texture, crop: part.crop, depth: vertices.flat().reduce((a, b) => a + b, 0), shade: Math.max(0, 1 - (normal.normalize().y * .25 + .72)) });
    }
    quads.sort((a, b) => a.depth - b.depth);
    for (const face of quads) {
      const p = face.vertices.map(([x, y, z]) => [16 + (x - z) * 14, 25 - y * 21 + (x + z - 1) * 7]);
      const image = this.tileCanvases.get(face.texture), crop = face.crop || [0, 0, 1, 1]; if (!image) continue;
      ctx.save(); ctx.beginPath(); p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.clip();
      ctx.setTransform((p[2][0] - p[3][0]) / 16, (p[2][1] - p[3][1]) / 16, (p[0][0] - p[3][0]) / 16, (p[0][1] - p[3][1]) / 16, ...p[3]);
      ctx.drawImage(image, crop[0] * 16, crop[1] * 16, (crop[2] - crop[0]) * 16, (crop[3] - crop[1]) * 16, 0, 0, 16, 16);
      ctx.fillStyle = `rgba(0,0,0,${face.shade})`; ctx.fillRect(0, 0, 16, 16); ctx.restore();
    }
  }
  iconURL(id) {
    if (!this.iconURLs.has(id)) this.iconURLs.set(id, this.icon(id).toDataURL());
    return this.iconURLs.get(id);
  }
  itemTexture(id) {
    if (!this.itemTextures.has(id)) {
      const tex = new THREE.CanvasTexture(items[id]?.block === undefined ? this.itemSprite(items[id]) : this.icon(id));
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace; this.itemTextures.set(id, tex);
    }
    return this.itemTextures.get(id);
  }
  itemSprite(item) {
    const c = canvas(16), ctx = c.getContext('2d'), name = item?.icon || 'coal';
    if (item?.spawnMob) {
      const palettes = { zombie: ['#52675a','#c5ad75'], skeleton: ['#b2b4a0','#477d79'], creeper: ['#4a7554','#e8b55e'], spider: ['#514264','#9fb9ad'] };
      const colors = palettes[item.spawnMob];
      for (let y=1;y<15;y++) for (let x=2;x<14;x++) if ((x-7.5)**2/26+(y-8)**2/43<1) { ctx.fillStyle = ((x*3+y*7)%13<4) ? colors[1] : colors[0]; ctx.fillRect(x,y,1,1); }
      ctx.fillStyle='#e2dcc2';ctx.fillRect(5,4,2,1);return c;
    }
    if (paintAdventureItem(ctx, name)) return c;
    const px = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); };
    const rect = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
    const line = (x0, y0, x1, y1, col, width = 1) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= steps; i++) rect(Math.round(x0 + (x1 - x0) * i / (steps || 1)), Math.round(y0 + (y1 - y0) * i / (steps || 1)), width, width, col);
    };
    const poly = (points, color) => {
      // Rasterize into a tiny canvas once; no vector smoothing survives this resolution.
      ctx.fillStyle = color; ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
    };
    const material = palette[name.split('_')[0]] || [161, 122, 70], main = rgb(...material), dark = rgb(...material.map(v => v * .43)), light = rgb(...material.map(v => v * 1.23));
    if (item?.tool && !['shears'].includes(item.tool)) {
      line(3, 12, 10, 5, '#45321e', 3); line(4, 12, 11, 5, '#9b763f', 1); line(4, 13, 10, 7, '#75542e', 1);
      if (item.tool === 'pickaxe' || item.tool === 'hoe') {
        rect(4, 2, 8, 3, dark); rect(11, 3, 3, 3, dark); rect(12, 5, 3, item.tool === 'pickaxe' ? 4 : 2, dark);
        rect(5, 2, 7, 1, light); rect(5, 3, 8, 1, main); rect(12, 4, 1, 3, main); px(13, 5, light);
      } else if (item.tool === 'axe') {
        rect(8, 1, 5, 2, dark); rect(9, 3, 6, 4, dark); rect(10, 7, 4, 2, dark);
        rect(9, 2, 3, 2, main); rect(10, 3, 4, 4, main); rect(10, 2, 2, 1, light); rect(13, 3, 1, 4, light);
      } else if (item.tool === 'shovel') {
        poly([[10, 1], [14, 1], [15, 5], [11, 9], [7, 5]], dark);
        poly([[10, 2], [13, 2], [14, 5], [11, 7], [9, 5]], main); line(10, 2, 12, 2, light); line(10, 3, 9, 4, light);
      } else if (item.tool === 'sword') {
        line(6, 9, 12, 3, dark, 3); rect(13, 1, 2, 3, dark); line(7, 9, 13, 3, main, 1); line(8, 9, 14, 3, light, 1);
        line(4, 7, 9, 12, dark, 2); line(4, 7, 9, 12, main, 1); rect(2, 13, 3, 2, dark);
      }
    } else if (item?.armor !== undefined) {
      const patterns = [
        ['  XXXXXXXX  ', ' XXXXXXXXXX ', ' XXX    XXX ', ' XX      XX ', ' XX      XX '],
        ['XXX    XXX', 'XXXXXXXXXX', 'XXXXXXXXXX', '  XXXXXX  ', '  XXXXXX  ', '  XXXXXX  ', '  XXXXXX  '],
        ['XXXXXXXX', 'XXXXXXXX', 'XXX  XXX', 'XXX  XXX', 'XXX  XXX', 'XXX  XXX', 'XXX  XXX', 'XXX  XXX'],
        [' XXX XXX ', ' XXX XXX ', ' XXX XXX ', ' XXX XXX ', 'XXXX XXXX', 'XXXX XXXX']
      ][item.armor];
      const w = patterns[0].length, ox = Math.floor((16 - w) / 2), oy = Math.floor((16 - patterns.length) / 2);
      patterns.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') rect(x + ox, y + oy, 1, 1, x === 0 || row[x - 1] !== 'X' ? dark : y === 0 ? light : main); }));
    } else if (name.endsWith('ingot') || name === 'brick') {
      const color = name.startsWith('iron') ? '#d9dcd8' : name.startsWith('gold') ? '#f0d44e' : '#bc634b';
      poly([[4, 4], [12, 4], [15, 8], [12, 12], [1, 12], [1, 8]], '#3e3c33');
      poly([[4, 5], [12, 5], [13, 8], [3, 8]], color); rect(2, 9, 10, 2, name.startsWith('gold') ? '#b89a23' : name === 'brick' ? '#894531' : '#939b9b'); rect(4, 5, 7, 1, '#f3efda');
    } else if (name === 'diamond') {
      poly([[5, 1], [11, 1], [15, 5], [14, 9], [8, 15], [2, 10], [1, 6]], '#124c4a');
      poly([[5, 2], [10, 2], [13, 5], [8, 12], [3, 6]], '#4cdbc9');
      poly([[5, 2], [9, 2], [7, 6], [3, 6]], '#c4fff0'); line(8, 7, 12, 6, '#98f7e4');
    } else if (name === 'stick' || name === 'bone' || name === 'arrow') {
      const bone = name === 'bone', arrow = name === 'arrow'; line(2, 13, 12, 3, bone ? '#776e59' : '#48311d', 2); line(3, 13, 13, 3, bone ? '#ded9bf' : '#a78045');
      if (bone) { rect(1, 12, 3, 2, '#ece5c9'); rect(3, 13, 2, 2, '#ece5c9'); rect(12, 1, 2, 3, '#ece5c9'); rect(13, 3, 2, 2, '#ece5c9'); }
      if (arrow) { poly([[10, 1], [15, 1], [15, 6]], '#c2c4c0'); rect(1, 11, 3, 2, '#e0ded1'); rect(3, 13, 2, 2, '#e0ded1'); }
    } else if (name.includes('bucket')) {
      poly([[1, 3], [14, 3], [12, 13], [4, 15], [2, 11]], '#3d4546');
      poly([[3, 5], [12, 5], [10, 12], [5, 13]], '#b4babc'); rect(3, 3, 10, 2, '#ededdf'); rect(4, 5, 8, 2, '#687277');
      if (name !== 'bucket') { rect(4, 5, 8, 3, name === 'water_bucket' ? '#355ccd' : '#ee9c19'); rect(5, 8, 6, 2, name === 'water_bucket' ? '#517bdf' : '#e66c15'); }
    } else if (name === 'bow') {
      line(7, 1, 12, 6, '#4b321b', 2); line(12, 6, 12, 10, '#4b321b', 2); line(12, 10, 6, 15, '#4b321b', 2);
      line(8, 2, 12, 6, '#b58b4d'); line(12, 7, 12, 10, '#b58b4d'); line(12, 10, 7, 14, '#b58b4d'); line(7, 1, 6, 14, '#c7c7ba');
    } else if (name === 'shears' || name === 'flint_steel') {
      line(2, 12, 12, 2, '#53585a', 3); line(3, 12, 13, 2, '#c1c9ca');
      line(4, 2, 12, 12, '#414344', 3); line(4, 2, 12, 12, name === 'shears' ? '#a7abad' : '#464644');
      rect(2, 11, 3, 3, '#7f4e2f'); rect(11, 11, 3, 3, '#7f4e2f');
    } else if (name === 'apple') {
      rect(7, 1, 2, 4, '#63472b'); rect(9, 2, 3, 2, '#56842a');
      poly([[4, 4], [7, 4], [8, 5], [10, 4], [13, 5], [14, 8], [12, 13], [9, 15], [7, 14], [5, 15], [2, 11], [1, 7]], '#672624');
      poly([[4, 5], [7, 5], [8, 6], [11, 5], [13, 7], [12, 11], [9, 13], [5, 13], [3, 10], [2, 7]], '#ce2f2b'); rect(3, 6, 2, 3, '#f77f64'); rect(5, 5, 2, 1, '#f79b7c');
    } else if (name === 'bread') {
      poly([[2, 7], [7, 3], [12, 3], [15, 7], [14, 11], [7, 14], [2, 12]], '#745024');
      poly([[2, 7], [7, 4], [11, 4], [14, 7], [12, 10], [6, 12], [2, 10]], '#c39344');
      line(5, 6, 7, 9, '#f0c579'); line(8, 5, 10, 8, '#e1b56b'); line(11, 5, 13, 7, '#e1b56b');
    } else if (['pork', 'cooked_pork', 'beef', 'steak', 'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton', 'rotten_flesh'].includes(name)) {
      const cooked = name.startsWith('cooked') || name === 'steak', chicken = name.includes('chicken');
      poly([[3, 4], [8, 2], [13, 4], [14, 8], [11, 12], [6, 14], [2, 11], [1, 7]], cooked ? '#503322' : '#652c2c');
      poly([[3, 5], [8, 3], [12, 5], [13, 8], [9, 11], [5, 12], [2, 9]], cooked ? '#a26b3b' : '#c06e72');
      line(4, 5, 9, 4, cooked ? '#c58e53' : '#e9a0a0'); line(3, 9, 6, 12, cooked ? '#bf874b' : '#e9b1a6');
      if (chicken) { line(3, 12, 1, 14, '#ebe5c9', 2); rect(1, 13, 2, 3, '#ede9d5'); }
    } else if (name === 'wheat' || name === 'seeds') {
      if (name === 'seeds') { for (const [x, y] of [[3, 10], [7, 5], [10, 11], [12, 6]]) { rect(x, y, 2, 3, '#466b25'); rect(x, y, 1, 2, '#9bbd50'); } }
      else for (let k = 0; k < 3; k++) { const x = 4 + k * 4; line(7, 14, x, 3, '#8f792c'); for (let y = 3; y < 10; y += 2) { rect(x - 1, y, 3, 1, '#c9ad48'); px(x, y - 1, '#ead579'); } }
    } else if (name === 'paper' || name === 'book') {
      poly([[4, 2], [13, 3], [12, 14], [2, 12]], name === 'paper' ? '#797b76' : '#4f3723');
      poly([[5, 3], [12, 4], [11, 12], [3, 11]], name === 'paper' ? '#eeeece' : '#aa7442');
      line(5, 5, 10, 6, name === 'paper' ? '#c5c8b8' : '#d0ac73'); line(4, 8, 9, 9, name === 'paper' ? '#c5c8b8' : '#d0ac73');
    } else if (name === 'feather') {
      poly([[11, 1], [14, 3], [12, 9], [5, 13], [3, 11], [6, 4]], '#9da49d');
      poly([[10, 2], [13, 3], [11, 8], [6, 11], [4, 10], [7, 4]], '#e8e9d8'); line(2, 14, 12, 3, '#bcbfac');
    } else if (name === 'compass' || name === 'clock') {
      poly([[5, 1], [11, 1], [15, 5], [15, 11], [11, 15], [5, 15], [1, 11], [1, 5]], '#303332');
      rect(4, 3, 8, 10, name === 'clock' ? '#e1bc46' : '#a6a8a6'); rect(3, 4, 10, 8, name === 'clock' ? '#e1bc46' : '#a6a8a6');
      rect(5, 5, 6, 6, name === 'clock' ? '#508ac5' : '#3e4446'); line(8, 4, 6, 9, '#d32f27'); line(8, 11, 8, 7, '#dadcd4');
    } else if (name === 'leather') {
      poly([[3, 2], [6, 4], [10, 3], [13, 1], [14, 6], [11, 9], [13, 14], [8, 13], [4, 15], [2, 12], [4, 8], [1, 5]], '#613d23');
      poly([[4, 4], [8, 5], [12, 3], [12, 6], [9, 9], [11, 12], [7, 11], [4, 13], [4, 9], [5, 7], [3, 5]], '#a87243');
    } else if (name === 'egg') {
      poly([[7, 2], [10, 3], [13, 8], [13, 12], [10, 15], [5, 15], [2, 12], [3, 7]], '#9b8c74');
      poly([[7, 3], [9, 4], [11, 8], [11, 12], [8, 14], [4, 12], [4, 8]], '#e3dbc1'); rect(6, 5, 2, 4, '#fff3d5');
    } else if (name === 'string') {
      for (const [x, y] of [[3, 4], [7, 2], [11, 5], [9, 9], [5, 11], [2, 9]]) { rect(x, y, 3, 1, '#e7e8da'); rect(x, y + 1, 1, 3, '#b3b5b0'); }
    } else {
      const base = name === 'coal' || name === 'charcoal' ? [52, 52, 52] : name === 'redstone' || name === 'red_dye' ? [181, 31, 28] : name === 'lapis' ? [41, 74, 169] : name === 'bone_meal' ? [218, 221, 197] : name === 'clay_ball' ? [144, 153, 171] : [94, 94, 94];
      poly([[5, 2], [10, 1], [14, 5], [13, 10], [10, 14], [4, 14], [1, 10], [2, 5]], rgb(...base.map(v => v * .4)));
      poly([[5, 3], [10, 2], [12, 5], [12, 9], [9, 12], [4, 12], [2, 9], [3, 5]], rgb(...base));
      rect(5, 4, 3, 2, rgb(...base.map(v => v * 1.5))); rect(9, 7, 2, 2, rgb(...base.map(v => v * .8)));
    }
    return c;
  }
}

export function crackTextures() {
  const result = [];
  for (let stage = 0; stage < 10; stage++) {
    const c = canvas(16), ctx = c.getContext('2d'); ctx.fillStyle = 'rgba(15,9,5,.8)';
    for (let branch = 0; branch <= stage + 2; branch++) {
      let x = 7, y = 7, angle = branch * 2.399;
      for (let step = 0; step < 2 + stage; step++) {
        x += Math.cos(angle) * 1.1; y += Math.sin(angle) * 1.1; angle += (hash(branch, step, 12) - .5) * 1.7;
        ctx.fillRect(Math.round(x), Math.round(y), stage > 6 && step < 3 ? 2 : 1, 1);
      }
    }
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; result.push(t);
  }
  return result;
}
