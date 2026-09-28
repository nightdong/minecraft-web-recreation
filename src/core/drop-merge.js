import { items } from './blocks.js';
import { compatible } from './inventory.js';

/** Spatial broad phase preserves exact stack compatibility and 0.8-block
 * distance, without testing every distant pair after a large explosion. */
export function mergeNearbyDrops(drops, loaded = () => true) {
  const bins=new Map();let comparisons=0,merged=0;
  for(const drop of drops){
    if(drop.dead||!drop.stack||!loaded(drop))continue;
    const x=Math.floor(drop.pos.x),y=Math.floor(drop.pos.y),z=Math.floor(drop.pos.z);
    for(let dz=-1;dz<=1&&drop.stack.count;dz++)for(let dy=-1;dy<=1&&drop.stack.count;dy++)for(let dx=-1;dx<=1&&drop.stack.count;dx++){
      const bucket=bins.get(`${x+dx},${y+dy},${z+dz}`);if(!bucket)continue;
      for(const previous of bucket){
        comparisons++;
        if(previous.dead||!compatible(previous.stack,drop.stack)||Math.hypot(previous.pos.x-drop.pos.x,previous.pos.y-drop.pos.y,previous.pos.z-drop.pos.z)>.8)continue;
        const amount=Math.min(items[drop.stack.id].stack-previous.stack.count,drop.stack.count);
        previous.stack.count+=amount;drop.stack.count-=amount;merged+=amount;
        if(!drop.stack.count){drop.dead=true;break;}
      }
    }
    if(!drop.dead){const key=`${x},${y},${z}`;let bucket=bins.get(key);if(!bucket){bucket=[];bins.set(key,bucket);}bucket.push(drop);}
  }
  return {comparisons,merged,bins:bins.size};
}
