import test from "node:test";
import assert from "node:assert/strict";
import { explainScore, groupBufferedEvents, prioritizeFacts, stableFactsKey } from "../src/v5/engines.js";

test("Home Score returns components and additive deductions",()=>{
  const r=explainScore({zones:[{device_id:"x",temperature:22.5,humidity:50,created_at:new Date().toISOString()}],alerts:[]});
  assert.equal(r.overall,100); assert.equal(r.confidence,100); assert.equal(r.components.reduce((s,x)=>s+x.points,0),100);
});
test("Home Score marks missing climate data and does not silently score it as zero",()=>{
  const r=explainScore({zones:[],alerts:[]}); assert.equal(r.comfort,null); assert.equal(r.overall,100); assert.equal(r.confidence,35);
});
test("Home Score penalty arithmetic matches final score",()=>{
  const r=explainScore({zones:[],alerts:[{severity:"critical"},{severity:"warning"}]});
  assert.equal(Math.round(100-r.deductions.reduce((s,x)=>s+x.points,0)),r.overall);
});
test("Caretaker facts prioritize severity then freshness",()=>{
  assert.deepEqual(prioritizeFacts([{id:"i",severity:"info"},{id:"h",severity:"high"},{id:"c",severity:"critical"}],2).map(x=>x.id),["c","h"]);
  assert.equal(stableFactsKey([{id:"x",severity:"warning"}]),stableFactsKey([{id:"x",severity:"warning"}]));
});
test("event buffer merges matching groups and preserves unique source ids",()=>{
  const groups=groupBufferedEvents([{group_key:"offline",category_key:"device_health",items:["a"],source_ids:[1]},{group_key:"offline",category_key:"device_health",items:["b"],source_ids:[1,2]}]);
  assert.deepEqual(groups[0].items,["a","b"]); assert.deepEqual(groups[0].source_ids,[1,2]);
});
