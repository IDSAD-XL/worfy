# 02 — Demo ticket with every state

Type: task
Status: claimed 2026-11-04T08:00Z
Blocked by: —

## Готово, когда

- [x] Failed item.
  - evidence: test-run pass · `pnpm test` exit 0 · mac dev · 1111111
  - evidence: test-run fail · `pnpm test` exit 1 · mac dev · 2222222
- [x] Reviewed only.
  - evidence: review pass · PR #12 · - - · 3333333
- [ ] (вручную) Canvas on the PC.
  - needs: windows stable
  - evidence: screenshot pass · `../evidence/02-canvas.webp` · windows installed · 4444444 · scrub: 2026-11-04
- [ ] (вручную) Manual item with a test run only.
  - evidence: test-run pass · `pnpm test` exit 0 · mac dev · 5555555
- [x] (вручную, owner) Manual item the owner checked.
  - evidence: owner-check pass · 2026-11-04 owner said ok · mac stable · 6666666
- [ ] Parent item.
  - [x] Nested child item.
    - evidence: test-run pass · `bash t.sh` exit 0 · linux - · 7777777
- [ ] Item with a broken line.
  - evidence: test-run VERIFIED · x · mac dev · 8888888
- [x] Verified item.
  - evidence: ci-check pass · ci-ok on PR #12 · ci ci · 9999999
- [ ] Needs met.
  - needs: windows
  - evidence: test-run pass · `pnpm test` exit 0 · windows dev · aaaaaaa
- [ ] (вручную) Drag of a card.
  - evidence: video pass · `../evidence/02-card-drag.webm` · mac dev · bbbbbbb · scrub: 2026-11-05
