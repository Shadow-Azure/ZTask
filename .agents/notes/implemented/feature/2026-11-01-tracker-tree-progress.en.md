# Agent Note: Task Tree Status Counts and Read-Only Progress

Status: implemented

English | [中文](2026-11-01-tracker-tree-progress.md)

## Problem

The [m1-01 prototype](../../../../plan/m1-01-ui-prototype/ztask-prototype.html) showed only total task counts on folders, making remaining work unclear. Task nodes also needed visible progress, while the fixed sidebar could not accommodate both long task names and the task board.

## Decision

Folder rows use a green check with the completed count and a red circle with the incomplete count, calculated recursively. Only tasks at exactly 100% count as completed. Task rows show a read-only 18px SVG progress ring and percentage at the right edge. The ring track remains visible, partial progress is blue, and complete progress is green; the ring exposes `progressbar` semantics and its current value. Editing stays outside the tree. Quick progress updates refresh the tree. A separator with an expanded hit area supports pointer dragging and arrow keys, clamps the tree to 220–480px, and reserves at least 480px for the board.

## Alternatives considered

Progress is not hidden until hover because it should remain scannable. A horizontal bar is not used because it creates more visual noise when task names, folder state, and progress appear together, while a compact ring uses less width in dense tree rows. The tree does not contain sliders because users only need to view progress there, and another editing entry would add accidental input and visual noise. The resize hit area is not limited to a 1px line because that is difficult to target.

## Consequences

The default tree width increases from 264px to 340px to fit task names and progress. The 18px ring plus percentage reduces the progress region from 76px to 49px, giving long task names more room. Completion status and progress continue to use the same task data rather than separate tree state.
