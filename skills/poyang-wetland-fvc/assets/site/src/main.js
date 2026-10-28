import Papa from 'papaparse';
import { fromArrayBuffer } from 'geotiff';
import { availableMethods, safeNumber, validateAlignment } from './core.js';
import { runExperiment, MODES } from './experiment.js';
import { createAudit, exportPixelsCsv, fingerprintFile } from './audit.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
  source: null,
  sourceName: '',
  inputs: {},
  rows: null,
  width: 0,
  height: 0,
  spatial: false,
  geoRaw: {},
  geoFiles: {},
  selectedMethod: null,
  selectedMode: 'independent',
  referenceMethod: null,
  fixedSource: 'common',
  experiment: null,
  sourceFiles: {},
  pendingReads: 0,
  appliedScale: 1,
  runId: null,
  runAt: null,
  thresholds: { mndwi: 0, ndwi: 0, mask: 0.5 },
  results: {},
  analyzed: false,
  mapRect: null,
  toastTimer: null,
};

const methodLabels = { mndwi: 'MNDWI', ndwi: 'NDWI', mask: '已有水体掩膜' };

function invalidateAnalysis() {
  state.experiment = null;
  state.results = {};
  state.analyzed = false;
  state.mapRect = null;
  $('#results-section').hidden = true;
  $('#export-btn').disabled = true;
  $('#audit-btn').disabled = true;
}

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.className = 'toast'; }, 3600);
}

function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function normalizeHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function findColumn(headers, aliases) {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  for (const alias of aliases) {
    if (normalized.has(normalizeHeader(alias))) return normalized.get(normalizeHeader(alias));
  }
  return null;
}

function inferGrid(rows, xColumn, yColumn) {
  // CSV coordinates alone do not establish a correctly ordered spatial grid.
  const width = Math.ceil(Math.sqrt(rows.length));
  return { width, height: Math.ceil(rows.length / width), spatial: false };
}

function setDataStatus(kind, title, detail) {
  const el = $('#data-status');
  el.className = `data-status${kind ? ` ${kind}` : ''}`;
  el.querySelector('b').textContent = title;
  el.querySelector('small').textContent = detail;
}

function updateReadiness() {
  const methods = availableMethods(state.inputs).filter((item) => item.ready);
  const hasNdvi = Boolean(state.inputs.ndvi?.length);
  const ready = hasNdvi && methods.length > 0;
  $('#analyze-btn').disabled = !ready || state.pendingReads > 0;
  if (state.pendingReads > 0) { setDataStatus('', '正在读取与校验文件', '文件处理完成前不可运行分析'); return; }
  $('#reset-btn').disabled = !state.source && !Object.keys(state.geoRaw).length;

  if (!hasNdvi) {
    if (Object.keys(state.geoRaw).length) setDataStatus('warn', '仍需 NDVI', '已暂存水体栅格，请载入 NDVI GeoTIFF');
    else setDataStatus('', '等待数据', '未载入任何观测值');
    return;
  }
  const count = state.inputs.ndvi.filter ? state.inputs.ndvi.filter(Number.isFinite).length : Array.from(state.inputs.ndvi).filter(Number.isFinite).length;
  if (!methods.length) {
    setDataStatus('warn', 'NDVI 已载入，缺少水体依据', `${count.toLocaleString()} 个有效 NDVI 像元；请再载入一种水体指数或掩膜`);
    return;
  }
  setDataStatus('ready', '数据可以分析', `${count.toLocaleString()} 个有效 NDVI 像元 · 可比较 ${methods.map((m) => m.label).join(' / ')}`);
}

function markCsvLoaded(file, rowCount) {
  const zone = $('#csv-dropzone');
  zone.classList.add('loaded');
  zone.querySelector('strong').textContent = file.name;
  zone.querySelector('small').textContent = `${rowCount.toLocaleString()} 行已解析 · 点击可替换文件`;
}

