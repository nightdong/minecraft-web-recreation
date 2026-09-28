import { PlayDriver } from './browser-driver.mjs';
import { B, I } from '../src/core/blocks.js';
import assert from 'node:assert/strict';

const d = new PlayDriver(); let failure, anchor, lever, wires, lamp;
try {
  await d.open('redstone'); await d.create();
  await d.stage('Build a physical test platform using normal creative placement and flight', async () => {
    await d.catalogue(B.STONE, 0); anchor = await d.placeOnGround(B.STONE);
    const p = (await d.snapshot()).player.pos;
    await d.flyTo({ x: anchor.x + 1.5, y: anchor.y + 2, z: anchor.z + 2 });
    // Three tiles extend eastward from the first placed block. No block writes.
    for (const dx of [1, 2, 3]) {
      const pos = { x: anchor.x + dx, y: anchor.y, z: anchor.z };
      await d.flyTo({ x: pos.x + .5, y: anchor.y + 2, z: pos.z + .5 });
      const existing = await d.block(pos);
      if (existing && existing !== B.STONE) await d.mine(pos);
      if (await d.block(pos) !== B.STONE) await d.placeAt(B.STONE, pos);
    }
    await d.flyTo({ x: anchor.x + 1.5, y: anchor.y + 2, z: anchor.z + 2 });
    return { anchor, start: p, flown: (await d.snapshot()).player.pos };
  });
  await d.stage('Place a lever, two wires, and a lamp from the creative catalog', async () => {
    lever = { ...anchor, y: anchor.y + 1 }; wires = [1, 2].map(dx => ({ x: anchor.x + dx, y: anchor.y + 1, z: anchor.z })); lamp = { x: anchor.x + 3, y: anchor.y + 1, z: anchor.z };
    await d.catalogue(B.REDSTONE_LAMP, 2); await d.placeAt(B.REDSTONE_LAMP, lamp);
    await d.catalogue(I.REDSTONE, 3); for (const wire of wires) await d.placeAt(B.WIRE, wire);
    await d.catalogue(B.LEVER, 4); await d.placeAt(B.LEVER, lever);
    assert.equal(await d.block(lamp), B.REDSTONE_LAMP); assert.equal(await d.state(wires[0]), 0);
    await d.aim({ x: anchor.x + 1.8, y: anchor.y + 1.3, z: anchor.z + .5 }); await d.screenshot('01-circuit-off');
  });
  await d.stage('Toggle the real lever and observe attenuated dust and a lit lamp', async () => {
    await d.page.evaluate(pos => {
      window.leverTrace = []; let previous = -1;
      const frame = time => { const state = window.voxelDiagnostics.blockState(pos.x, pos.y, pos.z); if (state !== previous) window.leverTrace.push({ time, state }); previous = state; requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    }, lever);
    await d.aim({ x: lever.x + .5, y: lever.y + .25, z: lever.z + .5 });
    assert.equal((await d.snapshot()).target.id, B.LEVER); await d.click();
    await d.wait(async () => await d.block(lamp) === B.REDSTONE_LAMP_ON, 8000, 'lamp on');
    assert.equal(await d.state(wires[0]), 15); assert.equal(await d.state(wires[1]), 14);
    await d.aim({ x: anchor.x + 1.8, y: anchor.y + 1.3, z: anchor.z + .5 }); await d.screenshot('02-circuit-on');
    await d.aim({ x: lever.x + .5, y: lever.y + .25, z: lever.z + .5 }); await d.click();
    await d.wait(async () => await d.block(lamp) === B.REDSTONE_LAMP, 8000, 'lamp off');
    d.report.switchGestureEvidence = await d.page.evaluate(() => ({ transitions: window.leverTrace, events: window.actualMouseEvents.filter(event => event.target === 'game-canvas').slice(-4) }));
  });
  await d.stage('Save and reload the player-built circuit, preserving placements and switch state', async () => {
    await d.aim({ x: lever.x + .5, y: lever.y + .25, z: lever.z + .5 }); await d.click();
    await d.wait(async () => await d.block(lamp) === B.REDSTONE_LAMP_ON);
    await d.page.keyboard.press('Escape'); await d.wait(s => s.screen === 'pause');
    const id = (await d.snapshot()).worldId;
    await d.page.locator('[data-action="save"]').click(); await d.page.getByText('世界已保存', { exact: true }).waitFor();
    await d.page.reload(); await d.wait(s => s.screen === 'title', 180000);
    await d.page.locator('[data-action="worlds"]').click(); await d.page.locator(`[data-world="${id}"]`).click();
    await d.page.locator('[data-action="play-selected"]').click(); await d.wait(s => s.screen === 'ready', 180000); await d.enter();
    assert.ok(await d.state(lever) & 8); assert.equal(await d.block(lamp), B.REDSTONE_LAMP_ON);
    await d.aim({ x: lever.x + .5, y: lever.y + .25, z: lever.z + .5 }); await d.click(); await d.wait(async () => await d.block(lamp) === B.REDSTONE_LAMP);
  });
  await d.stage('Build an upward piston, power it with the same circuit, and retract it', async () => {
    await d.mine(lamp); await d.catalogue(B.PISTON, 5);
    // Looking down places an upward-facing piston, as exposed by its real state.
    await d.flyTo({ x: lamp.x + .5, y: lamp.y + 3, z: lamp.z + 1 }); await d.placeAt(B.PISTON, lamp);
    assert.equal(await d.state(lamp) & 7, 4);
    const cargo = { ...lamp, y: lamp.y + 1 }; await d.catalogue(B.STONE, 0); await d.placeAt(B.STONE, cargo);
    await d.flyTo({ x: anchor.x + 1.5, y: anchor.y + 3, z: anchor.z + 2.5 });
    await d.aim({ x: lever.x + .5, y: lever.y + .25, z: lever.z + .5 }); await d.click();
    await d.wait(async () => await d.block(cargo) === B.PISTON_HEAD, 8000, 'piston extends');
    assert.equal(await d.block({ ...cargo, y: cargo.y + 1 }), B.STONE);
    await d.aim({ x: lamp.x + .5, y: lamp.y + 1.1, z: lamp.z + .5 }); await d.screenshot('03-piston-extended');
    await d.aim({ x: lever.x + .5, y: lever.y + .25, z: lever.z + .5 }); await d.click();
    await d.wait(async () => await d.block(cargo) === B.AIR, 8000, 'piston retracts');
    assert.equal(await d.state(lamp) & 8, 0); assert.equal(await d.block({ ...cargo, y: cargo.y + 1 }), B.STONE);
    await d.aim({ x: lamp.x + .5, y: lamp.y + 1.1, z: lamp.z + .5 }); await d.screenshot('04-piston-retracted');
  });
} catch (error) { failure = error; process.exitCode = 1; }
finally { await d.finish(failure); }
