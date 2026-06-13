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

export type {
  PackRef,
  PackManifest,
  DecodedPack,
  LoadTopology,
  Topology,
  GeometryCollection,
} from "./types.js";
