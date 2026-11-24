# 07 — Call log Harness, только запись: повторы упавших вызовов считаются, агент ничего не видит

Type: task
Status: done 2026-11-17T07:18Z
PR: #1947
Blocked by: none
Source: [spec.md](../spec.md), «Ticket-ы», 7; «Решение», 3; «Путь пользователя», C; «Решения по реализации» → «Call log
Harness — только запись»; «Вне Epic-а» → «Отложено»; «Решено без владельца», 4, 5 и 6;
[critic](../../../docs/product/critic/worfy-stuck-agents-2026-11-14.md), возражение 1 и «Alternative»

Кто: агент.

Платформенный PR (ADR-0056, пункт 2): новые hook-и и script Harness — до merge нужен вердикт Windows (ADR-0071), job-ы
`windows (harness-scripts …) / full-suite` в составе `ci-ok` на head PR. Глубина ревью — `high`: hook идёт на каждом
вызове tool-а каждого агента.

## Что происходит

- Повторы одной и той же упавшей команды никто не считает. Разбор 2026-10-15 насчитал 0 случаев, но без данных: Journal
  команд не пишет (`docs/research/2026-10-15-застрявшие-ticket-ы.md:113–115`, `:149–152`). Условие вернуться к детектору —
  три и больше случаев (`:198`). Этот Ticket даёт счёт; подсказка, отказ и `blocked: loop` — в «Вне Epic-а» spec-а.
- У Harness нет PostToolUse hook-а: в `harness/hooks/hooks.json` PreToolUse (`guard.mjs`, matcher `Bash|apply_patch`,
  `:155–166`) и hook-и Session, gate и Stop.
