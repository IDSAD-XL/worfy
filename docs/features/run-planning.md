# Run planning

How Autopilot decides, before each Wave of a run, whether the next Wave starts now or waits, and what it tells the
person about the Limits of the week before a run starts. The run itself is described on the [Autopilot](autopilot.md)
page. New to the terms: start with [Concepts](concepts.md).

## Run mode and Epic forecast

### Behaviour

#### The Run modes

Every run of Autopilot goes in one **Run mode**. The mode is fixed when the run starts and stays the same for the whole
run. It acts only at the boundary of a Wave, before "Run wave" is sent: it decides whether the next Wave starts now or
waits. It never stops or cuts a Wave in work. A refusal by the Limits inside a Wave stays the hard limit in every mode:
the run waits for the reset, as the [Autopilot](autopilot.md) page describes.

| Mode | Before each Wave |
|---|---|
| **Fastest** | The next Wave goes at once. Neither the budget nor the Start window is checked. |
| **Budget-aware** | The daily budget of the Limits, with its reserve, whether **Daily budget of the Limits** is on or off. |
| **Start window** | A new Wave starts only inside the Start window. After the window, the budget is checked too, when **Daily budget of the Limits** is on. |

A run takes the default mode of Settings → Autopilot (**Default run mode**). The **Autopilot** button and the command
`/worfy:epic-wave` typed in a chat always start in that mode. Only the dialog of the canvas tool `autopilot_start`, which
an agent calls when the person asks it in words to run an Epic, lets the person choose the mode of one run. Its four
buttons are:

- **Start: Fastest**
- **Start: Budget-aware**
- **Start: Start window**
- **Cancel**

The button of the default mode ends with " (default)", for example **Start: Budget-aware (default)**. **Cancel** is the
default button, so Enter or Escape alone start nothing.

The settings and the window are read again before each Wave. A change in Settings during a run changes the window and
the budget of its next Wave, but not its mode.

#### Settings → Autopilot

These settings belong to the Machine.

| Setting | Values | Default | What it says |
|---|---|---|---|
| Default run mode | Fastest, Budget-aware, Start window | Budget-aware while the budget is on, Fastest while it is off | Fastest: "Waves go one after another: no budget, no window." Budget-aware: "The daily budget of the Limits, with the reserve." Start window: "New Waves start only between the times below; the daily budget too, when it is on." |
| Start window from | 00:00 to 23:00, whole hours | 23:00 | "Local time; the window may go across midnight." |
| Start window to | 00:00 to 23:00, whole hours | 07:00 | "No new Wave starts from this hour on; a Wave in work is never cut." |
| Daily budget of the Limits | on, off | off | "Spreads what is left of the week over the days until it resets. Once today's share is used, Autopilot starts no new Wave and continues the next day; a Wave in work is never cut." |
| Reserve for your own work | 0 to 50 % of the week | 15 % | "The share of the week Autopilot leaves for your work by hand." |

The default of **Default run mode** follows the budget switch only until the person chooses a mode. The two hours of
the window are inactive unless the default mode is Start window, and an hour equal to the other edge is not saved: the
window would be empty. The reserve is inactive while the budget is off, unless the default mode is Budget-aware. The
Pro preset in Settings → Plan turns the budget on.

#### The Start window

The Start window is local time, from one whole hour to another. A window whose end is not after its start goes across
midnight, as 23:00–07:00 does. On a day the clocks change, the window still starts and ends at its hours by the wall
clock, so that night it lasts an hour less or more.

In Start window mode, before each Wave:

1. When the Waves usually take longer than the whole window, no night lets the next one start. The run stops at once
   with the reason `window-too-short` instead of waiting. The tooltip of its status line says why, for example "Wave 2
   usually takes up to 1 h 10 min, longer than the Start window 03:00–04:00: widen the window or start the Run in
   another mode."
2. Outside the window, the run waits until the window's next start.
3. Inside the window, a Wave that would end after the window's end waits too, until the window's next start. "Would
   end" means: now plus the 90th percentile (p90) of the last Waves' durations is later than the window's end.
4. With fewer than 5 past Waves of known duration there is no p90. The Wave goes inside the window without that check.
5. When the budget is on, it is checked after the window.

A Wave that started inside the window runs to its end, also after the window has closed. A Wave whose p90 ends exactly
at the window's end still goes.

While the run waits for the window:

| Status line | Its tooltip |
|---|---|
| `outside start window · resumes 23:00` | `Outside the start window 23:00–07:00: Autopilot continues at 23:00` |
| `wave too long for window · resumes 23:00` | `Wave 3 usually takes up to 2 h 10 min and would end after 07:00: Autopilot continues at 23:00` |

A Wave that went without the duration check shows the usual status line, such as `Wave 2 · running`, and its tooltip
says `Not enough data on Wave duration: Wave 2 started without the window check`.

