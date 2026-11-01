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

test('subtask summary counts completed and total work items', () => {
  const subtaskSummary = loadFunction('subtaskSummary');
  assert.deepEqual(subtaskSummary([{ progress: 100 }, { progress: 40 }, { progress: 99 }]), { done: 1, total: 3 });
  assert.deepEqual(subtaskSummary([]), { done: 0, total: 0 });
  assert.deepEqual(subtaskSummary(null), { done: 0, total: 0 });
});

test('task card presents a unified read-only subtask and progress view', () => {
  const taskRow = loadFunction('taskRow', {
    subtaskSummary: loadFunction('subtaskSummary'),
    esc: value => String(value),
    subtaskProgressHtml: loadFunction('subtaskProgressHtml'),
    ava: () => '<span class="ava"></span>',
    isOverdue: () => false,
    avaGroup: () => '',
    member: id => ({ name: id }),
    impName: { high: '高', mid: '中' },
    fmtD: () => '11-06',
  });
  const rendered = taskRow({
    id: 't1', desc: '任务树组件重构', progress: 70, owners: [], imp: 'high', due: '2026-11-06',
    detail: '第一行进展\n第二行进展',
    subs: [{ id: 'st1', desc: '小任务', owner: 'chen', progress: 100, due: '2026-11-01' }],
  }, false, null);

  assert.match(rendered, /class="task-card"/);
  assert.match(rendered, /class="task-card-head"/);
  assert.match(rendered, /class="task-card-body"/);
  assert.match(rendered, /第一行进展\n第二行进展/);
  assert.match(rendered, /1\/1/);
  assert.match(rendered, /subtask-progress-ring/);
  assert.match(rendered, /subtask-owner/);
  assert.match(rendered, /chen/);
  assert.doesNotMatch(rendered, /subtask-line[\s\S]*class="track"/);
  assert.doesNotMatch(rendered, /data-op|data-prog|aria-expanded|overview-toggle|<button/);
});

test('read-only task card handles empty subtasks and details without controls', () => {
  const taskRow = loadFunction('taskRow', {
    subtaskSummary: loadFunction('subtaskSummary'),
    esc: value => String(value),
    subtaskProgressHtml: loadFunction('subtaskProgressHtml'),
    ava: () => '<span class="ava"></span>',
    isOverdue: () => false,
    avaGroup: () => '',
    member: id => ({ name: id }),
    impName: { high: '高', mid: '中' },
    fmtD: () => '11-06',
  });
  const rendered = taskRow({ id: 't2', desc: '看板优化', progress: 30, owners: [], imp: 'mid', due: '2026-11-20', detail: '', subs: [] }, false, null);
  assert.match(rendered, /暂无小任务/);
  assert.match(rendered, /暂无进展详情/);
  assert.doesNotMatch(rendered, /data-op|data-prog|<button/);
});

test('subtask pane width clamps to preserve readable subtasks and detail', () => {
  const clampSubtaskPanePercent = loadFunction('clampSubtaskPanePercent');
  assert.equal(clampSubtaskPanePercent(10), 26);
  assert.equal(clampSubtaskPanePercent(36), 36);
  assert.equal(clampSubtaskPanePercent(80), 55);
});

test('task card includes an accessible resizer between subtasks and detail', () => {
  const taskRow = loadFunction('taskRow', {
    subtaskSummary: loadFunction('subtaskSummary'),
    esc: value => String(value),
    isOverdue: () => false,
    avaGroup: () => '',
    member: id => ({ name: id }),
    impName: { mid: '中' },
    fmtD: () => '11-20',
  });
  const rendered = taskRow({ id: 't2', desc: '看板优化', progress: 30, owners: [], imp: 'mid', due: '2026-11-20', detail: '详情', subs: [] }, false, null);
  assert.match(rendered, /class="task-pane-resizer"/);
  assert.match(rendered, /role="separator"/);
  assert.match(rendered, /aria-orientation="vertical"/);
  assert.match(rendered, /aria-valuemin="26"/);
  assert.match(rendered, /aria-valuemax="55"/);
  assert.match(rendered, /aria-valuenow="36"/);
  assert.match(rendered, /tabindex="0"/);
});


test('subtask progress ring exposes progress and prints percentage inside', () => {
  const subtaskProgressHtml = loadFunction('subtaskProgressHtml');
  const rendered = subtaskProgressHtml(40, '大数据量虚拟滚动');
  assert.match(rendered, /role="progressbar"/);
  assert.match(rendered, /aria-valuenow="40"/);
  assert.match(rendered, /aria-label="大数据量虚拟滚动，进度 40%"/);
  assert.match(rendered, /subtask-progress-ring-value/);
  assert.match(rendered, />40%<\/text>/);
  const complete = subtaskProgressHtml(100, '树节点拖拽交互');
  assert.match(complete, /subtask-progress-ring-value done/);
});

test('default dashboard range starts at yesterday local midnight and ends at the exact current time', () => {
  const createDefaultRange = loadFunction('createDefaultRange');
  const now = new Date(2026, 10, 1, 12, 34, 56, 789);
  const range = createDefaultRange(now);

  assert.equal(range.start.getTime(), new Date(2026, 9, 31, 0, 0, 0, 0).getTime());
  assert.equal(range.end.getTime(), now.getTime());
});

