/**
 * PLATEAU authoritative building tier — additive browser fetch path
 * (Phase-09 Stage 2). Separate from the Stage-1 OSM "buildings-light" tier:
 * these packs carry authoritative building **heights** from MLIT Project
 * PLATEAU (国土交通省), shipped under ODbL-1.0.
 *
 * Tiling unit is the Japanese 3rd-level mesh (~1 km, 8-digit code). The full
 * 23-ku is too many polygons for one pack, so there is **one pack per mesh** and
 * a top-level `plateau/index.json` lists every mesh with its bbox (for viewport
 * culling) and pack path. A consumer fetches the index once, then fetches +
 * decodes only the in-view meshes.
 *
 * Design notes:
 *  - The mesh index is a NEW JSON wire shape with no producer in any *published*
 *    geo-* package yet, so it is defined here as a LOCAL type rather than
 *    imported. It is read-only retrieved data.
 *  - This module reuses the existing brotli-injection seam: the per-mesh pack is
 *    fetched + decoded through {@link LoadTopology} (built by `makeBrowserLoader`,
 *    which already takes an injected `brotliDecode`), so NO hard brotli
 *    dependency is added.
 *  - Source separation (ADR-013) is binding: PLATEAU packs are pure PLATEAU.
 *    Every decoded building Feature is asserted to carry `source: "plateau"`.
 *
 * DI convention throughout: `(deps, target, options?)`.
 */
import { feature as topojsonFeature } from "topojson-client";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { GeometryObject } from "topojson-specification";
import type { LoadTopology, PackRef } from "./types.js";

/** The TopoJSON object key for a PLATEAU mesh building pack: `<mesh8>-building`. */
const meshObjectName = (mesh: string): string => `${mesh}-building`;

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");

/**
 * One mesh entry in {@link PlateauMeshIndex}. Mirrors the on-disk
 * `packs/plateau/index.json` `meshes[]` shape (cross-package JSON contract v1).
 */
export interface PlateauMeshEntry {
  /** Japanese 3rd-level mesh code, 8 digits, e.g. `"53393596"`. */
  readonly mesh: string;
  /** Geographic bounding box `[minLon, minLat, maxLon, maxLat]` (EPSG:4326). */
  readonly bbox: readonly [number, number, number, number];
  /**
   * Pack path **relative to `packs/`**, e.g.
   * `"plateau/53393596/building/flat.<hash>.topo.json.br"`. Resolved against a
   * configured base URL by {@link resolvePlateauPackUrl}.
   */
  readonly pack: string;
  /** Number of building features in the pack. */
  readonly count: number;
  /** Maximum building height (m) in the mesh — an LOD / extrusion hint. */
  readonly height_max: number;
}

/**
 * The PLATEAU mesh index (`packs/plateau/index.json`). A NEW cross-package JSON
 * wire shape, defined LOCALLY here (no published producer to import from yet).
 * Treated as untrusted retrieved data — {@link fetchPlateauIndex} validates the
 * minimum shape it relies on.
 */
export interface PlateauMeshIndex {
  /** Tier discriminator, `"plateau-building"`. */
  readonly tier: string;
  /** Data CRS of the pack coordinates (geographic), e.g. `"urn:ogc:def:crs:EPSG::4326"`. */
  readonly crs?: string;
  /** CRS geo-canvas projects to at render time, e.g. `"EPSG:6677"`. */
  readonly render_crs?: string;
  /** Attribution lines to surface, e.g. `["出典：国土交通省 PLATEAU（加工して作成）"]`. */
  readonly attribution: readonly string[];
  /** License identifier as recorded on disk, e.g. `"ODbL-1.0"`. */
  readonly license?: string;
  /** Every mesh covered by the tier. */
  readonly meshes: readonly PlateauMeshEntry[];
}

/**
 * A reference addressing the PLATEAU tier for one mesh. It is structurally a
 * {@link PackRef} so it flows through the existing {@link LoadTopology} /
 * `makeBrowserLoader` plumbing unchanged: `ward` is the `plateau/<mesh>` place
 * id (so `packPaths` resolves the manifest under `packs/plateau/<mesh>/…`),
 * `layer` is `"building"`, `detail` is `"flat"`.
 */
