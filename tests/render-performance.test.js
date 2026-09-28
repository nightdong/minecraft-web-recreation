import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ParticlePool } from '../src/render/particle-pool.js';
import { FrameMetrics } from '../src/game/frame-metrics.js';
import { creatureMaterial, lightCreature } from '../src/render/entity-light.js';

test('many explosions reuse a fixed particle pool without growing its vectors or colors', () => {
  const pool = new ParticlePool(128), objects = new Set(pool.storage), palette = [new THREE.Color('#c3a16d')];
  for (let i=0;i<100;i++) { pool.emit(0,5,0,palette,120,3); pool.tick(.05,null); }
  assert.ok(pool.active.length<=128); assert.equal(pool.stats.allocated,128); assert.ok(pool.stats.recycled>1000);
  assert.ok(pool.active.every(p=>objects.has(p))); pool.tick(2,null); assert.equal(pool.active.length,0);assert.equal(pool.free.length,128);
  pool.reset(); assert.equal(new Set(pool.free).size,128);
});
test('paused particle effects do not change and low quality bounds future emissions', () => {
  const pool=new ParticlePool(128), palette=[new THREE.Color()];pool.emit(0,1,0,palette,100,1,32);
  assert.equal(pool.active.length,32);const state=JSON.stringify(pool.active);pool.tick(0,null);assert.equal(JSON.stringify(pool.active),state);
});
test('rolling frame telemetry is bounded and separates rendering from simulation time', () => {
  const metrics=new FrameMetrics(10);for(let i=0;i<30;i++)metrics.record(1,2,3,7);
  const s=metrics.summary();assert.equal(s.samples,10);assert.equal(s.simulation.meanMs,1);assert.equal(s.streaming.p95Ms,2);assert.equal(s.render.maxMs,3);
});

test('creature lighting matches the terrain light once, keeping night silhouettes readable without fullbright bodies', () => {
  const atlas = { texture: new THREE.Texture() }, material = creatureMaterial(atlas);
  const renderer = { day: { value: .085 }, nightTint: { value: new THREE.Color(.59, .70, 1) }, ambient: { value: .0095 }, flameIntensity: { value: 1 } };
  assert.equal(material.isMeshBasicMaterial, true, 'Baked face shading must not be multiplied by scene daylight a second time');
  assert.equal(material.map, atlas.texture);
  lightCreature(material.color, 15, 0, renderer);
  assert.ok(Math.abs(material.color.r - (.085 * .59 + .0095)) < 1e-10);
  assert.ok(material.color.b > material.color.r && material.color.b < .1, 'Night stays dim and blue, not fully emissive');
  lightCreature(material.color, 0, 15, renderer);
  assert.ok(material.color.r > material.color.g && material.color.g > material.color.b, 'Cave torch light stays warm');
  lightCreature(material.color, 0, 0, renderer);
  assert.equal(material.color.r, .0095, 'Unlit cave bodies receive only the configured ambient floor');
  material.dispose(); atlas.texture.dispose();
});
