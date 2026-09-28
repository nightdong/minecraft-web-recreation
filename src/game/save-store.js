/** Lightweight metadata and full world payload commit atomically. */
export class SaveStore {
  constructor(name = 'voxel-worlds-v1') {
    this.name=name; this.db=null; this.opening=null;
    this.stats={loads:0,lists:0,saves:0,lastWriteMs:0,maxWriteMs:0};
  }
  static metadata(data) { const {id,name,seed,updated,mode,thumbnail,playTime}=data;return {id,name,seed,updated,mode,thumbnail,playTime}; }
  async open() {
    if(this.db)return this.db;if(this.opening)return this.opening;
    this.opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open(this.name,2);let cancelled=false;
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('worlds'))db.createObjectStore('worlds',{keyPath:'id'});
        if(!db.objectStoreNames.contains('metadata')){
          const metadata=db.createObjectStore('metadata',{keyPath:'id'}),cursor=request.transaction.objectStore('worlds').openCursor();
          cursor.onsuccess=()=>{const row=cursor.result;if(row){metadata.put(SaveStore.metadata(row.value));row.continue();}};
        }
      };
      request.onblocked=()=>{cancelled=true;reject(new Error('存档升级被其他标签页占用。请关闭旧版游戏标签页后重试；原存档未被删除。'));};
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        if(cancelled){request.result.close();return;}
        const connection=request.result;this.db=connection;
        connection.onversionchange=()=>{connection.close();if(this.db===connection)this.db=null;};
        connection.onclose=()=>{if(this.db===connection)this.db=null;};resolve(connection);
      };
    });
    try{return await this.opening;}finally{this.opening=null;}
  }
  async request(mode,operation,storeName='worlds'){
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,mode);let result;
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('存档事务失败'));
      try{const request=operation(tx.objectStore(storeName));request.onsuccess=()=>{result=request.result;};request.onerror=()=>reject(request.error);}catch(error){tx.abort();reject(error);}
    });
  }
  async list(){this.stats.lists++;return(await this.request('readonly',s=>s.getAll(),'metadata')).sort((a,b)=>b.updated-a.updated);}
  load(id){this.stats.loads++;return this.request('readonly',s=>s.get(id));}
  async save(data){
    const db=await this.open(),started=performance.now(),value={...data,format:1,updated:Date.now()};
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(['worlds','metadata'],'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('保存事务失败'));
      try{tx.objectStore('worlds').put(value);tx.objectStore('metadata').put(SaveStore.metadata(value));}catch(error){tx.abort();reject(error);}
    });
    this.stats.saves++;this.stats.lastWriteMs=performance.now()-started;this.stats.maxWriteMs=Math.max(this.stats.maxWriteMs,this.stats.lastWriteMs);return data.id;
  }
  async delete(id){
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction(['worlds','metadata'],'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('删除事务失败'));
      tx.objectStore('worlds').delete(id);tx.objectStore('metadata').delete(id);
    });
  }
  close(){this.db?.close();this.db=null;}
}
