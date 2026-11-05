import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBackupService,
  initStore,
  openDiagnosticDb,
  readTaskAggregate,
  restoreFromBackup,
  SCHEMA_VERSION,
  type RevisionLine,
} from "@ztask/server";

const FIXTURE_DB = fileURLToPath(new URL("../fixtures/schema/v1/ztask.db", import.meta.url));
const TASK_ID = "27175541-1091-4e1e-89e3-832617a36e9e";
const APP_VERSION = "0.1.0";

let dataDir: string;
let restoreDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "ztask-upgrade-fixture-"));
  restoreDir = await mkdtemp(path.join(tmpdir(), "ztask-upgrade-restore-"));
  await cp(FIXTURE_DB, path.join(dataDir, "ztask.db"));
});

afterEach(async () => {
  await Promise.all([
    rm(dataDir, { recursive: true, force: true }),
    rm(restoreDir, { recursive: true, force: true }),
  ]);
});

describe("v1 fixture upgrade", () => {
  it("opens a real v1 database, keeps data and survives backup/restore", async () => {
    const store = await initStore({ dataDir, applicationVersion: APP_VERSION });
    expect(store.manifest.formatVersion).toBe(SCHEMA_VERSION);

    const taskIds = await store.tasks.listTaskIds();
    expect(taskIds).toHaveLength(3);

    const aggregate = await readTaskAggregate(dataDir, TASK_ID);
    expect(aggregate).not.toBeNull();
    expect(aggregate?.task.progress).toBe(70);
    expect(aggregate?.taskVersion).toBe(2);
    expect(aggregate?.revisionTip.checksum).toMatch(/^[a-f0-9]{64}$/);

    const revisions: RevisionLine[] = [];
    await store.tasks.readRevisions(TASK_ID, (line) => revisions.push(line));
    expect(revisions).toHaveLength(2);
    expect(revisions.at(-1)?.checksum).toBe(aggregate?.revisionTip.checksum);

    const backup = await createBackupService({
      dataDir,
      appVersion: APP_VERSION,
      timeZone: store.manifest.timeZone,
      pauseWrites: () => store.pauseWrites(),
    }).create();
    expect(backup.report.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.report.tables?.task_aggregates).toBe(3);
    await store.close();

    const diagnostic = openDiagnosticDb(path.join(dataDir, "ztask.db"));
    try {
      expect(diagnostic.raw.pragma("quick_check", { simple: true })).toBe("ok");
      expect(diagnostic.raw.pragma("foreign_key_check")).toEqual([]);
    } finally {
      await diagnostic.db.destroy().catch(() => undefined);
      try {
        diagnostic.raw.close();
      } catch {
        // db.destroy 可能已经关闭连接。
      }
    }

    const summary = await restoreFromBackup({
      backupDir: backup.backupDir,
      targetDir: restoreDir,
      applicationVersion: APP_VERSION,
    });
    expect(summary.tasks).toBe(3);
    expect(summary.folders).toBe(2);
    expect(summary.members).toBe(2);

    const restored = await initStore({ dataDir: restoreDir, applicationVersion: APP_VERSION });
    const restoredAggregate = await readTaskAggregate(restoreDir, TASK_ID);
    expect(restored.manifest.formatVersion).toBe(SCHEMA_VERSION);
    expect(restoredAggregate?.task.progress).toBe(70);
    expect(restoredAggregate?.taskVersion).toBe(2);
    await restored.close();
  });
});