test('custom dashboard dates include the whole start and end days in local time', () => {
  const resolveQueryRange = loadFunction('resolveQueryRange');
  const range = resolveQueryRange('2026-10-20', '2026-10-29', false, new Date(2026, 10, 1, 12, 0, 0));

  assert.equal(range.start.getTime(), new Date(2026, 9, 20, 0, 0, 0, 0).getTime());
  assert.equal(range.end.getTime(), new Date(2026, 9, 29, 23, 59, 59, 999).getTime());
});

test('default dashboard query never extends the end time to future end-of-day', () => {
  const resolveQueryRange = loadFunction('resolveQueryRange');
  const now = new Date(2026, 10, 1, 8, 15, 30, 250);
  const range = resolveQueryRange('2026-10-31', '2026-11-01', true, now);

  assert.equal(range.end.getTime(), now.getTime());
  assert.notEqual(range.end.getTime(), new Date(2026, 10, 1, 23, 59, 59, 999).getTime());
});

test('dashboard query rejects missing, invalid, or reversed date ranges', () => {
  const resolveQueryRange = loadFunction('resolveQueryRange');
  const now = new Date(2026, 10, 1, 12, 0, 0);

  assert.equal(resolveQueryRange('', '2026-11-01', false, now), null);
  assert.equal(resolveQueryRange('2026-11-02', '2026-11-01', false, now), null);
  assert.equal(resolveQueryRange('not-a-date', '2026-11-01', false, now), null);
});

test('history snapshot lookup includes the exact boundary and excludes later snapshots', () => {
  const snapshotAt = loadFunction('snapshotAt');
  const history = [
    { d: '2026-10-31T00:00:00.000', p: 40 },
    { d: '2026-10-31T12:00:00.000', p: 55 },
    { d: '2026-11-01T00:00:00.000', p: 70 },
  ];

  assert.equal(snapshotAt(history, new Date(2026, 9, 31, 12, 0, 0, 0)).p, 55);
  assert.equal(snapshotAt(history, new Date(2026, 9, 31, 23, 59, 59, 999)).p, 55);
  assert.equal(snapshotAt(history, new Date(2026, 9, 30, 23, 59, 59, 999)), undefined);
});

test('relative history timestamps are available during prototype data initialization', () => {
  const pad2 = loadFunction('pad2');
  const formatLocalDate = loadFunction('formatLocalDate', { pad2 });
  const formatTimestamp = loadFunction('formatTimestamp', { formatLocalDate, pad2 });
  const historyHoursAgo = loadFunction('historyHoursAgo', { formatTimestamp });
  const originalNow = Date.now;
  Date.now = () => new Date(2026, 10, 1, 12, 34, 56).getTime();
  try {
    assert.equal(historyHoursAgo(1), '2026-11-01T11:34:56');
  } finally {
    Date.now = originalNow;
  }
});

test('query results render every diff expanded and provide bulk disclosure controls', () => {
  const box = { innerHTML: '', querySelectorAll: () => [], querySelector: () => ({ addEventListener() {} }) };
  const fields = {
    '#range-start': { value: '2026-10-20' },
    '#range-end': { value: '2026-10-29' },
    '#range-result': box,
  };
  const pad2 = loadFunction('pad2');
  const formatLocalDate = loadFunction('formatLocalDate', { pad2 });
  const formatTimestamp = loadFunction('formatTimestamp', { formatLocalDate, pad2 });
  const renderRangeQuery = loadFunction('renderRangeQuery', {
    $: selector => fields[selector],
    rangeMode: 'custom',
    resolveQueryRange: loadFunction('resolveQueryRange'),
    formatTimestamp,
    dashTasks: () => [{ id: 't1', desc: '任务树组件重构', owners: [], imp: 'high' }],
    HISTORY: { t1: [
      { d: '2026-10-20T09:00:00', p: 55, detail: '旧进展' },
      { d: '2026-10-21T09:00:00', p: 70, detail: '新进展' },
    ] },
    snapshotAt: loadFunction('snapshotAt'),
    diffLines: loadFunction('diffLines'),
    esc: value => String(value),
    avaGroup: () => '',
  });

  renderRangeQuery();

  assert.match(box.innerHTML, /class="chg-toolbar"/);
  assert.match(box.innerHTML, /id="btn-expand-all"/);
  assert.match(box.innerHTML, /id="btn-collapse-all"/);
  assert.match(box.innerHTML, /class="chg-row open"/);
  assert.match(box.innerHTML, /class="diff-wrap open"/);
});

test('bulk disclosure controls expand and collapse both task rows and diff panels', () => {
  const setAllChanges = loadFunction('setAllChanges');
  const makeElement = () => ({
    open: false,
    classList: {
      toggle(name, force) { this.owner.open = force === undefined ? !this.owner.open : force; },
    },
  });
  const rows = [makeElement(), makeElement()];
  const diffs = [makeElement(), makeElement()];
  rows.concat(diffs).forEach(el => { el.classList.owner = el; });
  const box = { querySelectorAll: () => [...rows, ...diffs] };

  setAllChanges(box, true);
  assert.ok(rows.concat(diffs).every(el => el.open));
  setAllChanges(box, false);
  assert.ok(rows.concat(diffs).every(el => !el.open));
});
