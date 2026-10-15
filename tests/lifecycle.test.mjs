import { build } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const bundle = await build({
    stdin: { contents: `export {SyncController} from './src/sync/controller';
        export {LocalFS,isSyncWrite} from './src/fs/local';
        export {SyncLockedError} from './src/sync/manifest';
        export {SyncQueue} from './src/sync/queue';
        export {registerSyncTriggers} from './src/sync/triggers';
        export {renderSyncStatus} from './src/ui/status-bar';
        export {TFile,Notice} from 'obsidian';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'obsidian-double', setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
            export class TFile { constructor(path) {this.path=path;this.stat={mtime:1,size:1};} }
            export class Notice { static messages=[]; constructor(message) {Notice.messages.push(message);} hide() {} setMessage(m) {Notice.messages.push(m);} }
            export const setIcon=(el,value)=>{el.icon=value;};export const setTooltip=(el,value)=>{el.tooltip=value;};
            export const getLanguage=()=> 'en';export const requestUrl=()=> {throw Error('Unexpected network');};` }));
    } }]
});
const { SyncController, SyncQueue, registerSyncTriggers, renderSyncStatus, LocalFS, isSyncWrite, SyncLockedError, TFile, Notice } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
Error.stackTraceLimit=3;
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const bytes=value=>new TextEncoder().encode(value).buffer;

function setup(configured=true) {
    const timers=new Map();const delays=[];let nextTimer=0;
    globalThis.window={navigator:{onLine:true},setTimeout(fn,delay){delays.push(delay);timers.set(++nextTimer,fn);return nextTimer;},clearTimeout(id){timers.delete(id);}};
    Notice.messages=[];
    const files=new Map([['a.md',new TFile('a.md')]]);const contents=new Map([['a.md',bytes('A')]]);const storage=new Map();
    const events=[];const states=[];const counts=[];const calls=[];const signals=[];let operation=async()=>false;
    const app={loadLocalStorage:key=>storage.get(key),saveLocalStorage:(key,value)=>storage.set(key,value),
        vault:{configDir:'.obsidian',getFiles:()=>[...files.values()],getAbstractFileByPath:path=>files.get(path),
            readBinary:async file=>contents.get(file.path),
            process:async(file,fn)=>{const value=fn(new TextDecoder().decode(contents.get(file.path)));contents.set(file.path,bytes(value));controller.fileChanged(file);return value;},
            modifyBinary:async(file,value)=>{contents.set(file.path,value);controller.fileChanged(file);},
            createBinary:async(path,value)=>{const file=new TFile(path);files.set(path,file);contents.set(path,value);controller.fileChanged(file);},
            createFolder:async()=>{}},
        fileManager:{trashFile:async file=>{files.delete(file.path);contents.delete(file.path);controller.fileChanged(file,file.path);}},
        workspace:{trigger:event=>events.push(event),getActiveFile:()=>files.get('a.md')}};
    const plugin={app,settings:{nasUrl:configured?'https://nas.test':'',username:'user',password:'password',sid:configured?'sid':'',syncFolder:'/mydrive/test'},
        updateStatusBar:(state,count)=>{states.push(state);counts.push(count);},saveSettings:async()=>controller.settingsChanged(),
        getEngine:async signal=>{signals.push(signal);return {runSync:async full=>{calls.push(full);return operation();}};}};
    const controller=new SyncController(plugin);controller.initialize();
    return {controller,plugin,app,files,contents,storage,timers,delays,calls,signals,states,counts,events,setOperation(fn){operation=fn;},
        async ready(){controller.layoutReady();await flush();},
        async tick(){const entries=[...timers.entries()];timers.clear();for(const [,fn]of entries)fn();await flush();}};
}

test('unconfigured startup and automatic polls do not show repeated errors',async()=>{
    const d=setup(false);await d.ready();await d.controller.runSync(false);await d.controller.runSync(false);
    assert.deepEqual(d.calls,[]);assert.deepEqual(Notice.messages,[]);d.controller.dispose();
});

test('user deletion during sync is retained and schedules a follow-up',async()=>{
    const d=setup();await d.ready();let finish;d.setOperation(()=>new Promise(resolve=>{finish=resolve;}));
    const running=d.controller.runSync(false);await flush();const file=d.files.get('a.md');d.files.delete('a.md');
    d.controller.fileChanged(file,file.path);assert.ok(d.controller.deletions.pending.has('a.md'));
    finish(false);await running;d.setOperation(async()=>false);await d.tick();
    assert.equal(d.calls.length,3);assert.ok(d.controller.deletions.pending.has('a.md'));d.controller.dispose();
});

