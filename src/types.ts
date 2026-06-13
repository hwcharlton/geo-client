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
import type { LayerKind } from "@hwcharlton/geo-model";

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
  /** Detail tier. */
  detail: "high" | "med" | "low";
}

/**
 * The baked per-artifact manifest written next to each pack (`geo-area-pack/1`
 * shape, ADR-016). Only the fields the client reads are typed here; the full
 * provenance manifest lives in `@hwcharlton/geo-model` (`ArtifactManifest`).
 */
export interface PackManifest {
  readonly schema?: string;
  /** Where the data came from; `attribution` is surfaced to end users. */
  readonly source: {
    readonly name: string;
    readonly license: string;
    /** e.g. `"© OpenStreetMap contributors"`. */
    readonly attribution: string;
    readonly input_file?: string;
    readonly input_provider?: string;
    readonly input_date?: string;
  };
  /**
   * The artifact bytes. `file` is the served (compressed) artifact — the
   * content-hashed `.br`; `file_raw` is the bare uncompressed `.topo.json`
   * alias (per ADR-016 the public tier serves both).
   */
  readonly artifact: {
    /** The primary (compressed) artifact filename, e.g. `high.<hash>.topo.json.br`. */
    readonly file: string;
    /** The raw uncompressed alias, e.g. `high.topo.json`. */
    readonly file_raw?: string;
    readonly bytes_topojson?: number;
    readonly bytes_brotli?: number;
    readonly hash_algo?: string;
    readonly hash_topojson?: string;
    readonly hash_brotli?: string;
  };
}

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
