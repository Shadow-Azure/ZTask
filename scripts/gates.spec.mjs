// 门禁自测试：只覆盖移植进 ZTask 的门禁。全部用可离线合成的夹具，不读仓库
// 真实文档（真实文档由各门禁在全库模式下管辖）。运行：node --test scripts/gates.spec.mjs。

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "@redocly/ajv/dist/2020.js";
import {
  collectRefs,
  globToRegExp,
  parseFlowDocument,
  parseFlowYaml,
  uncoveredFiles,
  validateTree,
  validateIssueSections,
} from "./flow-lib.mjs";
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
import { applyGithubRef, planRetirements, renderIssueBody, runSync } from "./flow-sync.mjs";
import { verifyFlowDiff } from "./verify-flow.mjs";
import { skeletonErrors } from "./verify-agent-notes.mjs";
import { groupTriplets, parseArchivedManifest } from "./verify-archived-agent-notes.mjs";
import { countWords } from "./verify-doc-budgets.mjs";

// ── 夹具 ─────────────────────────────────────────────────────────────────────

const roadmap = `# Roadmap

\`\`\`yaml flow
kind: roadmap
milestones:
  - m0
\`\`\`
`;

const milestone = (id, status = "planned") => `# ${id}

\`\`\`yaml flow
kind: milestone
id: ${id}
title: ${id}
status: ${status}
github:
  number: null
  url: null
\`\`\`
`;

const issue = (milestoneId, status = "backlog", extra = "") => `# Issue

\`\`\`yaml flow
kind: issue
id: ${milestoneId}-01
milestone: ${milestoneId}
depends: []
priority: P0
status: ${status}
${extra}scope:
  - docs/**
adr: []
github:
  number: null
  url: null
\`\`\`
`;

const sections = ["背景", "目标", "设计依据", "实现内容", "实施步骤", "依赖与交付边界", "独立验证", "验收标准", "门禁与 CI", "非目标"]
  .map((heading) => `## ${heading}\n\n验收夹具内容。`)
  .join("\n\n");

function tree() {
  return {
    roadmap: { file: ".agents/flow/roadmap.md", data: parseFlowDocument(roadmap, "roadmap.md").data },
    milestones: [
      { file: ".agents/flow/milestones/m0-a.md", name: "m0-a", data: parseFlowDocument(milestone("m0", "done"), "m0-a.md").data },
    ],
    issues: [
      {
        file: ".agents/flow/issues/m0-01-a.md",
        name: "m0-01-a",
        data: parseFlowDocument(issue("m0", "done", "bootstrap: true\n"), "m0-01-a.md").data,
        content: sections,
      },
    ],
  };
}

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

// ── flow-lib ─────────────────────────────────────────────────────────────────

test("flow document requires exactly one yaml flow fence", () => {
  assert.throws(() => parseFlowDocument("# no fence\n", "x.md"), /恰好一个/);
  assert.equal(parseFlowDocument(roadmap, "roadmap.md").kind, "roadmap");
});

test("flow yaml rejects duplicate keys and parses inline lists", () => {
  assert.throws(() => parseFlowYaml(["kind: roadmap", "kind: milestone"], "x.md"), /重复 key/);
  assert.deepEqual(parseFlowYaml(["depends: [m0-01, m0-02]"], "x.md"), { depends: ["m0-01", "m0-02"] });
});

test("valid tree passes and milestone/issue status is cross-checked", () => {
  assert.deepEqual(validateTree(tree(), { exists: () => true }), []);
  const broken = tree();
  broken.milestones[0].data.status = "planned";
  assert.match(validateTree(broken, { exists: () => true }).join("\n"), /全部 issue 已 done/);
});

test("bootstrap is limited to the first milestone", () => {
  const extended = tree();
  extended.roadmap.data = parseFlowDocument(roadmap.replace("- m0", "- m0\n  - m1"), "roadmap.md").data;
  extended.milestones.push({
    file: ".agents/flow/milestones/m1-b.md",
    name: "m1-b",
    data: parseFlowDocument(milestone("m1"), "m1-b.md").data,
  });
  extended.issues.push({
    file: ".agents/flow/issues/m1-01-b.md",
    name: "m1-01-b",
    data: parseFlowDocument(issue("m1", "backlog", "bootstrap: true\n"), "m1-01-b.md").data,
    content: sections,
  });
  assert.match(validateTree(extended, { exists: () => true }).join("\n"), /bootstrap/);
});

test("scope globs cover intended files only", () => {
  assert.equal(globToRegExp("docs/**").test("docs/i18n/README.md"), true);
  assert.equal(globToRegExp("docs/**").test("scripts/flow-lib.mjs"), false);
  assert.deepEqual(uncoveredFiles(["docs/a.md", "scripts/b.mjs"], ["docs/**"]), ["scripts/b.mjs"]);
});