test('renamed descendants remain observed when deleted before the next sync',async()=>{
    const d=setup();await d.ready();d.files.delete('a.md');const renamed=new TFile('folder/b.md');d.files.set(renamed.path,renamed);
    d.controller.fileChanged(renamed,'a.md');d.files.delete(renamed.path);d.controller.fileChanged(renamed,renamed.path);
    assert.ok(d.controller.deletions.pending.has('a.md'));assert.ok(d.controller.deletions.pending.has('folder/b.md'));d.controller.dispose();
});

test('sync filesystem events do not become user changes or deletion intent',async()=>{
    const d=setup();await d.ready();const fs=new LocalFS(d.app);
    await fs.writeChecked('a.md',bytes('remote'),bytes('A'));await fs.delete('a.md');
    assert.equal(d.controller.deletions.pending.size,0);assert.equal(d.timers.size,0);
    assert.equal(isSyncWrite(d.app,'a.md'),false);d.controller.dispose();
});

test('changing NAS invalidates SID and cancels the captured connection',async()=>{
    const d=setup();await d.ready();let finish;d.setOperation(()=>new Promise(resolve=>{finish=resolve;}));
    const running=d.controller.runSync(false);await flush();const before=d.plugin.settings.lastSyncTime;
    d.plugin.settings.nasUrl='https://other.test';d.controller.settingsChanged();
    assert.equal(d.plugin.settings.sid,'');assert.equal(d.signals.at(-1).aborted,true);
    finish(true);await running;assert.equal(d.plugin.settings.lastSyncTime,undefined);assert.ok(before);d.controller.dispose();
});

test('unloading cancels work and prevents success notifications or scheduled retries',async()=>{
    const d=setup();await d.ready();let finish;d.setOperation(()=>new Promise(resolve=>{finish=resolve;}));
    const running=d.controller.runSync(false,true);await flush();d.controller.fileChanged(d.files.get('a.md'));
    const events=d.events.length;d.controller.dispose();assert.equal(d.signals.at(-1).aborted,true);
    finish(true);await running;assert.equal(d.events.length,events);assert.equal(d.timers.size,0);
});

test('normal automatic lock contention waits without an error notice',async()=>{
    const d=setup();d.setOperation(async()=>{throw new SyncLockedError();});await d.ready();
    assert.equal(Notice.messages.length,0);assert.equal(d.plugin.settings.lastSyncTime,undefined);
    assert.equal(d.states.at(-1),'waiting-lock');assert.equal(d.timers.size,1);d.controller.dispose();
});

test('queue coalesces edits, survives reload, and only acknowledges the captured generation',()=>{
    const d=setup();const queue=new SyncQueue(d.app,'target');queue.mark(['a.md','a.md','b.md','../escape']);
    const batch=queue.snapshot();assert.equal(batch.size,2);
    queue.mark(['a.md']);queue.complete(batch);
    const reloaded=new SyncQueue(d.app,'target');assert.deepEqual([...reloaded.snapshot().keys()],['a.md']);
    assert.equal(new SyncQueue(d.app,'other-target').snapshot().size,0);
    const otherApp={loadLocalStorage:()=>null,saveLocalStorage:()=>{}};
    assert.equal(new SyncQueue(otherApp,'target').snapshot().size,0);d.controller.dispose();
});

test('failed queue acknowledgement keeps pending work in memory and on disk',()=>{
    const d=setup();const queue=new SyncQueue(d.app,'target');queue.mark(['a.md']);
    const save=d.app.saveLocalStorage;d.app.saveLocalStorage=()=>{throw Error('disk full');};
    assert.throws(()=>queue.complete(queue.snapshot()),/disk full/);
    assert.equal(queue.snapshot().size,1);d.app.saveLocalStorage=save;
    assert.equal(new SyncQueue(d.app,'target').snapshot().size,1);d.controller.dispose();
});

test('malformed queue entries cannot introduce unsafe paths',()=>{
    const app={loadLocalStorage:()=>({schemaVersion:1,entries:[['../a','token'],['.obsidian/a','token'],['ok.md','token'],['bad.md',4],null]}),saveLocalStorage:()=>{}};
    assert.deepEqual([...new SyncQueue(app).snapshot().keys()],['ok.md']);
});

