/**
 * `decodePack` — the fetch→decode→GeoJSON contract `geo-canvas` consumes
 * (ADR-012). Given a way to load a pack's {@link Topology} + manifest, expand
 * the single named TopoJSON object into a GeoJSON FeatureCollection and surface
 * the source attribution.
 *
 * DI convention: `(deps, target, options?)`.
 *   deps   — injected I/O + codecs (`loadTopology`, the topojson `feature()`).
 *   target — the {@link PackRef} to decode.
 *   options — optional knobs (an `AbortSignal`).
 *
 * `topojson-client` is a small runtime dependency, so `topoFeature` defaults to
 * its `feature()` when omitted — but it stays an injectable seam (tests pass it
 * explicitly; an alternate decoder can be substituted).
 */
import { feature as topojsonFeature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryObject } from "topojson-specification";
import type { LoadTopology, PackRef, DecodedPack } from "./types.js";

/** Injected dependencies for {@link decodePack}. */
export interface DecodePackDeps {
  /** Loads the decoded topology + manifest for a ref (network/codec seam). */
  loadTopology: LoadTopology;
  /**
   * The `topojson-client` `feature()` function that expands a TopoJSON object
   * into GeoJSON. Optional — defaults to the bundled `topojson-client`.
   */
  topoFeature?: typeof topojsonFeature;
}

/** Optional knobs for {@link decodePack}. */
export interface DecodePackOptions {
  signal?: AbortSignal;
}

/**
 * Decode a single pack ref into a GeoJSON FeatureCollection + attribution.
 *
 * Picks the *single* object key in the topology (baked packs carry exactly one
 * — `<ward>-<layer>`), expands it via `topoFeature`, and returns the collection
 * with its attribution, the expanded object name, and the feature count.
 *
 * @throws if the loaded topology has no objects.
 */
export async function decodePack(
  deps: DecodePackDeps,
  target: PackRef,
  options: DecodePackOptions = {},
): Promise<DecodedPack> {
  const topoFeature = deps.topoFeature ?? topojsonFeature;

  const { topology, manifest } = await deps.loadTopology(target, {
    signal: options.signal,
  });

  const objectName = Object.keys(topology.objects)[0];
  if (objectName === undefined) {
    throw new Error(
      `geo-client: topology for ${target.ward}/${target.layer}/${target.detail} has no objects`,
    );
  }
  const object = topology.objects[objectName] as GeometryObject;

  // topojson-client's `feature()` returns a Feature for a single geometry and a
  // FeatureCollection for a GeometryCollection; baked packs are always the
  // latter (a `GeometryCollection` object), so the result is a FeatureCollection.
  const collection = topoFeature(topology, object) as FeatureCollection<
    Geometry,
    Record<string, unknown>
  >;

  return {
    ref: target,
    collection,
    attribution: manifest.source.attribution,
    objectName,
    featureCount: collection.features.length,
  };
}
