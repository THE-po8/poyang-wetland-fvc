import test from 'node:test';
import assert from 'node:assert/strict';
import { runExperiment } from '../src/experiment.js';
import { analyzeFvc, PIXEL_STATUS } from '../src/core.js';

// Mathematical fixtures only. None of these arrays represents observations.
const fixture = () => ({ ndvi: [0.1, 0.2, 0.4, 0.6, 0.8, 0.9, NaN, 0.3],
  mndwi: [-1, -1, -1, -1, 1, 1, -1, NaN], ndwi: [1, 1, -1, -1, -1, -1, -1, -1] });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('independent endmembers remain per-scheme while fixed endmembers are shared', () => {
  const e = runExperiment(fixture());
  assert.deepEqual(e.commonIndices, [2, 3]);
  close(e.fixedEndmembers.soil, 0.41); close(e.fixedEndmembers.vegetation, 0.59);
  assert.notEqual(e.results.independent.mndwi.soil, e.results.independent.ndwi.soil);
  assert.equal(e.results.fixed.mndwi.soil, e.results.fixed.ndwi.soil);
  assert.equal(e.fixedEndmembers.sampleCount, 2);
});

test('fixed endmembers yield identical FVC on shared non-water pixels', () => {
  const e = runExperiment(fixture());
  const d = e.comparisons.ndwi.modes.fixed.pairedDifference;
  assert.equal(d.count, 2); assert.equal(d.meanDelta, 0); assert.equal(d.maxAbsoluteDifference, 0);
  assert.notEqual(e.comparisons.ndwi.modes.independent.pairedDifference.meanDelta, 0);
});

test('paired regions partition the entire input and missing classification is not water', () => {
  const e = runExperiment(fixture());
  const c = e.comparisons.ndwi;
  assert.deepEqual(Object.fromEntries(Object.entries(c.regions).map(([k, a]) => [k, a.length])), { shared: 2, referenceOnly: 2, candidateOnly: 3, neither: 1 });
  assert.equal(Object.values(c.transitions).flatMap(Object.values).reduce((a,b) => a+b,0), 8);
  assert.equal(c.transitions.missing_water_value.valid_nonwater, 1);
  assert.equal(e.classifications.mndwi.status[7], PIXEL_STATUS.indexOf('missing_water_value'));
});

test('changing reference reverses pair regions and signed differences, not FVC', () => {
  const a = runExperiment(fixture()), b = runExperiment(fixture(), { referenceMethod: 'ndwi' });
  assert.equal(a.comparisons.ndwi.regions.referenceOnly.length, b.comparisons.mndwi.regions.candidateOnly.length);
  close(a.comparisons.ndwi.modes.independent.pairedDifference.meanDelta, -b.comparisons.mndwi.modes.independent.pairedDifference.meanDelta);
  assert.deepEqual(a.results.independent.ndwi.fvc, b.results.independent.ndwi.fvc);
});

test('explicit reference-scheme fixed source is audited and affects every fixed result', () => {
  const e = runExperiment(fixture(), { fixedSource: 'mndwi' });
  assert.equal(e.fixedSource, 'mndwi');
  assert.equal(e.results.fixed.ndwi.soil, e.results.independent.mndwi.soil);
  assert.equal(e.fixedEndmembers.sampleCount, 4);
});

test('empty common support disables fixed mode without silently changing its source', () => {
  const inputs = { ndvi: [0.1,0.2,0.5,0.9], mndwi: [-1,-1,1,1], ndwi: [1,1,-1,-1] };
  const e = runExperiment(inputs);
  assert.equal(e.commonIndices.length, 0);
  assert.ok(e.fixedError); assert.ok(e.results.fixed.mndwi.error);
  assert.ok(!e.results.independent.mndwi.error);
  assert.equal(e.comparisons.ndwi.modes.fixed.pairedDifference.meanDelta, null);
});

test('degenerate independent mode can coexist with valid fixed-reference mode', () => {
  const e = runExperiment({ ndvi: [0.2,0.2,0.6,0.8], mndwi: [-1,-1,1,1], ndwi: [-1,-1,-1,-1] }, { fixedSource: 'ndwi' });
  assert.ok(e.results.independent.mndwi.error);
  assert.ok(!e.results.fixed.mndwi.error);
});

test('no finite FVC is emitted for excluded water, invalid NDVI or unknown classification', () => {
  const e = runExperiment(fixture());
  for (const mode of ['independent','fixed']) for (const method of e.methods) {
    const r = e.results[mode][method];
    const c = e.classifications[method];
    for (let i=0;i<c.status.length;i++) {
      if (c.status[i] !== 0) assert.ok(Number.isNaN(r.fvc[i]));
      else assert.ok(r.fvc[i] >= 0 && r.fvc[i] <= 1);
    }
    assert.equal(r.resultCount+r.waterCount+r.invalidCount+r.unclassifiedCount, 8);
  }
});

test('threshold changes use strictly-greater semantics and recompute endmembers', () => {
  const inputs = { ndvi: [0.1,0.3,0.6,0.9], mndwi: [0,0.2,0.5,1] };
  const a=runExperiment(inputs,{thresholds:{mndwi:0.2}}), b=runExperiment(inputs,{thresholds:{mndwi:0.5}});
  assert.equal(a.results.independent.mndwi.resultCount, 2);
  assert.equal(b.results.independent.mndwi.resultCount, 3);
  assert.notEqual(a.results.independent.mndwi.vegetation,b.results.independent.mndwi.vegetation);
  assert.equal(b.classifications.mndwi.status[2],0);
});

test('fixed endpoints require finite increasing values, and zero eligible pixels is not a zero mean', () => {
  const inputs = {ndvi:[0.1,0.2],mask:[1,1]};
  for (const endmembers of [{soil:0.5,vegetation:0.5},{soil:0,vegetation:NaN},{soil:1,vegetation:0}]) {
    assert.throws(()=>analyzeFvc(inputs,'mask',0.5,{endmembers}), /端元/);
  }
  const r = analyzeFvc(inputs,'mask',0.5,{endmembers:{soil:0,vegetation:1}});
  assert.equal(r.resultCount,0); assert.ok(Number.isNaN(r.meanFvc));
});

test('missing data, mismatched masks, unknown references and nonfinite thresholds stop explicitly', () => {
  assert.throws(()=>runExperiment({ndvi:[]}),/水体指数或掩膜/);
  assert.throws(()=>runExperiment({ndvi:[0.1,0.9],mask:[0]}),/数量/);
  assert.throws(()=>runExperiment(fixture(),{referenceMethod:'mask'}),/参考/);
  assert.throws(()=>runExperiment(fixture(),{fixedSource:'absent'}),/来源/);
  assert.throws(()=>runExperiment(fixture(),{thresholds:{mndwi:Infinity}}),/阈值/);
});
