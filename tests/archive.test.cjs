const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function setup({fail=false,noRows=false,saveFails=false}={}){
 const row={id:'one',title:'Dentist',notes_html:'Keep these notes',archived:false};
 let fields,updated=0;
 const context={showArchived:false,items:[{...row}],selectedId:'one',currentUser:{id:'owner'},TABLE_NAME:'items',Date,
 selectedItem(){return context.items.find(item=>item.id===context.selectedId);},async flushPendingSave(){return !saveFails;},cancelInlineVoice(){},renderItems(){},renderEditor(){},showStatus(message,error){context.status={message,error};},
 db:{from(){return {update(value){fields=value;updated++;return {eq(){return this;},async select(){if(!fail&&!noRows)Object.assign(row,fields);return {data:noRows?[]:[{id:'one'}],error:fail?Error('offline'):null};}};}};}}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function visibleItems('),source.indexOf('function renderItems(')),context);
 vm.runInContext(source.slice(source.indexOf('async function archiveSelectedItem('),source.indexOf('async function saveNote(')),context);
 return {context,row,get updated(){return updated;}};
}
test('archive persists without deleting title or notes; restore brings the item back',async()=>{
 const app=setup();await app.context.archiveSelectedItem();
 assert.equal(app.row.archived,true);assert.equal(app.context.visibleItems().length,0);
 assert.equal(app.row.notes_html,'Keep these notes');assert.equal(app.row.title,'Dentist');
 app.context.items=[{...app.row}]; // reload saved state
 await app.context.toggleArchiveView();
 assert.equal(app.context.visibleItems()[0].id,'one');
 app.context.selectedId='one';await app.context.archiveSelectedItem();
 assert.equal(app.row.archived,false);
 await app.context.toggleArchiveView();assert.equal(app.context.visibleItems()[0].id,'one');
});
for(const options of [{fail:true},{noRows:true},{saveFails:true}])test(`unsaved or rejected archive keeps the active item: ${JSON.stringify(options)}`,async()=>{
 const app=setup(options);await app.context.archiveSelectedItem();
 assert.equal(app.row.archived,false);assert.equal(app.context.items[0].archived,false);
 assert.equal(app.context.selectedId,'one');
});
