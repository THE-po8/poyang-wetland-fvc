import { analyzeFvc, availableMethods, classifyPixels, deriveEndmembers, PIXEL_STATUS } from './core.js';

export const MODES = Object.freeze(['independent', 'fixed']);

export function summarize(values, indices) {
  let count = 0, sum = 0, min = Infinity, max = -Infinity;
  for (const i of indices) {
    const v = values?.[i];
    if (!Number.isFinite(v)) continue;
    count += 1; sum += v; min = Math.min(min, v); max = Math.max(max, v);
  }
  return { count, mean: count ? sum / count : null, min: count ? min : null, max: count ? max : null };
}

function pairedDifference(candidate, reference, indices) {
  let count = 0, sum = 0, absoluteSum = 0, maxAbs = 0;
  for (const i of indices) {
    if (!Number.isFinite(candidate?.[i]) || !Number.isFinite(reference?.[i])) continue;
    const delta = candidate[i] - reference[i];
    count += 1; sum += delta; absoluteSum += Math.abs(delta); maxAbs = Math.max(maxAbs, Math.abs(delta));
  }
  return { count, meanDelta: count ? sum / count : null, meanAbsoluteDifference: count ? absoluteSum / count : null, maxAbsoluteDifference: count ? maxAbs : null };
}

export function runExperiment(inputs, options = {}) {
  const methods = availableMethods(inputs).filter(m => m.ready).map(m => m.id);
  if (!methods.length) throw new Error('至少需要一种水体指数或掩膜');
  const thresholds = {};
  const classifications = {};
  for (const m of methods) {
    thresholds[m] = options.thresholds?.[m] ?? (m === 'mask' ? 0.5 : 0);
    classifications[m] = classifyPixels(inputs, m, thresholds[m]);
  }
  const referenceMethod = options.referenceMethod ?? methods[0];
  if (!methods.includes(referenceMethod)) throw new Error('参考方案不在已载入的方案中');
  const fixedSource = options.fixedSource ?? 'common';
  if (fixedSource !== 'common' && !methods.includes(fixedSource)) throw new Error('固定端元来源必须是共同非水体区域或已载入方案');
  const commonIndices = [];
  for (let i = 0; i < inputs.ndvi.length; i += 1) {
    if (methods.every(m => classifications[m].status[i] === 0)) commonIndices.push(i);
  }
  let fixedEndmembers = null, fixedError = null;
  try {
    const sourceValues = fixedSource === 'common'
      ? commonIndices.map(i => inputs.ndvi[i])
      : classifications[fixedSource].validLandNdvi;
    fixedEndmembers = deriveEndmembers(sourceValues);
  } catch (error) { fixedError = error.message; }

  const results = { independent: {}, fixed: {} };
  for (const mode of MODES) {
    for (const m of methods) {
      try {
        if (mode === 'fixed' && fixedError) throw new Error(fixedError);
        results[mode][m] = analyzeFvc(inputs, m, thresholds[m], mode === 'fixed' ? { endmembers: fixedEndmembers } : {});
      } catch (error) { results[mode][m] = { error: error.message }; }
    }
  }
  const comparisons = {};
  for (const m of methods) {
    const regions = { shared: [], referenceOnly: [], candidateOnly: [], neither: [] };
    const transitions = Object.fromEntries(PIXEL_STATUS.map(a => [a, Object.fromEntries(PIXEL_STATUS.map(b => [b, 0]))]));
    const refStatus = classifications[referenceMethod].status;
    const status = classifications[m].status;
    for (let i = 0; i < inputs.ndvi.length; i += 1) {
      transitions[PIXEL_STATUS[refStatus[i]]][PIXEL_STATUS[status[i]]] += 1;
      const region = refStatus[i] === 0 ? (status[i] === 0 ? 'shared' : 'referenceOnly') : (status[i] === 0 ? 'candidateOnly' : 'neither');
      regions[region].push(i);
    }
    const modes = {};
    for (const mode of MODES) {
      const c = results[mode][m], r = results[mode][referenceMethod];
      modes[mode] = {
        allValid: summarize(c.fvc, classifications[m].status.keys()),
        commonNonwater: summarize(c.fvc, commonIndices),
        sharedCandidate: summarize(c.fvc, regions.shared),
        sharedReference: summarize(r.fvc, regions.shared),
        referenceOnly: summarize(r.fvc, regions.referenceOnly),
        candidateOnly: summarize(c.fvc, regions.candidateOnly),
        pairedDifference: pairedDifference(c.fvc, r.fvc, regions.shared),
      };
    }
    comparisons[m] = { regions, transitions, modes };
  }
  return { methods, thresholds, referenceMethod, fixedSource, fixedEndmembers, fixedError, commonIndices, classifications, results, comparisons,
    warnings: [
      ...(methods.length < 2 ? ['仅有一种方案：可以计算，但不能开展跨方案比较。'] : []),
      '不同方案全域均值的差异同时受像元范围与端元影响，不代表精度。',
      '固定端元下，共同非水体像元的 FVC 应相同；差异主要体现在排除区域。',
      '非水体不等于湿地植被。当前未进行真实数据精度验证。',
    ] };
}
