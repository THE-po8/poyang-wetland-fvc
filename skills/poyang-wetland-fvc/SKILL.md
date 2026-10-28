---
name: poyang-wetland-fvc
description: Build, run, or adapt a wetland fractional vegetation cover website from bundled source. Use for real NDVI CSV/GeoTIFF imports, P5/P95 pixel dichotomy FVC, independent/fixed-endmember controls, MNDWI/NDWI/existing water-mask comparisons, or reproducible status-aware CSV/JSON audits. Never invent observations or treat excluded water as zero-FVC vegetation.
---

# 湿地fvc

Use `assets/site/` as the browser-local website template. Read `references/model-and-data.md` before interpreting results or changing the model. Read `references/source-and-limits.md` before promising spatial validation or publishing.

## Create a working site

Run `node <skill-directory>/scripts/scaffold.mjs <new-project-directory>` to copy the template into a new, empty project directory. Never overwrite an existing project or edit the installed template for a one-off request.

In the new directory, run:

```sh
npm ci
npm test
npm run build
```

Serve `dist/` with an approved preview tool. Use the Sites skill for Sites hosting; otherwise follow the explicitly selected host. Do not create a Site, publish publicly, or modify an existing live deployment merely because this skill was invoked. Never copy another project's hosting identity or credentials.

## Preserve the scientific contract

- Accept only user-supplied or independently verified real NDVI and water-classification inputs. Provide a header-only CSV when data are absent. Label mathematical test fixtures as tests, not observations.
- Exclude invalid NDVI and missing water-mask values. Classify water with the selected index/mask threshold; keep water FVC missing, not zero.
- Compute both independent and fixed-endmember controls. In independent mode, derive P5/P95 from each scheme's own finite non-water NDVI. In fixed mode, use one common pair derived from all schemes' common non-water pixels by default, or an explicitly selected reference scheme. Use sorted linear interpolation at `(n - 1) * q`. Never silently fall back when the selected source is insufficient or degenerate.
- Calculate `FVC = clamp((NDVI - NDVIsoil)/(NDVIveg - NDVIsoil), 0, 1)`. Stop when fewer than two usable pixels remain or endmembers coincide.
- Keep blue water, gray invalid/unknown, and green FVC categories distinct in previews and exports.
- Do not call all non-water pixels wetland vegetation without an appropriate study-area/vegetation mask. Do not derive area without validated pixel area and CRS.

## Validate before handoff

Run `npm run check` for model, audit, scaffolding and DOM-simulation tests plus the production build. Verify a header-only CSV does not generate results, both modes run, references switch, thresholds recompute endpoints, failed controls stay explicit, and exported water/unknown pixels have empty FVC. Use real user data only when available and authorized; otherwise report real-data validation as pending.

Export all scheme/mode pixel rows and the matching run-ID audit JSON together. Retain original input files. Audit records SHA-256 file fingerprints, version/source fingerprint, applied scale, thresholds, endpoint source, counts and region transitions; it does not contain the source observations. Treat file modification time as filesystem metadata, never satellite acquisition time.

Compare all-method common non-water support separately from per-reference shared and unique regions. Fixed-endmember FVC must be identical on shared non-water pixels with the same NDVI. Do not call pairwise differences accuracy metrics or interpret different-support means as a controlled accuracy comparison.

Use supported browser tools when available. Never describe unit tests or static-resource checks as full browser QA. Keep spatial limitations visible in the handoff.

## Publish or share

When requested, publish this skill directory with its template, references, and tests. Exclude `.git`, `node_modules`, generated builds, credentials, observations, and `.openai/hosting.json`. Preserve dependency licenses. Resolve the intended account/repository before publishing to an ambiguous destination. Preserve live-site access unless explicitly asked to change it.