test('offline edits survive controller reload and resume synchronizes immediately',async()=>{
    const d=setup();await d.ready();d.controller.networkOffline();d.controller.fileChanged(d.files.get('a.md'));
    assert.equal(d.controller.pendingCount,1);assert.equal(d.states.at(-1),'waiting-network');assert.equal(d.timers.size,0);
    d.controller.dispose();const reloaded=new SyncController(d.plugin);reloaded.initialize();reloaded.networkOffline();
    reloaded.layoutReady();await flush();assert.equal(reloaded.pendingCount,1);assert.equal(d.calls.length,1);
    reloaded.resume(true);await flush();assert.equal(d.calls.length,2);assert.equal(reloaded.pendingCount,0);
    assert.equal(d.states.at(-1),'idle');reloaded.dispose();
});

test('same-path edit during sync remains queued and is not reported as synced',async()=>{
    const d=setup();await d.ready();d.controller.fileChanged(d.files.get('a.md'));let finish;
    d.setOperation(()=>new Promise(resolve=>{finish=resolve;}));const running=d.controller.runSync(false,true);await flush();
    d.controller.fileChanged(d.files.get('a.md'));finish(true);await running;
    assert.equal(d.controller.pendingCount,1);assert.equal(d.states.at(-1),'pending');assert.equal(d.counts.at(-1),1);
    assert.match(Notice.messages.at(-1),/1 items pending/);
    d.setOperation(async()=>false);await d.tick();assert.equal(d.controller.pendingCount,0);assert.equal(d.states.at(-1),'idle');d.controller.dispose();
});

test('failed sync retains the queue for the next attempt',async t=>{
    t.mock.method(console,'error',()=>{});
    const d=setup();await d.ready();d.controller.fileChanged(d.files.get('a.md'));
    d.setOperation(async()=>{throw Error('permission denied');});await d.controller.runSync(false);
    assert.equal(d.controller.pendingCount,1);assert.equal(d.states.at(-1),'error');
    d.setOperation(async()=>false);await d.controller.runSync(false);assert.equal(d.controller.pendingCount,0);d.controller.dispose();
});

test('pending record persistence failure remains visible instead of showing idle',async()=>{
    const d=setup();await d.ready();d.app.saveLocalStorage=()=>{throw Error('storage full');};
    d.controller.fileChanged(d.files.get('a.md'));
    assert.equal(d.states.at(-1),'error');assert.equal(d.controller.pendingCount,1);
    assert.match(Notice.messages.at(-1),/Could not save pending sync changes/);d.controller.dispose();
});

test('settings save failure cannot acknowledge pending changes',async t=>{
    t.mock.method(console,'error',()=>{});
    const d=setup();await d.ready();d.controller.fileChanged(d.files.get('a.md'));
    d.plugin.saveSettings=async()=>{throw Error('disk full');};await d.controller.runSync(false);
    assert.equal(d.controller.pendingCount,1);assert.equal(d.states.at(-1),'error');d.controller.dispose();
});

test('single-file transfer leaves unrelated queued paths pending',async()=>{
    const d=setup();await d.ready();const b=new TFile('b.md');d.files.set(b.path,b);
    d.controller.fileChanged(d.files.get('a.md'));d.controller.fileChanged(b);
    d.plugin.getEngine=async()=>({syncFile:async()=>true});await d.controller.transferActiveFile('upload');
    assert.equal(d.controller.pendingCount,1);assert.equal(d.states.at(-1),'pending');d.controller.dispose();
});

test('force download does not acknowledge local-only files',async()=>{
    const d=setup();await d.ready();d.controller.fileChanged(d.files.get('a.md'));
    d.plugin.getEngine=async()=>({forceDownload:async()=>true});await d.controller.forceDownload();
    assert.equal(d.controller.pendingCount,1);assert.equal(d.states.at(-1),'pending');d.controller.dispose();
});

test('lock retry retains full verification, backs off, and recovers without notices',async()=>{
    const d=setup();d.setOperation(async()=>{throw new SyncLockedError();});await d.ready();
    assert.equal(d.delays.at(-1),6000);await d.tick();assert.equal(d.delays.at(-1),12000);
    assert.deepEqual(d.calls,[true,true]);d.setOperation(async()=>false);await d.tick();
    assert.deepEqual(d.calls,[true,true,true]);assert.equal(d.states.at(-1),'idle');assert.equal(d.timers.size,0);
    assert.equal(Notice.messages.length,0);d.controller.dispose();
});

