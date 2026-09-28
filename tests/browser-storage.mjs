import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SaveStore } from '../src/game/save-store.js';

const started=new Date().toISOString(),out=path.resolve('tests/artifacts');fs.mkdirSync(out,{recursive:true});
const report={started,scope:'Isolated actual IndexedDB component tests using the production SaveStore class; not gameplay state injection',stages:[],errors:[]};
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
try{
  await page.route('**/storage-component',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated storage regression</title>'}));
  await page.goto((process.env.GAME_URL||'http://localhost:5173')+'/storage-component');
  await page.addScriptTag({content:`window.TestSaveStore=${SaveStore.toString()};`});
  const result=await page.evaluate(async()=>{
    const name='isolated-storage-regression-'+crypto.randomUUID(),events=[];
    const legacy=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('worlds',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=legacy.transaction('worlds','readwrite');tx.objectStore('worlds').put({id:'legacy',name:'legacy world',seed:'fixed',updated:1,mode:'survival',worlds:{large:Array(10000).fill(42)}});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    legacy.close();
    const store=new TestSaveStore(name),connections=await Promise.all([store.open(),store.open(),store.open()]);
    if(!connections.every(db=>db===connections[0]))throw new Error('Concurrent opens did not share a connection');
    const reads=[],getAll=IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll=function(...args){reads.push(this.name);return getAll.apply(this,args);};
    const migrated=await store.list(),payload=await store.load('legacy');
    if(migrated.length!==1||migrated[0].worlds!==undefined||payload.worlds.large.length!==10000)throw new Error('Legacy migration lost payload or exposed it to the list');
    if(reads.some(name=>name!=='metadata'))throw new Error('World list performed a full-payload scan');
    events.push({name:'Legacy migration and metadata-only list',status:'passed',reads});
    await store.save({id:'new',name:'new world',mode:'creative',seed:3,player:{x:9},worlds:{test:[1,2,3]}});
    const previous=await store.load('new');let aborted=false;
    try{await store.save({id:'new',name:'must not be committed',invalid:()=>{}});}catch{aborted=true;}
    const after=await store.load('new'),list=await store.list();
    if(!aborted||JSON.stringify(after)!==JSON.stringify(previous)||list.find(w=>w.id==='new').name!=='new world')throw new Error('Failed save partially committed');
    events.push({name:'Atomic metadata/payload rollback on a failed write',status:'passed'});
    store.close();const reopened=new TestSaveStore(name);const loaded=await reopened.load('new');if(loaded.player.x!==9)throw new Error('Reopen lost persisted save');
    await reopened.delete('new');if((await reopened.list()).some(w=>w.id==='new')||await reopened.load('new'))throw new Error('Atomic delete left one store behind');
    events.push({name:'Close, reopen, persist and atomic deletion',status:'passed'});
    const stats={...store.stats};reopened.close();IDBObjectStore.prototype.getAll=getAll;
    await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
    return {events,stats,metadataBytes:JSON.stringify(migrated).length,payloadBytes:JSON.stringify(payload).length};
  });
  report.stages=result.events;report.metrics=result;assert.equal(result.events.length,3);report.status='passed';console.log(JSON.stringify(result,null,2));
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error);}
finally{
  report.finished=new Date().toISOString();fs.writeFileSync(path.join(out,'storage-report.json'),JSON.stringify(report,null,2));
  const archive=path.join(out,'storage-runs',started.replace(/[:.]/g,'-'));fs.mkdirSync(archive,{recursive:true});fs.copyFileSync(path.join(out,'storage-report.json'),path.join(archive,'storage-report.json'));
  await browser.close();
}
