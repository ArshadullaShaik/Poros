import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCanvasDragTarget} from '../../src/features/builder/demo/drag-target.js';

test('canvas accepts a fast drop on entry, before any dragover event',()=>{
  const classes=new Set<string>(),child={};
  const canvas=Object.assign(new EventTarget(),{classList:{add:(name:string)=>classes.add(name),remove:(name:string)=>classes.delete(name)},contains:(node:unknown)=>node===child});
  mountCanvasDragTarget(canvas);
  const enter=new Event('dragenter',{cancelable:true});canvas.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented,true);assert.equal(classes.has('drag-over'),true);
  const within=Object.assign(new Event('dragleave'),{relatedTarget:child});canvas.dispatchEvent(within);assert.equal(classes.has('drag-over'),true);
  canvas.dispatchEvent(Object.assign(new Event('dragleave'),{relatedTarget:null}));assert.equal(classes.has('drag-over'),false);
  const over=new Event('dragover',{cancelable:true});canvas.dispatchEvent(over);assert.equal(over.defaultPrevented,true);
});
