export function quantile(values, q) {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) {
    throw new TypeError('values 必须是数组');
  }
  const sorted = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

export function classifyWater(method, index, inputs, threshold = 0) {
  if (method === 'none') return false;
  if (method === 'mndwi') {
    const value = inputs.mndwi?.[index];
    return Number.isFinite(value) ? value > threshold : false;
  }
  if (method === 'ndwi') {
    const value = inputs.ndwi?.[index];
    return Number.isFinite(value) ? value > threshold : false;
  }
  if (method === 'mask') {
    const value = inputs.mask?.[index];
    return Number.isFinite(value) ? value > threshold : false;
  }
  throw new Error(`未知水体掩膜方案：${method}`);
}

export const PIXEL_STATUS = Object.freeze(['valid_nonwater', 'excluded_water', 'invalid_ndvi', 'missing_water_value']);

export function classifyPixels(inputs, method, threshold = 0) {
  if (!['mndwi', 'ndwi', 'mask'].includes(method)) throw new Error('必须选择一种已提供的水体方案');
  if (!Number.isFinite(threshold)) throw new Error('水体阈值必须是有限数值');
  const ndvi = inputs.ndvi;
  if (!ndvi?.length) throw new Error('缺少有效 NDVI 像元');
  const maskKey = method === 'mndwi' ? 'mndwi' : method === 'ndwi' ? 'ndwi' : method === 'mask' ? 'mask' : null;
  if (maskKey && inputs[maskKey]?.length !== ndvi.length) {
    throw new Error(`${method.toUpperCase()} 与 NDVI 的像元数量不一致`);
  }

  const water = new Uint8Array(ndvi.length);
  const status = new Uint8Array(ndvi.length);
  const validLandNdvi = [];
  let invalidCount = 0;
  let unclassifiedCount = 0;

  for (let i = 0; i < ndvi.length; i += 1) {
    if (!Number.isFinite(ndvi[i])) {
      status[i] = 2;
      invalidCount += 1;
      continue;
    }
    if (maskKey && !Number.isFinite(inputs[maskKey][i])) {
      status[i] = 3;
      unclassifiedCount += 1;
      continue;
    }
    if (classifyWater(method, i, inputs, threshold)) {
      status[i] = 1;
      water[i] = 1;
      continue;
    }
    validLandNdvi.push(ndvi[i]);
  }

  return { status, water, validLandNdvi, invalidCount, unclassifiedCount };
}

export function deriveEndmembers(values) {
  const finite = Array.from(values).filter(Number.isFinite);
  if (finite.length < 2) throw new Error('掩膜后有效非水体 NDVI 像元不足，无法计算分位数');
  const soil = quantile(finite, 0.05);
  const vegetation = quantile(finite, 0.95);
  if (!(vegetation > soil)) throw new Error('NDVIsoil 与 NDVIveg 相同，无法计算 FVC');
  return { soil, vegetation, sampleCount: finite.length };
}

export function analyzeFvc(inputs, method, threshold = 0, options = {}) {
  const ndvi = inputs.ndvi;
  const { status, water, validLandNdvi, invalidCount, unclassifiedCount } = classifyPixels(inputs, method, threshold);
  const endmembers = options.endmembers ?? deriveEndmembers(validLandNdvi);
  const { soil, vegetation } = endmembers;
  if (!Number.isFinite(soil) || !Number.isFinite(vegetation) || !(vegetation > soil)) {
    throw new Error('端元必须是有限数值，且 NDVIveg 大于 NDVIsoil');
  }
  const span = vegetation - soil;

  const fvc = new Float32Array(ndvi.length);
  fvc.fill(Number.NaN);
  let fvcSum = 0;
  let resultCount = 0;
  let zeroCount = 0;
  let oneCount = 0;

  for (let i = 0; i < ndvi.length; i += 1) {
    if (status[i] !== 0) continue;
    const raw = (ndvi[i] - soil) / span;
    const clamped = Math.max(0, Math.min(1, raw));
    fvc[i] = clamped;
    fvcSum += clamped;
    resultCount += 1;
    if (clamped === 0) zeroCount += 1;
    if (clamped === 1) oneCount += 1;
  }

  return {
    soil,
    vegetation,
    fvc,
    status,
    water,
    resultCount,
    waterCount: water.reduce((sum, value) => sum + value, 0),
    invalidCount,
    unclassifiedCount,
    meanFvc: resultCount ? fvcSum / resultCount : NaN,
    zeroCount,
    oneCount,
  };
}

export function availableMethods(inputs) {
  return [
    { id: 'mndwi', label: 'MNDWI', ready: Boolean(inputs.mndwi?.length) },
    { id: 'ndwi', label: 'NDWI', ready: Boolean(inputs.ndwi?.length) },
    { id: 'mask', label: '已有水体掩膜', ready: Boolean(inputs.mask?.length) },
  ];
}

export function validateAlignment(base, candidate, label) {
  if (!candidate) return;
  if (candidate.width !== base.width || candidate.height !== base.height) {
    throw new Error(`${label} 尺寸为 ${candidate.width}×${candidate.height}，与 NDVI 的 ${base.width}×${base.height} 不一致`);
  }
  if (base.bbox && candidate.bbox) {
    const tolerance = 1e-7;
    const aligned = base.bbox.every((value, i) => Math.abs(value - candidate.bbox[i]) <= tolerance * Math.max(1, Math.abs(value)));
    if (!aligned) throw new Error(`${label} 与 NDVI 的空间范围不一致，请先完成重投影与像元对齐`);
  }
}

export function safeNumber(value) {
  if (value === null || value === undefined || value === '') return Number.NaN;
  const text = String(value).trim();
  if (!text) return Number.NaN;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}