async function loadCsv(file) {
  if (!file) return;
  if (state.pendingReads) { toast('请等待当前文件读取完成'); return; }
  state.pendingReads += 1;
  invalidateAnalysis();
  updateReadiness();
  try {
    const buffer = await file.arrayBuffer();
    const provenance = await fingerprintFile(file, buffer);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
    if (parsed.errors.some((error) => error.code !== 'UndetectableDelimiter')) {
      throw new Error(parsed.errors[0].message || 'CSV 解析失败');
    }
    const rows = parsed.data;
    if (!rows.length) throw new Error('CSV 只有表头，没有观测行');
    const headers = parsed.meta.fields || Object.keys(rows[0]);
    const columns = {
      ndvi: findColumn(headers, ['ndvi']),
      mndwi: findColumn(headers, ['mndwi']),
      ndwi: findColumn(headers, ['ndwi']),
      mask: findColumn(headers, ['water_mask', 'watermask', 'is_water', 'mask']),
      x: findColumn(headers, ['x', 'lon', 'longitude', 'easting']),
      y: findColumn(headers, ['y', 'lat', 'latitude', 'northing']),
      id: findColumn(headers, ['pixel_id', 'pixelid', 'id']),
    };
    if (!columns.ndvi) throw new Error('未找到 NDVI 列；请检查表头拼写');

    const inputs = { ndvi: rows.map((row) => safeNumber(row[columns.ndvi])) };
    for (const key of ['mndwi', 'ndwi', 'mask']) {
      if (columns[key]) inputs[key] = rows.map((row) => safeNumber(row[columns[key]]));
    }
    const grid = inferGrid(rows, columns.x, columns.y);
    state.source = 'csv';
    state.sourceName = file.name;
    state.sourceFiles = { csv: { ...provenance, columns } };
    state.inputs = inputs;
    state.rows = { data: rows, columns };
    state.width = grid.width;
    state.height = grid.height;
    state.spatial = grid.spatial;
    state.geoRaw = {};
    state.geoFiles = {};
    state.analyzed = false;
    $('#results-section').hidden = true;
    markCsvLoaded(file, rows.length);
    updateReadiness();
    const readyMethods = availableMethods(inputs).filter((item) => item.ready);
    toast(readyMethods.length ? `已解析 ${rows.length.toLocaleString()} 行输入数据；真实性与精度须独立核验` : 'NDVI 已读取；还需要水体指数或已有掩膜');
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.pendingReads -= 1;
    updateReadiness();
  }
}

async function readGeoTiff(file) {
  const buffer = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const sampleCount = image.getSamplesPerPixel();
  if (sampleCount !== 1) throw new Error('请提供单波段 GeoTIFF；多波段数据请先提取所需指数波段');
  const raster = await image.readRasters({ samples: [0], interleave: true });
  const noDataRaw = image.getGDALNoData?.();
  const noData = noDataRaw == null ? Number.NaN : Number(noDataRaw);
  const values = new Float32Array(raster.length);
  for (let i = 0; i < raster.length; i += 1) {
    const value = Number(raster[i]);
    values[i] = Number.isFinite(value) && !(Number.isFinite(noData) && value === noData) ? value : Number.NaN;
  }
  let bbox = null;
  try { bbox = image.getBoundingBox(); } catch { bbox = null; }
  return { width, height, values, bbox, noData, provenance: await fingerprintFile(file, buffer) };
}

function applyGeoScale(raw, kind, scale) {
  const values = new Float32Array(raw.values.length);
  const factor = kind === 'mask' ? 1 : scale;
  for (let i = 0; i < raw.values.length; i += 1) values[i] = Number.isFinite(raw.values[i]) ? raw.values[i] * factor : Number.NaN;
  return values;
}

