# 30 — Contract test-ы с timeout-ом под нагрузкой краснят gate full чужих PR: постоянные stub-ы вместо новых исполняемых файлов

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-16 — открыть Ticket и поставить первым в следующую Wave; «Итог»
[20](20-два-flaky-contract-test-а-harness.md) («Timeout в `harness-script-wiring.test.ts`»,
«Кандидаты с той же причиной», долг [low] о `{ shuffle: false }`); «Gate оркестратора»
[worfy-throughput 03](../../worfy-throughput/issues/03-implementer-гоняет-только-свои-e2e.md) (PR #385).

## Что происходит

- **Причина timeout-а найдена в Ticket-е 20.** macOS проверяет каждый новый исполняемый файл при
  первом запуске (`XprotectService`), по одному файлу на всю машину. Test, который пишет stub-скрипт
  заново в каждом test-е, под нагрузкой ждёт эту очередь секундами. Ticket 20 перевёл stub-ы
  `harness-script-wiring` на постоянные файлы `test/fixtures/harness-stub/`. Кандидаты с той же
  причиной остались: `harness-qmd`, `docs`, `github-prs`, `workflow-reader`.
- **2026-10-16 gate full PR, которые этих test-ов не трогали, краснел раз за разом.** Ticket
  worfy-throughput 03 (PR #385, только `.md` и `.sh`) — пять красных gate full подряд, зелёный с шестой
  попытки; ещё раз — Linux CI. Отдельно каждый упавший файл зелёный.
  - `workflow-reader`, `github-prs`, `harness-qmd`, `docs` — `Test timed out in 15000ms` (предел
    `testTimeout: 15_000`, `vitest.config.ts:50`);
  - `harness-script-env.test.ts` — `expected '/private/var/folders/…' to be null` в test-е «"Check
    again" with node added since the start» (`:264`, проверка `:276`);
  - один раз в Linux CI — `terminal-ai-zle.test.ts`, Alt+→ (`:338`): `expected 1 to be greater than 1`.
- **Где пишутся исполняемые файлы на каждый test.** Пути и коды выхода вписаны в текст скрипта, поэтому
  файл каждый раз новый.
  - `workflow-reader.test.ts`: `makeClaudeHome` (`:79-91`), `makePluginHome` (`:98-116`), `stubHarness`
    (`:498-512`), разовый `epic-status` (`:427-428`); около 40 вызовов.
  - `github-prs.test.ts`: `accountWorld` — `bin/profile` (`:513`) и stub `gh` (`:516`). Основной stub
    `gh` уже постоянный: `test/fixtures/gh/gh` (`:19`).
  - `harness-qmd.test.ts`: helper `stub` (`:33-36`) и `qmd-collections` (`:266-267`).
  - `docs.test.ts`: `bin/profile`, `bin/ticket` в `beforeEach` блока «a Silent Project» (`:365-367`).
    Какой test `docs` упал — по логу не установлено.
  - `harness-script-env.test.ts`: `login-shell` (`:269-270`).
- **`harness-script-env` и `terminal-ai-zle` — причина может быть другой.** Проверка `:276` ждёт, что
  после `recaptureAgentEnv()` в PATH нет node. Снимок shell-а, который упал (`fallback`), не заменяет
  прежний удачный (`src/main/agent/env.ts:556-559`); предел shell — 10 s (`env.ts:37`). Если shell не
  успел, остаётся снимок прошлого test-а, где node есть. Не проверено. В `terminal-ai-zle` сообщение —
  из helper-а `run` (`:213-216`): следующий prompt не пришёл за `WAIT` = 10 s (`:25`).
- **Долг Ticket-а 20.** Пара test-ов на протечку (`harness-script-wiring.test.ts:357`, `:362`) зависит
  от порядка и падает при `--sequence.shuffle.tests`. Порядок у `describe` (`:345`) не закреплён.

## Что делаем

1. **`workflow-reader`, `github-prs`, `harness-qmd`, `docs`** — как Ticket 20: постоянный stub в
   `test/fixtures/` (свой или общий `harness-stub/answer`), test ставит на него symlink. Что сейчас
   вписано в текст скрипта, stub берёт из env или из файла рядом. Где нельзя — причина в «Итог».
2. **`harness-script-env`** — сначала причина: под нагрузкой записать, что вернул `recaptureAgentEnv()`
   (`from`, время shell-а). Очередь `XprotectService` на `login-shell` — лечение пункта 1. Другая
   причина — лечить её; файл приложения дописывается в «Где в коде» при claim.
3. **`terminal-ai-zle`** — сначала причина: какой `run` не дождался prompt-а и почему. Падал только в
   Linux CI, где `XprotectService` нет.
4. **`{ shuffle: false }`** у `describe` в `harness-script-wiring.test.ts:345`.
5. **`testTimeout`, `WAIT` и пределы в файлах не поднимать** как лечение.

## Готово, когда

- [ ] В `workflow-reader`, `github-prs`, `harness-qmd`, `docs`, `harness-script-env` test не пишет
      новых исполняемых файлов, или в «Итог» названа причина.
- [ ] Причины падений `harness-script-env` и `terminal-ai-zle` — в «Итог» с выводом красного прогона до
      правки. Не воспроизвелось — так и записано, с числом прогонов.
- [ ] Замер способом Ticket-а 20: два прогона `--project contract` разом под `yes > /dev/null` на
      половине ядер (load около 15). До правки — до первого красного; после — 0 красных в N прогонах,
      N не меньше числа прогонов до первого красного × 3. Время самых долгих test-ов — в «Итог».
- [ ] Мутанты, где они что-то значат: stub снова пишется в каждом test-е; без `{ shuffle: false }` пара
      краснеет при `--sequence.shuffle.tests`, с ним — зелёная.
- [ ] `testTimeout` в `vitest.config.ts`, `WAIT` и пределы в файлах не подняты.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; Linux CI зелёный. gate full — шаг
      Orchestrator-а перед merge.

## Тесты

- `node scripts/vitest-electron.mjs --project contract <файл>` в цикле shell, под нагрузкой и без; у
  каждого прогона — код выхода.
- Нагрузка — только когда других агентов Wave нет: она краснит gate соседей.

## Где в коде

- `test/contract/workflow-reader.test.ts`, `github-prs.test.ts`, `harness-qmd.test.ts`, `docs.test.ts`,
  `harness-script-env.test.ts`, `terminal-ai-zle.test.ts`
- `test/fixtures/harness-stub/` — новые постоянные stub-ы, если нужны
- `test/contract/harness-script-wiring.test.ts` — только строка `{ shuffle: false }`

Только читать: `src/main/agent/env.ts`, `vitest.config.ts`. Не платформенный PR по ADR-0056, пункт 2:
скрипты Harness, код с ветками по платформе и упаковку он не трогает. Заденет `harness/` — нужен
вердикт Windows.

## Вне скоупа

- Другие кандидаты Ticket-а 20 (`harness-install`, `workflow-profile`, `projects` и т. д.) — только если
  краснят gate; иначе — запись в «Итог».
- e2e из тех же gate full (`session-back.spec.ts`, `harness-install.spec.ts`).
- ENOTEMPTY в `harness-drift` — решено в Ticket-е 20.
