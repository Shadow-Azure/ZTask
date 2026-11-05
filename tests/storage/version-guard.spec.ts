import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initStore,
  openDiagnosticDb,
  StorageCorruptionError,
  UnsupportedFormatError,
} from "@ztask/server";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "ztask-version-guard-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function createV1Store(): Promise<void> {
  const store = await initStore({ dataDir, applicationVersion: "0.1.0" });
  await store.close();
}

async function mutateDb(fn: (raw: ReturnType<typeof openDiagnosticDb>["raw"]) => void): Promise<void> {
  const { db, raw } = openDiagnosticDb(path.join(dataDir, "ztask.db"));
  try {
    fn(raw);
  } finally {
    await db.destroy().catch(() => undefined);
    try {
      raw.close();
    } catch {
      // db.destroy 可能已经关闭连接。
    }
  }
}

describe("schema version guard", () => {
  it("refuses a database whose user_version is newer than the app", async () => {
    await createV1Store();
    await mutateDb((raw) => raw.pragma("user_version = 2"));

    await expect(initStore({ dataDir, applicationVersion: "0.1.0" })).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });

  it("refuses a database with an unknown applied migration", async () => {
    await createV1Store();
    await mutateDb((raw) => {
      raw
        .prepare("INSERT INTO kysely_migration (name, timestamp) VALUES (?, ?)")
        .run("0002_future", new Date().toISOString());
    });

    await expect(initStore({ dataDir, applicationVersion: "0.1.0" })).rejects.toBeInstanceOf(
      StorageCorruptionError,
    );
  });

  it("refuses a changed checksum for an applied migration", async () => {
    await createV1Store();
    await mutateDb((raw) => {
      raw.prepare("UPDATE schema_migrations SET checksum = ? WHERE name = ?").run("bad", "0001_initial");
    });

    await expect(initStore({ dataDir, applicationVersion: "0.1.0" })).rejects.toBeInstanceOf(
      StorageCorruptionError,
    );
  });
});
