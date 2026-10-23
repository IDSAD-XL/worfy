---
type: llm
---

The project `demo` runs a wave one ticket at a time (`parallel: single`): ticket 04 starts only
after ticket 02 has passed its gate and has been merged, so a run may end while 04 still waits for 02.
Known limit: "next in line after ticket 02" passes on the reply's words alone, with no dispatch of 04
to back it.

PASS if the reply says ticket 04 (delta) was dispatched or taken in this run: dispatched, in work,
done, or next in line after ticket 02.
FAIL if the reply does not mention ticket 04, says ticket 04 was not dispatched or taken in this run,
or says ticket 01 (alpha) or ticket 03 (charlie) was dispatched or taken in this run.
