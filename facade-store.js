const dbName='winthrop-original-facades';
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore('walls',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function transact(mode,work){const db=await open();try{return await new Promise((resolve,reject)=>{const t=db.transaction('walls',mode),r=work(t.objectStore('walls'));t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}finally{db.close();}}
export const allFacades=()=>transact('readonly',s=>s.getAll());
export const saveFacade=r=>transact('readwrite',s=>s.put(r));
export const deleteFacade=id=>transact('readwrite',s=>s.delete(id));
