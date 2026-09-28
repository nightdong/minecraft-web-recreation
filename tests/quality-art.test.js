import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, qualityPresets } from '../src/game/storage.js';
import { paintTerrainTexture } from '../src/render/terrain-art.js';
import { paintHostileTexture, HOSTILE_TEXTURES } from '../src/render/hostile-art.js';
import { GameAudio } from '../src/game/audio.js';

test('every explicit quality preset survives validation and corrupt resolution/particle settings stay bounded',()=>{
  for(const [name,preset]of Object.entries(qualityPresets)){const s=sanitizeSettings(preset);assert.equal(s.quality,name);assert.equal(s.pixelScale,preset.pixelScale);assert.equal(s.particleLimit,preset.particleLimit);}
  const s=sanitizeSettings({quality:'unexpected',pixelScale:500,particleLimit:1e9});assert.equal(s.quality,'balanced');assert.equal(s.pixelScale,1.5);assert.equal(s.particleLimit,768);
});
test('original pixel painters are deterministic and produce finite coordinates without external assets',()=>{
  const context=()=>({fillStyle:'',draws:[],fillRect(...args){assert.ok(args.every(Number.isFinite));this.draws.push([this.fillStyle,...args]);}});
  for(const [paint,names]of [[paintHostileTexture,HOSTILE_TEXTURES],[paintTerrainTexture,['stone','grass_top','dirt','oak_leaves','diamond_ore','spruce_planks']]])for(const name of names){const a=context(),b=context();assert.equal(paint(a,name),true);assert.equal(paint(b,name),true);assert.ok(a.draws.length>150);assert.deepEqual(a.draws,b.draws);}
});
test('voice completion disconnects all Web Audio nodes and releases the bounded voice registry',()=>{
  const audio=new GameAudio({}),events=[],source={disconnect(){events.push('source');}},gain={disconnect(){events.push('gain');}},filter={disconnect(){events.push('filter');}};
  audio.trackVoice(source,[gain,filter]);assert.equal(audio.voices.size,1);source.onended();assert.equal(audio.voices.size,0);assert.deepEqual(events,['source','gain','filter']);
});
