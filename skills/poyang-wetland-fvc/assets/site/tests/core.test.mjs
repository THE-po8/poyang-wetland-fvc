import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFvc, quantile, validateAlignment, safeNumber } from '../src/core.js';

// Mathematical test fixtures only, not observations.

test('quantile performs linear interpolation', () => {
  assert.equal(quantile([0, 1, 2, 3, 4], 0.05), 0.2);
  assert.equal(quantile([0, 1, 2, 3, 4], 0.95), 3.8);
});

test('FVC excludes water and clamps results to 0..1', () => {
  const inputs = {
    ndvi: [-1, 0, 0.2, 0.4, 0.8, 1],
    mndwi: [1, -1, -1, 1, -1, -1],
  };
  const result = analyzeFvc(inputs, 'mndwi', 0);
  assert.equal(result.waterCount, 2);
  assert.equal(result.resultCount, 4);
  assert.ok(Array.from(result.fvc).filter(Number.isFinite).every((value) => value >= 0 && value <= 1));
  assert.ok(Number.isNaN(result.fvc[0]));
  assert.ok(Number.isNaN(result.fvc[3]));
});

test('existing mask treats values above threshold as water', () => {
  const result = analyzeFvc({ ndvi: [0.1, 0.2, 0.5, 0.8], mask: [1, 0, 0, 0] }, 'mask', 0);
  assert.equal(result.waterCount, 1);
  assert.equal(result.resultCount, 3);
});

test('alignment rejects mismatched rasters', () => {
  assert.throws(() => validateAlignment({ width: 10, height: 10 }, { width: 9, height: 10 }, 'NDWI'), /不一致/);
});

test('missing mask values remain missing FVC and audit totals balance', () => {
  const result = analyzeFvc({ ndvi: [0.1, 0.2, 0.4, 0.6, NaN], mask: [0, NaN, 0, 1, 0] }, 'mask', 0.5);
  assert.ok(Number.isNaN(result.fvc[1]));
  assert.equal(result.unclassifiedCount, 1);
  assert.equal(result.resultCount, 2);
  assert.equal(result.resultCount + result.waterCount + result.invalidCount + result.unclassifiedCount, 5);
});

test('whitespace and empty fields are missing, never zero', () => {
  for (const value of [' ', '\t', '', null, undefined, 'NoData']) assert.ok(Number.isNaN(safeNumber(value)));
  assert.equal(safeNumber('0'), 0);
});

test('degenerate endmembers and insufficient data stop analysis', () => {
  assert.throws(() => analyzeFvc({ ndvi: [0.5, 0.5], mask: [0, 0] }, 'mask', 0.5), /相同/);
  assert.throws(() => analyzeFvc({ ndvi: [0.1, 0.2], mask: [1, 1] }, 'mask', 0.5), /不足/);
});

test('invalid schemes and thresholds are rejected', () => {
  assert.throws(() => analyzeFvc({ ndvi: [0.1, 0.8] }, 'unknown', 0), /方案/);
  assert.throws(() => analyzeFvc({ ndvi: [0.1, 0.8], mask: [0, 0] }, 'mask', NaN), /阈值/);
});
