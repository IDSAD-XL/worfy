# 14 — Документы: переводы страниц Feature, Amendment к ADR-0050, новый ADR, термины CONTEXT.md

Type: task
Status: done 2026-11-18T13:00Z
PR: #1999
Blocked by: 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 16
Source: [spec.md](../spec.md), «Ticket-ы», 14; «Готово, когда», пункт о документах; «Решено без владельца», 5;
[critic 2026-11-14](../../../docs/product/critic/worfy-continuity-2026-11-14.md), «What the critic cannot know» (ADR-0010)

Кто: агент.

Не платформенный Ticket (документы). Глубина ревью — `low`.

## Что происходит

- Английские страницы Feature правят Ticket-ы своего поведения (ADR-0088): `autopilot-faults.md` (02, 04, 06, 07),
  `storage-and-diagnostics.md` (03), `sessions.md` (04, 05, 12), `autopilot.md` (06), `updates.md` (08),
  `flight-recorder.md` и `work-track.md` (09), `skills-agents-and-hooks.md` (10, 11). Перевод в PR с поведением не
  считается, поэтому `docs/features/ru/` отстаёт.
- ADR-0050 записал, что `resumable` живёт в памяти main (`docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md:67`),
  и отложил хранение в Journal-е (`:86`). Ticket 02 это меняет.
- Продолжения после перезапуска нет ни в одном ADR. ADR-0010 говорит, что состояние Session — только в памяти; critic
  отметил, что spec его не называет.
- В CONTEXT.md нет причины Wait-а `restart` и слов «unknown side effects».

## Что делаем

1. Переводы в `docs/features/ru/`: `sessions.md`, `autopilot.md`, `autopilot-faults.md`, `updates.md`,
   `flight-recorder.md`, `work-track.md`, `skills-agents-and-hooks.md`, `storage-and-diagnostics.md` — по английским
   страницам на `main`.
2. Amendment к ADR-0050 (датированный): `resumable` и Ticket-ы Wave в работе читаются из Journal-а (Ticket 02).
3. Новый ADR о продолжении после перезапуска: `run-suspended` и `run-continued`, `live-sessions.json`, grace до 60 с,
   правило часа и cap 2, unknown side effects ждёт человека (Q1–Q5 — (а)).
4. ADR-0010: сверить; если `live-sessions.json` расходится с его текстом — Amendment, иначе строка в новом ADR, почему
   нет.
5. CONTEXT.md: причина Wait-а `restart`; «unknown side effects»; при необходимости «Interrupted by restart».

## Готово, когда

- [ ] Восемь страниц `docs/features/ru/` совпадают по смыслу с английскими на `main` (review по каждой).
  - evidence: commit pass · worfy-continuity/14: Russian Feature pages, ADR-0108, ADR-0050/0010 amendments, CONTEXT terms · - - · efe0448851b833de7ab8933e3a0580d39547f095
  - evidence: review pass · PR #1999 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Amendment к ADR-0050 и новый ADR влиты; ADR-0010 сверен, итог — в ADR.
  - evidence: commit pass · worfy-continuity/14: Russian Feature pages, ADR-0108, ADR-0050/0010 amendments, CONTEXT terms · - - · efe0448851b833de7ab8933e3a0580d39547f095
  - evidence: review pass · PR #1999 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] CONTEXT.md называет причину Wait-а `restart` и «unknown side effects».
  - evidence: commit pass · worfy-continuity/14: Russian Feature pages, ADR-0108, ADR-0050/0010 amendments, CONTEXT terms · - - · efe0448851b833de7ab8933e3a0580d39547f095
  - evidence: review pass · PR #1999 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `node scripts/check-personal.mjs` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `node scripts/check-personal.mjs` exit 0 · mac - · deb9d782af184b237a9fa6c381a691904d9b0578
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44304990854/job/134805990333 · ci - · 7706e900726027326719249f16fd678831c1fa4a

## Где в коде

- `docs/features/ru/sessions.md`, `docs/features/ru/autopilot.md`, `docs/features/ru/autopilot-faults.md`,
  `docs/features/ru/updates.md`, `docs/features/ru/flight-recorder.md`, `docs/features/ru/work-track.md`,
  `docs/features/ru/skills-agents-and-hooks.md`, `docs/features/ru/storage-and-diagnostics.md`
- `docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md`
- `docs/adr/` (новый ADR, номер — по резерву)
- `docs/adr/0010-orchestrator-state-session-id-and-cost-only.md`
- `CONTEXT.md`

## Вне скоупа

- Английские страницы — в Ticket-ах поведения.

## Итог

Сделано 2026-11-18, ветка `worfy-continuity/14`.

- **Переводы.** Восемь страниц `docs/features/ru/` сверены с английскими на `main` (`b82c4d25`) целиком, а не только по
  diff-у Ticket-ов 02–12 и 16: `sessions.md`, `skills-agents-and-hooks.md`, `updates.md` и `storage-and-diagnostics.md`
  отставали и раньше (Vendor, Codex, Product Session, skill-ы Matt Pocock, `critic`, сборка Update, PR inbox, Code
  stories), они дополнены до полной сверки. Строка «Перевод … commit» на всех восьми — `b82c4d25`.
- **Ticket 13 (PR #1996, не влит).** Абзац об eval-кейсе `compaction-state` переведён в конец
  `docs/features/ru/skills-agents-and-hooks.md` и в `docs/features/ru/harness.md` (там же «двадцать три» кейса и строка
  `verdict` в таблице скриптов). Остальное отставание `ru/harness.md` (раздел On Codex и др.) — вне этого Ticket-а.
- **ADR.** Новый [ADR-0108](../../../docs/adr/0108-work-continues-after-a-restart-of-worfy.md); Amendment к ADR-0050
  (`resumable` из journal-а); ADR-0010 сверен — фраза «состояние Session только в памяти» расходится с
  `live-sessions.json`, поэтому Amendment, а не строка в ADR-0108.
- **CONTEXT.md.** Причина Wait-а `restart`, термины Unknown side effects и Interrupted by restart, И1–И10 в Recovery
  invariant.
- Английская страница не говорит, что строка Resume/Discard стоит только в рамке своего Epic-а; это записано в ADR-0108
  по коду (`src/renderer/canvas/actions/AutopilotAction.tsx`), перевод следует английской странице.
