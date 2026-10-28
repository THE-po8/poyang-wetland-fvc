# Model and data contract

## Inputs

CSV schema (header only; not observations):

```csv
pixel_id,x,y,ndvi,mndwi,ndwi,water_mask
```

Require ndvi and at least one of mndwi, ndwi, water_mask. Treat blank/non-numeric values as missing. Each row represents one co-located pixel. Optional coordinates are retained on export; CSV preview is row-order, not a georeferenced map.

For GeoTIFF, require separate single-band NDVI and water-index/mask files. Apply an explicit scale factor to indices, not the existing mask. Preserve NoData. Require pre-alignment of CRS, affine grid, resolution, extent, and study area in GIS. Current code checks dimensions and bounding boxes only, not full CRS/affine equivalence.

The tool accepts precomputed indices, not raw spectral bands. Document which NDWI convention was used: the intended water NDWI here is `(green - NIR)/(green + NIR)`, not the vegetation moisture index also called NDWI. MNDWI uses `(green - SWIR)/(green + SWIR)`.

## Exclusion and model

Defaults: `index > 0` for water indices; `mask > 0.5` for existing masks (binary 1 water, 0 non-water). These are exploratory thresholds, not universally validated cutoffs.

Partition pixels into disjoint classes: invalid NDVI; finite NDVI with missing classification; excluded water; valid non-water FVC. Invalid NDVI takes precedence when both NDVI and water classification are missing. Only valid non-water inputs enter P5/P95. Sort them and interpolate at `(n - 1) * q` for q = 0.05, 0.95. Stop endpoint estimation if n < 2 or P95 <= P5. Calculate `(NDVI-P5)/(P95-P5)` and clip to [0, 1]. FVC arrays use Float32, with means calculated over emitted finite FVC values.

## Controlled comparisons (v1.1.0)

Compute independent and fixed modes simultaneously. Independent mode estimates P5/P95 separately from each scheme's own valid non-water support. Fixed mode uses one pair for every scheme; by default derive it from pixels classified as valid non-water by every loaded scheme. Allow an explicit source scheme instead. Do not automatically switch sources if the common region is empty, too small, or constant. Preserve a fixed-mode error while independently valid results remain accessible. Under valid fixed endpoints, a scheme retaining zero pixels has no mean, not mean FVC=0.

Choose one loaded scheme as the region-comparison reference. Partition every pixel into shared non-water, reference-only non-water, candidate-only non-water, or neither. Reference-only/candidate-only are not automatically water changes: one side may lack NDVI/classification. Export a full 4×4 reference-to-candidate status transition matrix to distinguish those cases.

Report per-scheme whole-support means, all-method common-support means, per-reference shared means, unique-region summaries, and signed candidate-minus-reference shared-pixel differences. Empty-support statistics are null. Fixed-mode differences on the same valid shared pixels must be zero (same NDVI and endpoints). Independent-mode shared differences isolate the endpoint choice within the unchanged shared support; whole-support mean differences still conflate support and endpoints. Never call agreement, mean differences, or absolute differences field-validated accuracy.

## Audit exports

Export long-form CSV rows for every method × endpoint mode × source pixel. Include run ID, source pixel ID/coordinates, coordinate meaning, NDVI, threshold, explicit pixel status, tri-state is_water, common-support flag, reference-relative region, endpoints, FVC, and any analysis error. Unknown/invalid is_water is blank rather than 0; excluded/unknown/invalid FVC is blank.

Export matching-ID JSON with schema/software version, a build-generated source SHA-256 (null for unbuilt module execution), original-file byte SHA-256 fingerprints and sizes, applied index scaling, input field mappings, quantile definition, clipping, reference/fixed source, scheme errors, counts, regions and transitions. File lastModified is not observation date. Retain original rasters/CSV and external CRS/preprocessing metadata: a manifest cannot recreate missing source data. Sharing the JSON exposes original filenames and file hashes, not the original data values.

## Interpretation

An imported scene is not automatically a Poyang wetland vegetation region. Require upstream cloud/shadow removal and study-area cropping/masking. Non-water includes bare ground and other land covers. FVC is a model estimate, not a validation measurement. Never invent accuracy metrics, observation dates, field samples, vegetation areas, or citations. No real observational dataset is bundled.