test("issue references accept (#N) and [#N]", () => {
  assert.deepEqual(collectRefs("feat: add ingest (#12)"), [12]);
  assert.deepEqual(collectRefs("fix: gate [#7]"), [7]);
  assert.deepEqual(collectRefs("docs: no ref"), []);
});

test("issue sections require an executable implementation and verification contract", () => {
  assert.deepEqual(validateIssueSections(sections), []);
  assert.match(validateIssueSections(sections.replace("## 独立验证", "## 验证")).join("\n"), /独立验证/);
});

// ── verify-flow --diff ───────────────────────────────────────────────────────

test("diff mode treats an issue created and completed in this PR as activated", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ztask-flow-diff-"));
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    mkdirSync(path.join(dir, ".agents/flow/milestones"), { recursive: true });
    mkdirSync(path.join(dir, ".agents/flow/issues"), { recursive: true });
    writeFileSync(path.join(dir, ".agents/flow/roadmap.md"), roadmap);
    writeFileSync(
      path.join(dir, ".agents/flow/milestones/m0-a.md"),
      milestone("m0", "done").replace("github:\n  number: null", "github:\n  number: 1"),
    );
    git(["init", "-q"]);
    git(["add", "."]);
    git(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "baseline"]);

    const issueText = issue("m0", "done")
      .replace("scope:\n  - docs/**", "scope:\n  - .agents/flow/**")
      .replace("number: null", "number: 7");
    writeFileSync(path.join(dir, ".agents/flow/issues/m0-01-done.md"), `${issueText}\n\n${sections}\n`);
    git(["add", "."]);
    git(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "complete bootstrap (#7)"]);

    const previousCwd = process.cwd();
    const previousTitle = process.env.PR_TITLE;
    process.chdir(dir);
    process.env.PR_TITLE = "bootstrap (#7)";
    try {
      const result = await verifyFlowDiff("HEAD~1");
      assert.deepEqual(result.errors, []);
      assert.equal(result.ok, true);
    } finally {
      process.chdir(previousCwd);
      if (previousTitle === undefined) delete process.env.PR_TITLE;
      else process.env.PR_TITLE = previousTitle;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── flow-sync 纯函数 ─────────────────────────────────────────────────────────

test("github backfill removes the bootstrap exemption", () => {
  const content = "kind: issue\nbootstrap: true\ngithub:\n  number: null\n  url: null\n";
  const next = applyGithubRef(content, 42, "https://github.com/o/r/issues/42");
  assert.match(next, /number: 42/);
  assert.doesNotMatch(next, /bootstrap: true/);
});

test("github issue body strips locale and machine data", () => {
  const body = renderIssueBody(`# 标题\n\n[English](m0-a.en.md) | 中文\n\n\`\`\`yaml flow\nkind: issue\n\`\`\`\n\n## 目标\n\n交付。\n`, "o/r");
  assert.match(body, /## 目标/);
  assert.doesNotMatch(body, /yaml flow|English/);
});

test("retire-missing closes only open remote objects absent from the local tree", () => {
  const current = tree();
  current.milestones[0].data.github = { number: 2, url: "https://github.com/o/r/milestone/2" };
  current.issues[0].data.github = { number: 20, url: "https://github.com/o/r/issues/20" };
  assert.deepEqual(planRetirements(current, {
    milestones: [{ number: 1, state: "open" }, { number: 2, state: "open" }, { number: 3, state: "closed" }],
    issues: [{ number: 10, state: "OPEN" }, { number: 20, state: "OPEN" }, { number: 30, state: "CLOSED" }],
  }), { milestones: [1], issues: [10] });
});

test("sync republishes changed issue bodies and skips equal state", async () => {
  const current = tree();
  current.milestones[0].data.github = { number: 2, url: "https://github.com/o/r/milestone/2" };
  current.milestones[0].data.status = "active";
  current.issues[0].data.github = { number: 20, url: "https://github.com/o/r/issues/20" };
  const updates = [];
  const result = await runSync(current, {
    createMilestone() { throw new Error("unexpected"); },
    createIssue() { throw new Error("unexpected"); },
    backfill() {},
    readMilestoneState: () => "open",
    updateMilestoneState() {},
    readIssueState: () => "OPEN",
    updateIssueState() {},
    readIssueBody: () => "old",
    updateIssueBody: (_issue, body) => updates.push(body),
    issueBody: () => "new body",
  });
  assert.deepEqual(updates, ["new body"]);
  assert.deepEqual(result, { milestones: 0, issues: 0, stateUpdates: 1, bodyUpdates: 1 });
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
  const out = execFileSync("git", ["hash-object", "-w", "--stdin"], {
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