function rebuildGeoData() {
  invalidateAnalysis();
  const base = state.geoRaw.ndvi;
  if (!base) {
    state.inputs = {};
    updateReadiness();
    return;
  }
  const scale = Number($('#scale-input').value);
  if (!Number.isFinite(scale) || scale === 0) throw new Error('指数缩放系数必须是非零数值');
  const inputs = { ndvi: applyGeoScale(base, 'ndvi', scale) };
  for (const kind of ['mndwi', 'ndwi', 'mask']) {
    const candidate = state.geoRaw[kind];
    if (!candidate) continue;
    validateAlignment(base, candidate, methodLabels[kind]);
    inputs[kind] = applyGeoScale(candidate, kind, scale);
  }
  state.source = 'tiff';
  state.sourceName = state.geoFiles.ndvi || 'NDVI GeoTIFF';
  state.inputs = inputs;
  state.sourceFiles = Object.fromEntries(Object.entries(state.geoRaw).map(([kind, raw]) => [kind, { ...raw.provenance, noData: raw.noData, bbox: raw.bbox, width: raw.width, height: raw.height }]));
  state.appliedScale = scale;
  state.rows = null;
  state.width = base.width;
  state.height = base.height;
  state.spatial = true;
  state.analyzed = false;
  $('#results-section').hidden = true;
  updateReadiness();

  const finite = Array.from(inputs.ndvi).filter(Number.isFinite);
  if (finite.length) {
    const sample = finite.filter((_, index) => index % Math.max(1, Math.floor(finite.length / 2000)) === 0);
    const extreme = Math.max(...sample.map(Math.abs));
    if (extreme > 1.5 && scale === 1) toast('NDVI 绝对值超过 1；若栅格以整数存储，请核对并填写缩放系数', true);
  }
}

async function loadGeo(kind, file) {
  if (!file) return;
  if (state.pendingReads) { toast('请等待当前文件读取完成后重试'); return; }
  state.pendingReads += 1;
  invalidateAnalysis();
  updateReadiness();
  const previousRaw = state.geoRaw[kind];
  const previousName = state.geoFiles[kind];
  const slot = document.querySelector(`input[data-kind="${kind}"]`).closest('.raster-slot');
  const small = slot.querySelector('small');
  small.textContent = '正在读取…';
  try {
    const data = await readGeoTiff(file);
    state.geoRaw[kind] = data;
    state.geoFiles[kind] = file.name;
    slot.classList.add('loaded');
    slot.querySelector('i').textContent = '✓';
    small.textContent = `${file.name} · ${data.width}×${data.height}`;
    rebuildGeoData();
    updateReadiness();
    toast(`已载入 ${methodLabels[kind] || 'NDVI'}：${file.name}`);
  } catch (error) {
    if (previousRaw) { state.geoRaw[kind] = previousRaw; state.geoFiles[kind] = previousName; }
    else { delete state.geoRaw[kind]; delete state.geoFiles[kind]; }
    slot.classList.remove('loaded');
    slot.querySelector('i').textContent = '+';
    small.textContent = kind === 'ndvi' ? '必需 · 单波段' : kind === 'mask' ? '可选 · 水体值 > 0.5' : '可选 · 单波段';
    if (previousRaw) {
      slot.classList.add('loaded'); slot.querySelector('i').textContent = '✓';
      small.textContent = `${previousName} · ${previousRaw.width}×${previousRaw.height}（保留原文件）`;
    }
    try { rebuildGeoData(); } catch {}
    toast(error.message, true);
  } finally {
    state.pendingReads -= 1;
    updateReadiness();
  }
}

function computeAll() {
  const methods = availableMethods(state.inputs).filter((item) => item.ready);
  if (!methods.some(m => m.id === state.referenceMethod)) state.referenceMethod = methods[0]?.id;
  if (state.fixedSource !== 'common' && !methods.some(m => m.id === state.fixedSource)) state.fixedSource = 'common';
  state.experiment = runExperiment(state.inputs, { thresholds: state.thresholds, referenceMethod: state.referenceMethod, fixedSource: state.fixedSource });
  state.results = state.experiment.results[state.selectedMode];
  if (!methods.some(m => m.id === state.selectedMethod)) state.selectedMethod = methods[0].id;
  state.runId = crypto.randomUUID();
  state.runAt = new Date().toISOString();
  $('#export-btn').disabled = false;
  $('#audit-btn').disabled = false;
  renderExperimentControls();
}

