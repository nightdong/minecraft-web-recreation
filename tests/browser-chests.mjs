import { PlayDriver } from './browser-driver.mjs';
import { B, I } from '../src/core/blocks.js';
import assert from 'node:assert/strict';

const d = new PlayDriver(); let failure, first, second;
const slot = (kind, i) => d.page.locator(`[data-kind="${kind}"][data-index="${i}"]`);
async function open(pos, count) {
  if ((await d.snapshot()).screen !== 'chest') { await d.aim({ x: pos.x + .5, y: pos.y + .45, z: pos.z + .5 }); await d.click(); }
  await d.wait(s => s.screen === 'chest', 8000, 'open chest');
  assert.equal(await d.page.locator('[data-kind="container"]').count(), count);
}
try {
  await d.open('chests'); await d.create();
  await d.stage('Build two adjacent chests and obtain a real 54-slot container', async () => {
    await d.catalogue(B.CHEST, 0); await d.catalogue(I.DIAMOND, 1); await d.catalogue(B.STONE, 2);
    await d.select(2); const base = await d.placeOnGround(B.STONE), neighbor = { ...base, z: base.z + 1 };
    await d.flyTo({ x: base.x + 3.1, y: base.y + 1.4, z: base.z + 1 });
    const existing = await d.block(neighbor); if (existing && existing !== B.STONE) await d.mine(neighbor);
    if (await d.block(neighbor) !== B.STONE) await d.placeAt(B.STONE, neighbor);
    first = { ...base, y: base.y + 1 }; second = { ...neighbor, y: neighbor.y + 1 };
    await d.select(0); await d.placeAt(B.CHEST, first);
    if ((await d.snapshot()).screen === 'chest') await d.closeInventory();
    await d.placeAt(B.CHEST, second);
    assert.equal(await d.state(first) & 3, 1); assert.equal(await d.state(second) & 3, 1);
    assert.ok(await d.state(first) & 4); assert.ok(await d.state(second) & 8);
    if ((await d.snapshot()).screen === 'chest') await d.closeInventory();
    await d.aim({ x: first.x + .5, y: first.y + .45, z: first.z + 1 }); await d.screenshot('01-large-chest');
    await open(first, 54);
    await d.wait(s => s.chests.some(chest => chest.positions.length === 2 && chest.open > .95), 5000, 'visible hinged lid opens');
    await d.screenshot('02-large-inventory');
  });
  await d.stage('Put actual items in both halves and preserve slot ownership across save/reload', async () => {
    await slot('inv', 1).click(); for (let i = 0; i < 3; i++) await slot('container', 0).click({ button: 'right' }); await slot('inv', 1).click();
    await slot('inv', 2).click(); await slot('container', 40).click();
    assert.equal(await slot('container', 0).locator('.stack-count').innerText(), '3');
    assert.equal(await slot('container', 40).locator('.stack-count').innerText(), '64');
    await d.closeInventory(); await d.wait(s => s.chests.every(chest => chest.open === 0), 5000, 'lid closes');
    await d.page.keyboard.press('Escape'); await d.wait(s => s.screen === 'pause'); const id = (await d.snapshot()).worldId;
    await d.page.locator('[data-action="save"]').click(); await d.page.getByText('世界已保存', { exact: true }).waitFor();
    await d.page.reload(); await d.wait(s => s.screen === 'title', 180000);
    await d.page.locator('[data-action="worlds"]').click(); await d.page.locator(`[data-world="${id}"]`).click(); await d.page.locator('[data-action="play-selected"]').click();
    await d.wait(s => s.screen === 'ready', 180000); await d.enter(); await open(second, 54);
    assert.equal(await slot('container', 0).getAttribute('data-item'), String(I.DIAMOND));
    assert.equal(await slot('container', 0).locator('.stack-count').innerText(), '3');
    assert.equal(await slot('container', 40).getAttribute('data-item'), String(B.STONE));
    assert.equal(await slot('container', 40).locator('.stack-count').innerText(), '64');
    await d.screenshot('03-reloaded-inventory'); await d.closeInventory();
  });
  await d.stage('Break only one half, keep the other half and drop exactly the removed contents', async () => {
    const before = (await d.snapshot()).player.inventory.reduce((n, item) => n + (item?.id === I.DIAMOND ? item.count : 0), 0);
    await d.mine(first); await open(second, 27);
    assert.equal(await slot('container', 13).getAttribute('data-item'), String(B.STONE));
    assert.equal(await slot('container', 13).locator('.stack-count').innerText(), '64');
    const state = await d.snapshot();
    const acquired = state.player.inventory.reduce((n, item) => n + (item?.id === I.DIAMOND ? item.count : 0), 0) - before;
    const dropped = state.looseItems.filter(drop => drop.stack.id === I.DIAMOND).reduce((n, drop) => n + drop.stack.count, 0);
    assert.equal(acquired + dropped, 3); assert.equal(await d.state(second) & 12, 0);
    await d.screenshot('04-single-chest-preserved'); await d.closeInventory();
    return { diamondsAccountedFor: acquired + dropped, remainingStone: 64 };
  });
} catch (error) { failure = error; process.exitCode = 1; }
finally { await d.finish(failure); }
