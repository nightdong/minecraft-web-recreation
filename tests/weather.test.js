import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/core/world.js';
import { B } from '../src/core/blocks.js';
import { exposedToRain } from '../src/core/environment.js';
import { VoxelRenderer } from '../src/render/renderer.js';
import { precipitationAt, precipitationHeight, animationStep } from '../src/core/weather.js';

test('rain shelter includes glass, leaves, slabs and chests, not only opaque stone', () => {
  const world = new World('rain-shelter'); world.weather = 1; const chunk = world.ensure(0, 0); chunk.biomes.fill(0);
  for (const roof of [B.STONE, B.GLASS, B.OAK_LEAVES, B.OAK_SLAB, B.CHEST]) {
    world.set(8, 123, 8, roof, 0, false);
    assert.equal(exposedToRain(world, 8, 120, 8), false, `Roof ${roof} shelters the space below`);
    assert.ok(precipitationHeight(world, 8, 8) >= 123.5);
    world.set(8, 123, 8, B.AIR, 0, false);
  }
  assert.equal(exposedToRain(world, 8, 120, 8), true);
});

test('deserts receive neither rain nor snow, cold biomes receive snow, and the Nether stays dry', () => {
  const world = new World('weather-biomes'); world.weather = 1; const chunk = world.ensure(0, 0), i = 8 + 8 * 16;
  chunk.biomes[i] = 0; assert.equal(precipitationAt(world, 8, 8), 'rain');
  chunk.biomes[i] = 4; assert.equal(precipitationAt(world, 8, 8), null);
  chunk.biomes[i] = 6; assert.equal(precipitationAt(world, 8, 8), 'snow');
  world.dimension = 'nether'; assert.equal(precipitationAt(world, 8, 8), null);
});

test('rain geometry never puts streaks below the actual roof or inside a building', () => {
  const world = new World('weather-mesh'); world.weather = 1;
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) world.ensure(cx, cz).biomes.fill(0);
  for (let z = -18; z <= 18; z++) for (let x = -18; x <= 18; x++) world.set(x, 120, z, B.GLASS, 0, false);
  const renderer = { scene: new THREE.Scene(), settings: { weather: true }, time: 9 };
  VoxelRenderer.prototype.createWeather.call(renderer); renderer.rainAmount = 1;
  VoxelRenderer.prototype.updateWeather.call(renderer, world, { pos: { x: .5, y: 117, z: .5 } }, .05);
  const positions = renderer.rain.geometry.getAttribute('position'); let visible = 0;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i); if (y <= -100) continue;
    assert.ok(y >= 121 - 1e-6, `Rain rendered inside shelter at y=${y}`); visible++;
  }
  assert.ok(visible > 0, 'The test must still render actual rain above the roof');
  renderer.rain.geometry.dispose(); renderer.rain.material.dispose(); renderer.snow?.geometry.dispose(); renderer.snow?.material.dispose();
});

test('active singleplayer pause freezes environmental animation while title panorama continues', () => {
  assert.equal(animationStep({ activeWorld: true, paused: true }, .1), 0);
  assert.equal(animationStep({ activeWorld: true, paused: false }, .1), .1);
  assert.equal(animationStep({ activeWorld: false, paused: true }, .1), .1);
});
