# 05 — Продолжение Session после перезапуска: сообщение-продолжение, очередь на месте, chip и Continue

Type: task
Status: done 2026-11-18T08:04Z
PR: #1987
Blocked by: 01, 03, 04, 16
Source: [spec.md](../spec.md), «Ticket-ы», 5; «Решения по реализации» → «Продолжение Session»; «Вопросы владельцу», Q3 и Q4
(оба — (а), решено без владельца, подтвердить); [critic 2026-11-14](../../../docs/product/critic/worfy-continuity-2026-11-14.md),
возражения 1 и 2; «Решения по test-ам»; «Риски», 1, 2, 3, 5, 6, 8, 10

Кто: агент.

Платформенный Ticket (ADR-0056, пункт 2): поиск прежнего процесса Claude Code копии после падения — процессы и их
родители на macOS и Windows. Глубина ревью — `high`; снимок экрана Node-а.

## Что происходит

- После старта worfy Session-ы, бывшие в turn-е, стоят: никто не говорит им, что turn оборван. Очередь пропадает
  (`docs/features/sessions.md:104`).
- Session Node продолжается через `NodeSessions.start(projectId, nodeId)` (`src/main/agent/node-sessions.ts:283`);
  кнопка продолжения на Node уже есть (`src/renderer/canvas/nodes/SessionNode.tsx:463`, `:645`), chip состояния —
  `:302`. Codex продолжает thread через `thread/resume` (`src/main/vendors/codex/session.ts:972`).
- Текст повтора после ошибки API собирает `retryText` (`src/shared/agent/continue-plan.ts:1031`); исходное сообщение
  снова не уходит.
- Auto-continue молчит, пока Run владеет Session (`src/main/agent/orchestrator-continue.ts:16`); его строки `notice` —
  `:26–29` того же файла.
- Registry отказывает «Session … is already live» (`src/main/agent/session/registry.ts:108`) только о процессах этого
  запуска worfy: процесс Claude Code, оставшийся без родителя после падения, он не видит.
- Как Claude Code продолжает транскрипт с `tool_use` без `tool_result`, отвечает spike 01 (вопрос 6).

## Что делаем

1. Новый модуль `src/main/agent/continuity.ts`: после открытия Project-ов (`src/main/agent/app-orchestrators.ts`)
   читает `live-sessions.json` каждого Project-а (reader Ticket-а 03).
2. Session, которой владеет Run, пропускает: её продолжает Run (Ticket 06).
3. Проверка внешних вызовов функцией Ticket-а 16 — до продолжения. Есть вызов без результата у Session или её
   Interrupted Subagent-а — Session сама не продолжается: строка `notice` «worfy: not continued: `<команда>` may or
   may not have run» и chip с кнопкой Continue.
4. Правило часа и cap: возраст — от последней записи о Session до старта; не больше 2 автоматических продолжений на
   Session за час (счёт — в записи Ticket-а 03). Старше часа или после cap — chip «Interrupted by restart» и Continue.
5. Перед продолжением — прежний процесс Claude Code этой Session не жив. Как найти процесс копии — сверить со
   swap-helper-ом Update-а (`scripts/install-stable.mjs`; `docs/features/updates.md:127–128`). Жив — ждать выхода или
   завершить, только потом продолжать (ADR-0064).
6. Продолжение: Session Node — `NodeSessions.start`, Orchestrator — его `open()`, Codex — `thread/resume`. Затем одно
   сообщение `restartText(...)` — новая функция рядом с `retryText`. Текст английский: worfy перезапустился в 14:05
   (Update, выход или падение), turn оборван; Subagent-ы, ставшие Interrupted, и их Binding-и (Ticket); продолжай с
   того места, Ticket в работе веди по skill-у epic-wave, «How to resume a wave»
   (`harness/skills/epic-wave/SKILL.md:1945`); проверь, что сделала каждая команда, прежде чем повторять её. Если
   worfy обновился — так и сказать (риск 5). Что делать с `tool_use` без `tool_result` — по «Итогу» spike-а 01.