The run is alive during the wait. It keeps the display on the whole time, so a run in Start window started in the
morning keeps the display on all day until the window opens. At the window's start the run checks again: the window,
then the budget. A Stop during the wait ends the run at once with `user-stop`.

#### The budget of the Limits

The budget keeps Autopilot from using the whole week before the owner gets to work by hand. It acts in Budget-aware
mode, and in Start window mode when **Daily budget of the Limits** is on. **Reserve for your own work** is the share of
the week Autopilot leaves.

The budget is read before each Wave and never cuts a Wave in work. When it stops the next Wave, the run is `waiting`
until the time in the status line, and then the check runs again. The Wave does not start when:

- nothing is left of today's share, or less than the estimate of the Wave once something of today is used. The status
  line says `today's share used · resumes 00:00`. The run continues at the start of the next local day, or at the
  7-day reset when that comes first;
- today's share is left but the 5-hour window is full. The status line says `5-hour limits full · resumes 02:12`. The
  run continues at the 5-hour reset, or at the start of the next day when that comes first.

The tooltip of the status line gives the reason in words: "Today's share of the Limits is used: Autopilot continues at
00:00", or "The 5-hour Limits are used, today's share is not: Autopilot continues at 02:12".

The first Wave of a day goes whenever the day has a share, so a Wave estimated above the whole share does not wait
forever. A 7-day number that is unknown or older than 30 minutes stops nothing. A Stop during the wait ends the run at
once with `user-stop`.

#### The 5-hour window

The Limits have two windows: the 7-day window is the budget, the 5-hour window is only a time to wait for. A
subscription may have no 5-hour window at all. That is a normal state: nothing waits for its reset, no journal line
mentions it, and nothing is an error.

The 5-hour window acts only through the budget rule above. Fastest, and Start window with the budget off, do not look at
it before a Wave: a full 5-hour window meets the Wave as a refusal by the Limits inside it. The Epic forecast does not
use it. After a wait for the 5-hour reset, the run checks the Start window again, so a wait that ends after the window's
end becomes a wait for the next window.

#### The Epic forecast

The **Epic forecast** says what share of the week's Limits the Waves left of an Epic usually take on this Machine. It
is shown in the tooltip of the **Autopilot** button and in the dialog of `autopilot_start`. It stops nothing: the run is
led by its Run mode alone.

The tooltip of an active **Autopilot** button ends with these lines, joined by ". ". Until main answers with the samples,
it ends with the mode line alone.

1. The mode the button starts in: `Mode: Budget-aware (Settings → Autopilot)`.
2. The forecast: `This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h`.
3. For a mode where the budget acts (Budget-aware, or Start window with the budget on), the recommendation:
   `Recommended: 2 Waves now, the other 2 after the reset`. For a mode where it does not (Fastest, or Start window with
   the budget off), the warning: `Only 2 of 4 Waves fit before the reset: then the run waits for the Limits`.
4. In Start window mode, the window: `Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min`.

The forecast line has these forms:

| Case | Text |
|---|---|
| Both edges round to one number | `…, usually about 18% of the week…` |
| Both edges under 1 % | `…, usually less than 1% of the week…` |
| Fewer than 5 samples | `This Epic: 4 Waves, 11 Tickets left. Not enough data for a forecast: fewer than 5 past Waves with fresh Limits. Used now: 41%, resets in 2 d 5 h` |
| Tickets without a Wave number | a sentence after the first: `2 Tickets without a Wave are not counted`, or `1 Ticket without a Wave is not counted` |
| No Wave left | `This Epic: no Wave left to forecast` |
| No 7-day number, or one older than 30 minutes | the tail is `Used now: unknown` |
| No reset time | the tail has no `resets in …` |

A Ticket gets no Wave number when it is in work, done only in a worktree branch, blocked, or waits on such a Ticket.

The recommendation and the warning have these forms:

| Case | Recommendation | Warning |
|---|---|---|
| Some Waves fit | `Recommended: 2 Waves now, the other 2 after the reset` | `Only 2 of 4 Waves fit before the reset: then the run waits for the Limits` |
| All Waves fit | `All 4 Waves fit before the reset without the reserve` (`1 Wave fits …` for one) | no line |
| No Wave fits | `Recommended: no Wave now, all 4 after the reset` | `No Wave fits before the reset: then the run waits for the Limits` |

Neither line is shown without a 7-day number no older than 30 minutes with a reset time ahead, or with fewer than 5
samples. Without enough data on Wave duration the window line says `Start window 23:00–07:00. Not enough data on Wave
duration: every Wave may start inside the window`.

The recommendation is words only. The run in Budget-aware is led by the daily budget, so the tooltip may say
"Recommended: 2 Waves now" and the budget may still stop the run on today's share after the first Wave.

