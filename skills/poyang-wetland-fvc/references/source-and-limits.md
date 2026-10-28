# Source and known limits

Recover source from original Site revision `2a7ddb8621e8f2d8240cd7f405407bdf4202b2d8`. No original deployment identity, tokens, observation files, or Git history are bundled.

Packaging changes apply only to this template: exclude missing water classification from final FVC, handle whitespace-only CSV fields as missing, reject unknown schemes/nonfinite thresholds, require single-band rasters, and label CSV previews as row-order overviews. The original live Site remains unchanged.

Known limits:

- Raster checks cover dimensions and available bounding boxes, not full CRS/affine equivalence. Pre-align files in GIS; no reprojection/resampling is implemented.
- CSV coordinates are exported as provided, not reordered into a geographic grid. Raster exports use zero-based column/row indices, not world coordinates.
- Processing reads entire rasters into browser memory. Large scenes may exceed capacity. Crop/downsample upstream; do not silently sample pixels for statistics.
- No automatic wetland-boundary, cloud, or vegetation mask is applied. Supply a suitable study area.
- Passing model tests/build does not establish browser compatibility or scientific accuracy. Report missing browser/real-data QA.
- MIT covers original project/skill code; dependencies retain their licenses. Preserve applicable notices in redistributions and legal comments in bundled builds.

Test arrays are mathematical fixtures, never Poyang satellite or field observations.
