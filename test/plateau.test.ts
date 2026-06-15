/**
 * PLATEAU authoritative building tier (Phase-09 Stage 2), exercised hermetically
 * — NO network, NO browser.
 *
 *   - `fetchPlateauIndex` is driven by a FAKE `fetch` serving a tiny in-memory
 *     `plateau/index.json`, and we assert it parses to a typed index.
 *   - `resolvePlateauPackUrl` is asserted against an index entry's `pack` path.
 *   - `decodePlateauMesh` is fed a REAL tiny TopoJSON building pack built from
 *     actual sample buildings (read off `geo-spikes/plateau-stage2/sample/`) via
 *     a fixture `loadTopology`, and we assert it decodes to GeoJSON building
 *     Features carrying `height`, `source:"plateau"`, and the manifest
 *     attribution — and that source separation rejects a non-plateau feature.
 *
 * The TopoJSON is hand-built (no `transform`; arcs hold absolute lon/lat coords)
 * because only `topojson-client` (the decode side) is a dependency here; it
 * round-trips through the real `topojson-client` `feature()` exactly like a
 * baked pack would.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feature as topoFeature } from "topojson-client";
import type { Feature, Polygon } from "geojson";
import type { Topology } from "topojson-specification";
import {
  fetchPlateauIndex,
  decodePlateauMesh,
  plateauMeshRef,
  resolvePlateauPackUrl,
} from "../src/index.js";
import type {
  PlateauMeshIndex,
  PackManifest,
} from "../src/index.js";

const SAMPLE_DIR =
  "/home/ubuntu/dev/personal/geo-spikes/plateau-stage2/sample";
const MESH = "53392547";
const BASE_URL = "https://cdn.example.test/geo";

/** Read the first `n` real building features from a sample `.geojsonl`. */
function readSampleFeatures(
  mesh: string,
  n: number,
): Feature<Polygon, { height: number | null; source: string; id: string }>[] {
  const text = readFileSync(`${SAMPLE_DIR}/${mesh}.geojsonl`, "utf8");
  return text
    .trim()
    .split("\n")
    .slice(0, n)
    .map((line) => JSON.parse(line));
}

/**
 * Build a tiny but VALID TopoJSON building pack from GeoJSON polygon features,
 * matching the bake's `<mesh>-building` object naming. No `transform` → arcs
 * hold absolute lon/lat coordinates (delta-decoding is the identity), so
 * `topojson-client` reconstructs the exact rings.
 */
function buildMeshTopology(
  mesh: string,
  features: Feature<Polygon, Record<string, unknown>>[],
): Topology {
  const arcs: number[][][] = [];
  const geometries = features.map((f) => {
    const ring = f.geometry.coordinates[0];
    const arcIndex = arcs.length;
    arcs.push(ring.map(([x, y]) => [x, y]));
    return {
      type: "Polygon" as const,
      arcs: [[arcIndex]],
      properties: f.properties,
    };
  });
  return {
    type: "Topology",
    objects: {
      [`${mesh}-building`]: { type: "GeometryCollection", geometries },
    },
    arcs,
  } as unknown as Topology;
}

const ATTRIBUTION = ["出典：国土交通省 PLATEAU（加工して作成）"];

/** A minimal `geo-area-pack/1` manifest for a PLATEAU mesh pack. */
function meshManifest(): PackManifest {
  return {
    schema: "geo-area-pack/1",
    ward: `plateau/${MESH}`,
    layer: "building",
    detail: "flat",
    source: {
      name: "MLIT Project PLATEAU",
      license: "ODbL-1.0",
      attribution: ATTRIBUTION[0],
      input_file: `${MESH}_2 CityGML (EPSG:6697)`,
      input_provider: "MLIT Project PLATEAU — 2020 tokyo23ku CityGML",
      input_date: "2026-06-14",
    },
    pipeline: {
      simplify: { method: "keep-shapes", percentage: "100%" },
      quantization: 100000,
      format: "topojson",
      compression: { codec: "brotli", quality: 11 },
    },
    tools: {},
    artifact: {
      file: `flat.deadbeef0000.topo.json.br`,
      file_raw: "flat.topo.json",
      bytes_topojson: 0,
      bytes_brotli: 0,
      hash_algo: "sha256:12",
      hash_topojson: "0".repeat(12),
      hash_brotli: "deadbeef0000",
    },
    attribution_lines: ATTRIBUTION,
    requires_share_alike: true,
    generated_at: "2026-06-15T00:00:00.000Z",
  };
}

// ── fetchPlateauIndex ──────────────────────────────────────────────────────

test("fetchPlateauIndex fetches + parses the mesh index", async () => {
  const index: PlateauMeshIndex = {
    tier: "plateau-building",
    crs: "urn:ogc:def:crs:EPSG::4326",
    render_crs: "EPSG:6677",
    attribution: ATTRIBUTION,
    license: "ODbL-1.0",
    meshes: [
      {
        mesh: MESH,
        bbox: [139.71, 35.54, 139.72, 35.545],
        pack: `plateau/${MESH}/building/flat.deadbeef0000.topo.json.br`,
        count: 25,
        height_max: 31.4,
      },
    ],
  };

  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    return new Response(JSON.stringify(index), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const parsed = await fetchPlateauIndex({ fetch: fakeFetch, baseUrl: BASE_URL });

  assert.equal(calls[0], `${BASE_URL}/packs/plateau/index.json`);
  assert.equal(parsed.tier, "plateau-building");
  assert.equal(parsed.meshes.length, 1);
  const [entry] = parsed.meshes;
  assert.ok(entry);
  assert.equal(entry.mesh, MESH);
  assert.equal(entry.count, 25);
  assert.equal(entry.height_max, 31.4);
  assert.deepEqual(entry.bbox, [139.71, 35.54, 139.72, 35.545]);
  assert.deepEqual(parsed.attribution, ATTRIBUTION);
});

test("fetchPlateauIndex throws on a malformed index (no meshes[])", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ tier: "plateau-building" }), {
      status: 200,
    })) as unknown as typeof fetch;

  await assert.rejects(
    () => fetchPlateauIndex({ fetch: fakeFetch, baseUrl: BASE_URL }),
    /no meshes/,
  );
});

