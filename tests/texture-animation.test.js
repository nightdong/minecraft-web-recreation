import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TextureAtlas } from '../src/render/textures.js';

test('fluid and fire animation advances UV frames without repainting or reuploading the atlas', () => {
  let uploads = 0;
  const atlas = { lastFrame: -1, canvas: { width: 512, height: 512 }, animationOffset: { value: new THREE.Vector2() },
    paint() { throw new Error('A runtime animation frame must not repaint the full terrain atlas'); },
    texture: { set needsUpdate(value) { if (value) uploads++; } } };
  TextureAtlas.prototype.animate.call(atlas, 0);
  assert.deepEqual(atlas.animationOffset.value.toArray(), [0, 0]);
  TextureAtlas.prototype.animate.call(atlas, 1);
  assert.deepEqual(atlas.animationOffset.value.toArray(), [4 / 16, -32 / 512]);
  TextureAtlas.prototype.animate.call(atlas, 1.6);
  assert.deepEqual(atlas.animationOffset.value.toArray(), [0, 0]);
  assert.equal(uploads, 0);
});
