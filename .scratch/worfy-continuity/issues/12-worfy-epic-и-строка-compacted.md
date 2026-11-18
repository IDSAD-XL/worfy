# 12 — worfy: `WORFY_EPIC`, дописка к system prompt, Codex `compact_prompt`, строка «Context compacted»

Type: task
Status: done 2026-11-18T10:16Z
PR: #1991
Blocked by: 11
Source: [spec.md](../spec.md), «Ticket-ы», 12; «Решения по реализации» → «Compaction», пункт «worfy (12)»; «Истории
пользователя», 10; «Риски», 13

Кто: агент.

Не платформенный Ticket (main process, driver-ы, renderer). Глубина ревью — `medium`; снимок экрана строки в Session view.

## Что происходит

- Окружение Session собирает `sessionEnv` (`src/main/vendors/claude/options.ts:745`); переменная вида Session —
  `WORFY_SESSION_KIND` (`:400`). Epic-а в окружении нет.
- Дописка к system prompt — поле `instructions` (`options.ts:396`), уходит в конец (`:824`).
- Codex: `config` уже уходит в `thread/start` (`src/main/vendors/codex/session.ts:961–967`); `compact_prompt` — поле
  `Config` протокола (`src/main/vendors/codex/protocol/ts/v2/Config.ts:25`). Когда Codex сжимает контекст, worfy не
  знает (`src/main/vendors/codex/items.ts:123`).
- На `compact_boundary` worfy только заново спрашивает заполнение контекста
  (`src/main/vendors/claude/session.ts:535–536`): ни строки в Session view.
- Session Orchestrator-а для Wave запускает `src/main/actions/launch.ts` (`waveBriefText` — `:139`).

## Что делаем

1. `WORFY_EPIC` в окружении Session Orchestrator-а, которую запустил Run или действие «Run wave», рядом с
   `WORFY_SESSION_KIND`.
2. Epic и Ticket-ы Wave — ещё и в дописке к system prompt (`instructions`), если «Итог» spike-а 01 (вопрос 4) показал,
   что она переживает compaction. Иначе — не добавлять и записать причину в «Итог».
3. Codex: `compact_prompt` с инструкциями Ticket-а 10 в `config` thread-а; если spike показал, что элемент
   `contextCompaction` приходит, — та же строка в Session view.
4. На `compact_boundary` Session view показывает строку «Context compacted (auto) · 812K → 41K» из `compact_metadata`:
   `trigger`, `pre_tokens` и `post_tokens`, когда он есть.
5. Английская страница `docs/features/sessions.md`: строка «Context compacted»; перевод — Ticket 14.

## Готово, когда

- [ ] Unit test `sessionEnv`: Session Wave-а несёт `WORFY_EPIC`; обычная Session — нет.
  - evidence: test-run pass · `pnpm test test/unit/agent-options.test.ts test/contract/orchestrator-wave-epic.test.ts` exit 0 · mac - · 6fc7043ee2491118cb80f50c7f2255c7ecc49698
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/agent-options.test.ts test/contract/orchestrator-wave-epic.test.ts test/contract/app-orchestrators.test.ts test/contract/codex-session.test.ts` exit 0 · mac - · e4823794515716704c68a32beb97a969cb00b378
- [ ] Unit test: `compact_boundary` с `compact_metadata` даёт строку «Context compacted (auto) · 812K → 41K»; без
      `post_tokens` — без второго числа.
  - evidence: test-run pass · `pnpm test test/unit/claude-compact-line.test.ts` exit 0 · mac - · 6fc7043ee2491118cb80f50c7f2255c7ecc49698
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/claude-compact-line.test.ts test/contract/agent-compacted-line.test.ts` exit 0 · mac - · e4823794515716704c68a32beb97a969cb00b378
- [ ] Contract test на fake agent (`WORFY_AGENT=fake`): сценарий с `compact_boundary` — строка в событиях Session view.
  - evidence: test-run pass · `pnpm test test/contract/agent-compacted-line.test.ts` exit 0 · mac - · 6fc7043ee2491118cb80f50c7f2255c7ecc49698
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/claude-compact-line.test.ts test/contract/agent-compacted-line.test.ts` exit 0 · mac - · e4823794515716704c68a32beb97a969cb00b378
- [ ] Contract test на fake app-server Codex: `compact_prompt` в `config` `thread/start`.
  - evidence: test-run pass · `pnpm test test/contract/codex-session.test.ts` exit 0 · mac - · 6fc7043ee2491118cb80f50c7f2255c7ecc49698
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/agent-options.test.ts test/contract/orchestrator-wave-epic.test.ts test/contract/app-orchestrators.test.ts test/contract/codex-session.test.ts` exit 0 · mac - · e4823794515716704c68a32beb97a969cb00b378
- [ ] Английская страница `sessions.md` описывает строку «Context compacted».
  - evidence: commit pass · worfy-continuity/12: WORFY_EPIC of a Wave, Codex compact_prompt, the "Context compacted" line · - - · 6fc7043ee2491118cb80f50c7f2255c7ecc49698
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 6fc7043ee2491118cb80f50c7f2255c7ecc49698
  - evidence: gate pass · `gate fast` exit 0 · mac - · e4823794515716704c68a32beb97a969cb00b378
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44272317747/job/134729653547 · ci - · 99d23491ab16011764cbe533dc1784f1ea7b34fe

## Тесты

- Unit для `src/main/vendors/claude/options.ts` и `src/shared/vendors/claude/events.ts`; сценарий fake agent в
  `test/fixtures/agent-scripts/`; contract Codex на `test/fixtures/codex-app-server/fake-app-server.mjs`. Каждый test
  сначала красный.