function renderExperimentControls() {
  for (const [id, selected, includeCommon] of [['reference-select', state.referenceMethod, false], ['fixed-source-select', state.fixedSource, true]]) {
    const select = document.getElementById(id);
    select.replaceChildren();
    if (includeCommon) select.add(new Option('所有方案共同非水体的 P5/P95', 'common'));
    for (const method of state.experiment.methods) select.add(new Option(methodLabels[method] + (includeCommon ? ' 非水体 P5/P95' : ''), method));
    select.value = selected;
  }
  $('#mode-select').value = state.selectedMode;
  const fixed = state.experiment.fixedEndmembers;
  $('#experiment-note').textContent = `共同非水体：${state.experiment.commonIndices.length} 像元。固定端元：${fixed ? `${formatNumber(fixed.soil)} / ${formatNumber(fixed.vegetation)}` : `不可估计（${state.experiment.fixedError}）`}。${state.experiment.warnings.join(' ')} 栅格须预先完成 CRS/像元网格对齐；本工具未进行精度验证。`;
}

function renderMethodSwitch() {
  const host = $('#method-switch');
  host.replaceChildren();
  for (const method of availableMethods(state.inputs).filter((item) => item.ready)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(method.id === state.selectedMethod));
    button.className = method.id === state.selectedMethod ? 'active' : '';
    button.textContent = method.label;
    button.title = state.results[method.id]?.error ?? '';
    button.addEventListener('click', () => {
      state.selectedMethod = method.id;
      renderResults();
    });
    host.append(button);
  }
}

function fvcColor(value) {
  const stops = value < 0.5
    ? [[239, 231, 178], [126, 197, 111], value * 2]
    : [[126, 197, 111], [16, 101, 73], (value - 0.5) * 2];
  return stops[0].map((start, i) => Math.round(start + (stops[1][i] - start) * stops[2]));
}

function renderCanvas(result) {
  const canvas = $('#fvc-canvas');
  const ctx = canvas.getContext('2d');
  const outputW = 1000;
  const outputH = 560;
  canvas.width = outputW;
  canvas.height = outputH;
  ctx.fillStyle = '#edf1ec';
  ctx.fillRect(0, 0, outputW, outputH);

  const sourceRatio = state.width / state.height;
  const targetRatio = outputW / outputH;
  let drawW = outputW;
  let drawH = outputH;
  if (sourceRatio > targetRatio) drawH = Math.max(1, Math.round(outputW / sourceRatio));
  else drawW = Math.max(1, Math.round(outputH * sourceRatio));
  const offsetX = Math.floor((outputW - drawW) / 2);
  const offsetY = Math.floor((outputH - drawH) / 2);
  const image = ctx.createImageData(drawW, drawH);

  for (let y = 0; y < drawH; y += 1) {
    const sourceY = Math.min(state.height - 1, Math.floor(y / drawH * state.height));
    for (let x = 0; x < drawW; x += 1) {
      const sourceX = Math.min(state.width - 1, Math.floor(x / drawW * state.width));
      const sourceIndex = sourceY * state.width + sourceX;
      const targetIndex = (y * drawW + x) * 4;
      let color = [211, 217, 213];
      if (sourceIndex < state.inputs.ndvi.length) {
        if (result.water[sourceIndex]) color = [61, 143, 179];
        else if (Number.isFinite(result.fvc[sourceIndex])) color = fvcColor(result.fvc[sourceIndex]);
      }
      image.data[targetIndex] = color[0];
      image.data[targetIndex + 1] = color[1];
      image.data[targetIndex + 2] = color[2];
      image.data[targetIndex + 3] = 255;
    }
  }
  ctx.putImageData(image, offsetX, offsetY);
  state.mapRect = { offsetX, offsetY, drawW, drawH, result };
}

