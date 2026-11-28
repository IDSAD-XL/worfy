# 10: Отказы guard в Journal и Run history; кнопка владельца

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), «Ticket-ы», 10; «Набросок функции» (шаги 3 и 6, блок Guard, вид PR); «Решения по
реализации» («`land`: пути проверок, draft, `land --check`» — отметка `owner`; «Отказы guard в Journal и Run history»);
«Риски» («Отметка владельца на GitHub»); «Вопросы владельцу», Q3 (а); «Волны», Wave 3;
[critic 2026-11-28](../../../docs/product/critic/worfy-harness-guarantees-2026-11-28.md), возражение 1 и «Alternative»

Кто: агент. Глубина ревью — `high`: вторая запись main-процесса на GitHub, кроме ответов на review.

Платформенный PR (ADR-0056, пункт 2): правка `harness/bin/land` — скрипт Harness; до merge нужен Windows verdict.

## Что происходит

- Отказ guard-а сегодня видит только агент: Journal Run-а и Run history о нём молчат.
- По Q3 (а) PR, который дописывает путь проверки в trail Ticket-а, ждёт отметки владельца. Ticket 04 такой PR только
  называет в строке `land`: требование отметки перенесено сюда, к кнопке, которая её пишет (решение владельца
  2026-11-28, critic, возражение 1).
- Строку отказа пишет `deny()` guard-а в файл из `WORFY_GUARD_LOG` (Ticket 03, та же Wave): время, id правила, агент,
  Ticket, сокращённая команда. Формат — в spec-е («Один helper отказа»); этот Ticket читает его по fixture-у, а Ticket 03
  пишет его в шапку `guard.mjs`. Какой из двух PR сольётся вторым, тот сверяет fixture с шапкой.

## Что строить

- `WORFY_GUARD_LOG` — файл в данных Run-а — в окружении Session-ов, которые запускает worfy: Claude (`sessionEnv`,
  `src/main/vendors/claude/options.ts:780`) и Codex (окружение Run-а, `src/main/vendors/codex/session.ts:962`).
- Строки файла переносятся в Journal Run-а новым видом `guard-deny` (список видов
  `src/shared/autopilot/journal.ts:476`, как `auto-approval` — `:656`).
- Run history (`src/renderer/flight-recorder/RunHistoryView.tsx`, `DetailPanel.tsx`): блок Guard и строка в конце Run-а.

  ```text
  Guard · 2 refused
    10:14  impl-07        verification path outside the trail   Write .github/workflows/ci.yml
    10:31  Orchestrator   merge outside land                    gh pr merge 1851 --admin
  ```

- Кнопка Allow verification change в виде PR (PR inbox, правая панель — `docs/features/pr-inbox.md:88-96`,
  `src/renderer/pr-inbox/PrInboxView.tsx`) у PR, который дописывает путь проверки в trail:

  ```text
  #1852  Docs: trail of worfy-x 07                       CI ✓   Review ✓
  Verification paths: adds .github/workflows/ci.yml to the trail of worfy-x 07
  [Allow verification change]
  ```

  По щелчку main-процесс пишет commit status `owner` на head PR. Код записи — один модуль в `src/main/github/`, как у
  ответа на review (`src/main/github/pr-reply-send.ts`, ADR-0105 `:51-52`) и у отправки review
  (`src/main/github/pr-review-submit.ts`, ADR-0112): ничего не пишется без щелчка.
- `land` (`harness/bin/land`, `ready()` `:755-764`, `statuses` `:359`): PR, который расширяет trail на путь проверки,
  ждёт commit status `owner` на head — `waits — the owner's mark: verification paths added to the trail of <epic> <NN>`.
- Тексты UI — на английском (ADR-0074).

## Где в коде

- `src/main/vendors/claude/options.ts` — `sessionEnv` `:780`
- `src/main/vendors/codex/session.ts` — окружение Run-а `:962`
- `src/shared/autopilot/journal.ts` — виды `:476`, событие `auto-approval` `:656` как образец
- `src/main/autopilot/` — перенос строк `WORFY_GUARD_LOG` в Journal (файл — по месту, где Run пишет Journal)
- `src/renderer/flight-recorder/RunHistoryView.tsx`, `src/renderer/flight-recorder/DetailPanel.tsx`
- `src/renderer/pr-inbox/PrInboxView.tsx` — кнопка Allow verification change
- `src/main/github/owner-mark.ts` (новый, имя — предложение) — запись commit status `owner`
- `src/main/ipc/pr-inbox.ts` — канал щелчка
- `harness/bin/land` — требование `owner`; `harness/bin/tests/land.test.sh`
- `test/fixtures/guard-log/` (новый fixture строк отказа, имя — предложение)
- `test/unit/` — Journal `guard-deny`, блок Guard, запись `owner` только по щелчку (новые файлы, имена — предложение)
- `test/e2e/flight-recorder.spec.ts` — блок Guard в Run history
- Только читать: `docs/adr/0105-pr-reply-only-on-the-users-click.md`, `docs/adr/0112-pr-review-submit-only-on-the-users-click.md`

## Test-ы

- Unit: строки fixture-а `WORFY_GUARD_LOG` дают записи Journal `guard-deny`; блок Guard рисует их по времени и агенту.
- Unit: commit status `owner` пишется только по щелчку; ни чтение, ни открытый вид PR записи не делают.
- `land.test.sh`: PR, который расширяет trail на путь проверки, без `owner` ждёт; с `owner` на head — проходит.
- E2e: блок Guard в Run history (агент — `WORFY_AGENT=fake`).
- Сначала падающий test: красный на старом поведении, это пишется в «Итог».
- Без моделей и без сети: gh stand-in.

## Готово, когда

- [ ] worfy задаёт `WORFY_GUARD_LOG` Session-ам Claude и Codex; отказы guard-а попадают в Journal Run-а видом
      `guard-deny`.
- [ ] Run history показывает блок Guard (время, агент, правило, команда) и строку в конце Run-а.
- [ ] Вид PR, который дописывает путь проверки в trail, показывает Allow verification change; щелчок пишет commit status
      `owner` на head, без щелчка записи нет.
- [ ] `land` ждёт отметки `owner` у PR, который расширяет trail на путь проверки (shell test).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.
