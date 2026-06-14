/**
 * Shared types for `@hwcharlton/geo-client`.
 *
 * Domain types (the layer taxonomy, attribution constant) are imported from
 * `@hwcharlton/geo-model` rather than redefined — geo-model is the single
 * source of truth for the ecosystem's vocabulary (ADR-013). This module only
 * adds the *client-facing* shapes: what to load (a pack ref), the on-disk baked
 * manifest the loader reads, and what `decodePack` hands back.
 */
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import type {
  AreaPackManifest,
  DetailTier,
  LayerKind,
} from "@hwcharlton/geo-model";

/**
 * A reference to a single baked area pack: a ward, one render/data layer
 * (reusing geo-model's {@link LayerKind} taxonomy), and a detail tier.
 *
 * `layer` is widened to `LayerKind | (string & {})` so callers may pass the
 * canonical layer kinds with autocomplete while still tolerating any baked
 * directory name without a cast.
 */
export interface PackRef {
  /** Ward slug, e.g. `"shibuya"`. */
  ward: string;
  /** Layer name — one of geo-model's {@link LayerKind}s (e.g. `"admin"`). */
  layer: LayerKind | (string & {});
  /**
   * Detail tier — geo-model's {@link DetailTier} (`"high" | "med" | "low"` for
   * area packs; `"flat"` for the single un-tiered building layer).
   */
  detail: DetailTier;
}

/**
 * The baked per-artifact manifest written next to each pack: the
 * `geo-area-pack/1` on-disk WIRE shape, owned by `@hwcharlton/geo-model` as the
 * single source of truth shared between the `geo-build` producer and this
 * consumer (ADR-013 / ADR-016).
 *
 * Re-exported here under the historical `PackManifest` name so this package's
 * public API stays stable; it is now exactly geo-model's
 * {@link AreaPackManifest}. The client reads `source.attribution`,
 * `artifact.file`, and `artifact.file_raw` — all required on that type.
 */
export type PackManifest = AreaPackManifest;

/** What {@link decodePack} hands back to a consumer (e.g. `geo-canvas`). */
export interface DecodedPack {
  /** The pack ref that was decoded (provenance pass-through / cache key). */
  readonly ref: PackRef;
  /** The named TopoJSON object expanded into a GeoJSON FeatureCollection. */
  readonly collection: FeatureCollection<Geometry, Record<string, unknown>>;
  /** Source attribution line, surfaced from the manifest. */
  readonly attribution: string;
  /** The TopoJSON object key that was expanded (e.g. `"shibuya-admin"`). */
  readonly objectName: string;
  /** Number of features in {@link collection}. */
  readonly featureCount: number;
}

/**
 * Loads the decoded {@link Topology} + its baked {@link PackManifest} for a
 * pack ref. The browser implementation ({@link makeBrowserLoader}) fetches +
 * brotli-decodes; tests inject a fake that reads local fixtures.
 */
export type LoadTopology = (
  packRef: PackRef,
  options?: { signal?: AbortSignal },
) => Promise<{ topology: Topology; manifest: PackManifest }>;

/** Re-export the TopoJSON spec types the public API surfaces. */
export type { Topology, GeometryCollection };