function renderComparison() {
  const body = $('#compare-body');
  body.replaceChildren();
  for (const method of availableMethods(state.inputs).filter((item) => item.ready)) {
    for (const mode of MODES) {
    const result = state.experiment.results[mode][method.id];
    const row = document.createElement('tr');
    if (method.id === state.selectedMethod && mode === state.selectedMode) row.className = 'active';
    const name = `${method.label} / ${mode === 'fixed' ? '固定' : '独立'}`;
    if (result.error) {
      const label = document.createElement('td'); label.textContent = name;
      const error = document.createElement('td'); error.colSpan = 6; error.textContent = result.error;
      row.append(label, error);
    } else {
      const threshold = state.thresholds[method.id];
      const stats = state.experiment.comparisons[method.id].modes[mode];
      row.innerHTML = `<td>${name}</td><td>&gt; ${formatNumber(threshold, 2)}</td><td>${formatNumber(result.soil)}</td><td>${formatNumber(result.vegetation)}</td><td>${formatNumber(result.meanFvc, 3)}</td><td>${formatNumber(stats.commonNonwater.mean, 3)} (n=${stats.commonNonwater.count})</td><td>${formatNumber(stats.pairedDifference.meanDelta, 6)} (n=${stats.pairedDifference.count})</td>`;
    }
    body.append(row);
    }
  }
  const regionsBody = $('#regions-body'); regionsBody.replaceChildren();
  for (const method of state.experiment.methods) {
    const regions = state.experiment.comparisons[method].regions;
    const row = document.createElement('tr');
    for (const value of [methodLabels[method], ...Object.values(regions).map(a => a.length)]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    regionsBody.append(row);
  }
}

function renderResults() {
  const result = state.results[state.selectedMethod];
  if (!result) return;
  renderMethodSwitch();
  $('#threshold-input').value = state.thresholds[state.selectedMethod];
  $('#threshold-hint').textContent = state.selectedMethod === 'mask' ? `掩膜值 > ${state.thresholds.mask} 判为水体` : `指数值 > ${state.thresholds[state.selectedMethod]} 判为水体`;
  $('#result-error').hidden = !result.error;
  $('#result-error').textContent = result.error ? `${methodLabels[state.selectedMethod]} / ${state.selectedMode} 无法计算：${result.error}。错误和像元分类仍可导出审计。` : '';
  $('#result-display').hidden = Boolean(result.error);
  renderComparison();
  if (result.error) { state.mapRect = null; return; }
  $('#soil-value').textContent = formatNumber(result.soil);
  $('#veg-value').textContent = formatNumber(result.vegetation);
  $('#mean-value').textContent = formatNumber(result.meanFvc, 3);
  $('#water-value').textContent = result.waterCount.toLocaleString();
  const total = state.inputs.ndvi.length;
  $('#water-rate').textContent = `${(result.waterCount / total * 100).toFixed(1)}% 的全部像元`;
  $('#result-count').textContent = result.resultCount.toLocaleString();
  $('#water-count').textContent = result.waterCount.toLocaleString();
  const invalid = result.invalidCount + result.unclassifiedCount;
  $('#invalid-count').textContent = invalid.toLocaleString();
  $('#donut-value').textContent = `${(result.resultCount / total * 100).toFixed(1)}%`;
  $('#donut').style.setProperty('--p', result.resultCount / total * 100);
  $('#donut').style.setProperty('--w', result.waterCount / total * 100);
  $('#preview-size').textContent = `${state.width.toLocaleString()} × ${state.height.toLocaleString()}`;
  $('#preview-title').textContent = state.spatial ? 'FVC 像元空间分布' : 'FVC 像元序列预览';
  renderCanvas(result);
}

function analyze() {
  try {
    computeAll();
    state.analyzed = true;
    const section = $('#results-section');
    section.hidden = false;
    $('#result-subtitle').textContent = `${state.sourceName} · ${state.inputs.ndvi.length.toLocaleString()} 个像元 · 两种端元模式同时计算与导出`;
    renderResults();
    requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } catch (error) {
    toast(error.message, true);
  }
}

function updateThreshold() {
  const value = safeNumber($('#threshold-input').value);
  if (!Number.isFinite(value)) { $('#threshold-input').value = state.thresholds[state.selectedMethod]; toast('阈值必须是有限数值', true); return; }
  state.thresholds[state.selectedMethod] = value;
  try {
    computeAll();
    renderResults();
  } catch (error) {
    toast(error.message, true);
  }
}

function csvEscape(value) {
  if (value === null || value === undefined || value === '') return '';
  const string = String(value);
  return /[",\n\r]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function downloadBlob(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportResults() {
  if (!state.experiment) return;
  const content = exportPixelsCsv(state.inputs, state.experiment, { runId: state.runId, coordinateMeaning: state.source === 'csv' ? 'user_supplied_or_absent' : 'zero_based_column_row', pixel: i => {
    const row = state.rows?.data[i], columns = state.rows?.columns;
    return { id: row && columns.id ? row[columns.id] : i + 1,
      x: row && columns.x ? row[columns.x] : state.spatial ? i % state.width : null,
      y: row && columns.y ? row[columns.y] : state.spatial ? Math.floor(i / state.width) : null };
  } });
  downloadBlob(`fvc_${state.runId}_pixels.csv`, content, 'text/csv;charset=utf-8');
  toast('已导出两种端元模式与所有方案；请同时保存同编号审计 JSON');
}

function exportAudit() {
  if (!state.experiment) return;
  const audit = createAudit(state.experiment, { runId: state.runId, createdAt: state.runAt, sourceType: state.source,
    files: Object.entries(state.sourceFiles).map(([role, info]) => ({ role, ...info })),
    grid: { width: state.width, height: state.height, previewIsSpatial: state.spatial },
    indexScaleFactor: state.source === 'tiff' ? state.appliedScale : 1,
    coordinateMeaning: state.source === 'csv' ? 'user_supplied_or_absent' : 'zero_based_column_row',
    selectedMode: state.selectedMode, selectedMethod: state.selectedMethod });
  downloadBlob(`fvc_${state.runId}_audit.json`, JSON.stringify(audit, null, 2), 'application/json');
  toast('审计已导出；文件名与校验值属于数据来源信息，分享前请检查');
}

function resetAll() {
  if (state.pendingReads) { toast('请等待文件读取完成'); return; }
  invalidateAnalysis();
  state.source = null;
  state.sourceName = '';
  state.inputs = {};
  state.rows = null;
  state.width = 0;
  state.height = 0;
  state.spatial = false;
  state.geoRaw = {};
  state.geoFiles = {};
  state.results = {};
  state.selectedMethod = null;
  state.sourceFiles = {};
  state.thresholds = { mndwi: 0, ndwi: 0, mask: 0.5 }; state.appliedScale = 1;
  $('#scale-input').value = 1;
  state.selectedMode = 'independent'; state.referenceMethod = null; state.fixedSource = 'common';
  state.analyzed = false;
  $$('input[type="file"]').forEach((input) => { input.value = ''; });
  $('#csv-dropzone').classList.remove('loaded');
  $('#csv-dropzone strong').textContent = '拖入 CSV，或点击选择';
  $('#csv-dropzone small').textContent = '必须包含 NDVI；另含 MNDWI、NDWI 或 water_mask 至少一项';
  $$('.raster-slot').forEach((slot) => {
    const kind = slot.querySelector('input').dataset.kind;
    slot.classList.remove('loaded');
    slot.querySelector('i').textContent = '+';
    slot.querySelector('small').textContent = kind === 'ndvi' ? '必需 · 单波段' : kind === 'mask' ? '可选 · 水体值 > 0.5' : '可选 · 单波段';
  });
  $('#results-section').hidden = true;
  updateReadiness();
  toast('已清除本机内存中的数据');
}

function handleCanvasMove(event) {
  const rect = state.mapRect;
  if (!rect) return;
  const canvas = $('#fvc-canvas');
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width * canvas.width;
  const y = (event.clientY - bounds.top) / bounds.height * canvas.height;
  const tip = $('#canvas-tooltip');
  if (x < rect.offsetX || y < rect.offsetY || x >= rect.offsetX + rect.drawW || y >= rect.offsetY + rect.drawH) {
    tip.hidden = true;
    return;
  }
  const col = Math.min(state.width - 1, Math.floor((x - rect.offsetX) / rect.drawW * state.width));
  const row = Math.min(state.height - 1, Math.floor((y - rect.offsetY) / rect.drawH * state.height));
  const index = row * state.width + col;
  if (index >= state.inputs.ndvi.length) { tip.hidden = true; return; }
  let detail = '无效 / 无掩膜值';
  if (rect.result.water[index]) detail = '水体 · 已排除';
  else if (Number.isFinite(rect.result.fvc[index])) detail = `FVC ${rect.result.fvc[index].toFixed(3)}`;
  tip.textContent = `行 ${row + 1} · 列 ${col + 1} · ${detail}`;
  tip.style.left = `${event.clientX - bounds.left}px`;
  tip.style.top = `${event.clientY - bounds.top}px`;
  tip.hidden = false;
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.tab').forEach((item) => {
    const active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  const csvActive = tab.dataset.tab === 'csv';
  $('#csv-panel').hidden = !csvActive;
  $('#tiff-panel').hidden = csvActive;
  $('#csv-panel').classList.toggle('active', csvActive);
  $('#tiff-panel').classList.toggle('active', !csvActive);
}));

