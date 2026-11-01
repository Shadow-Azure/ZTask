// 门禁自测试：只覆盖移植进 ZTask 的门禁。全部用可离线合成的夹具，不读仓库
// 真实文档（真实文档由各门禁在全库模式下管辖）。运行：node --test scripts/gates.spec.mjs。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "@redocly/ajv/dist/2020.js";
import {
  blobHash,
  documentAnchors,
  generatedRegionsEqual,
  githubSlug,
  isManifestExcluded,
  pairAnchorOfArgument,
  pairPaths,
  parseLinkTarget,
  parsePairingCliArgs,
  parsePairingManifest,
  parsePairRecord,
  parseSignature,
  partitionGeneratedRegions,
  renderPairRecord,
  structureDiff,
} from "./translation-pairing-lib.mjs";
import { skeletonErrors } from "./verify-agent-notes.mjs";
import { groupTriplets, parseArchivedManifest } from "./verify-archived-agent-notes.mjs";
import { countWords } from "./verify-doc-budgets.mjs";

// ── manifest 形状（@redocly/ajv）─────────────────────────────────────────────

test("manifests keep their pinned shapes", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const budgets = ajv.compile({
    type: "object",
    required: ["//"],
    properties: { "//": { type: "string" } },
    propertyNames: { type: "string" },
    additionalProperties: { type: "integer", minimum: 1 },
  });
  const budgetManifest = JSON.parse(readFileSync("scripts/doc-budgets.manifest.json", "utf8"));
  assert.equal(budgets(budgetManifest), true, JSON.stringify(budgets.errors));
  assert.ok(budgetManifest["docs/charter.md"] > 0);

  const pairing = parsePairingManifest(readFileSync("scripts/translation-pairing.manifest.json", "utf8"));
  assert.ok(pairing.excluded.includes("docs/AGENTS.md"));
  assert.equal(isManifestExcluded("docs/AGENTS.md", pairing), true);
  assert.equal(isManifestExcluded("docs/charter.md", pairing), false);

  const typeEquiv = ajv.compile({
    type: "object",
    required: ["entries"],
    properties: { "//": { type: "string" }, entries: { type: "array" } },
    additionalProperties: false,
  });
  assert.equal(
    typeEquiv(JSON.parse(readFileSync("scripts/type-equiv.manifest.json", "utf8"))),
    true,
  );
});

// ── translation-pairing-lib ──────────────────────────────────────────────────

test("triplet paths derive from the base side only", () => {
  assert.deepEqual(pairPaths("docs/charter.md"), {
    base: "docs/charter.md",
    en: "docs/charter.en.md",
    meta: "docs/charter.i18n.yaml",
  });
  assert.throws(() => pairPaths("docs/charter.en.md"), /中文 base/);
  assert.equal(pairAnchorOfArgument("docs/charter.i18n.yaml"), "docs/charter.md");
});

test("blob hash matches git hash-object", () => {
  const out = execFileSync("git", ["hash-object", "--stdin"], {
    input: "ztask\n",
    encoding: "utf8",
  }).trim();
  assert.equal(blobHash("ztask\n"), out);
});

test("pairing records round-trip and reject malformed content", () => {
  const paths = pairPaths("docs/charter.md");
  const record = renderPairRecord(paths, { baseHash: "a".repeat(40), enHash: "b".repeat(40) });
  assert.deepEqual(parsePairRecord(record, paths), { baseHash: "a".repeat(40), enHash: "b".repeat(40) });
  assert.equal(parsePairRecord("charter.md: nothex\n", paths), undefined);
  assert.equal(parsePairRecord(`${record}extra.md: ${"c".repeat(40)}\n`, paths), undefined);
});

test("cli args keep --write scoped", () => {
  assert.equal(parsePairingCliArgs(["docs/charter.md"]).mode, "check");
  assert.deepEqual(parsePairingCliArgs(["--write", "--all"]), { mode: "write", scope: "corpus", anchors: [] });
  assert.throws(() => parsePairingCliArgs(["--write"]), /--all/);
  assert.throws(() => parsePairingCliArgs(["--write", "--all", "docs/charter.md"]), /不能同用/);
});

