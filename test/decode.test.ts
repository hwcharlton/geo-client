/**
 * `decodePack` against a REAL baked Shibuya admin pack.
 *
 * Loads the raw `.topo.json` fixture from `geo-data-staging` and its sibling
 * manifest from disk, injects the real `topojson-client` `feature()`, and
 * asserts the decoded GeoJSON FeatureCollection carries the 渋谷区 feature with
 * its OSM properties, the right feature count, and the manifest attribution.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { feature as topoFeature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { decodePack } from "../src/index.js";
import type { PackManifest, PackRef } from "../src/index.js";

const FIXTURE_DIR =
  "/home/ubuntu/dev/personal/geo-data-staging/packs/shibuya/admin";

const SHIBUYA_HIGH: PackRef = {
  ward: "shibuya",
  layer: "admin",
  detail: "high",
};

async function loadFixture(): Promise<{
  topology: Topology;
  manifest: PackManifest;
}> {
  const [topoJson, manifestJson] = await Promise.all([
    readFile(`${FIXTURE_DIR}/high.topo.json`, "utf8"),
    readFile(`${FIXTURE_DIR}/high.manifest.json`, "utf8"),
  ]);
  return {
    topology: JSON.parse(topoJson) as Topology,
    manifest: JSON.parse(manifestJson) as PackManifest,
  };
}

test("decodePack expands the real Shibuya admin pack to a FeatureCollection", async () => {
  const fixture = await loadFixture();

  const decoded = await decodePack(
    {
      loadTopology: async () => fixture,
      topoFeature,
    },
    SHIBUYA_HIGH,
  );

  // It is a GeoJSON FeatureCollection.
  assert.equal(decoded.collection.type, "FeatureCollection");
  assert.ok(Array.isArray(decoded.collection.features));

  // The single baked object is `shibuya-admin` with exactly one feature.
  assert.equal(decoded.objectName, "shibuya-admin");
  assert.equal(decoded.featureCount, 1);
  assert.equal(decoded.collection.features.length, decoded.featureCount);

  // The feature is 渋谷区 with its OSM properties (name + admin_level).
  const [ward] = decoded.collection.features;
  assert.ok(ward, "expected one feature");
  const props = ward.properties as Record<string, unknown>;
  assert.equal(props.name, "渋谷区");
  assert.equal(props["name:en"], "Shibuya");
  assert.equal(props.admin_level, "7");

  // Real geometry came through (a polygon/multipolygon).
  assert.ok(ward.geometry);
  assert.ok(["Polygon", "MultiPolygon"].includes(ward.geometry.type));

  // Attribution surfaced from the manifest.
  assert.equal(decoded.attribution, "© OpenStreetMap contributors");

  // The ref is passed through unchanged.
  assert.deepEqual(decoded.ref, SHIBUYA_HIGH);
});

test("decodePack defaults topoFeature to the bundled topojson-client", async () => {
  const fixture = await loadFixture();

  // No `topoFeature` injected — exercises the default-decoder convenience.
  const decoded = await decodePack(
    { loadTopology: async () => fixture },
    SHIBUYA_HIGH,
  );

  assert.equal(decoded.collection.type, "FeatureCollection");
  assert.equal(decoded.featureCount, 1);
  assert.equal(decoded.attribution, "© OpenStreetMap contributors");
});

test("decodePack forwards the AbortSignal to loadTopology", async () => {
  const fixture = await loadFixture();
  const controller = new AbortController();
  let seen: AbortSignal | undefined;

  await decodePack(
    {
      loadTopology: async (_ref, options) => {
        seen = options?.signal;
        return fixture;
      },
      topoFeature,
    },
    SHIBUYA_HIGH,
    { signal: controller.signal },
  );

  assert.equal(seen, controller.signal);
});