$('#csv-input').addEventListener('change', (event) => loadCsv(event.target.files[0]));
$$('input[data-kind]').forEach((input) => input.addEventListener('change', (event) => loadGeo(input.dataset.kind, event.target.files[0])));
$('#scale-input').addEventListener('change', () => {
  if (!state.geoRaw.ndvi || state.pendingReads) return;
  try { rebuildGeoData(); toast('已按新的缩放系数更新指数值'); } catch (error) { $('#scale-input').value = state.appliedScale; updateReadiness(); toast(error.message, true); }
});
$('#analyze-btn').addEventListener('click', analyze);
$('#threshold-input').addEventListener('change', updateThreshold);
$('#export-btn').addEventListener('click', exportResults);
$('#audit-btn').addEventListener('click', exportAudit);
$('#mode-select').addEventListener('change', () => {
  if (!state.experiment) return;
  state.selectedMode = $('#mode-select').value;
  state.results = state.experiment.results[state.selectedMode];
  renderResults();
});
for (const [id, key] of [['reference-select', 'referenceMethod'], ['fixed-source-select', 'fixedSource']]) {
  document.getElementById(id).addEventListener('change', () => {
    if (!state.experiment) return;
    state[key] = document.getElementById(id).value;
    try { computeAll(); renderResults(); } catch (error) { invalidateAnalysis(); toast(error.message, true); }
  });
}
$('#reset-btn').addEventListener('click', resetAll);
$('#template-btn').addEventListener('click', () => downloadBlob('poyang_fvc_input_structure.csv', '\uFEFFpixel_id,x,y,ndvi,mndwi,ndwi,water_mask\n', 'text/csv;charset=utf-8'));
$('#format-help-btn').addEventListener('click', () => $('#format-dialog').showModal());
$('#fvc-canvas').addEventListener('mousemove', handleCanvasMove);
$('#fvc-canvas').addEventListener('mouseleave', () => { $('#canvas-tooltip').hidden = true; });

const dropzone = $('#csv-dropzone');
for (const eventName of ['dragenter', 'dragover']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add('dragover'); });
for (const eventName of ['dragleave', 'drop']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove('dragover'); });
dropzone.addEventListener('drop', (event) => loadCsv(event.dataTransfer.files[0]));

updateReadiness();
