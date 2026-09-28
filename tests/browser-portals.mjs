import { PlayDriver } from './browser-driver.mjs';
import { B, I } from '../src/core/blocks.js';
import assert from 'node:assert/strict';

const d = new PlayDriver(); let failure, anchor, originalInventory, netherPortal;
async function walkThrough(expectedDimension) {
  await d.page.keyboard.down('w');
  try { await d.wait(state => state.dimension === expectedDimension || state.screen === 'loading', 12000, 'portal travel begins through physical movement'); }
  finally { await d.page.keyboard.up('w'); }
  await d.wait(state => state.dimension === expectedDimension && state.screen !== 'loading', 180000, 'destination finishes loading');
  if ((await d.snapshot()).screen !== 'playing') await d.enter();
}
try {
  await d.open('portals'); await d.create();
  await d.stage('Build and ignite a complete obsidian frame using normal placement', async () => {
    await d.catalogue(B.OBSIDIAN, 0); anchor = await d.placeOnGround(B.OBSIDIAN);
    // Bottom row, side pillars and top row. All writes are ordinary player clicks.
    const frame = [];
    for (let x = 1; x < 4; x++) frame.push({ x: anchor.x + x, y: anchor.y, z: anchor.z });
    for (let y = 1; y <= 4; y++) for (const x of [0, 3]) frame.push({ x: anchor.x + x, y: anchor.y + y, z: anchor.z });
    for (const x of [1, 2]) frame.push({ x: anchor.x + x, y: anchor.y + 4, z: anchor.z });
    for (const pos of frame) {
      await d.flyTo({ x: pos.x + .5, y: pos.y + 1.4, z: pos.z + 2.2 });
      const old = await d.block(pos); if (old && old !== B.OBSIDIAN) await d.mine(pos);
      if (await d.block(pos) !== B.OBSIDIAN) await d.placeAt(B.OBSIDIAN, pos);
    }
    for (let y = 1; y < 4; y++) for (let x = 1; x < 3; x++) {
      const pos = { x: anchor.x + x, y: anchor.y + y, z: anchor.z };
      if (await d.block(pos)) { await d.flyTo({ x: pos.x + .5, y: pos.y + 1, z: pos.z + 2 }); await d.mine(pos); }
    }
    await d.flyTo({ x: anchor.x + 1.5, y: anchor.y + 1.3, z: anchor.z + 2.2 });
    await d.catalogue(I.FLINT_STEEL, 1);
    await d.aim({ x: anchor.x + 1.5, y: anchor.y + .999, z: anchor.z + .5 }); await d.click();
    const inside = { x: anchor.x + 1, y: anchor.y + 1, z: anchor.z };
    await d.wait(async () => await d.block(inside) === B.PORTAL, 8000, 'actual portal ignition');
    for (let y = 1; y < 4; y++) for (let x = 1; x < 3; x++) assert.equal(await d.block({ x: anchor.x + x, y: anchor.y + y, z: anchor.z }), B.PORTAL);
    originalInventory = (await d.snapshot()).player.inventory;
    await d.aim({ x: anchor.x + 2, y: anchor.y + 2, z: anchor.z + .5 }); await d.screenshot('01-ignited-frame');
    return { anchor, interiorBlocks: 6 };
  });
  await d.stage('Physically enter the portal and arrive safely in the Nether', async () => {
    await d.look(0, 0); await walkThrough('nether');
    const state = await d.snapshot(); netherPortal = { ...state.player.pos };
    assert.equal(state.player.health, 20); assert.deepEqual(state.player.inventory, originalInventory);
    assert.ok(Math.hypot(state.player.pos.x - (anchor.x + 1.5) / 8, state.player.pos.z - (anchor.z + .5) / 8) < 3, 'The new destination uses the Nether coordinate scale');
    assert.equal(await d.block({ ...state.player.pos, y: state.player.pos.y - .1 }), B.OBSIDIAN);
    await d.page.keyboard.down('w'); await d.page.waitForTimeout(650); await d.page.keyboard.up('w'); await d.page.waitForTimeout(350);
    await d.look(.65, .05); await d.screenshot('02-nether-arrival');
    return { arrival: netherPortal, dimension: state.dimension, meshing: state.meshing };
  });
  await d.stage('Return through the linked portal and preserve the player-built Overworld frame', async () => {
    await d.page.waitForTimeout(5500);
    const current = (await d.snapshot()).player.pos;
    await d.look(Math.atan2(current.x - netherPortal.x, current.z - netherPortal.z), 0);
    await walkThrough('overworld'); const state = await d.snapshot();
    assert.ok(Math.hypot(state.player.pos.x - (anchor.x + 1.5), state.player.pos.z - (anchor.z + .5)) < 2);
    assert.deepEqual(state.player.inventory, originalInventory);
    await d.page.keyboard.down('w'); await d.page.waitForTimeout(650); await d.page.keyboard.up('w');
    await d.page.waitForTimeout(300); await d.aim({ x: anchor.x + 1.5, y: anchor.y + 2, z: anchor.z + .5 });
    await d.screenshot('03-returned-frame');
  });
  await d.stage('Breaking an actual frame block deactivates the whole portal surface', async () => {
    const side = { x: anchor.x, y: anchor.y + 2, z: anchor.z };
    const p = (await d.snapshot()).player.pos;
    await d.flyTo({ x: anchor.x + .5, y: anchor.y + 2.1, z: anchor.z + (p.z >= anchor.z ? 2.1 : -1.1) });
    await d.mine(side);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 3; x++) assert.equal(await d.block({ x: anchor.x + x, y: anchor.y + y, z: anchor.z }), B.AIR);
    await d.screenshot('04-deactivated');
  });
} catch (error) { failure = error; process.exitCode = 1; }
finally { await d.finish(failure); }
