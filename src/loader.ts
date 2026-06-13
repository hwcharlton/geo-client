/**
 * `makeBrowserLoader` — the production `loadTopology`. Browser-facing: the only
 * I/O is `fetch` and a brotli decode, both injected so the module imports no
 * Node built-ins and Node tests can supply `node:zlib` brotli.
 *
 * Per ADR-016 the public tier serves a content-hashed `.br` (the manifest's
 * `artifact.file`) *and* a raw `.topo.json` alias (`artifact.file_raw`). This
 * loader handles both: it fetches `artifact.file` by default and only
 * brotli-decodes when the resolved filename actually ends in `.br`, so pointing
 * `preferRaw` (or a manifest whose `file` is already raw) at the uncompressed
 * alias just parses the bytes directly.
 */
import type { Topology } from "topojson-specification";
import type { LoadTopology, PackManifest, PackRef } from "./types.js";

/** Injected dependencies for {@link makeBrowserLoader}. */
export interface BrowserLoaderDeps {
  /** The platform `fetch` (browser global, or a Node/undici fetch in tests). */
  fetch: typeof fetch;
  /**
   * Brotli decode: compressed bytes → the UTF-8 JSON string. In the browser,
   * wrap `DecompressionStream("br")`; in Node, wrap `zlib.brotliDecompress`.
   * Only invoked for `.br` artifacts.
   */
  brotliDecode: (bytes: Uint8Array) => Promise<string> | string;
  /**
   * Base URL the packs are served under. The manifest lives at
   * `<baseUrl>/packs/<ward>/<layer>/<detail>.manifest.json`.
   */
  baseUrl: string;
}

/** Options for the loader factory. */
export interface BrowserLoaderOptions {
  /**
   * Prefer the raw uncompressed `.topo.json` alias (`artifact.file_raw`) over
   * the `.br` when the manifest offers it. Default `false` (fetch the `.br`).
   */
  preferRaw?: boolean;
}

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");

/**
 * Build a `loadTopology` that fetches the manifest + artifact for a pack ref
 * and returns the decoded {@link Topology} alongside its {@link PackManifest}.
 *
 * URL shape (ADR-016 / phase 08):
 *   manifest → `<baseUrl>/packs/<ward>/<layer>/<detail>.manifest.json`
 *   artifact → `<dir>/<artifact.file>` (or `<artifact.file_raw>` when raw)
 */
export function makeBrowserLoader(
  deps: BrowserLoaderDeps,
  options: BrowserLoaderOptions = {},
): LoadTopology {
  const base = stripTrailingSlash(deps.baseUrl);

  return async (packRef: PackRef, loadOptions = {}) => {
    const { signal } = loadOptions;
    const dir = `${base}/packs/${packRef.ward}/${packRef.layer}`;

    const manifestRes = await deps.fetch(
      `${dir}/${packRef.detail}.manifest.json`,
      {
        signal,
      },
    );
    if (!manifestRes.ok) {
      throw new Error(
        `geo-client: manifest fetch failed (${manifestRes.status}) for ${packRef.ward}/${packRef.layer}/${packRef.detail}`,
      );
    }
    const manifest = (await manifestRes.json()) as PackManifest;

    const rawFile = manifest.artifact.file_raw;
    const file =
      options.preferRaw && rawFile !== undefined
        ? rawFile
        : manifest.artifact.file;

    const artifactRes = await deps.fetch(`${dir}/${file}`, { signal });
    if (!artifactRes.ok) {
      throw new Error(
        `geo-client: artifact fetch failed (${artifactRes.status}) for ${dir}/${file}`,
      );
    }

    let json: string;
    if (file.endsWith(".br")) {
      const bytes = new Uint8Array(await artifactRes.arrayBuffer());
      json = await deps.brotliDecode(bytes);
    } else {
      // Raw `.topo.json` alias — no decompression needed.
      json = await artifactRes.text();
    }

    return { topology: JSON.parse(json) as Topology, manifest };
  };
}