7. Очередь возвращается как была; held — held.
8. Строка `notice` в Session view: «worfy: restarted at 14:05 (update), sent "continue"».
9. Continue на Node — Resume плюс `restartText`.
10. Замки: после продолжения проверить, кто держит замок worktree (`harness/bin/worktree-lock`, срок 60 мин — `:177`)
    и e2e-замок (`scripts/e3-sandbox.sh:399`), и снять замки оборванной Session (риск 6).
11. Английская страница `docs/features/sessions.md`: продолжение, chip, Continue, `notice`; перевод — Ticket 14.

## Готово, когда

- [ ] Unit test `restartText`: причина перезапуска, Subagent-ы с Ticket-ами, просьба проверить команды; исходного
      сообщения в тексте нет.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · fa787ed8eff1b95aa3d6b57a01578625d9b56292
  - evidence: gate pass · `gate fast` exit 0 · mac - · fa787ed8eff1b95aa3d6b57a01578625d9b56292
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Unit test правила часа и cap: 59 мин — продолжается; 61 мин — нет; третье продолжение за час — нет.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · fa787ed8eff1b95aa3d6b57a01578625d9b56292
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test (рядом с `test/contract/node-sessions.test.ts`): Session Node в turn-е, выход, старт → одно
      сообщение-продолжение, очередь held на месте.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · fa787ed8eff1b95aa3d6b57a01578625d9b56292
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test: Session с `git push` без результата (у неё или у Subagent-а) → продолжения нет, строка `notice`
      «not continued», chip и Continue.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · fa787ed8eff1b95aa3d6b57a01578625d9b56292
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test: Session, которой владеет Run, этот модуль не трогает.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · fa787ed8eff1b95aa3d6b57a01578625d9b56292
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test: прежний процесс Session жив → продолжение ждёт его выхода.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · fa787ed8eff1b95aa3d6b57a01578625d9b56292
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test на fake app-server Codex: продолжение через `thread/resume` и одно сообщение.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · fa787ed8eff1b95aa3d6b57a01578625d9b56292
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] e2e test (рядом с `test/e2e/session-resume.spec.ts`): Session Node после SIGKILL worfy продолжается; старше часа
      (часы test-а) — chip «Interrupted by restart», Continue продолжает.
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Английская страница `docs/features/sessions.md` описывает продолжение после перезапуска.
  - evidence: commit pass · worfy-continuity/05: continue a Session after worfy restarts · - - · fa787ed8eff1b95aa3d6b57a01578625d9b56292
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): job Windows в составе `ci-ok` зелёный на head PR до merge.
  - evidence: review pass · PR #1987 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44259603264/job/134663330049 · ci - · 82094242eb43dafb5d45403323544c0ddb0a7238

## Тесты

- `test/unit/continue-plan.test.ts` (`restartText`), новый `test/unit/continuity-rules.test.ts`, contract рядом с
  `test/contract/node-sessions.test.ts`, contract Codex на `test/fixtures/codex-app-server/fake-app-server.mjs`, e2e
  рядом с `test/e2e/session-resume.spec.ts`. Каждый test сначала красный.

## Где в коде

- `src/main/agent/continuity.ts` (новый)
- `src/main/agent/app-orchestrators.ts`
- `src/main/agent/node-sessions.ts`
- `src/main/agent/orchestrator.ts`
- `src/main/vendors/codex/session.ts`
- `src/shared/agent/continue-plan.ts` (`restartText`)
- `src/renderer/canvas/nodes/SessionNode.tsx`
- `test/unit/continue-plan.test.ts`, `test/unit/continuity-rules.test.ts` (новый)
- `test/contract/` (новые сценарии), `test/e2e/` (новый test)
- `docs/features/sessions.md`

Только читать: `src/shared/agent/unknown-side-effects.ts` (Ticket 16), `src/shared/agent/live-sessions.ts` (Ticket 03),
`src/main/agent/session/registry.ts`, `scripts/install-stable.mjs`, `harness/bin/worktree-lock`.

## Вне скоупа

- Session-ы под Run-ом — Ticket 06; метка Ticket-а и toast — Ticket 07; Session-ы из терминала и Claude desktop
  (spec, «Не в этом Epic-е»).
