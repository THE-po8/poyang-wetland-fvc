import { PIXEL_STATUS } from './core.js';
import { MODES } from './experiment.js';

export const SOFTWARE_VERSION = '1.1.0';
export const SOURCE_SHA256 = typeof __SOURCE_SHA256__ === 'undefined' ? null : __SOURCE_SHA256__;

export async function fingerprintFile(file, buffer) {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持 SHA-256 校验，请通过 HTTPS 或 localhost 打开工具');
  const bytes = buffer ?? await file.arrayBuffer();
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return { name: file.name, sizeBytes: bytes.byteLength, lastModified: file.lastModified ?? null,
    sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') };
}

function resultSummary(result) {
  if (result.error) return { error: result.error };
  const { soil, vegetation, resultCount, waterCount, invalidCount, unclassifiedCount, meanFvc, zeroCount, oneCount } = result;
  return { soil, vegetation, resultCount, waterCount, invalidCount, unclassifiedCount,
    meanFvc: Number.isFinite(meanFvc) ? meanFvc : null, zeroCount, oneCount };
}

export function createAudit(experiment, metadata = {}) {
  const { methods, thresholds, referenceMethod, fixedSource, fixedEndmembers, fixedError, results, comparisons, warnings } = experiment;
  return {
    schemaVersion: '1.0.0', software: { name: 'poyang-fvc-lab', version: SOFTWARE_VERSION, sourceSha256: SOURCE_SHA256 },
    runId: metadata.runId ?? globalThis.crypto.randomUUID(), createdAt: metadata.createdAt ?? new Date().toISOString(),
    inputs: { sourceType: metadata.sourceType ?? null, files: metadata.files ?? [], grid: metadata.grid ?? null,
      indexScaleFactor: metadata.indexScaleFactor ?? 1, maskScaleFactor: 1,
      coordinateMeaning: metadata.coordinateMeaning ?? 'unknown' },
    processing: { methods, thresholds, waterComparison: 'strictly greater than threshold',
      quantiles: { soil: 0.05, vegetation: 0.95, interpolation: 'linear at (n-1)*q on sorted finite nonwater NDVI' },
      fvcRange: [0, 1], fvcStorage: 'Float32', referenceMethod, fixedSource, fixedEndmembers, fixedError,
      selectedMode: metadata.selectedMode ?? null, selectedMethod: metadata.selectedMethod ?? null,
      statusCodes: PIXEL_STATUS, unknownIsNotWaterOrLand: true },
    results: Object.fromEntries(MODES.map(mode => [mode, Object.fromEntries(methods.map(m => [m, resultSummary(results[mode][m])]))])),
    classificationCounts: Object.fromEntries(methods.map(m => {
      const counts = Object.fromEntries(PIXEL_STATUS.map(s => [s, 0]));
      for (const status of experiment.classifications[m].status) counts[PIXEL_STATUS[status]] += 1;
      return [m, counts];
    })),
    comparisons: Object.fromEntries(methods.map(m => [m, {
      regionCounts: Object.fromEntries(Object.entries(comparisons[m].regions).map(([k, v]) => [k, v.length])),
      transitions: comparisons[m].transitions, modes: comparisons[m].modes,
    }])),
    commonNonwaterCount: experiment.commonIndices.length, warnings,
    validation: { realDataAccuracyValidated: false, inputAuthenticityVerified: false, browserQa: 'not established by model tests',
      spatialAlignment: 'dimensions/bounding-box checks only; CRS and affine grid require external validation' },
    reproducibility: 'Retain original files and their alignment/preprocessing metadata; the manifest does not contain observations or reconstruct the source rasters.',
  };
}

export function csvCell(value) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '';
  let s = String(value);
  // Protect spreadsheet formula injection for user-provided text, not numeric negatives.
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function exportPixelsCsv(inputs, experiment, metadata = {}) {
  const lines = ['run_id,pixel_id,x,y,coordinate_meaning,ndvi,method,mode,threshold,pixel_status,is_water,common_nonwater,region_vs_reference,soil,vegetation,fvc,analysis_error'];
  const common = new Set(experiment.commonIndices);
  for (const mode of MODES) for (const method of experiment.methods) {
    const result = experiment.results[mode][method];
    const status = experiment.classifications[method].status;
    const ref = experiment.classifications[experiment.referenceMethod].status;
    for (let i = 0; i < inputs.ndvi.length; i += 1) {
      const pixel = metadata.pixel?.(i) ?? { id: i + 1 };
      const region = ref[i] === 0 ? (status[i] === 0 ? 'shared' : 'referenceOnly') : (status[i] === 0 ? 'candidateOnly' : 'neither');
      lines.push([metadata.runId, pixel.id, pixel.x, pixel.y, metadata.coordinateMeaning,
        inputs.ndvi[i], method, mode, experiment.thresholds[method], PIXEL_STATUS[status[i]],
        status[i] === 1 ? 1 : status[i] === 0 ? 0 : null, common.has(i) ? 1 : 0, region,
        result.soil, result.vegetation, result.fvc?.[i], result.error].map(csvCell).join(','));
    }
  }
  return '\uFEFF' + lines.join('\n');
}
