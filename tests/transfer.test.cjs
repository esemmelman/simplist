const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function setup({edited=false,fail=false}={}){
 let receive;const parent={messages:[],postMessage(message){this.messages.push(message);}};
 const filters=[];let deletes=0,loads=0;
 const copy={token:'copy-1',id:'item-1',userId:'user-1',title:'Dentist',notesHtml:'Notes'};
 const context={window:{parent,addEventListener(name,fn){receive=fn;}},location:{origin:'https://esemmelman.github.io'},currentUser:{id:'user-1'},items:[{id:'item-1',title:edited?'Edited':'Dentist',notes_html:'Notes'}],selectedId:'item-1',TABLE_NAME:'items',
 async flushPendingSave(){return true;},showStatus(){},renderItems(){},renderEditor(){},async loadItems(){loads++;context.items=[];},
 db:{from(){return {delete(){deletes++;return {eq(key,value){filters.push([key,value]);return this;},then(resolve){return Promise.resolve({error:fail?Error('offline'):null}).then(resolve);}};}};}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const pendingListRemovals =')),context);
 return {context,parent,filters,copy,get deletes(){return deletes;},get loads(){return loads;},send(overrides={}){return receive({source:parent,origin:context.location.origin,data:{type:'dayflow:remove-copied-item',copy},...overrides});}};
}
test('saved appointment removes only the copied account/item/revision and refreshes the list',async()=>{
 const app=setup();await app.send();
 assert.equal(app.deletes,1);assert.equal(app.loads,1);
 assert.deepEqual(app.filters,[['id','item-1'],['user_id','user-1'],['title','Dentist'],['notes_html','Notes']]);
 assert.equal(app.parent.messages[0].type,'simplist:removed');assert.equal(app.context.selectedId,null);
});
test('edited items are kept, and list failures do not acknowledge removal',async()=>{
 const edited=setup({edited:true});await edited.send();assert.equal(edited.deletes,0);
 const failed=setup({fail:true});await failed.send();assert.equal(failed.parent.messages.length,0);
 await failed.send();assert.equal(failed.deletes,2);
});
test('untrusted messages and other accounts cannot remove list items',async()=>{
 const app=setup();await app.send({origin:'https://example.com'});await app.send({source:{}});
 app.copy.userId='someone-else';await app.send();assert.equal(app.deletes,0);
});