export interface PlateauMeshRef extends PackRef {
  readonly ward: `plateau/${string}`;
  readonly layer: "building";
  readonly detail: "flat";
}

/**
 * Build the {@link PlateauMeshRef} for a mesh code. Use this when fetching a
 * pack through the standard {@link LoadTopology} (manifest-driven) path; use
 * {@link resolvePlateauPackUrl} when fetching a pack directly by the index
 * entry's `pack` path.
 *
 * @example
 * plateauMeshRef("53393596");
 *   // { ward: "plateau/53393596", layer: "building", detail: "flat" }
 */
export const plateauMeshRef = (mesh: string): PlateauMeshRef => ({
  ward: `plateau/${mesh}`,
  layer: "building",
  detail: "flat",
});

/** A decoded PLATEAU building feature: a polygon footprint carrying `height`. */
export interface PlateauBuildingProperties {
  /** Building height in metres (PLATEAU `measuredHeight`); `null` if unknown. */
  readonly height: number | null;
  /** Data source — always `"plateau"` (source separation, ADR-013). */
  readonly source: "plateau";
  /** PLATEAU building id (`gml:id`), e.g. `"BLD_d61ead86-…"`. */
  readonly id: string;
}

/** A single decoded PLATEAU building footprint Feature. */
export type PlateauBuildingFeature = Feature<
  Polygon | MultiPolygon,
  PlateauBuildingProperties
>;

/** What {@link decodePlateauMesh} hands back for one mesh. */
export interface DecodedPlateauMesh {
  /** The mesh code that was decoded. */
  readonly mesh: string;
  /** The expanded TopoJSON object name (`<mesh>-building`). */
  readonly objectName: string;
  /** The decoded building footprint Features (each carries `height`). */
  readonly features: readonly PlateauBuildingFeature[];
  /** Number of features (`=== features.length`). */
  readonly featureCount: number;
  /** Attribution lines surfaced from the per-mesh manifest. */
  readonly attribution: readonly string[];
}

/** Injected dependencies for {@link fetchPlateauIndex}. */
export interface FetchPlateauIndexDeps {
  /** The platform `fetch` (browser global, or a Node/undici fetch in tests). */
  readonly fetch: typeof fetch;
  /**
   * Base URL the packs are served under. The index lives at
   * `<baseUrl>/packs/plateau/index.json`.
   */
  readonly baseUrl: string;
}

/** Optional knobs for {@link fetchPlateauIndex}. */
export interface FetchPlateauIndexOptions {
  readonly signal?: AbortSignal;
}

/**
 * Fetch + parse the PLATEAU mesh index (`<baseUrl>/packs/plateau/index.json`)
 * into a typed {@link PlateauMeshIndex}.
 *
 * Validates the minimum shape this client relies on (a `meshes` array of
 * entries with a `mesh` code and a `pack` path) since the index is untrusted
 * retrieved data.
 *
 * @throws if the fetch fails or the payload is not a well-formed index.
 */
export async function fetchPlateauIndex(
  deps: FetchPlateauIndexDeps,
  options: FetchPlateauIndexOptions = {},
): Promise<PlateauMeshIndex> {
  const base = stripTrailingSlash(deps.baseUrl);
  const url = `${base}/packs/plateau/index.json`;

  const res = await deps.fetch(url, { signal: options.signal });
  if (!res.ok) {
    throw new Error(
      `geo-client: plateau index fetch failed (${res.status}) for ${url}`,
    );
  }

  const raw = (await res.json()) as unknown;
  return assertPlateauIndex(raw, url);
}

/**
 * Resolve a per-mesh pack URL from a mesh entry's `pack` path (which is relative
 * to `packs/`) joined to a base URL: `<baseUrl>/packs/<entry.pack>`.
 *
 * @example
 * resolvePlateauPackUrl("https://cdn/geo", {
 *   pack: "plateau/53393596/building/flat.abc.topo.json.br", …
 * }); // "https://cdn/geo/packs/plateau/53393596/building/flat.abc.topo.json.br"
 */
export const resolvePlateauPackUrl = (
  baseUrl: string,
  entry: Pick<PlateauMeshEntry, "pack">,
): string => `${stripTrailingSlash(baseUrl)}/packs/${entry.pack}`;

