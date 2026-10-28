import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAudit, exportPixelsCsv, fingerprintFile, csvCell, SOFTWARE_VERSION } from '../src/audit.js';
import { runExperiment } from '../src/experiment.js';

// Explicit mathematical fixtures, not observations or a Poyang dataset.
const inputs = {ndvi:[0.1,0.4,0.8,0.5,NaN],mask:[0,0,1,NaN,0]};

test('file provenance contains a real SHA256 of original bytes, not a generated identifier', async () => {
  const bytes = new TextEncoder().encode('mathematical test only').buffer;
  const p = await fingerprintFile({name:'test-only.txt',lastModified:123,arrayBuffer:async()=>bytes});
  assert.equal(p.sha256,createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));
  assert.equal(p.sizeBytes,bytes.byteLength); assert.equal(p.lastModified,123);
});

test('audit retains thresholds, endpoint provenance, counts, schema and software versions', () => {
  const e=runExperiment(inputs);
  const a=createAudit(e,{runId:'test-run',createdAt:'2000-01-01T00:00:00.000Z',sourceType:'csv',files:[{name:'test-only',sha256:'explicit-test-placeholder'}]});
  assert.equal(a.software.version,SOFTWARE_VERSION);
  assert.equal(a.schemaVersion,'1.0.0'); assert.equal(a.runId,'test-run');
  assert.equal(a.processing.thresholds.mask,0.5);
  assert.equal(a.processing.fixedEndmembers.sampleCount,2);
  assert.equal(a.results.independent.mask.unclassifiedCount,1);
  assert.equal(a.results.fixed.mask.resultCount,2);
  assert.equal(a.validation.realDataAccuracyValidated,false);
  assert.equal(a.validation.inputAuthenticityVerified,false);
  assert.deepEqual(a.classificationCounts.mask,{valid_nonwater:2,excluded_water:1,invalid_ndvi:1,missing_water_value:1});
  assert.equal(a.inputs.files[0].sha256,'explicit-test-placeholder');
  assert.equal(a.commonNonwaterCount,2);
  assert.equal(a.comparisons.mask.regionCounts.neither,3);
});

test('JSON roundtrip preserves failures and undefined means as null, not false zeroes', () => {
  const e=runExperiment({ndvi:[0.1,0.2,0.5,0.9],mndwi:[-1,-1,1,1],ndwi:[1,1,-1,-1]});
  const a=JSON.parse(JSON.stringify(createAudit(e)));
  assert.ok(a.processing.fixedError);
  assert.ok(a.results.fixed.ndwi.error);
  assert.equal(a.comparisons.ndwi.modes.fixed.commonNonwater.mean,null);
});

test('all modes export explicit statuses with empty water/unknown FVC and unknown is_water', () => {
  const csv=exportPixelsCsv(inputs,runExperiment(inputs),{runId:'test-run',coordinateMeaning:'row_order'});
  const lines=csv.replace(/^\uFEFF/,'').split('\n').map(line=>line.split(','));
  assert.equal(lines.length,1+inputs.ndvi.length*2);
  const header=lines[0];
  for (const row of lines.slice(1)) {
    assert.equal(row[header.indexOf('run_id')],'test-run');
    const status=row[header.indexOf('pixel_status')];
    if(status!=='valid_nonwater') assert.equal(row[header.indexOf('fvc')],'');
    if(status==='missing_water_value'||status==='invalid_ndvi') assert.equal(row[header.indexOf('is_water')],'');
    if(status==='excluded_water') assert.equal(row[header.indexOf('is_water')],'1');
  }
});

test('failed analyses still export classifications and an explicit analysis_error', () => {
  const i={ndvi:[0.5,0.5],mask:[0,0]};
  const csv=exportPixelsCsv(i,runExperiment(i),{runId:'test-only'});
  assert.ok(csv.includes('valid_nonwater')); assert.ok(csv.includes('相同'));
  const audit=createAudit(runExperiment(i));
  assert.equal(audit.classificationCounts.mask.valid_nonwater,2);
  assert.equal(Object.values(audit.classificationCounts.mask).reduce((a,b)=>a+b,0),2);
});

test('spreadsheet formula text and CSV delimiters are escaped without corrupting numeric negatives', () => {
  assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('@SUM(1)'),"'@SUM(1)");
  assert.equal(csvCell(-0.2),'-0.2');
  assert.equal(csvCell('a,b'),'"a,b"');
  assert.equal(csvCell(NaN),'');
});

test('audit is reproducible with explicit identifiers and does not mutate experiment data', () => {
  const e=runExperiment(inputs), before=Array.from(e.results.fixed.mask.fvc);
  const m={runId:'fixture',createdAt:'2000-01-01T00:00:00Z'};
  assert.deepEqual(createAudit(e,m),createAudit(e,m));
  assert.deepEqual(Array.from(e.results.fixed.mask.fvc),before);
});
