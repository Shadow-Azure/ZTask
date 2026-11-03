# Agent Note: Subtask save validation and diagnosable errors

Status: implemented

English | [中文](2026-11-03-subtask-save-error-reporting.md)

## Problem

When a subtask save failed, users saw only “内部错误”. The server collapsed every unexpected exception into the same `INTERNAL_ERROR / 内部错误`, recording neither a request id nor a stack, and distinguishing neither storage corruption, an unwritable directory, nor a code defect. Admin subtask payloads had no structural validation: when `subtasks.create` was an object or contained empty entries, the iteration threw `TypeError` and the handler flattened it into a 500. The frontend also sent predictable form problems (missing subtask owner, empty progress) to the server, so the message users saw did not match the real cause.

## Decision

The server validates subtask payload structure at task write entry points: `subtasks` must be an object, `create/update` must be arrays, `deleteIds` must be a string array, and every entry must be an object; invalid shapes return a 400 naming the field and reason and never reach the aggregate write. The unified error handler logs the request id, method, and stack, and returns a safe Chinese cause by error type: storage corruption, missing entry, unwritable directory, and low disk space each state the next action, while other cases return the request id with retry/feedback guidance. The frontend adds a unified error translator that turns error codes, AJV English validation messages, and the request id into readable text; the admin editor and subtask forms validate description, owner, and progress in place before submitting.

## Alternatives considered

Returning the raw exception message to users was rejected: it can contain data-directory paths, internal file structure, or other private information. Frontend-only validation was rejected: old clients, scripts, and concurrent entry points could bypass it, so the server must stay closed. Keeping every 500 as “内部错误” was rejected: it tells users nothing to do next and leaves maintainers unable to locate a log from one report. Treating every unexpected exception as a 400 was rejected because it would mask real server failures.

## Consequences

Users can tell “invalid input”, “stale member”, “data corruption”, and “directory/disk problem” apart and get a searchable request id; maintainers can locate a stack in server logs by that id. The cost is maintaining the error-type-to-message map and updating it when a storage code is added. Old invalid clients change from 500 to 400, so external scripts relying on the old status need adjustment. The request id is diagnostic only and carries no data; responses still expose no file paths.
