import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mountLibraryTabs} from '../../src/features/builder/demo/community.js';
test('library navigation shows only the selected section and supports arrow keys',()=>{
 const panels=new Map(['community','unlocked','creators'].map(key=>[`#library-${key}`,{hidden:false}]));
 const tabs=['community','unlocked','creators'].map(key=>({dataset:{libraryTab:key},attrs:{} as Record<string,string>,tabIndex:0,handlers:{} as Record<string,Function>,focused:false,setAttribute(k:string,v:string){this.attrs[k]=v;},addEventListener(k:string,fn:Function){this.handlers[k]=fn;},focus(){this.focused=true;}}));
 let loads=0;
 mountLibraryTabs({root:{querySelectorAll:()=>tabs,querySelector:(id:string)=>panels.get(id)},onCommunity:()=>{loads++;}});
 assert.equal(loads,1);assert.equal(panels.get('#library-unlocked')!.hidden,true);
 tabs[1].handlers.click();assert.equal(panels.get('#library-community')!.hidden,true);assert.equal(panels.get('#library-unlocked')!.hidden,false);assert.equal(tabs[1].attrs['aria-selected'],'true');
 tabs[1].handlers.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(panels.get('#library-creators')!.hidden,false);assert.equal(tabs[2].focused,true);
 tabs[2].handlers.keydown({key:'Home',preventDefault(){}});assert.equal(loads,2);assert.equal(panels.get('#library-community')!.hidden,false);
});