test("generated regions are stripped and compared modulo locale paths", () => {
  const region = "<!-- BEGIN GENERATED commands -->\nsee docs/a.md\n<!-- END GENERATED commands -->";
  const base = `前文\n${region}\n`;
  const en = `Front\n${region.replace("docs/a.md", "docs/a.en.md")}\n`;
  assert.equal(partitionGeneratedRegions(base).stripped, "前文\n");
  assert.equal(generatedRegionsEqual(
    partitionGeneratedRegions(base).regions,
    partitionGeneratedRegions(en).regions,
  ), true);
  assert.throws(() => partitionGeneratedRegions("<!-- END GENERATED x -->"), /BEGIN/);
});

test("structure signature mirrors headings, fences and links", () => {
  const zh = "# 标题\n\n[English](x.en.md) | 中文\n\n## 节\n\n- a\n- b\n\n```text\nsame\n```\n";
  const en = "# Title\n\nEnglish | [中文](x.md)\n\n## Section\n\n- a\n- b\n\n```text\nsame\n```\n";
  assert.deepEqual(structureDiff(parseSignature(zh), parseSignature(en)), []);
  assert.notDeepEqual(parseSignature(zh), parseSignature(en.replace("- b", "- b\n- c")));
});

test("link targets normalize locale suffixes and fragments", () => {
  assert.equal(parseLinkTarget("../x.en.md#a-b").path, "../x.en.md");
  assert.equal(documentAnchors("## A 标题!\n").has(githubSlug("A 标题!")), true);
});

// ── agent notes 门禁 ─────────────────────────────────────────────────────────

test("note skeleton accepts free sections only between skeleton sections", () => {
  const ok = "# Agent Note: t\n\nstatus\n\nStatus: implemented\n\n## Problem\n\np\n\n## Note\n\nfree\n\n## Decision\n\nd\n\n## Alternatives considered\n\na\n\n## Consequences\n\nc\n";
  assert.deepEqual(skeletonErrors("x.md", ok), []);
  assert.match(skeletonErrors("x.md", "## Decision\n\n## Problem\n\n## Alternatives considered\n\n## Consequences\n").join("\n"), /Problem/);
  assert.match(
    skeletonErrors("x.md", "## Problem\n\n## Decision\n\n## Alternatives considered\n\n## Consequences\n\n## Extra\n").join("\n"),
    /Consequences" 之后/,
  );
});

test("archived manifest parsing and triplet grouping are strict", () => {
  const manifest = JSON.stringify({ entries: { "process/2026-01-01-t.md": "a".repeat(64) } });
  assert.deepEqual(parseArchivedManifest(manifest).entries, { "process/2026-01-01-t.md": "a".repeat(64) });
  assert.throws(() => parseArchivedManifest(JSON.stringify({ entries: { x: "nothex" } })), /64 位/);
  assert.throws(() => parseArchivedManifest(JSON.stringify({ entries: {}, extra: 1 })), /不支持的字段/);

  const group = groupTriplets([
    "feature/2026-01-01-t.md",
    "feature/2026-01-01-t.en.md",
    "feature/2026-01-01-t.i18n.yaml",
  ]);
  assert.equal(group.errors.length, 0);
  assert.equal(group.triplets.length, 1);
  const broken = groupTriplets(["feature/2026-01-01-t.md", "testing/2026-01-02-u.md"]);
  assert.match(broken.errors.join("\n"), /三件套不齐|非法 class/);
});

// ── 文档预算计数 ─────────────────────────────────────────────────────────────

test("word counting weights CJK per character and the rest per token", () => {
  assert.equal(countWords("进度管理 progress management"), 6);
  assert.equal(countWords("one two\tthree"), 3);
  assert.equal(countWords(""), 0);
});