test('resume and full-sync requests during a running check produce one serialized follow-up',async()=>{
    const d=setup();await d.ready();let finish;d.setOperation(()=>new Promise(resolve=>{finish=resolve;}));
    const running=d.controller.runSync(false);await flush();d.controller.resume(true);d.controller.resume(true);
    await d.controller.runSync(true);assert.equal(d.calls.length,2);finish(false);await running;
    assert.equal(d.timers.size,1);d.setOperation(async()=>false);await d.tick();assert.deepEqual(d.calls,[true,false,true]);d.controller.dispose();
});

test('switching targets cannot acknowledge edits for the new target from an old run',async()=>{
    const d=setup();await d.ready();d.controller.fileChanged(d.files.get('a.md'));let finish;
    d.setOperation(()=>new Promise(resolve=>{finish=resolve;}));const running=d.controller.runSync(false);await flush();
    d.plugin.settings.syncFolder='/mydrive/other';d.controller.settingsChanged();d.controller.fileChanged(d.files.get('a.md'));
    finish(true);await running;assert.equal(d.controller.pendingCount,1);assert.equal(d.states.at(-1),'pending');d.controller.dispose();
});

test('offline network hints suppress automatic calls but allow a manual NAS check',async()=>{
    const d=setup();await d.ready();d.controller.networkOffline();await d.controller.runSync(false);
    assert.equal(d.calls.length,1);await d.controller.runSync(false,true);assert.equal(d.calls.length,2);
    d.controller.dispose();d.controller.resume(true);await flush();assert.equal(d.calls.length,2);
});

test('an offline hint cannot hide a permission or metadata failure already in flight',async t=>{
    t.mock.method(console,'error',()=>{});
    const d=setup();await d.ready();let fail;d.setOperation(()=>new Promise((_,reject)=>{fail=reject;}));
    const running=d.controller.runSync(false);await flush();d.controller.networkOffline();fail(Error('permission denied'));
    await running;assert.equal(d.states.at(-1),'error');assert.match(Notice.messages.at(-1),/permission denied/);d.controller.dispose();
});

test('foreground and connectivity listeners use plugin registration and ignore hidden focus',()=>{
    const d=setup();const doc={hidden:true};globalThis.document=doc;const listeners=[];const resumed=[];let offline=0;
    registerSyncTriggers({registerDomEvent:(target,type,fn)=>listeners.push({target,type,fn})},
        {resume:online=>resumed.push(online),networkOffline:()=>offline++});
    assert.equal(listeners.length,4);assert.equal(listeners.find(x=>x.type==='visibilitychange').target,doc);
    listeners.find(x=>x.type==='focus').fn();assert.deepEqual(resumed,[]);doc.hidden=false;
    listeners.find(x=>x.type==='visibilitychange').fn();listeners.find(x=>x.type==='online').fn();
    listeners.find(x=>x.type==='offline').fn();assert.deepEqual(resumed,[true,true]);assert.equal(offline,1);d.controller.dispose();
});

test('pending and waiting status labels expose the queue count accessibly',()=>{
    const el={empty(){},setAttribute(key,value){this[key]=value;}};
    renderSyncStatus(el,'pending',Date.now(),2);assert.match(el.tooltip,/2 items pending/);assert.equal(el['aria-label'],el.tooltip);
    renderSyncStatus(el,'waiting-lock',undefined,2);assert.match(el.tooltip,/another device/);
    renderSyncStatus(el,'waiting-network',undefined,2);assert.match(el.tooltip,/network/);
    renderSyncStatus(el,'pending',undefined,0);assert.match(el.tooltip,/check for updates/);assert.doesNotMatch(el.tooltip,/0 items/);
});

test('custom config paths and folder substitutions cannot be changed by LocalFS',async()=>{
    const d=setup();d.app.vault.configDir='config';const fs=new LocalFS(d.app);
    await assert.rejects(fs.write('config/plugins/data.json',bytes('secret')),/metadata is invalid/);
    d.files.set('folder',{path:'folder'});await assert.rejects(fs.delete('folder'),/File changed/);
    assert.ok(d.files.has('folder'));d.controller.dispose();
});

test('binary replacement checks its final read before overwriting',async()=>{
    const d=setup();const fs=new LocalFS(d.app);const original=new Uint8Array([255,1]).buffer;
    d.contents.set('a.md',new Uint8Array([255,2]).buffer);
    await assert.rejects(fs.writeChecked('a.md',new Uint8Array([255,3]).buffer,original),/File changed/);
    assert.deepEqual([...new Uint8Array(d.contents.get('a.md'))],[255,2]);d.controller.dispose();
});
