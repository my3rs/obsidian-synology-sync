import { build } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const bundle = await build({
    stdin: { contents: `export {SyncController} from './src/sync/controller';
        export {LocalFS,isSyncWrite} from './src/fs/local';
        export {SyncLockedError} from './src/sync/manifest';
        export {TFile,Notice} from 'obsidian';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'obsidian-double', setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
            export class TFile { constructor(path) {this.path=path;this.stat={mtime:1,size:1};} }
            export class Notice { static messages=[]; constructor(message) {Notice.messages.push(message);} hide() {} setMessage(m) {Notice.messages.push(m);} }
            export const getLanguage=()=> 'en';export const requestUrl=()=> {throw Error('Unexpected network');};` }));
    } }]
});
const { SyncController, LocalFS, isSyncWrite, SyncLockedError, TFile, Notice } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
Error.stackTraceLimit=3;
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const bytes=value=>new TextEncoder().encode(value).buffer;

function setup(configured=true) {
    const timers=new Map();let nextTimer=0;
    globalThis.window={setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},clearTimeout(id){timers.delete(id);}};
    Notice.messages=[];
    const files=new Map([['a.md',new TFile('a.md')]]);const contents=new Map([['a.md',bytes('A')]]);const storage=new Map();
    const events=[];const states=[];const calls=[];const signals=[];let operation=async()=>false;
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
        updateStatusBar:state=>states.push(state),saveSettings:async()=>controller.settingsChanged(),
        getEngine:async signal=>{signals.push(signal);return {runSync:async full=>{calls.push(full);return operation();}};}};
    const controller=new SyncController(plugin);controller.initialize();
    return {controller,plugin,app,files,contents,timers,calls,signals,states,events,setOperation(fn){operation=fn;},
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
    assert.equal(Notice.messages.length,0);assert.equal(d.plugin.settings.lastSyncTime,undefined);d.controller.dispose();
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