/** Injected dependencies for {@link decodePlateauMesh}. */
export interface DecodePlateauMeshDeps {
  /**
   * Loads the decoded TopoJSON topology + manifest for a mesh ref. In
   * production this is `makeBrowserLoader(...)` (which already injects
   * `brotliDecode` + handles the `.br` artifact); tests inject a fixture
   * loader. Reusing this seam is what keeps the brotli dependency injected.
   */
  readonly loadTopology: LoadTopology;
  /**
   * `topojson-client` `feature()`. Optional — defaults to the bundled one
   * (kept injectable for tests / alternate decoders, mirroring `decodePack`).
   */
  readonly topoFeature?: typeof topojsonFeature;
}

/** Optional knobs for {@link decodePlateauMesh}. */
export interface DecodePlateauMeshOptions {
  readonly signal?: AbortSignal;
}

/**
 * Decode one PLATEAU mesh into building footprint Features carrying `height` +
 * `source` + the manifest attribution.
 *
 * `target` may be a mesh code, a {@link PlateauMeshRef}, or a
 * {@link PlateauMeshEntry} (from the index). The per-mesh pack is loaded through
 * the injected {@link LoadTopology} (manifest-driven), expanded with
 * `topojson-client`, and every feature is asserted to be `source: "plateau"`
 * (source separation, ADR-013).
 *
 * @throws if the topology has no objects, or any feature is not pure PLATEAU.
 */
export async function decodePlateauMesh(
  deps: DecodePlateauMeshDeps,
  target: string | PlateauMeshRef | PlateauMeshEntry,
  options: DecodePlateauMeshOptions = {},
): Promise<DecodedPlateauMesh> {
  const topoFeature = deps.topoFeature ?? topojsonFeature;
  const mesh =
    typeof target === "string"
      ? target
      : "mesh" in target
        ? target.mesh
        : target.ward.slice("plateau/".length);
  const ref = plateauMeshRef(mesh);

  const { topology, manifest } = await deps.loadTopology(ref, {
    signal: options.signal,
  });

  const objectName = Object.keys(topology.objects)[0];
  if (objectName === undefined) {
    throw new Error(
      `geo-client: plateau mesh ${mesh} topology has no objects`,
    );
  }
  const object = topology.objects[objectName] as GeometryObject;

  const collection = topoFeature(topology, object);
  // A baked mesh pack is always a GeometryCollection → a FeatureCollection.
  const features = (
    "features" in collection ? collection.features : [collection]
  ) as Feature[];

  const buildings: PlateauBuildingFeature[] = features.map((f, i) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    // Source separation is BINDING: PLATEAU packs are pure PLATEAU. Reject any
    // feature that is not `source: "plateau"` rather than silently passing it
    // through (it would mean a mis-tagged / co-mingled pack).
    if (props.source !== "plateau") {
      throw new Error(
        `geo-client: plateau mesh ${mesh} feature ${i} has source=${String(
          props.source,
        )} (expected "plateau")`,
      );
    }
    const height =
      typeof props.height === "number" ? props.height : null;
    return {
      type: "Feature",
      geometry: f.geometry as Polygon | MultiPolygon,
      properties: { height, source: "plateau", id: String(props.id ?? "") },
    };
  });

  return {
    mesh,
    objectName,
    features: buildings,
    featureCount: buildings.length,
    attribution: manifest.attribution_lines,
  };
}

/** Validate the minimum {@link PlateauMeshIndex} shape from untrusted JSON. */
function assertPlateauIndex(raw: unknown, url: string): PlateauMeshIndex {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`geo-client: plateau index at ${url} is not an object`);
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.meshes)) {
    throw new Error(`geo-client: plateau index at ${url} has no meshes[]`);
  }
  for (const [i, m] of obj.meshes.entries()) {
    const entry = m as Record<string, unknown>;
    if (typeof entry.mesh !== "string" || typeof entry.pack !== "string") {
      throw new Error(
        `geo-client: plateau index at ${url} meshes[${i}] missing mesh/pack`,
      );
    }
  }
  return raw as PlateauMeshIndex;
}

export { meshObjectName as plateauMeshObjectName };
