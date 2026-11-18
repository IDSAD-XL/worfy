# Code story — worfy-continuity 14: Документы: переводы страниц Feature, Amendment к ADR-0050, новый ADR, термины CONTEXT.md

Kind: pr · Epic: worfy-continuity · Ticket: 14 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 02–12 и 16 поменяли выход из worfy, продолжение Run-а и Session после перезапуска, метку unknown side effects,
Update во время работы и compaction, но правили только английские страницы Feature (ADR-0088). `docs/features/ru/`
отстал. ADR-0050 всё ещё говорил, что `resumable` живёт в памяти main, ADR-0010 — что состояние Session только в памяти,
а решения о продолжении после перезапуска не было ни в одном ADR. В CONTEXT.md не было причины Wait-а `restart` и слов
«unknown side effects».

- Требование: [Что происходит](../issues/14-документы-перевод-adr-context.md#что-происходит)

## 2. Новый ADR-0108: unknown side effects ждут человека

Code: `docs/adr/0108-work-continues-after-a-restart-of-worfy.md:47-56` · key lines: 47, 51, 54

```markdown
7. **Unknown side effects ждут человека (Q4 (а); Ticket-ы 16 и 07).** Ticket, у implementer-а которого внешний вызов
   без результата, в продолженную Wave не идёт: он остаётся в `claimed`, получает метку **unknown side effects** с
   tooltip-ом о вызове и toast с **Checked, include**. Метка — строка journal-а `unknown-side-effects {ticket, actions}`,
   снимает её `side-effects-checked`. Метки живут в journal-е, поэтому переживают перезапуск и переходят к следующему
   Run-у того же Epic-а. Вызов без результата у самого Orchestrator-а или у Subagent-а, не привязанного ни к одному
   Ticket-у, удерживает все Ticket-ы Wave. Discard сначала читает вызовы оборванной Wave и помечает удержанные
   Ticket-ы до `run-stopped`.
   worfy не сверяет git и GitHub сам: включить Ticket — всегда решение человека. Читаются только транскрипты Claude
   Code: на Orchestrator-е Codex ни один Ticket не удерживается. Новый Recovery invariant I10: Ticket, помеченный
   `unknown-side-effects`, не входит ни в одну более позднюю `wave-started` до своего `side-effects-checked`.
```

- Что делает: записывает решение Q4 (а): Ticket с внешним вызовом без результата ждёт человека, метка живёт в journal-е и переходит к следующему Run-у, Discard помечает удержанные Ticket-ы, Codex Orchestrator Ticket-ов не держит, вызов Orchestrator-а или Subagent-а без Ticket-а держит все Ticket-ы Wave, и называет новый Recovery invariant I10.
- Почему здесь: Ticket просит новый ADR о продолжении после перезапуска ([Что делаем, п. 3](../issues/14-документы-перевод-adr-context.md#что-делаем)); номер 0108 дал preflight.
- Без него: решение «включить Ticket — всегда решение человека» было бы только в spec-е с пометкой «подтвердить» и в коде.
- Требование: [Что делаем, п. 3](../issues/14-документы-перевод-adr-context.md#что-делаем)
- Риски и пробелы test-ов: ADR пересказывает страницы и код; что каждая фраза верна коду, проверяет только чтение. Что строка Resume/Discard стоит только в рамке своего Epic-а, английская страница не говорит; пункт 6 ADR берёт это из `src/renderer/canvas/actions/AutopilotAction.tsx`.

## 3. Amendment к ADR-0050: `resumable` из journal-а

Code: `docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md:100-110` · key lines: 101, 102, 106

```markdown
- **2026-11-18 — `resumable` и Ticket-ы Wave в работе читаются из journal-а** (worfy-continuity 02, PR #1971; документы —
  worfy-continuity 14, ADR-0108). Отложенный вариант «Хранить `resumable` в журнале и читать при старте приложения»
  выбран: старт Run-а берёт `resumable` из checkpoint-а — reader-а journal-ов Run-ов Project-а
  (`src/shared/autopilot/checkpoint.ts`), а не из памяти main, поэтому список переживает перезапуск приложения. Из тех же
  строк (`wave-started`, `ticket-status`) читаются номер Wave и её Ticket-ы в работе; ими пользуется продолжение
  оборванного Run-а (ADR-0108). Последствие «`resumable` живёт в памяти main» больше не действует. Оборванный Run
  (последняя строка — `run-suspended` или `run-stopped` нет вовсе) не оставляет ничего `resumable`, пока его не
  продолжили или не отбросили; Discard пишет `run-stopped` с причиной `discarded`, и Ticket-ы его Wave в работе
  становятся `resumable`, как после Force stop. Ticket с меткой `unknown-side-effects` не `resumable` до своего
  `side-effects-checked`. Выход больше не ждёт 3 s, пока Run запишет `app-quit`: Run приостанавливается с
  `run-suspended` (ADR-0108). Остальное решение в силе.
```

- Что делает: отмечает, что отложенный вариант «хранить `resumable` в журнале» выбран Ticket-ом 02, и отменяет последствие «`resumable` живёт в памяти main»; текст принятого ADR не тронут.
- Почему здесь: Ticket называет Amendment к ADR-0050 ([Что делаем, п. 2](../issues/14-документы-перевод-adr-context.md#что-делаем)); изменение решения дописывается датированным разделом `## Amendments` (правило ADR проекта).
- Без него: ADR-0050 противоречил бы коду (`src/shared/autopilot/checkpoint.ts`).
- Требование: [Что делаем, п. 2](../issues/14-документы-перевод-adr-context.md#что-делаем)
- Риски и пробелы test-ов: not recorded.

## 4. Сверка ADR-0010: Amendment, а не строка в ADR-0108

Code: `docs/adr/0010-orchestrator-state-session-id-and-cost-only.md:36-41` · key lines: 36, 39, 40

```markdown
- **2026-11-18, ADR-0108** (`worfy-continuity` 03, PR #1970; сверка — `worfy-continuity` 14). Фраза «Состояние Session
  живёт только в памяти» больше не верна. Состояние живых Session-ов — идёт ли turn, очередь сообщений, удержана ли
  она, Run-владелец, время последнего события и продолжения за час — main пишет в `live-sessions.json` в подпапке
  Project-а (папка данных worfy, ADR-0005), чтобы после перезапуска worfy продолжить оборванные Session-ы. Это не Layout:
  `data` Node-а `orchestrator` в `layout.json` по-прежнему несёт только `sessionId`, `costUsd` и `vendor`, а модель и
  блок состояния по-прежнему читаются из транскрипта. Остальное решение в силе.
```

- Что делает: признаёт, что фраза «Состояние Session живёт только в памяти» больше не верна из-за `live-sessions.json`, и оставляет в силе решение о Layout (`sessionId`, `costUsd`, `vendor`).
- Почему здесь: Ticket велит при расхождении с `live-sessions.json` дописать Amendment, иначе строку в новом ADR ([Что делаем, п. 4](../issues/14-документы-перевод-adr-context.md#что-делаем)). Расхождение есть.
- Без него: ADR-0010 говорил бы обратное тому, что делает Ticket 03.
- Требование: [Что делаем, п. 4](../issues/14-документы-перевод-adr-context.md#что-делаем)
- Риски и пробелы test-ов: not recorded.

## 5. Термин Unknown side effects в CONTEXT.md

Code: `CONTEXT.md:139-141` · key lines: 139, 141

```markdown
**Unknown side effects**:
Метка Ticket-а, у implementer-а которого после перезапуска worfy остался внешний вызов без результата (`git push`, `gh pr merge`, вызов MCP server-а, Subagent): он мог выполниться, а мог и нет. Такой Ticket в продолженную Wave не идёт и остаётся в `claimed` для человека; метку и toast снимает только его «Checked, include». Метка — строка Journal-а `unknown-side-effects`, снятие — `side-effects-checked`; открытая метка переходит к следующему Run-у того же Epic-а ([ADR-0108](docs/adr/0108-work-continues-after-a-restart-of-worfy.md)).
_Avoid_: неизвестные побочные эффекты, side effects без «unknown», in-flight (это отказ повтора Auto-continue), dirty
```

- Что делает: вводит термин с _Avoid_; в том же PR Wait получил причину `restart`, появился термин Interrupted by restart, Recovery invariant — И1–И10.
- Почему здесь: Ticket называет причину Wait-а `restart`, «unknown side effects» и, при необходимости, «Interrupted by restart» ([Что делаем, п. 5](../issues/14-документы-перевод-adr-context.md#что-делаем)).
- Без него: метку путали бы с отказом `in-flight` у Auto-continue, а chip Session Node-а — со статусом Interrupted Subagent-а.
- Требование: [Готово, когда](../issues/14-документы-перевод-adr-context.md#готово-когда)
- Риски и пробелы test-ов: not recorded.

## 6. Перевод: Recovery invariant I10 на русской странице

Code: `docs/features/ru/autopilot-faults.md:418-419` · key lines: 418

```markdown
- **I10.** Ticket, помеченный строкой `unknown-side-effects`, не входит ни в одну более позднюю `wave-started` — ни своего run-а, ни
  более позднего — до его `side-effects-checked`.
```

- Что делает: один пример перевода: правило I10 Ticket-а 07 на русской странице, рядом с изменёнными I3, I4, I6 и I8.
- Почему здесь: Ticket называет восемь страниц `docs/features/ru/` ([Что делаем, п. 1](../issues/14-документы-перевод-adr-context.md#что-делаем)).
- Без него: русская страница называла бы I1–I9 и не знала бы о метке.
- Требование: [Готово, когда](../issues/14-документы-перевод-adr-context.md#готово-когда)
- Риски и пробелы test-ов: `scripts/check-feature-docs.mjs` русские страницы не читает; совпадение по смыслу проверяет только review.

## 7. Что сознательно не меняли

`sessions.md`, `skills-agents-and-hooks.md`, `updates.md` и `storage-and-diagnostics.md` отставали и до Epic-а; они
сверены целиком, поэтому их метка перевода — `b82c4d25`. `ru/harness.md` получил только абзац Ticket-а 13 и строку
`verdict`; его прочее отставание (раздел On Codex) осталось, поэтому метка — `229013fd`, и `feature-docs-lag.mjs`
его показывает. Английские страницы не тронуты.

## 8. Как проверено

`node scripts/check-personal.mjs`, `node scripts/check-feature-docs.mjs`, `node scripts/check-handoff.mjs`,
`node scripts/feature-docs-lag.mjs` — exit 0; ссылки и anchor-ы восьми страниц, `ru/harness.md`, ADR-0108 и CONTEXT.md
проверены скриптом — битых нет, кроме давнего `harness.md#in-codex` в `ru/autopilot.md`. `pnpm lint`, `pnpm typecheck`,
`pnpm test` и gate fast — в отчёте implementer-а с exit code-ами.

## Проверить себя

1. Почему ADR-0010 получил Amendment, а не строку в ADR-0108 «почему нет»?
   - Ответ: его фраза «Состояние Session живёт только в памяти» расходится с `live-sessions.json`; решение о Layout при этом в силе.
   - Строки: `docs/adr/0010-orchestrator-state-session-id-and-cost-only.md:36-41`
2. Почему Ticket с unknown side effects не включается сам, даже если push на самом деле прошёл?
   - Ответ: по Q4 (а) worfy не сверяет git и GitHub сам — такая проверка может ошибиться в обе стороны; включает только «Checked, include» человека.
   - Строки: `docs/adr/0108-work-continues-after-a-restart-of-worfy.md:47-56`
3. Почему метка `ru/harness.md` не стала `b82c4d25`?
   - Ответ: страница переведена не целиком; новая метка спрятала бы её отставание от `feature-docs-lag.mjs`.
   - Строки: `docs/features/ru/harness.md:3-3`
