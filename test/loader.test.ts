/**
 * `makeBrowserLoader` against a REAL baked Shibuya admin pack, exercised
 * end-to-end without a network or a browser:
 *
 *   - a FAKE `fetch` serves the local `high.manifest.json` (as JSON) and the
 *     content-hashed `.br` artifact (as bytes), keyed by URL path;
 *   - a Node `brotliDecode` (node:zlib) stands in for the browser's
 *     `DecompressionStream("br")`.
 *
 * Asserts the loader resolves `artifact.file` from the manifest, fetches +
 * brotli-decodes it, and returns the same Topology as the raw `.topo.json` —
 * then that `decodePack` on that loader yields the 渋谷区 FeatureCollection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { brotliDecompress } from "node:zlib";
import { promisify } from "node:util";
import { feature as topoFeature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { decodePack, makeBrowserLoader } from "../src/index.js";
import type { PackManifest, PackRef } from "../src/index.js";

const STAGING_ROOT = "/home/ubuntu/dev/personal/geo-data-staging";
const FIXTURE_DIR = `${STAGING_ROOT}/packs/shibuya/admin`;
const BASE_URL = "https://cdn.example.test/geo";

const SHIBUYA_HIGH: PackRef = {
  ward: "shibuya",
  layer: "admin",
  detail: "high",
};

const brotliInflate = promisify(brotliDecompress);
/** Node stand-in for the browser `DecompressionStream("br")`. */
const brotliDecode = async (bytes: Uint8Array): Promise<string> => {
  const out = await brotliInflate(Buffer.from(bytes));
  return out.toString("utf8");
};

/**
 * A fake `fetch` that serves files from the real fixture dir. It maps any URL
 * ending in `/packs/shibuya/admin/<file>` to `<FIXTURE_DIR>/<file>`, returning
 * JSON for `.json` and an ArrayBuffer for everything else.
 */
const makeFakeFetch = (): { fetch: typeof fetch; calls: string[] } => {
  const calls: string[] = [];
  const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const file = url.slice(
      url.indexOf("/packs/shibuya/admin/") + "/packs/shibuya/admin/".length,
    );
    const path = `${FIXTURE_DIR}/${file}`;
    try {
      if (file.endsWith(".json")) {
        const text = await readFile(path, "utf8");
        return new Response(text, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const buf = await readFile(path);
      // Copy into a fresh ArrayBuffer so `.arrayBuffer()` returns exact bytes.
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      );
      return new Response(ab, { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
  return { fetch: fakeFetch as unknown as typeof fetch, calls };
};

async function readRawTopology(): Promise<Topology> {
  return JSON.parse(
    await readFile(`${FIXTURE_DIR}/high.topo.json`, "utf8"),
  ) as Topology;
}

test("makeBrowserLoader fetches the manifest + .br and decodes to the raw topology", async () => {
  const { fetch, calls } = makeFakeFetch();
  const manifest = JSON.parse(
    await readFile(`${FIXTURE_DIR}/high.manifest.json`, "utf8"),
  ) as PackManifest;

  const loadTopology = makeBrowserLoader({
    fetch,
    brotliDecode,
    baseUrl: BASE_URL,
  });
  const { topology, manifest: loadedManifest } =
    await loadTopology(SHIBUYA_HIGH);

  // It hit the manifest first, then the .br artifact named in the manifest.
  assert.equal(calls[0], `${BASE_URL}/packs/shibuya/admin/high.manifest.json`);
  assert.ok(
    calls.some((u) => u.endsWith(`/${manifest.artifact.file}`)),
    `expected a fetch for ${manifest.artifact.file}, got ${calls.join(", ")}`,
  );
  assert.ok(manifest.artifact.file.endsWith(".br"));

  // The brotli-decoded topology equals the raw `.topo.json`.
  const raw = await readRawTopology();
  assert.deepEqual(topology, raw);
  assert.equal(Object.keys(topology.objects)[0], "shibuya-admin");
  assert.equal(
    loadedManifest.source.attribution,
    "© OpenStreetMap contributors",
  );
});

test("makeBrowserLoader feeds decodePack a real FeatureCollection", async () => {
  const { fetch } = makeFakeFetch();
  const loadTopology = makeBrowserLoader({
    fetch,
    brotliDecode,
    baseUrl: BASE_URL,
  });

  const decoded = await decodePack({ loadTopology, topoFeature }, SHIBUYA_HIGH);

  assert.equal(decoded.collection.type, "FeatureCollection");
  assert.equal(decoded.objectName, "shibuya-admin");
  assert.equal(decoded.featureCount, 1);
  const [ward] = decoded.collection.features;
  assert.ok(ward);
  assert.equal((ward.properties as Record<string, unknown>).name, "渋谷区");
  assert.equal(decoded.attribution, "© OpenStreetMap contributors");
});

test("makeBrowserLoader trims a trailing slash on baseUrl", async () => {
  const { fetch, calls } = makeFakeFetch();
  const loadTopology = makeBrowserLoader({
    fetch,
    brotliDecode,
    baseUrl: `${BASE_URL}/`,
  });
  await loadTopology(SHIBUYA_HIGH);
  assert.equal(calls[0], `${BASE_URL}/packs/shibuya/admin/high.manifest.json`);
});

test("makeBrowserLoader can load the raw .topo.json alias when preferRaw", async () => {
  const { fetch, calls } = makeFakeFetch();
  const loadTopology = makeBrowserLoader(
    { fetch, brotliDecode, baseUrl: BASE_URL },
    { preferRaw: true },
  );
  const { topology } = await loadTopology(SHIBUYA_HIGH);

  // It fetched the raw alias, not the .br.
  assert.ok(calls.some((u) => u.endsWith("/high.topo.json")));
  assert.ok(!calls.some((u) => u.endsWith(".br")));
  assert.deepEqual(topology, await readRawTopology());
});
