# Agent Note: Dashboard Default Time Range and Boundaries

Status: implemented

English | [中文](2026-11-01-dashboard-default-time-range.md)

## Problem

The dashboard in the [m1-01 prototype](../../../../plan/m1-01-ui-prototype/ztask-prototype.html) used fixed historical dates and showed no query results until the user clicked the query button. Its date inputs and string comparisons did not define actual timestamps, leaving the end boundary ambiguous for both the default “yesterday to now” range and custom end dates.

## Decision

The dashboard now automatically queries from yesterday at 00:00:00.000 to the exact current time in the local timezone, displays changed tasks immediately, and provides an “update to now” action. Editing either date switches to custom mode. A custom query starts at 00:00:00.000 on the start date and ends at 23:59:59.999 on the end date, including both complete calendar days. The filter area adds a “yesterday to now” state, date labels, and boundary guidance; the result area shows the actual query timestamps and change count. Prototype history is generated relative to the current time so the default range has meaningful changes to inspect. Snapshot comparison uses real timestamps and includes snapshots exactly on a boundary.

## Alternatives considered

The default end was not set to 23:59:59.999 today because that would include future data. A custom end was not set to 00:00:00 because that would omit almost the entire end date. The start was not set to 00:00:01 because that would omit records exactly at midnight. A dual-calendar popover was not introduced; the existing inline structure remains, with a quick range and status summary reducing interaction cost.

## Consequences

Default and custom queries now have distinct, explicit end boundaries, and the interface displays the actual range used. Prototype tests cover the default yesterday-to-now range, full-day custom boundaries, prevention of future default end times, invalid ranges, and inclusive snapshot boundaries. Browser screenshot verification covers automatic results and the default filter layout.
