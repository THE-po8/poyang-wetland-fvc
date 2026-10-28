import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { File } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import Papa from 'papaparse';

// DOM simulation with mocked canvas drawing, not real-browser or real-image QA.
// Every numeric row below is an explicit mathematical test fixture.
const fixtureCsv = 'pixel_id,ndvi,mndwi,ndwi\np1,0.1,-1,1\np2,0.2,-1,1\np3,0.4,-1,-1\np4,0.6,-1,-1\np5,0.8,1,-1\np6,0.9,1,-1\np7,0.3,,-1\np8,,-1,-1\n';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const bundled = await build({ entryPoints: [new URL('../src/main.js', import.meta.url).pathname], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent', define: { __SOURCE_SHA256__: JSON.stringify('explicit-test-source-fingerprint') } });

function setup() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://test.invalid/', pretendToBeVisual: true });
  const w = dom.window, downloads = [];
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.TextDecoder = TextDecoder; w.Blob = Blob; w.File = File;
  w.Element.prototype.scrollIntoView = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, putImageData() {}, createImageData: (width, height) => ({data:new Uint8ClampedArray(width*height*4)}) });
  w.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:test-only'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.eval(bundled.outputFiles[0].text);
  const $ = s => w.document.querySelector(s);
  const change = (s, value) => { $(s).value=value; $(s).dispatchEvent(new w.Event('change',{bubbles:true})); };
  async function upload(csv) {
    Object.defineProperty($('#csv-input'),'files',{configurable:true,value:[new File([csv],'mathematical-test-only.csv',{lastModified:123})]});
    $('#csv-input').dispatchEvent(new w.Event('change',{bubbles:true}));
    for(let i=0;i<150 && ($('#analyze-btn').disabled && !$('#toast').textContent.includes('只有表头'));i++) await new Promise(r=>setTimeout(r,5));
  }
  return { dom, $, change, upload, downloads };
}

test('empty state and header-only import never synthesize observations or enable export', async t => {
  const s=setup(); t.after(()=>s.dom.window.close());
  assert.equal(s.$('#analyze-btn').disabled,true);
  assert.equal(s.$('#export-btn').disabled,true);
  assert.equal(s.$('#audit-btn').disabled,true);
  await s.upload('pixel_id,ndvi,mndwi\n');
  assert.equal(s.$('#results-section').hidden,true);
  assert.match(s.$('#toast').textContent,/只有表头/);
  assert.equal(s.downloads.length,0);
});

test('DOM controls run both modes, change reference, export matching audit/pixel IDs and preserve unknown status', async t => {
  const s=setup(); t.after(()=>s.dom.window.close());
  await s.upload(fixtureCsv);
  assert.equal(s.$('#analyze-btn').disabled,false);
  s.$('#analyze-btn').click();
  assert.equal(s.$('#results-section').hidden,false);
  assert.equal(s.$('#compare-body').children.length,4);
  assert.equal(s.$('#regions-body').children.length,2);
  const independentSoil=s.$('#soil-value').textContent;
  s.change('#mode-select','fixed');
  assert.notEqual(s.$('#soil-value').textContent,independentSoil);
  s.change('#reference-select','ndwi');
  assert.equal(s.$('#reference-select').value,'ndwi');
  s.$('#audit-btn').click(); s.$('#export-btn').click();
  const audit=JSON.parse(await s.downloads[0].text());
  const pixels=Papa.parse(await s.downloads[1].text(),{header:true,skipEmptyLines:true}).data;
  assert.equal(audit.processing.referenceMethod,'ndwi');
  assert.equal(audit.processing.selectedMode,'fixed');
  assert.equal(audit.software.sourceSha256,'explicit-test-source-fingerprint');
  assert.match(audit.inputs.files[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(pixels.length,32);
  assert.ok(pixels.every(row=>row.run_id===audit.runId));
  const unknown=pixels.find(row=>row.pixel_id==='p7' && row.method==='mndwi');
  assert.equal(unknown.pixel_status,'missing_water_value'); assert.equal(unknown.is_water,''); assert.equal(unknown.fvc,'');
});

test('threshold changes recompute and reset prevents stale audit export', async t => {
  const s=setup(); t.after(()=>s.dom.window.close());
  await s.upload(fixtureCsv); s.$('#analyze-btn').click();
  s.$('#audit-btn').click(); const oldAudit=JSON.parse(await s.downloads[0].text());
  s.change('#threshold-input','1');
  s.$('#audit-btn').click(); const newAudit=JSON.parse(await s.downloads[1].text());
  assert.notEqual(newAudit.runId,oldAudit.runId);
  assert.equal(newAudit.processing.thresholds.mndwi,1);
  assert.notEqual(newAudit.results.independent.mndwi.resultCount,oldAudit.results.independent.mndwi.resultCount);
  s.$('#reset-btn').click();
  assert.equal(s.$('#audit-btn').disabled,true); assert.equal(s.$('#results-section').hidden,true);
  assert.equal(s.$('#analyze-btn').disabled,true);
});

test('fixed mode with empty common support hides stale metrics and exposes failure in audit', async t => {
  const s=setup(); t.after(()=>s.dom.window.close());
  await s.upload('ndvi,mndwi,ndwi\n0.1,-1,1\n0.2,-1,1\n0.5,1,-1\n0.9,1,-1\n');
  s.$('#analyze-btn').click(); s.change('#mode-select','fixed');
  assert.equal(s.$('#result-error').hidden,false);
  assert.equal(s.$('#result-display').hidden,true);
  s.$('#audit-btn').click();
  const audit=JSON.parse(await s.downloads[0].text());
  assert.equal(audit.commonNonwaterCount,0); assert.ok(audit.processing.fixedError);
  s.change('#fixed-source-select','mndwi');
  assert.equal(s.$('#result-error').hidden,true); assert.equal(s.$('#result-display').hidden,false);
});
