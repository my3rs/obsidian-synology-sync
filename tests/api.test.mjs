import { build } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const bundle = await build({
    stdin: { contents: "export {SynologyClient} from './src/api/client';", resolveDir: process.cwd() },
    bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'obsidian-double', setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
            export const getLanguage=()=> 'en';
            export const requestUrl=req=>globalThis.mockRequest(req);` }));
    } }]
});
const { SynologyClient } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=synology-api-test.js').toString('base64'));
globalThis.window ??= {setTimeout};
const client = () => new SynologyClient('https://nas.test', 'user', 'password');
const bytes = text => new TextEncoder().encode(text).buffer;
function response(value, headers = {}, status = 200) {
    const text = JSON.stringify(value);
    return {status, text, headers, arrayBuffer:bytes(text)};
}

// Real Drive v2 responses contain total, without a has_more member.
test('Drive v2 total paginates a directory containing more than 200 entries', async () => {
    const entries = Array.from({length: 450}, (_, i) => ({name: `${i}.md`, type: 'file'}));
    const offsets = [];
    globalThis.mockRequest = async req => {
        const query = new URL(req.url).searchParams;
        const offset = Number(query.get('offset'));
        offsets.push(offset);
        assert.equal(query.get('limit'), '200');
        return response({success:true, data:{total:entries.length, items:entries.slice(offset, offset+200)}});
    };
    const result = await client().listFiles('/mydrive/notes');
    assert.deepEqual(result.data.items, entries);
    assert.deepEqual(offsets, [0,200,400]);
});

test('server page caps advance by actual returned count', async () => {
    const entries = Array.from({length: 7}, (_, i) => ({name:String(i)}));
    const offsets = [];
    globalThis.mockRequest = async req => {
        const offset = Number(new URL(req.url).searchParams.get('offset'));
        offsets.push(offset);
        return response({success:true, data:{total:7,items:entries.slice(offset,offset+3)}});
    };
    assert.equal((await client().listFiles('/mydrive/notes')).data.items.length,7);
    assert.deepEqual(offsets,[0,3,6]);
});

test('listing refuses a repeated page before it can conceal missing files', async () => {
    let calls=0;
    globalThis.mockRequest=async()=>{calls++;return response({success:true,data:{total:3,items:[{name:'A'}]}});};
    await assert.rejects(client().listFiles('/mydrive/notes'),/invalid response/);
    assert.equal(calls,2);
});

test('listing refuses changing totals and empty intermediate pages',async()=>{
    for (const second of [{total:3,items:[{name:'B'}]}, {total:2,items:[]}]) {
        let calls=0;
        globalThis.mockRequest=async()=>response({success:true,data:++calls===1?{total:2,items:[{name:'A'}]}:second});
        await assert.rejects(client().listFiles('/mydrive/notes'),/invalid response/);
    }
});

test('a business error on a later page rejects the entire listing',async()=>{
    let calls=0;
    globalThis.mockRequest=async()=>response(++calls===1?{success:true,data:{total:2,items:[{name:'A'}]}}:{success:false,error:{code:1000}});
    await assert.rejects(client().listFiles('/mydrive/notes'),/1000/);
});

test('search uses documented query pagination and folder type',async()=>{
    const offsets=[];
    globalThis.mockRequest=async req=>{
        const query=new URL(req.url).searchParams;
        const offset=Number(query.get('offset'));
        offsets.push(offset);
        assert.equal(query.get('limit'),'200');
        assert.deepEqual(JSON.parse(req.body),{location:'/mydrive',file_type:'folder',start_date:0,time:'modified_time'});
        return response({success:true,data:{total:3,items:offset===0?[{file_id:'1',name:'same'},{file_id:'2',name:'same'}]:[{file_id:'3',name:'last'}]}});
    };
    assert.equal((await client().search('/mydrive','dir',0)).data.items.length,3);
    assert.deepEqual(offsets,[0,2]);
});

test('non-download mutations require an explicit success acknowledgement',async()=>{
    for (const value of [null,{}, {data:{}}]) {
        globalThis.mockRequest=async()=>response(value);
        const c=client();
        await assert.rejects(c.createFolder('/mydrive/test','stop'),/invalid response/);
        await assert.rejects(c.uploadFile('/mydrive/a.md',bytes('A'),true),/invalid response/);
        await assert.rejects(c.deleteFile('/mydrive/a.md'),/invalid response/);
    }
});

test('HTML proxy responses never acknowledge a mutation',async()=>{
    globalThis.mockRequest=async()=>({status:200,text:'<html>Sign in</html>',headers:{},arrayBuffer:bytes('<html>Sign in</html>')});
    await assert.rejects(client().uploadFile('/mydrive/a.md',bytes('A'),true),/invalid response/);
});

test('metadata only preserves the exact legacy 1003 code contract',async()=>{
    globalThis.mockRequest=async()=>response({success:false,error:{code:10030}});
    await assert.rejects(client().getMetadata('/mydrive/a.md'),/10030/);
    globalThis.mockRequest=async()=>response({success:false,error:{code:1003}});
    assert.equal(await client().getMetadata('/mydrive/a.md'),null);
});

test('download requests a forced attachment and preserves legitimate JSON error-shaped contents',async()=>{
    const content={success:false,error:{code:1000}};
    globalThis.mockRequest=async req=>{
        assert.deepEqual(JSON.parse(req.body),{files:['/mydrive/data.json'],force_download:true});
        return response(content,{'Content-Disposition':'attachment; filename="data.json"'});
    };
    assert.deepEqual(JSON.parse(new TextDecoder().decode(await client().downloadFile('/mydrive/data.json'))),content);
});

test('download rejects business errors and non-attachment login pages',async()=>{
    globalThis.mockRequest=async()=>response({success:false,error:{code:1000}});
    await assert.rejects(client().downloadFile('/mydrive/a.md'),/1000/);
    globalThis.mockRequest=async()=>({status:200,text:'<html>Sign in</html>',headers:{},arrayBuffer:bytes('<html>Sign in</html>')});
    await assert.rejects(client().downloadFile('/mydrive/a.md'),/invalid response/);
});

test('parent creation never overwrites directories and accepts a verified directory conflict',async()=>{
    const calls=[];
    globalThis.mockRequest=async req=>{
        const url=new URL(req.url);
        calls.push([url.pathname,url.searchParams.get('path')]);
        if(url.pathname.endsWith('/list')) return response({success:true,data:{total:1,items:[{name:'notes',type:'dir'}]}});
        assert.equal(url.searchParams.get('conflict_action'),'stop');
        return response({success:false,error:{code:1000}});
    };
    await client().ensureRemoteFolder('/mydrive/notes');
    assert.deepEqual(calls,[['/api/SynologyDrive/default/v2/files','/mydrive/notes'],['/api/SynologyDrive/default/v2/files/list','/mydrive']]);
});

test('parent creation cannot replace a file or ignore an unreadable parent',async()=>{
    globalThis.mockRequest=async req=>new URL(req.url).pathname.endsWith('/list')
        ? response({success:true,data:{total:1,items:[{name:'notes',type:'file'}]}})
        : response({success:false,error:{code:1000}});
    await assert.rejects(client().ensureRemoteFolder('/mydrive/notes'),/1000/);
    globalThis.mockRequest=async()=>response({success:false,error:{code:1003}});
    await assert.rejects(client().ensureRemoteFolder('/mydrive/notes'),/1003/);
});

test('login requires a usable session ID',async()=>{
    globalThis.mockRequest=async()=>response({success:true,data:{}});
    await assert.rejects(client().login());
});
