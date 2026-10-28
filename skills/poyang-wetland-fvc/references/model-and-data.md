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

Partition pixels into disjoint classes: invalid NDVI; finite NDVI with missing classification; excluded water; valid non-water FVC. Only the final class enters P5/P95 and the FVC mean. Sort non-water NDVI and interpolate at `(n - 1) * q` for q = 0.05, 0.95. Stop if n < 2 or P95 <= P5. Calculate `(NDVI-P5)/(P95-P5)` and clip to [0, 1]. Re-estimate endmembers per scheme; comparisons reflect both exclusions and endmembers.

## Interpretation

An imported scene is not automatically a Poyang wetland vegetation region. Require upstream cloud/shadow removal and study-area cropping/masking. Non-water includes bare ground and other land covers. FVC is a model estimate, not a validation measurement. Never invent accuracy metrics, observation dates, field samples, vegetation areas, or citations. No real observational dataset is bundled.
