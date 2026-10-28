# Source and known limits

Recover source from original Site revision `2a7ddb8621e8f2d8240cd7f405407bdf4202b2d8`. No original deployment identity, tokens, observation files, or Git history are bundled.

Packaging changes apply only to this template: exclude missing water classification from final FVC, handle whitespace-only CSV fields as missing, reject unknown schemes/nonfinite thresholds, require single-band rasters, and label CSV previews as row-order overviews. The original live Site remains unchanged.

Version 1.1.0 adds independent/fixed endpoint controls, common/reference-relative support statistics, explicit classification exports, SHA-256 input/source provenance, matching-ID pixel CSV and audit JSON, and tests for those behaviors. These are software improvements, not real-data validation. No Sites deployment is needed to save this skill; do not update the original live Site for software-only requests.

Known limits:

- Raster checks cover dimensions and available bounding boxes, not full CRS/affine equivalence. Pre-align files in GIS; no reprojection/resampling is implemented.
- CSV coordinates are exported as provided, not reordered into a geographic grid. Raster exports use zero-based column/row indices, not world coordinates.
- Processing reads entire rasters into browser memory. Large scenes may exceed capacity. Crop/downsample upstream; do not silently sample pixels for statistics.
- No automatic wetland-boundary, cloud, or vegetation mask is applied. Supply a suitable study area.
- Passing model tests/build does not establish browser compatibility or scientific accuracy. Report missing browser/real-data QA.
- DOM-simulation tests use jsdom and mocked canvas drawing; they do not validate actual browser downloads, canvas rendering, GeoTIFF browser decoding or cross-browser compatibility.
- Fixed endpoints default to the common non-water intersection. A small intersection is not necessarily representative; the tool reports its size but does not establish ecological representativeness or optimal thresholds.
- Endpoint settings apply to one imported batch, not a harmonized multi-date time series. No uncertainty intervals, ground-truth metrics, automatic cloud masking or reproducible GIS preprocessing are provided.
- MIT covers original project/skill code; dependencies retain their licenses. Preserve applicable notices in redistributions and legal comments in bundled builds.

Test arrays are mathematical fixtures, never Poyang satellite or field observations.