- Hook input Claude Code: внутри Subagent-а есть `agent_id` (`BaseHookInput`,
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:184–187`); у `PostToolUseFailure` — строка `error` без exit code
  (`sdk.d.ts:2753–2765`). Stop hook берёт `agent_id` только на Codex (`harness/hooks/stop.mjs:150`).
- Codex: у Bash в `tool_response` только вывод, у `apply_patch` текст начинается с `Exit code: 0`
  (`test/fixtures/codex-messages/hooks/PostToolUse.jsonl`). Hook-и одни на оба Vendor-а; Codex выключает hook-и
  обновлённого plugin-а до одобрения в `/hooks` после каждого обновления (`docs/features/harness.md:193`).
- Папка состояния gate-а — `harness/hooks/gate-paths.mjs` (`CLAUDE_GATE_STATE` или `<harness home>/gate/state`).

## Что делаем

1. `harness/hooks/hooks.json`: `PostToolUse` (все tools) и `PostToolUseFailure` → `node
   "${CLAUDE_PLUGIN_ROOT}/hooks/calls.mjs"`, timeout 5 с.
2. `harness/hooks/calls.mjs`:
   - `owner` — Session, у Subagent-а Session и `agent_id` (на обоих Vendor-ах);
   - пишет в `<gate state>/calls/<owner>.jsonl` последние 20 вызовов: tool, хэш нормализованного ввода (команда без
     пробелов по краям; у правки — файл и хэш его содержимого после неё), исход, время;
   - исход: Claude Code — успех (PostToolUse) или неуспех плюс хэш текста `error` (PostToolUseFailure); Codex — exit code,
     где он есть, плюс хэш вывода;
   - зовёт шаблоны; совпадение дописывает в `<gate state>/calls/loops.jsonl`: `would-hint` на 3-м повторе, `would-deny` на
     4-м — один раз на шаблон и `owner`; строка: время, Session, `agent_id`, шаблон, tool, начало команды до 200 символов;
   - ничего не пишет в stdout, всегда exit 0, ошибку чтения или записи глотает;
   - файлы `calls/` старше 7 дней удаляет при записи; `loops.jsonl` держит последние 2000 строк.
3. `harness/hooks/loop-patterns.mjs` — чистый модуль:
   - тот же вызов с тем же неуспешным исходом 3 раза среди последних 20;
   - правка туда и обратно: файл дважды вернулся к содержимому, которое было две правки назад;
   - A-B-A-B: пара вызовов с теми же исходами 3 раза подряд;
   - повтор с новым исходом — не цикл; команды ожидания CI (`gh pr checks`, `gh run watch` и подобные) в счёт не идут.
4. `harness/bin/loop-log [--since <YYYY-MM-DD>]` — печатает случаи `would-deny` (время, Session, шаблон, начало команды) и
   последнюю строку `cases: N (revisit at 3)`. Exit 0; без файла — `cases: 0 (revisit at 3)`.
5. `docs/features/skills-agents-and-hooks.md` (таблица hook-ов, строка `PreToolUse` — `:251`): строка о новом hook-е —
   только запись, агент ничего не видит, где лежат файлы, команда `loop-log`.
6. В «Итог»: время одного вызова `calls.mjs` на fixture (медиана 20 запусков на Mac).

## Готово, когда

- [ ] Shell test `harness/hooks/tests/calls.test.sh`: три одинаковых неуспешных вызова — строка `would-hint` в
      `loops.jsonl`; четвёртый — `would-deny`; stdout hook-а пустой, exit 0 на каждом вызове.
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · 4a934a63fb6e21968922553e9252b7a9674157b1
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · af86654709b1329d9f9dc4925473b94b05d05633
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Shell test: тот же вызов с новым исходом — строки нет; `gh pr checks` четыре раза с ненулевым exit code — строки
      нет.
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · 4a934a63fb6e21968922553e9252b7a9674157b1
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · af86654709b1329d9f9dc4925473b94b05d05633
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Shell test: A-B-A-B три раза — `would-hint`; правка туда и обратно дважды — `would-hint`.
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · 4a934a63fb6e21968922553e9252b7a9674157b1
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · af86654709b1329d9f9dc4925473b94b05d05633
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Shell test: битый JSON на stdin и папка состояния без права записи — exit 0, stdout пустой.
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · 4a934a63fb6e21968922553e9252b7a9674157b1
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · af86654709b1329d9f9dc4925473b94b05d05633
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Shell test: два Subagent-а одной Session (разные `agent_id`) ведут разные `calls/<owner>.jsonl`; в call log не
      больше 20 строк.
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · 4a934a63fb6e21968922553e9252b7a9674157b1
  - evidence: test-run pass · `bash harness/hooks/tests/calls.test.sh` exit 0 · mac - · af86654709b1329d9f9dc4925473b94b05d05633
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Shell test `harness/bin/tests/loop-log.test.sh`: `loop-log` печатает случаи `would-deny` и `cases: N (revisit at
      3)`; `--since` отбрасывает старые; без файла — `cases: 0`.
  - evidence: test-run pass · `bash harness/bin/tests/loop-log.test.sh` exit 0 · mac - · 4a934a63fb6e21968922553e9252b7a9674157b1
  - evidence: test-run pass · `bash harness/bin/tests/loop-log.test.sh` exit 0 · mac - · af86654709b1329d9f9dc4925473b94b05d05633
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Unit test `loop-patterns.mjs` (в `harness/hooks/tests/` или `test/unit/`): три шаблона, «новый исход — не цикл»,
      команды ожидания.
  - evidence: test-run pass · `pnpm test test/unit/loop-patterns.test.ts` exit 0 · mac - · 4a934a63fb6e21968922553e9252b7a9674157b1
  - evidence: test-run pass · `pnpm test test/unit/loop-patterns.test.ts` exit 0 · mac - · af86654709b1329d9f9dc4925473b94b05d05633
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test `test/contract/harness-codex-hooks.test.ts`: строки `PostToolUse.jsonl` Codex (Bash и `apply_patch`)
      дают записи call log с исходом по exit code или хэшу вывода; Codex-input Subagent-а — свой `owner`.
  - evidence: test-run pass · `pnpm test test/contract/harness-codex-hooks.test.ts` exit 0 · mac - · 4a934a63fb6e21968922553e9252b7a9674157b1
  - evidence: test-run pass · `pnpm test test/contract/harness-codex-hooks.test.ts` exit 0 · mac - · af86654709b1329d9f9dc4925473b94b05d05633
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `docs/features/skills-agents-and-hooks.md` называет новый hook и `loop-log`.
  - evidence: commit pass · Harness call log, write only: count repeats of failed calls; loop-log reads them (worfy-stuck-agents 07) · - - · 4a934a63fb6e21968922553e9252b7a9674157b1
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): вердикт Windows до merge.
  - evidence: review pass · PR #1947 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Все `harness/bin/tests/*.test.sh` и `harness/hooks/tests/*.test.sh` зелёные, в том числе `plugin-neutral.test.sh`;
      `node scripts/check-personal.mjs` — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на
      head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44034549684/job/133877292113 · ci - · bd79dad0d98246ec957db72ae84ba7e5325f0c10

## Тесты

- `harness/hooks/tests/calls.test.sh` (новый), `harness/bin/tests/loop-log.test.sh` (новый), unit test шаблонов,
  `test/contract/harness-codex-hooks.test.ts`; если `test/contract/codex-parity.test.ts` перечисляет hook-и — строка о
  новом. Каждый test сначала красный.

## Где в коде

- `harness/hooks/hooks.json`
- `harness/hooks/calls.mjs` (новый)
- `harness/hooks/loop-patterns.mjs` (новый)
- `harness/hooks/tests/calls.test.sh` (новый)
- `harness/bin/loop-log` (новый)
- `harness/bin/tests/loop-log.test.sh` (новый)
- `test/contract/harness-codex-hooks.test.ts`
- `test/contract/codex-parity.test.ts`
- `docs/features/skills-agents-and-hooks.md`

Только читать: `harness/hooks/stop.mjs` (ключ `owner`), `harness/hooks/codex-input.mjs`, `harness/hooks/gate-paths.mjs`,
`harness/hooks/guard.mjs`, `harness/hooks/tests/guard-silent.test.sh`, `test/fixtures/codex-messages/hooks/`.

## Вне скоупа

- Подсказка агенту (`additionalContext`), отказ в `guard.mjs`, поле `blocked` в отчёте implementer-а, правило
  `epic-wave`, Stop hook по отпечатку failure record — отдельный Epic после `cases: 3` (spec, «Вне Epic-а»).
- Показ call log в UI worfy.

## Итог

- Hook `harness/hooks/calls.mjs` на `PostToolUse` и `PostToolUseFailure` (все tools, timeout 5 с) пишет call log в
  `<gate state>/calls/<owner>.jsonl` и случаи в `calls/loops.jsonl`; шаблоны — чистый модуль
  `harness/hooks/loop-patterns.mjs`; `harness/bin/loop-log [--since <YYYY-MM-DD>]` печатает случаи `would-deny` и
  `cases: N (revisit at 3)`.
- **Время одного вызова `calls.mjs` на fixture** (`test/fixtures/codex-messages/hooks/PostToolUse.jsonl`, 20 запусков на
  Mac, node v24.19.0): медиана 56.8 ms, минимум 40.6, максимум 92.9; пустой `node -e ''` на той же Machine — медиана
  36.7 ms, то есть сам hook добавляет к старту node около 20 ms.
- Решено без владельца:
  - Исход без exit code (shell-вызов Codex: в его `tool_response` только вывод) неуспехом не считается — ни в «том же
    неуспехе», ни в A-B-A-B (раунд 2 ревью; в первом раунде считался). Успехом тоже: правка с таким исходом в «туда и
    обратно» не идёт. Цена: на Codex повторы shell-команды не дают случаев вовсе — три одинаковых `cat` подряд больше не
    дают ложного `would-hint`, но и настоящий цикл shell-команды на Codex `loop-log` не покажет; `apply_patch` Codex-а
    несёт exit code и считается.
  - A-B-A-B считается, только если хотя бы один вызов пары неуспешен: два успешных вызова по очереди (например,
    `sleep` и `gh pr view`) — работа, а не цикл.
  - Правка, которая упала, содержимого не меняет и в «туда и обратно» не идёт.
  - Прерывание человеком (`is_interrupt`) в call log не пишется.
  - Файлы старше 7 дней удаляются, когда пишется call log нового `owner`-а (первый вызов Session или Subagent-а), а не
    на каждом вызове: так hook не читает папку `calls/` при каждом tool-е.
  - Команды ожидания CI: `gh pr checks`, `gh run watch`, `gh run view`; в call log они не пишутся вовсе.
  - Ввод hook читает через `harness/hooks/hook-stdin.mjs` (раунд 2 ревью): закрытый stdin заканчивает ожидание сразу,
    открытый молчащий pipe — через 2 с без первого байта. После первого байта ввод читается до конца, без своего
    предела в 2 с; общий предел — 5 с `hooks.json`.
  - `loop-log` печатает и Vendor (`claude`, `codex`, `-` у строки без него), а управляющие символы в полях — как `?`:
    команда — текст агента, и escape-последовательность из неё не должна дойти до terminal-а.
