# Effective timing infrastructure

This directory is the task-01 browser timing boundary for R3. Training
modules declare what they are doing; they do not read browser visibility,
construct timestamps or event IDs, calculate elapsed time, or write timing
events directly.

## Public session API

Application route hosts obtain a session from
`ProductionEffectiveTimingSessionFactory.create(taskId, moduleId)`. The
factory resolves the real active-plan task before opening its versioned
snapshot. A route must use the task's real `taskId`; a module ID or array
position is not a substitute.

The session exposes these serialized operations:

1. `start(declaration)` opens the first declared phase.
2. `transition(declaration)` closes the previous phase and opens the next.
3. `activity()` records a real non-DOM interaction. Pointer, keyboard, input,
   and touch activity are already observed centrally.
4. `pause()` enters the excluded `user-paused` phase.
5. `resume(declaration)` explicitly restarts a phase after pause, background,
   or recovery.
6. `finish()` closes the final segment, publishes all pending events, and then
   deletes the timing snapshot. Repeating a successful finish is idempotent;
   repeating a failed finish retries its already-persisted pending event.
7. `dispose()` closes the current segment but retains a suspended snapshot for
   a later route mount.

`flush()` is for deterministic waiting and retry coordination. It does not
close a segment and must not be used as a pause operation.

## Allowed declarations

| Module state | Declaration | Effective time |
| --- | --- | --- |
| Answering | `answering / active-answering` | Included while active |
| Viewing feedback | `feedback / active-feedback` | Included while active |
| Listening to learning audio | `audio-listening / active-audio-listening` | Included |
| Recording | `recording / active-recording` | Included |
| Playing a recording | `playback / active-playback` | Included |
| Content or media loading | `loading / content-loading` or `media-loading` | Excluded |
| Permission wait | `permission-wait / permission-wait` | Excluded |
| Network wait | `network-wait / network-wait` | Excluded |
| Explicit pause | `paused / user-paused` | Excluded |

Task 01 does not infer a module's current exercise, answer state, audio state,
or recording state. A later 06/07/08 integration must emit these declarations
from its real runtime transitions.

## Browser and idle rules

- `visibilitychange`, `pagehide`, and available `freeze` events close the
  foreground segment at the event's captured monotonic-clock instant.
- `pageshow`, visible, or resume never starts time by itself. Interactive
  phases require real activity; continuous media requires an explicit
  `resume()` or `transition()`.
- Answering and feedback stop after 45 seconds without activity. A delayed
  browser timer cannot extend that limit because every operation settles
  already-due monotonic boundaries before handling the new action.
- Continuous audio, recording, and playback ignore ordinary click idleness
  but are safely split every 15 minutes. The module must transition when the
  media pauses, ends, loads, or fails.
- DOM activity listeners are throttled to 250 ms and removed when the session
  finishes or is disposed.
- Segments shorter than one whole second do not create synthetic zero-second
  events.

## Persistence, ordering, and recovery

Snapshots use namespace `app.effective-timing`, schema version 1, and key
`session:<encoded planId>:<encoded taskId>`. Each event ID is stable:
`timing:<sessionId>:<sequence>`.

Closing a segment follows this order:

1. Add the event to `pendingEvents`.
2. Save the snapshot.
3. Publish through the production learning event sink.
4. After the sink has saved engine state and active-plan state, remove the
   pending event and save the snapshot again.
5. Only then expose the production sink's runtime update.

If step 4 fails after publication, refresh may replay the same event ID. Both
the production runtime ledger and plan lifecycle are idempotent by ID, so the
segment is not accumulated twice.

An open segment stored before a crash is crash-detection metadata, not a
resumable stopwatch. Restore discards it and never fills the time between the
old page and the new page. The saved declaration remains suspended until real
activity or an explicit resume. A snapshot with a future schema, corrupt
phase, foreign pending event, or mismatched plan/task identity is preserved
and rejected with a recoverable error; it cannot contaminate another task.

All persistence is device-local and works offline. This infrastructure does
not read, clear, or migrate assessment answers or daily-plan business data.

## Integration order for training modules

A route integration must:

1. Resolve and create the timing session before the first measured phase.
2. Translate real module runtime changes into declarations.
3. Await phase operations so storage failures are visible and duplicate
   actions remain serialized.
4. Call `finish()` before publishing the final
   `learning.attempt.completed.v1`; this guarantees the completion sees the
   final timing totals and can create one trusted duration sample.
5. Call `dispose()` on unfinished route teardown.

If local persistence fails, the operation rejects and no later state should be
presented as durably timed. Lifecycle-triggered failures are reported through
the factory error callback. The safe degradation is under-counting and a
suspended recoverable session, never invented elapsed time.