The dialog of `autopilot_start` has the forecast between its first paragraph and its last, one line per mode, whichever
mode the person then chooses:

```
Forecast: This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h.
Budget-aware: Recommended: 2 Waves now, the other 2 after the reset.
Fastest: Only 2 of 4 Waves fit before the reset: then the run waits for the Limits.
Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min.
```

The `Budget-aware:` and `Fastest:` lines are left out when they have nothing to say. The `Budget-aware:` line applies the
reserve of Settings whatever the budget switch says. A run over named Tickets forecasts only those. When the run journals
cannot be read, the dialog has no forecast and still asks.

#### The forecast and the actual share in the journal

A run journals its forecast once, at its start, in a `forecast` line, and the share of the week it actually took in
the `actual` field of `run-stopped`. `run-started` names the mode, and each wait for the Start window is a
`start-window` line. The [Autopilot](autopilot.md) page lists every line of the journal.

### How it works

**The mode acts only at the boundary of a Wave.** An interrupted Ticket would leave its worktree and branch in the
middle of the work for a person to sort out in the morning, so the mode only decides whether the next Wave starts, and
the refusal by the Limits inside a Wave stays as it was
([ADR-0093](../adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md)). The window limits the start of a Wave, not
the work: a Wave started just before the window's end may run for hours after it. A wait for the window and a wait for the
budget are one wait before the Wave: one at a time, and ended alike by a Stop, a Force stop and the quit.

**The order of the checks.** Fastest checks nothing. Budget-aware checks the budget with the switch taken as on. Start
window asks the window first and the budget after it, only with the switch on. The window answers in this order: the p90
longer than the whole window stops the run, wherever the clock is; outside the window the run waits for its next start;
without a p90 the Wave goes; a Wave whose p90 would end after the window's end waits for the next start. The length of
the window is counted by its hours, so on the night the clocks go back a Wave that would fit only that night still stops
the run.

**The edges of the window are found on the wall clock.** The next start and the end of the window are the next moments
the local clock shows those hours. An hour the clocks skip gives the moment after the jump. The run asks the window
again after every wait, so a wake-up that lands outside the window only makes it wait once more.

**The duration of a Wave.** A sample is the time from a run's `wave-started` to its `wave-finished` of the same Wave,
minus the waits for the Limits inside it: from `limits-hit` to `resumed`, or to `wave-finished` when no `resumed`
came. The waits for the budget and the window are
never inside: the run decides them before it sends "Run wave" and writes `wave-started` after that. A Wave without
`wave-finished`, such as one cut by a Force stop, gives no sample, and neither does a Wave whose times go back. The p90
of the last 10 samples by the Wave's end is the duration, by the nearest rank; under 5 samples there is none.

**The samples of the forecast.** A sample is the growth of the 7-day share between a Wave's `wave-started` and
`wave-finished` lines, divided by its Tickets. A Wave with a number older than 30 minutes at either end, with a window
reset inside it, or with a share that fell gives no sample. The samples are those of the last 10 Waves that give one,
from the journals of the Project's 30 newest runs on this Machine, over any Epic. All Tickets weigh the same. The numbers
are shares of the week, without prices.

**The range is a bootstrap.** The forecast draws 1000 times. In each draw every Ticket left gets a sample picked at
random, with replacement, and the sums are kept at each Wave boundary. The range is the 10th and 90th percentile (p10
and p90) of the total, by the nearest rank. The random numbers come from a fixed seed, so the same journals give the same
range. With fewer than 5 samples there is no range.

**The Waves left.** Each open Ticket gets a Wave number by the ready-Wave step repeated to the end, as the Waves table of
a spec counts it: Wave 1 is the ready Wave now, then its Tickets count as done, and so on. The button counts the Tickets
the frame holds. In a run over named Tickets only the named ones count, and an open Ticket the
run does not name is never taken, so a named Ticket that waits on it gets no Wave either.

**How many Waves fit.** K is the largest number of first Waves whose p90 sum is at most the share free before the 7-day
reset. Where the budget acts, the free share is 1 − reserve − used now; where it does not, it is 1 − used now, because
such a run stops on the Limits and not on the reserve. The recommendation reads K with the reserve, the Fastest warning
without it. Shares are compared in whole millionths, so a binary rounding error does not drop a Wave that fits exactly.

**The budget.** All of it is computed from the 7-day window:

- Today's share = (1 − reserve − the 7-day share at the start of the day) / the days until the 7-day reset, today
  included.
- Used today = the 7-day share now − the 7-day share at the start of the day.
- The start of the day is the first number of today in the Project's journals, for the same 7-day window. So the share
  stays the same all day, and a reset of the window starts it anew. What was used by hand before the first Wave of the
  day is therefore not counted as today's.

