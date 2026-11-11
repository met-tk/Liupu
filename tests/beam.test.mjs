import test from 'node:test';
import assert from 'node:assert/strict';
import {splitBeamPolygon} from '../src/beam.mjs';
const area=points=>Math.abs(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y},0))/2;
test('sloping beams retain total area and meet exactly at stem midpoints',()=>{
 const original=[{x:0,y:5},{x:120,y:29},{x:120,y:35},{x:0,y:11}];
 const parts=splitBeamPolygon(original,[{id:'c',x:120},{id:'a',x:0},{id:'b',x:60},{id:'chord',x:60}]);
 assert.deepEqual(parts.map(p=>p.noteId),['a','b','c']);
 assert.equal(parts[0].box.x+parts[0].box.w,parts[1].box.x);
 assert.equal(parts[1].box.x+parts[1].box.w,parts[2].box.x);
 assert.ok(Math.abs(parts.reduce((sum,p)=>sum+area(p.points),0)-area(original))<1e-8);
});
test('secondary beam hooks retain their complete shape with no invented segments',()=>{
 const hook=[{x:10,y:5},{x:25,y:5},{x:25,y:11},{x:10,y:11}];
 const parts=splitBeamPolygon(hook,[{id:'a',x:10},{id:'b',x:70},{id:'c',x:120}]);
 assert.equal(parts.length,1);assert.equal(parts[0].noteId,'a');assert.equal(area(parts[0].points),90);
 assert.deepEqual(splitBeamPolygon(hook,[]),[]);
});
