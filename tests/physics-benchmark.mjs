import fs from 'node:fs';
import { World } from '../src/core/world.js';
import { B } from '../src/core/blocks.js';
import { bodyBox, obstacles, intersects, collides } from '../src/core/physics.js';

const world=new World('physics-benchmark');
for(let x=-8;x<8;x++)for(let z=-8;z<8;z++){world.set(x,109,z,B.STONE,0,false);if((x+z)%3===0)world.set(x,110,z,B.OAK_STAIRS,(x+z)&7,false);}
const bodies=Array.from({length:2000},(_,i)=>({pos:{x:(i*37%150)/10-7.5,y:109.7+(i%7)*.15,z:(i*17%150)/10-7.5},width:.6,height:1.95}));
const reference=(w,b)=>{const box=bodyBox(b);return obstacles(w,box).some(o=>intersects(box,o));};
const measure=fn=>{let hits=0;const start=performance.now();for(let r=0;r<20;r++)for(const b of bodies)hits+=+fn(world,b);return{milliseconds:performance.now()-start,hits};};
measure(reference);measure(collides);
const result={scope:'Node CPU microbenchmark; not a browser FPS claim',checks:40000,reference:[],current:[]};
for(let i=0;i<5;i++){result.reference.push(measure(reference));result.current.push(measure(collides));}
if(result.reference.some((r,i)=>r.hits!==result.current[i].hits))throw new Error('Collision benchmark changed results');
fs.mkdirSync('tests/artifacts',{recursive:true});fs.writeFileSync('tests/artifacts/physics-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
