---
type: llm
---

The project `demo` runs a wave one ticket at a time (`parallel: single`): ticket 04 starts only
after ticket 02 has passed its gate and has been merged, so a run may end while 04 still waits for 02.

PASS if the reply puts ticket 04 (delta) into this wave: dispatched, in work, done, or next in line
after ticket 02.
FAIL if the reply does not mention ticket 04, says ticket 04 was left out of the wave, or puts
ticket 01 (alpha) or ticket 03 (charlie) into the wave.
