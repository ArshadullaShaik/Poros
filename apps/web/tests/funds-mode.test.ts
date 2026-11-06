import test from 'node:test';
import assert from 'node:assert/strict';
import {mountFundsMode,readFundsMode} from '../../../src/features/builder/demo/funds-mode.js';
class Control extends EventTarget { value='AI'; }
class Host extends EventTarget {
  values=new Map<string,string>();
  sessionStorage={getItem:(key:string)=>this.values.get(key)??null,setItem:(key:string,value:string)=>{this.values.set(key,value);}};
}
test('navbar mode selects the real executor and dispatches settings changes without starting a run',()=>{
 const host=new Host(),select=new Control();let changes=0;const published:string[]=[];
 select.addEventListener('change',()=>changes++);
 host.addEventListener('poros:funds-mode',event=>published.push((event as CustomEvent).detail));
 const stop=mountFundsMode(select,host);
 assert.equal(select.value,'AI');assert.equal(readFundsMode(host),'DEMO');
 host.dispatchEvent(new CustomEvent('poros:set-funds-mode',{detail:'REAL'}));
 assert.equal(select.value,'LIVE');assert.equal(changes,1);assert.equal(readFundsMode(host),'REAL');
 host.dispatchEvent(new CustomEvent('poros:set-funds-mode',{detail:'REAL'}));assert.equal(changes,1);
 host.dispatchEvent(new CustomEvent('poros:set-funds-mode',{detail:'DEMO'}));
 assert.equal(select.value,'AI');assert.equal(changes,2);assert.equal(published.at(-1),'DEMO');
 host.dispatchEvent(new CustomEvent('poros:set-funds-mode',{detail:'invalid'}));assert.equal(select.value,'AI');
 stop();host.dispatchEvent(new CustomEvent('poros:set-funds-mode',{detail:'REAL'}));assert.equal(select.value,'AI');
});
test('settings stay in sync with navbar, preserve local demo and restore explicit tab preference',()=>{
 const host=new Host(),select=new Control();host.sessionStorage.setItem('poros.funds-mode','REAL');
 const stop=mountFundsMode(select,host);assert.equal(select.value,'LIVE');
 select.value='RULES_ONLY';select.dispatchEvent(new Event('change'));
 assert.equal(readFundsMode(host),'DEMO');
 host.dispatchEvent(new CustomEvent('poros:set-funds-mode',{detail:'DEMO'}));assert.equal(select.value,'RULES_ONLY');
 stop();
 assert.equal(readFundsMode({get sessionStorage():Storage{throw new Error('blocked');}}),'DEMO');
});
