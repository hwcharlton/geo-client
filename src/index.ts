/**
 * `@hwcharlton/geo-client` — browser-facing fetch + decode client for the
 * @hwcharlton geo-data ecosystem.
 *
 * Responsibility (ADR-012): given a pack ref, fetch the baked TopoJSON area
 * pack, brotli-decode it if compressed, expand the named TopoJSON object into a
 * GeoJSON `FeatureCollection` via `topojson-client`, and surface the source
 * attribution from the sibling `geo-area-pack/1` manifest. The only I/O —
 * `fetch` and brotli decode — is dependency-injected, so this package imports
 * no Node built-ins and runs unchanged in the browser.
 *
 * Domain vocabulary (the layer taxonomy, the OSM attribution constant) comes
 * from `@hwcharlton/geo-model` and is not redefined here.
 *
 *   - {@link decodePack} — `(deps, packRef, options?)` → decoded pack.
 *   - {@link makeBrowserLoader} — build a `loadTopology` from `fetch` + brotli.
 *
 * The PLATEAU authoritative building tier (Phase-09 Stage 2) is an additive,
 * mesh-tiled fetch path layered on the same injected brotli/loader seam:
 *
 *   - {@link fetchPlateauIndex} — fetch + parse `plateau/index.json`.
 *   - {@link decodePlateauMesh} — decode one mesh pack → building Features with
 *     `height` + `source` + attribution.
 *   - {@link plateauMeshRef} / {@link resolvePlateauPackUrl} — address the tier.
 */
export {
  decodePack,
  type DecodePackDeps,
  type DecodePackOptions,
} from "./decode.js";

export {
  makeBrowserLoader,
  type BrowserLoaderDeps,
  type BrowserLoaderOptions,
} from "./loader.js";

export {
  fetchPlateauIndex,
  decodePlateauMesh,
  plateauMeshRef,
  resolvePlateauPackUrl,
  plateauMeshObjectName,
  type PlateauMeshIndex,
  type PlateauMeshEntry,
  type PlateauMeshRef,
  type PlateauBuildingFeature,
  type PlateauBuildingProperties,
  type DecodedPlateauMesh,
  type FetchPlateauIndexDeps,
  type FetchPlateauIndexOptions,
  type DecodePlateauMeshDeps,
  type DecodePlateauMeshOptions,
} from "./plateau.js";

export type {
  PackRef,
  PackManifest,
  DecodedPack,
  LoadTopology,
  Topology,
  GeometryCollection,
} from "./types.js";