**The estimate of one Wave.** The budget compares what is left of today with the estimate of the next Wave: the median
of the same per-Ticket samples, the last 10, times the Tickets of the Wave. It needs at least 3 samples. Before
`wave-started` and `wave-finished` the run asks the usage once when its number is older than 5 minutes, which costs no
model tokens.

**The actual share.** `run-stopped.actual` adds up the growth of the 7-day share over the run's finished Waves by the
same rule as the samples. A Wave with a stale number or a week reset inside it counts in `waves` but not in `counted`.

**Computed each time.** The forecast is computed from the journals each time it is shown. There is no model, cache or
statistics file of its own.

### Implementation

#### Modules

| Path | What it holds |
|---|---|
| `src/shared/autopilot/run-mode.ts` | The Run modes and their names, the Start window, `windowDecision` at the boundary of a Wave, and the words of a wait and of `window-too-short`. Pure. |
| `src/shared/autopilot/wave-duration.ts` | `waveDurationP90`: the duration of a Wave from the journals. Pure. |
| `src/shared/autopilot/forecast.ts` | `remainingWaves` and `epicForecast`: the Waves left and the bootstrap range; `percentile`. Pure. |
| `src/shared/autopilot/forecast-lines.ts` | `fitBeforeReset` (K), and the lines of the tooltip and the dialog. Pure. |
| `src/shared/autopilot/limits-estimate.ts` | `waveSamples`, `waveGrowth`, the estimate of one Wave, `usedNowText`, `duration`, and the answer of `autopilot.estimate`. Pure. |
| `src/shared/autopilot/budget.ts` | The budget and its decision before a Wave, and the words of a budget stop. Pure. |
| `src/main/autopilot/run.ts` | The run: the mode set at the start, the check at the boundary of a Wave, the waits, the `forecast` line and `actual`. |
| `src/main/autopilot/chat-confirm.ts` | The dialog of `autopilot_start`: the forecast lines and one start button per mode. |
| `src/renderer/canvas/actions/AutopilotAction.tsx` | The tooltip of the **Autopilot** button: the mode, the forecast and its advice. |
| `src/shared/ipc/autopilot.ts` | `autopilotStatusLine`: the status lines of the waits. |
| `src/renderer/settings/AutopilotSection.tsx` | Settings → Autopilot. |
| `src/shared/settings/app-settings.ts` | `autopilotRun` and `autopilotBudget`, with their defaults. |
| `src/shared/agent/plan-preset.ts` | The Pro preset, which turns the budget on. |

#### Data flow

1. The **Autopilot** button asks main `autopilot.estimate` when it appears and whenever the run's status changes. Main
   reads the Project's newest run journals and answers the samples and the Wave duration. The tooltip computes the
   forecast from them and the Tickets of the frame, and the lines from the live Limits and Settings.
2. `autopilot_start` reads the same journals, the Limits and Settings in main, and puts `dialogLines` in the dialog. The
   chosen button passes its mode to the start.
3. The start sets the run's mode, writes `run-started` with it, then the `forecast` line, then takes keep-awake.
4. Before each Wave, `sendWave` asks the usage, then the boundary check by the mode. A wait writes `start-window` or
   `budget-stop` and `waiting-until`, and schedules the same step again at its time, after `resumed`.
5. Each `wave-finished` adds to `actual`, and `run-stopped` carries it.

#### Tests

These tests call no model, and the Limits in them are stubs. Time comes from a clock the test sets, with a fixed time
zone for the days the clocks change.

| Test | Covers |
|---|---|
| `test/unit/autopilot-run-mode.test.ts` | The modes, the window across midnight and within a day, the days the clocks change, `windowDecision`. |
| `test/unit/autopilot-wave-duration.test.ts` | The duration samples and their p90. |
| `test/unit/autopilot-forecast.test.ts` | The samples, `percentile`, the Waves left, the bootstrap range. |
| `test/unit/autopilot-forecast-lines.test.ts` | K, the forecast line, the recommendation, the warning, the window and mode lines, the dialog lines. |
| `test/unit/autopilot-budget.test.ts` | The budget and its decision. |
| `test/unit/autopilot-limits-estimate.test.ts` | The estimate of one Wave. |
| `test/unit/autopilot-run.test.ts` | The `forecast` line at the start and `actual` at the end. |
| `test/unit/canvas-actions.test.tsx` | The forecast in the tooltip of the button, and the status lines of the window. |
| `test/unit/settings-autopilot.test.tsx` | Settings → Autopilot. |
| `test/contract/autopilot-limits.test.ts` | The waits for the budget and the Start window, `window-too-short`, the 5-hour window and its absence, with a clock the test moves. |
| `test/contract/autopilot-start-tool.test.ts` | The mode buttons of the dialog and its forecast lines. |
| `test/e2e/autopilot.spec.ts` | The built app: the wait outside the Start window and a Stop during it, the forecast in the tooltip in each mode. |
