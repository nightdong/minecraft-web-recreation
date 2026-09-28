import { hash, seedNumber } from '../core/noise.js';

const ORES={coal:'#455257',iron:'#c09e80',gold:'#dabb69',diamond:'#69c3b4',redstone:'#b96657',lapis:'#658daf'};
/** Original layered-stone / woven-grass art direction. Broad pixel clusters
 * retain a readable surface at distance; isolated high-contrast noise is rare. */
export function paintTerrainTexture(ctx,name){
  const ore=name.endsWith('_ore')?name.slice(0,-4):null;
  const supported=['stone','dirt','grass_side','grass_top','cobblestone','sand','gravel','oak_planks','birch_planks','spruce_planks','oak_leaves','birch_leaves','spruce_leaves'];
  if(!supported.includes(name)&&!ORES[ore])return false;
  const seed=seedNumber(name),rect=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(x,y,w,h);};
  const paint=(base,grain=12)=>{
    for(let y=0;y<16;y++)for(let x=0;x<16;x++){
      const n=(hash(x>>1,y>>1,4,seed)-.5)*grain+(hash(x,y,8,seed)-.5)*4;
      rect(x,y,1,1,`rgb(${base.map(c=>Math.round(c+n)).join(',')})`);
    }
  };
  if(name==='stone'||ore){
    paint([123,134,136],16);
    for(const [x,y,w] of [[1,3,5],[9,6,6],[3,10,7],[12,14,4]]){rect(x,y,w,1,'#6b777b');rect(x+1,y-1,w-1,1,'#939e9b');}
    if(ore){for(const [x,y]of [[3,3],[11,5],[6,10],[12,13]]){rect(x-1,y,4,2,'#606e70');rect(x,y-1,2,3,ORES[ore]);rect(x,y-1,1,1,'#ddd4ae');}}
  }else if(name==='dirt'||name==='grass_side'){
    paint([129,102,75],20);
    for(const [x,y]of [[2,5],[9,8],[4,13],[13,2]]){rect(x,y,2,1,'#927e60');rect(x+1,y+1,2,1,'#635b49');}
    if(name==='grass_side')for(let x=0;x<16;x++){const edge=3+(hash(x>>1,8,1,seed)*3|0);rect(x,0,1,edge,'#75945c');rect(x,edge,1,1,'#536e48');}
  }else if(name==='grass_top'){
    paint([112,146,87],19);
    for(let i=0;i<18;i++){const x=hash(i,1,0,seed)*16|0,y=hash(i,2,0,seed)*16|0;rect(x,y,2,1,'#859e68');rect(x+1,y+1,1,1,'#617f4e');}
  }else if(name==='cobblestone'){
    paint([90,103,105],9);
    for(let row=0;row<4;row++)for(let col=-1;col<4;col++){
      const x=col*5+(row%2)*2,y=row*4;rect(x+1,y+1,4,3,'#83908e');rect(x+1,y+1,3,1,'#a3ada2');rect(x+4,y+2,1,2,'#657475');
    }
  }else if(name==='sand'){paint([205,188,139],12);for(let i=0;i<18;i++)rect(hash(i,2,1,seed)*16|0,hash(i,3,1,seed)*16|0,2,1,'#c0b082');}
  else if(name==='gravel'){paint([127,129,119],23);for(let i=0;i<24;i++){const x=hash(i,1,4,seed)*16|0,y=hash(i,2,4,seed)*16|0;rect(x,y,2,2,'#9b9f8e');rect(x,y+2,2,1,'#646f69');}}
  else if(name.endsWith('_planks')){
    const base=name.startsWith('birch')?[186,175,130]:name.startsWith('spruce')?[106,91,68]:[163,132,88];paint(base,14);
    for(let y=3;y<16;y+=4)rect(0,y,16,1,`rgb(${base.map(c=>Math.round(c*.62)).join(',')})`);
    for(const [x,y]of [[5,0],[12,4],[3,8],[10,12]]){rect(x,y,1,3,`rgb(${base.map(c=>Math.round(c*.71)).join(',')})`);rect((x+4)%16,y+1,3,1,`rgb(${base.map(c=>Math.round(c*.87)).join(',')})`);}
  }else{
    const base=name.startsWith('birch')?[97,131,77]:name.startsWith('spruce')?[53,95,81]:[69,117,72];
    for(let y=0;y<16;y++)for(let x=0;x<16;x++){
      const cell=hash(x>>1,y>>1,6,seed),n=(cell-.5)*33;
      if(cell<.15&&((x+y)&1))continue;
      rect(x,y,1,1,`rgb(${base.map(c=>Math.round(c+n)).join(',')})`);
      if((x+y*3)%7===0)rect(x,y,1,1,`rgb(${base.map(c=>Math.round(c+23)).join(',')})`);
    }
  }
  return true;
}
