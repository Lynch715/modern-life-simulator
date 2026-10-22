/* 离线策略回归，不替代物理设备安装验收。 */
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const listeners={},data=new Map(),events=[],cacheNames=new Set(['mls-old']),origin='http://127.0.0.1:8765';let offline=false,skipped=false;
const key=req=>new URL(typeof req==='string'?req:req.url,origin+'/').href;
const cache={async addAll(xs){for(const x of xs){const f=x==='./'?'index.html':x.replace(/^\.\//,'');assert(fs.existsSync(path.join(root,f)),f);data.set(key(x),new Response('shell:'+x));}events.push(['install',xs.length]);},async put(req,r){data.set(key(req),r)},async keys(){return [...data.keys()].map(url=>({url}))}};
const caches={async open(name){cacheNames.add(name);return cache},async keys(){return [...cacheNames]},async delete(name){return cacheNames.delete(name)},async match(req){const r=data.get(key(req));return r&&r.clone()}};
vm.runInNewContext(source,{self:{addEventListener:(k,fn)=>listeners[k]=fn,clients:{claim:async()=>events.push(['claim'])},skipWaiting:()=>{skipped=true}},caches,location:{origin},URL,fetch:async()=>{if(offline)throw Error('offline');return new Response('network')},Promise});
async function fire(type){let p;listeners[type]({waitUntil:x=>p=x});await p;}
async function request(url,method='GET'){let p;listeners.fetch({request:{url,method},respondWith:x=>p=x});return p?await p:null;}
(async()=>{
 await fire('install');await fire('activate');assert(!cacheNames.has('mls-old'));assert(cacheNames.has('mls-v38-panel-20261022'));
 assert(await request('https://api.example.test/v1')===null);assert(await request(origin+'/index.html','POST')===null);
 const online=await request(origin+'/index.html');assert(await online.text()==='network');await Promise.resolve();
 offline=true;const saved=await request(origin+'/index.html');assert(await saved.text()==='network');
 const fallback=await request(origin+'/missing.html');assert(await fallback.text()==='network');
 const picture=await request(origin+'/assets/art/scenes/cover_arrival.webp');assert((await picture.text()).startsWith('shell:'));
 listeners.message({data:'skipWaiting'});assert(skipped);
 console.log('PASS：离线壳资源存在、缓存升级、网络优先、离线回退、图片缓存、接口隔离和更新激活');
})().catch(e=>{console.error(e);process.exitCode=1});
