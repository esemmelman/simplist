const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function setup(){
 let recognition,timer,next=0,added=[];
 const input={value:'',remove(){this.removed=true;},setAttribute(){},addEventListener(name,fn){this[name]=fn;},focus(){}};
 const context={inlineVoiceSession:null,currentUser:{id:'u'},SpeechRecognition:class{constructor(){recognition=this;}start(){this.onstart();}abort(){this.aborted=true;}},navigator:{language:'en-US'},cancelSpeech(){},showStatus(){},
 setTimeout(fn,delay){assert.equal(delay,3000);timer={fn,id:++next};return next;},clearTimeout(id){if(timer?.id===id)timer=null;},
 itemList:{querySelector(){return this.input&&!this.input.removed?this.input:null;},append(i){this.input=i;},addEventListener(){},focus(){}},
 document:{createElement(){return input;}},window:{addEventListener(){}},async addItem(title){added.push(title);}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function cancelInlineVoice()'),source.indexOf('async function copySelectedItem()')),context);
 return {context,input,added,get recognition(){return recognition;},get timer(){return timer;}};
}
test('voice entry saves once after three seconds of silence and includes interim speech',async()=>{
 const app=setup();app.context.beginInlineItem();
 app.recognition.onresult({results:[[{transcript:'Call dentist'}]]});
 const old=app.timer;
 app.recognition.onresult({results:[[{transcript:'Call dentist tomorrow'}]]});
 assert.notEqual(app.timer.id,old.id);assert.equal(app.added.length,0);
 app.timer.fn();await Promise.resolve();
 assert.deepEqual(app.added,['Call dentist tomorrow']);assert.ok(app.recognition.aborted);
 app.recognition.onresult({results:[[{transcript:'late words'}]]});
 assert.deepEqual(app.added,['Call dentist tomorrow']);
});
test('tapping draft cancels voice and ignores late recognition results',()=>{
 const app=setup();app.context.beginInlineItem();
 app.recognition.onresult({results:[[{transcript:'Cancel me'}]]});
 const late=app.timer.fn;
 app.input.click();late();
 app.recognition.onresult({results:[[{transcript:'late'}]]});
 assert.equal(app.added.length,0);assert.ok(app.input.removed);assert.ok(app.recognition.aborted);
});
test('silence without speech adds nothing and typing remains available',()=>{
 const app=setup();app.context.beginInlineItem();app.timer.fn();
 assert.equal(app.added.length,0);assert.equal(app.context.inlineVoiceSession,null);
});

test('Android partial hypotheses replace each other instead of repeating take',()=>{
 const app=setup();app.context.beginInlineItem();
 const result=(text,isFinal=false)=>Object.assign([{transcript:text}],{isFinal});
 assert.equal(app.recognition.continuous,false);
 app.recognition.onresult({resultIndex:0,results:[result('take')]});
 app.recognition.onresult({resultIndex:1,results:[result('take'),result('take the')]});
 app.recognition.onresult({resultIndex:2,results:[result('take'),result('take the'),result('take the trash out')]});
 assert.equal(app.input.value,'take the trash out');
 app.recognition.onresult({resultIndex:0,results:[result('Take the trash out',true)]});
 app.timer.fn();
 assert.deepEqual(app.added,['Take the trash out']);
});
test('final speech is preserved and deliberate repeated words are not removed',()=>{
 const app=setup();app.context.beginInlineItem();
 const result=(text,isFinal=false)=>Object.assign([{transcript:text}],{isFinal});
 app.recognition.onresult({results:[result('very very important',true),result('call'),result('call mom')]});
 assert.equal(app.input.value,'very very important call mom');
});
