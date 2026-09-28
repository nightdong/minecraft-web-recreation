import { PlayDriver } from './browser-driver.mjs';
import { B, I } from '../src/core/blocks.js';
import assert from 'node:assert/strict';

const d = new PlayDriver(); let failure, base, source, torch, sources, initialTorches;
async function waterNear(center, radius = 4) {
  return d.page.evaluate(({ center, radius }) => {
    const result = [];
    for (let y = center.y - 2; y <= center.y + 1; y++) for (let x = center.x - radius; x <= center.x + radius; x++) for (let z = center.z - radius; z <= center.z + radius; z++) {
      if (window.voxelDiagnostics.block(x, y, z) === 8) result.push({ x, y, z, level: window.voxelDiagnostics.blockState(x, y, z) });
    }
    return result;
  }, { center, radius });
}
try {
  await d.open('fluids'); await d.create();
  await d.stage('Pour a real water bucket onto a player-built pedestal and observe downstream flow', async () => {
    await d.catalogue(B.STONE, 0); await d.catalogue(I.WATER_BUCKET, 1); await d.catalogue(I.BUCKET, 2); await d.catalogue(B.TORCH, 3);
    await d.select(0); base = await d.placeOnGround(B.STONE); source = { ...base, y: base.y + 1 };
    await d.flyTo({ x: base.x + 1.8, y: base.y + 2, z: base.z + 1.8 });
    torch = { x: base.x + 1, y: base.y + 1, z: base.z };
    const torchSupport = { ...torch, y: torch.y - 1 };
    if (await d.block(torchSupport) && await d.block(torchSupport) !== B.STONE) await d.mine(torchSupport);
    if (await d.block(torchSupport) !== B.STONE) await d.placeAt(B.STONE, torchSupport);
    await d.select(3); await d.placeAt(B.TORCH, torch);
    initialTorches = (await d.snapshot()).player.inventory.reduce((n, item) => n + (item?.id === B.TORCH ? item.count : 0), 0);
    await d.select(1); await d.aim({ x: base.x + .5, y: base.y + .999, z: base.z + .5 });
    assert.equal((await d.snapshot()).target?.id, B.STONE); await d.click();
    await d.wait(async () => await d.block(source) === B.WATER, 6000, 'water source placed');
    await d.wait(async () => (await waterNear(source)).some(cell => cell.level > 0), 10000, 'visible derived flow');
    await d.aim({ x: source.x + 1, y: source.y + .2, z: source.z + .5 }); await d.screenshot('01-source-and-stream');
    sources = (await waterNear(source)).filter(cell => cell.level === 0);
    assert.equal(sources.length, 1, 'One water bucket may not create arbitrary new sources');
    return { source, flowing: (await waterNear(source)).filter(cell => cell.level > 0).length };
  });
  await d.stage('Flow washes away a real placed torch and produces exactly one dropped torch', async () => {
    await d.wait(async () => await d.block(torch) === B.WATER, 10000, 'torch flooded');
    const state = await d.snapshot(), dropped = state.looseItems.filter(drop => drop.stack.id === B.TORCH);
    const loose = dropped.reduce((n, drop) => n + drop.stack.count, 0);
    const pickedUp = state.player.inventory.reduce((n, item) => n + (item?.id === B.TORCH ? item.count : 0), 0) - initialTorches;
    assert.equal(loose + pickedUp, 1, 'The washed torch must exist exactly once, whether still floating or already picked up');
    await d.screenshot('02-washed-torch');
    return { loose, pickedUp };
  });
  await d.stage('An empty bucket removes the source and all of its nearby flow recedes', async () => {
    await d.select(2); await d.aim({ x: source.x + .5, y: source.y + .5, z: source.z + .5 });
    assert.equal((await d.snapshot()).target?.id, B.WATER); await d.click();
    await d.wait(async () => await d.block(source) !== B.WATER, 5000, 'source scooped');
    await d.wait(async () => (await waterNear(source)).length === 0, 30000, 'derived flow drains');
    assert.equal(await d.block(base), B.STONE); await d.screenshot('03-stream-drained');
  });
  await d.stage('Two bucket sources form a renewable middle source above an actual solid floor', async () => {
    const line = [0, 1, 2].map(dx => ({ x: base.x + dx, y: base.y + 2, z: base.z }));
    await d.flyTo({ x: base.x + 1.5, y: base.y + 3, z: base.z + 2 }); await d.select(0);
    // Build the floor one layer above the former stream using normal block placement.
    for (const pos of line) {
      const support = { ...pos, y: pos.y - 1 };
      // Move to a side from which the supporting face is actually visible.
      // Extending a connected floor does not require filling the space below it.
      await d.flyTo({ x: pos.x + 1.4, y: base.y + 2.4, z: pos.z + 2 });
      if (await d.block(support) && await d.block(support) !== B.STONE) await d.mine(support);
      if (await d.block(support) !== B.STONE) await d.placeAt(B.STONE, support);
    }
    await d.select(1); await d.placeAt(B.WATER, line[0]); await d.placeAt(B.WATER, line[2]);
    await d.wait(async () => await d.block(line[1]) === B.WATER && await d.state(line[1]) === 0, 12000, 'renewed source');
    await d.aim({ x: line[1].x + .5, y: line[1].y + .4, z: line[1].z + .5 }); await d.screenshot('04-renewable-source');
    return { sources: line, centerLevel: await d.state(line[1]) };
  });
} catch (error) { failure = error; process.exitCode = 1; }
finally { await d.finish(failure); }
