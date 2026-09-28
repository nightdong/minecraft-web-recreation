import { PlayDriver } from './browser-driver.mjs';
import { B, I } from '../src/core/blocks.js';
import assert from 'node:assert/strict';

const d = new PlayDriver(); let failure;
try {
  await d.open('environment'); await d.create();
  let base;
  await d.stage('Use flint and steel to ignite an actual animated fire block', async () => {
    await d.catalogue(B.NETHERRACK, 0); await d.catalogue(I.FLINT_STEEL, 1); await d.select(0);
    base = await d.placeOnGround(B.NETHERRACK); await d.select(1);
    await d.aim({ x: base.x + .5, y: base.y + .999, z: base.z + .5 });
    const target = (await d.snapshot()).target; assert.equal(target?.id, B.NETHERRACK); assert.equal(target.normal[1], 1);
    await d.click(); await d.wait(async () => await d.block({ ...base, y: base.y + 1 }) === B.FIRE, 5000, 'fire ignited');
    await d.aim({ x: base.x + .5, y: base.y + 1.4, z: base.z + .5 }); await d.screenshot('01-fire');
    await d.page.waitForTimeout(1200); assert.equal(await d.block({ ...base, y: base.y + 1 }), B.FIRE);
    return { base, fire: { ...base, y: base.y + 1 } };
  });
  await d.stage('Extinguish the same fire with a real left click', async () => {
    assert.equal((await d.snapshot()).target?.id, B.FIRE); await d.click('left');
    await d.wait(async () => await d.block({ ...base, y: base.y + 1 }) === B.AIR, 5000, 'fire extinguished');
    assert.equal(await d.block(base), B.NETHERRACK); await d.screenshot('02-extinguished');
  });
  await d.stage('Hoe soil, plant seeds, grow wheat using bone meal, and harvest', async () => {
    await d.catalogue(I.IRON_HOE, 2); await d.catalogue(I.SEEDS, 3); await d.catalogue(I.BONE_MEAL, 4); await d.select(2);
    const soil = await d.ground(); assert.ok([B.GRASS, B.DIRT].includes(soil.id));
    await d.click(); await d.wait(async () => await d.block(soil) === B.FARMLAND, 5000, 'soil tilled');
    await d.select(3); await d.aim({ x: soil.x + .5, y: soil.y + .936, z: soil.z + .5 }); await d.click();
    const crop = { x: soil.x, y: soil.y + 1, z: soil.z };
    await d.wait(async () => await d.block(crop) === B.WHEAT0, 5000, 'seeds planted');
    await d.select(4);
    for (let i = 0; i < 5 && await d.block(crop) !== B.WHEAT7; i++) {
      await d.aim({ x: crop.x + .5, y: crop.y + .35, z: crop.z + .5 }); await d.click();
    }
    assert.equal(await d.block(crop), B.WHEAT7); await d.screenshot('03-grown-wheat');
    await d.click('left'); await d.wait(async () => await d.block(crop) === B.AIR); assert.equal(await d.block(soil), B.FARMLAND);
  });
} catch (error) { failure = error; process.exitCode = 1; }
finally { await d.finish(failure); }
