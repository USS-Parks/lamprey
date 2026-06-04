---
name: loop
description: Run a task on a recurring interval, or let the model self-pace.
args:
  - interval
  - body
---
Set up a recurring task. Interval: `{{interval}}`. Task body:

{{body}}

Each iteration should: do the work, summarize what happened (one sentence), and decide whether to continue, stop, or hand back. If the interval is empty, self-pace using `schedule_wakeup`.
