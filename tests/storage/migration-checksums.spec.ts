import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIGRATION_CHECKSUMS, SCHEMA_VERSION } from "@ztask/server";

const manifestPath = fileURLToPath(new URL("../fixtures/migrations/checksums.json", import.meta.url));

interface ChecksumManifest {
  schemaVersion: number;
  migrations: Record<string, string>;
}

describe("migration checksum gate", () => {
  it("keeps released migration checksums frozen and version monotonic", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ChecksumManifest;

    expect(manifest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(manifest.migrations).toEqual(MIGRATION_CHECKSUMS);
    expect(Object.keys(MIGRATION_CHECKSUMS)).toHaveLength(SCHEMA_VERSION);
  });
});
