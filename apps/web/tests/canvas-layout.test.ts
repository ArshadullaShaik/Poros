import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCanvasLayout} from '../../../src/features/builder/demo/canvas-layout.js';
class Button extends EventTarget {
 textContent='';attrs=new Map<string,string>();setAttribute(key:string,value:string){this.attrs.set(key,value);}
}
test('canvas independently expands left and right and restores existing panels without removing their content',()=>{
 const left={hidden:false,content:'blocks'},right={hidden:false,content:'strategies'},workspace={dataset:{} as Record<string,string>};
 const a=new Button(),b=new Button();
 const elements=new Map<string,any>([['.workspace',workspace],['#canvas-blocks-panel',left],['#canvas-library-panel',right],['#canvas-toggle-left',a],['#canvas-toggle-right',b]]);
 const cleanup=mountCanvasLayout({querySelector:(key:string)=>elements.get(key)});
 a.dispatchEvent(new Event('click'));assert.equal(left.hidden,true);assert.equal(right.hidden,false);assert.equal(a.attrs.get('aria-expanded'),'false');assert.equal(workspace.dataset.leftHidden,'true');
 b.dispatchEvent(new Event('click'));assert.equal(right.hidden,true);assert.equal(workspace.dataset.rightHidden,'true');
 a.dispatchEvent(new Event('click'));b.dispatchEvent(new Event('click'));
 assert.equal(left.hidden,false);assert.equal(right.hidden,false);assert.equal(left.content,'blocks');assert.equal(right.content,'strategies');assert.equal(a.attrs.get('aria-expanded'),'true');
 cleanup();a.dispatchEvent(new Event('click'));assert.equal(left.hidden,false);
});
