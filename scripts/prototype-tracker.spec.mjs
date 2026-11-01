import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../plan/m1-01-ui-prototype/ztask-prototype.html', import.meta.url), 'utf8');

function loadFunction(name, dependencies = {}) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in the prototype`);
  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') depth--;
    if (depth === 0) {
      const source = html.slice(start, i + 1);
      return new Function(...Object.keys(dependencies), `${source}; return ${name};`)(...Object.values(dependencies));
    }
  }
  assert.fail(`${name} must have a complete function body`);
}

test('folder counts split completed and incomplete tasks recursively supplied ids', () => {
  const summarizeTaskCounts = loadFunction('summarizeTaskCounts');
  const tasks = {
    done: { progress: 100 },
    started: { progress: 70 },
    untouched: { progress: 0 },
  };
  assert.deepEqual(summarizeTaskCounts(['done', 'started', 'untouched'], tasks), { done: 1, todo: 2 });
});

test('folder counts treat only exactly 100 percent as completed', () => {
  const summarizeTaskCounts = loadFunction('summarizeTaskCounts');
  assert.deepEqual(summarizeTaskCounts(['almost'], { almost: { progress: 99 } }), { done: 0, todo: 1 });
});

test('tree width clamps to a usable desktop range', () => {
  const clampTreeWidth = loadFunction('clampTreeWidth');
  assert.equal(clampTreeWidth(100, 1440), 220);
  assert.equal(clampTreeWidth(900, 1440), 480);
  assert.equal(clampTreeWidth(340, 1440), 340);
});

test('tree width always leaves room for the task board on narrow screens', () => {
  const clampTreeWidth = loadFunction('clampTreeWidth');
  assert.equal(clampTreeWidth(700, 900), 420);
});

test('quick progress updates refresh the read-only tree and folder counts', () => {
  const TASKS = { t2: { progress: 30, subs: [] } };
  const renders = { tasks: 0, stats: 0, tree: 0 };
  const commitProgress = loadFunction('commitProgress', {
    TASKS,
    progressEditing: 't2',
    toast: () => {},
    renderTasks: () => { renders.tasks++; },
    renderStats: () => { renders.stats++; },
    renderTree: () => { renders.tree++; },
  });
  commitProgress('t2', 100);
  assert.equal(TASKS.t2.progress, 100);
  assert.deepEqual(renders, { tasks: 1, stats: 1, tree: 1 });
});

test('task tree progress renders a compact accessible determinate ring', () => {
  const treeProgressHtml = loadFunction('treeProgressHtml', {
    treeProgressOffset: loadFunction('treeProgressOffset'),
  });
  const rendered = treeProgressHtml(70, '任务树组件重构');

  assert.match(rendered, /role="progressbar"/);
  assert.match(rendered, /aria-valuemin="0"/);
  assert.match(rendered, /aria-valuemax="100"/);
  assert.match(rendered, /aria-valuenow="70"/);
  assert.match(rendered, /tree-progress-ring-value/);
  assert.match(rendered, />70%<\/span>/);
  assert.doesNotMatch(rendered, /tree-progress-track/);
});

test('task tree ring maps and clamps determinate progress to a stroke offset', () => {
  const treeProgressOffset = loadFunction('treeProgressOffset');
  const circumference = 43.982297;

  assert.ok(Math.abs(treeProgressOffset(-10) - circumference) < 0.000001);
  assert.ok(Math.abs(treeProgressOffset(0) - circumference) < 0.000001);
  assert.ok(Math.abs(treeProgressOffset(25) - 32.986723) < 0.000001);
  assert.equal(treeProgressOffset(100), 0);
  assert.equal(treeProgressOffset(110), 0);
});