test("fetchPlateauIndex throws when the fetch fails", async () => {
  const fakeFetch = (async () =>
    new Response("nope", { status: 404 })) as unknown as typeof fetch;

  await assert.rejects(
    () => fetchPlateauIndex({ fetch: fakeFetch, baseUrl: BASE_URL }),
    /index fetch failed \(404\)/,
  );
});

// ── resolvePlateauPackUrl ──────────────────────────────────────────────────

test("resolvePlateauPackUrl joins the entry pack path under packs/", () => {
  const entry = {
    pack: `plateau/${MESH}/building/flat.deadbeef0000.topo.json.br`,
  };
  assert.equal(
    resolvePlateauPackUrl(BASE_URL, entry),
    `${BASE_URL}/packs/plateau/${MESH}/building/flat.deadbeef0000.topo.json.br`,
  );
  // Trailing slash on the base is trimmed.
  assert.equal(
    resolvePlateauPackUrl(`${BASE_URL}/`, entry),
    `${BASE_URL}/packs/plateau/${MESH}/building/flat.deadbeef0000.topo.json.br`,
  );
});

test("plateauMeshRef addresses the plateau tier", () => {
  assert.deepEqual(plateauMeshRef(MESH), {
    ward: `plateau/${MESH}`,
    layer: "building",
    detail: "flat",
  });
});

// ── decodePlateauMesh ──────────────────────────────────────────────────────

test("decodePlateauMesh decodes a real sample pack to building Features with height", async () => {
  const features = readSampleFeatures(MESH, 5);
  const topology = buildMeshTopology(MESH, features);
  const manifest = meshManifest();

  let seenRef: unknown;
  const decoded = await decodePlateauMesh(
    {
      loadTopology: async (ref) => {
        seenRef = ref;
        return { topology, manifest };
      },
      topoFeature,
    },
    MESH,
  );

  // It addressed the plateau tier for this mesh.
  assert.deepEqual(seenRef, plateauMeshRef(MESH));

  // It expanded the `<mesh>-building` object to the right feature count.
  assert.equal(decoded.mesh, MESH);
  assert.equal(decoded.objectName, `${MESH}-building`);
  assert.equal(decoded.featureCount, 5);
  assert.equal(decoded.features.length, 5);

  // Every feature is a pure-PLATEAU building footprint with a numeric height
  // matching the source sample, and real polygon geometry survived.
  decoded.features.forEach((f, i) => {
    assert.equal(f.type, "Feature");
    assert.equal(f.properties.source, "plateau");
    assert.equal(f.geometry.type, "Polygon");
    assert.ok((f.geometry as Polygon).coordinates[0].length > 0);
    assert.equal(f.properties.height, features[i]!.properties.height);
    assert.equal(f.properties.id, features[i]!.properties.id);
  });

  // First building height carried through exactly (11.5 m in the sample).
  assert.equal(decoded.features[0]!.properties.height, 11.5);

  // Attribution surfaced from the manifest.
  assert.deepEqual(decoded.attribution, ATTRIBUTION);
});

test("decodePlateauMesh accepts an index entry as the target", async () => {
  const features = readSampleFeatures(MESH, 3);
  const topology = buildMeshTopology(MESH, features);
  const manifest = meshManifest();

  const entry = {
    mesh: MESH,
    bbox: [139.71, 35.54, 139.72, 35.545] as [number, number, number, number],
    pack: `plateau/${MESH}/building/flat.deadbeef0000.topo.json.br`,
    count: 3,
    height_max: 11.5,
  };

  const decoded = await decodePlateauMesh(
    { loadTopology: async () => ({ topology, manifest }), topoFeature },
    entry,
  );
  assert.equal(decoded.mesh, MESH);
  assert.equal(decoded.featureCount, 3);
});

test("decodePlateauMesh enforces source separation (rejects non-plateau)", async () => {
  const features = readSampleFeatures(MESH, 2);
  // Poison one feature's source — simulates a co-mingled / mis-tagged pack.
  features[1]!.properties = { ...features[1]!.properties, source: "osm" };
  const topology = buildMeshTopology(
    MESH,
    features as Feature<Polygon, Record<string, unknown>>[],
  );
  const manifest = meshManifest();

  await assert.rejects(
    () =>
      decodePlateauMesh(
        { loadTopology: async () => ({ topology, manifest }), topoFeature },
        MESH,
      ),
    /source=osm \(expected "plateau"\)/,
  );
});

test("decodePlateauMesh forwards the AbortSignal to loadTopology", async () => {
  const features = readSampleFeatures(MESH, 1);
  const topology = buildMeshTopology(MESH, features);
  const manifest = meshManifest();
  const controller = new AbortController();
  let seen: AbortSignal | undefined;

  await decodePlateauMesh(
    {
      loadTopology: async (_ref, options) => {
        seen = options?.signal;
        return { topology, manifest };
      },
      topoFeature,
    },
    MESH,
    { signal: controller.signal },
  );

  assert.equal(seen, controller.signal);
});