## Где в коде

- `src/main/vendors/claude/options.ts`
- `src/main/actions/launch.ts`
- `src/main/vendors/claude/session.ts`
- `src/shared/vendors/claude/events.ts`
- `src/main/vendors/codex/session.ts`, `src/main/vendors/codex/items.ts`
- `src/renderer/session/` (строка в Session view)
- `test/fixtures/agent-scripts/` (новый сценарий)
- `docs/features/sessions.md`

Только читать: «Итог» Ticket-а 01, `harness/hooks/rules/compaction.md` (Ticket 10).

## Вне скоупа

- Своё сжатие контекста («якорные» summary) — вне Epic-а.

## Итог

Сделано 2026-11-18, ветка `worfy-continuity/12`.

- **Пункт 1 — `WORFY_EPIC`.** Посылка тикета, что Session Orchestrator-а для Wave запускает `src/main/actions/launch.ts`,
  не подтвердилась: `sendWave` только отправляет текст в Session, которую уже запустил `src/main/agent/orchestrator.ts`,
  а окружение процесса фиксируется при его старте. Поэтому Epic берёт сам Orchestrators при каждом старте unattended
  Session (`waveEpic` → `Autopilot.runningEpic`): при старте Run-а и для новой SDK session перед каждой следующей Wave,
  в том числе при переходе на следующий Epic очереди. `launch.ts` и `run.ts` не тронуты. Связь с Autopilot — через
  динамический `import('../ipc/autopilot')` в `app-orchestrators.ts`, как в `browser-server.ts`: статический импорт дал
  бы цикл.
- **Ограничение.** «Run wave» руками в уже запущенный attended Orchestrator `WORFY_EPIC` не даёт: окружение процесса
  задано при старте, а перезапускать Orchestrator ради переменной worfy не станет. Там hook `after-compact` берёт Epic
  ветки checkout-а, иначе первый из Epics in play (Ticket 11). Attended Orchestrator — открытый человеком или отданный
  после Run-а — Epic-а не несёт.
- **Известное ограничение (не чинили, второй раунд PR).** В очереди Epic-ов первая Wave следующего Epic-а может уйти в ту
  же Session: `newSession` (`src/main/autopilot/run.ts`) отвечает `same`, когда Orchestrator занят (turn, фоновая задача,
  очередь сообщений). Эта Session хранит `WORFY_EPIC` и строку system prompt прежнего Epic-а, и hook `after-compact` после
  compaction даёт wave-brief прежнего Epic-а — пока Run не начнёт новую session для следующей Wave. Записано и в
  `docs/features/sessions.md`.
- **Второй раунд PR, test-ы.** Связка `waveEpic` → `Autopilot.runningEpic` в `app-orchestrators.ts` теперь проверена
  `test/contract/app-orchestrators.test.ts` (настоящий `sharedAutopilot()`, `runningEpic` подменён); бросающий и пустой
  ответ `waveEpic` — `test/contract/orchestrator-wave-epic.test.ts`; пустой `epic` без строки prompt —
  `test/unit/agent-options.test.ts`. Каждый test красный на своём мутанте (5 мутантов, копия ветки).
- **Пункт 2 — дописка к system prompt.** Добавлена: «Итог» Ticket-а 01, вопрос 4, — дописка переживает compaction главной
  Session (`system_prompt_append_after: True` и при `/compact`, и при auto-compaction). Строка называет только Epic и
  просит запустить `wave-brief <epic>`; Ticket-ов Wave в ней нет: Session стартует до того, как Run прочитал Ticket-ы
  Wave (`newSession` идёт перед `autopilotWave`), и одна Session может вести несколько Wave.
- **Пункт 3 — Codex.** `compact_prompt` в `config` и `thread/start`, и `thread/resume` — полный prompt: строка с задачей
  и `harness/hooks/rules/compaction.md` целиком (по «Итогу» 01, вопрос 5, это замена prompt-а Codex, не дописка). Он же
  перекрывает `compact_prompt` из config.toml пользователя для thread-ов, которые запускает worfy. Элемент
  `contextCompaction` приходит (записанный трафик Codex 0.166.0, `test/fixtures/codex-messages/compact.jsonl`) — на него
  та же строка, но без trigger и чисел: в элементе их нет. Codex Orchestrator тоже получает `WORFY_EPIC` в окружении
  app-server.
- **Пункт 4 — строка.** `compact_boundary` → notice «Context compacted (auto) · 812K → 41K»; без `post_tokens` — без
  второго числа. Числа пишутся как в Context meter. После повторного открытия Session из транскрипта строки нет:
  разбор транскрипта (`src/shared/transcript/parse.ts`) вне следа тикета.
- **Долг Ticket-а 11 закрыт:** `harness/hooks/tests/session-hooks.test.sh` проверяет, что `WORFY_EPIC` идёт раньше Epic-а
  ветки; без этого правила в `after-compact.mjs` проверка красная (прогон на копии harness).
- **Снимок экрана строки** не сделан: Electron и e2e на этом Mac агентам запускать нельзя (правило владельца
  2026-11-11); снимок — в приёмку владельцем (Ticket 15).
- **Файлы вне списка** (согласованы с Orchestrator-ом): `src/main/agent/orchestrator.ts`,
  `src/main/agent/app-orchestrators.ts`, `src/main/agent/session-settings.ts`, `src/main/agent/session.ts`,
  `src/main/agent/session/types.ts`, `src/main/vendors/claude/query.ts`, `src/main/vendors/session.ts`,
  `harness/hooks/tests/session-hooks.test.sh`.
