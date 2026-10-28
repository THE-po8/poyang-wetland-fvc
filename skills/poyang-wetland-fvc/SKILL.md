---
name: poyang-wetland-fvc
description: Build, run, or adapt a Poyang Lake wetland fractional vegetation cover website from bundled source. Use for real NDVI CSV/GeoTIFF imports, pixel dichotomy FVC with non-water P5/P95 endmembers, or MNDWI/NDWI/existing water-mask comparisons. Never invent observations or treat excluded water as zero-FVC vegetation.
---

# 鄱阳湖湿地 FVC

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
- Derive NDVIsoil = P5 and NDVIveg = P95 from finite non-water NDVI independently for each scheme. Use sorted linear interpolation at `(n - 1) * q`.
- Calculate `FVC = clamp((NDVI - NDVIsoil)/(NDVIveg - NDVIsoil), 0, 1)`. Stop when fewer than two usable pixels remain or endmembers coincide.
- Keep blue water, gray invalid/unknown, and green FVC categories distinct in previews and exports.
- Do not call all non-water pixels wetland vegetation without an appropriate study-area/vegetation mask. Do not derive area without validated pixel area and CRS.

## Validate before handoff

Run model tests and the production build. Verify a header-only CSV does not generate results, schemes switch, thresholds recompute endmembers, and exported water/unknown pixels have empty FVC. Use real user data only when available and authorized; otherwise report real-data validation as pending.

Use supported browser tools when available. Never describe unit tests or static-resource checks as full browser QA. Keep spatial limitations visible in the handoff.

## Publish or share

When requested, publish this skill directory with its template, references, and tests. Exclude `.git`, `node_modules`, generated builds, credentials, observations, and `.openai/hosting.json`. Preserve dependency licenses. Resolve the intended account/repository before publishing to an ambiguous destination. Preserve live-site access unless explicitly asked to change it.
