# 37: Product Session не уходит в архив сама

Type: task
Status: open
Blocked by: None — can start immediately
Source: owner 2026-11-25: «они не должны архивироваться вообще пока пользователь сам ее не кинет в архив».

**What to build:** автоархив законченных Session (ADR-0076) никогда не берёт Node Product Session, что бы ни стояло в
Settings → Canvas «Archive finished sessions after». В архив её отправляет только Archive самого пользователя на этой
Node; Restore работает как раньше. Product Session, которые уже ушли в архив, сами не возвращаются.

## Что происходит

Product Session, простоявшая дольше порога «Archive finished sessions after» (или с правилом `ticket-done`, или по
«Archive finished sessions now»), уходит в архив вместе с обычными законченными Session. Владелец хочет, чтобы она
оставалась на Canvas, пока он сам её не заархивирует.

## Где в коде

- `src/main/layout/archive.ts` — `AutoArchiver`, `archiveCandidates`, правило `ticket-done`, `candidatesNow`
  (`layout.archiveCandidates`, «Archive finished sessions now»), `archiveFromScreen`. Product Session распознаётся
  уже существующим предикатом (тем, по которому её узнают экран Product Session и sidebar), второй не заводится.
- Unit и contract test-ы архива: `test/unit/*archive*`, `test/contract/*archive*`.
- `docs/adr/0076-*.md` — Amendment 2026-11-25 (одна-две фразы; бриф его называет).
- `docs/features/` — страница, которая описывает автоархив (en и `docs/features/ru/`).

## Готово, когда

- [ ] archiveCandidates никогда не возвращает Node Product Session — при любом пороге, при правиле ticket-done и в
  «Archive finished sessions now»; unit test красный на origin/main, зелёный здесь.
- [ ] Ручной Archive на Node Product Session по-прежнему архивирует её, Restore возвращает; test.
- [ ] Комментарий в `archive.ts`, ADR-0076 Amendment (дата 2026-11-25, одна-две фразы) и страница `docs/features`,
  которая описывает автоархив (en и ru), говорят, что Product Session не уходит в архив сама.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
- [ ] (вручную) На Mac Stable Product Session, простоявшая дольше порога, остаётся на Canvas.
  - needs: mac stable
