# 20 — Карантин flaky unit- и contract-test-ов: запись с владельцем и датой выхода, блокирующие run-ы их пропускают

Type: task
Status: done 2026-10-28T06:22Z
PR: #873
Branch: worfy-throughput/20
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», решения 2 и 3; открытые вопросы
Ticket-ов [11](11-pr-вливается-по-задетым-test-ам-полный-набор-на-main.md)
и [12](12-ci-на-linux-на-каждый-pr-shard-ами.md) «flaky test: чинить или карантин»; flaky test-ы gate full на
Mac 2026-10-27 и разбор run-ов «Windows tests» с 2026-10-18.

## Что происходит

- Механизма карантина нет: ни в `harness/hooks/gate.mjs`, ни в конфигурации test-ов. Playwright без повторов
  нарочно (`playwright.config.ts:17`).
- Под нагрузкой (load average 30–60 от параллельных агентов) краснеют test-ы, не связанные с PR: на Mac 2026-10-27
  — `test/unit/canvas.test.tsx` (`collectNodeTypes`, `:48`, jsdom 5 s), `test/unit/session-node-drop.test.tsx`,
  `test/contract/login-shell-capture.test.ts`; на Windows-runner-е — `test/contract/claude-home-registry.test.ts`
  (watcher, 3 run-а), `test/contract/link-access.test.ts` (порядок вывода ConPTY, 3 run-а),
  `test/contract/workflow-reader.test.ts` (предел времени), `test/contract/workflow-branches-handles.test.ts`
  (`rmdir` EBUSY). Каждый такой красный — повтор gate full (около 12 min) или ручной разбор.
- `vitest.config.ts`, `package.json`, setup-файлы test-ов и `test/**/terminal*` — в `PC_ONLY`
  (`scripts/windows-verdict-scope.mjs:41,86,97`): их правка сделала бы PR `pc`, а ПК на паузе.

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): карантин нужен ещё больше: блокирующие run-ы теперь — job-ы `ci-ok` на трёх ОС
(Ticket 35), и flaky test без записи краснит merge каждого PR. Платформа записи `platforms` относится и к
runner-у этой ОС; helper работает без правки workflow-ов (без `WORFY_QUARANTINE` test пропускается).

## Что делаем

1. `test/quarantine/<id>.json` — одна запись на test (отдельные файлы, чтобы Ticket-ы, которые чинят разные
   test-ы, не правили один файл): `file`, `test` (полное имя, как печатает vitest), `platforms`
   (`darwin` / `win32` / `linux`), `reason`, `owner` (Ticket, который чинит: `worfy-throughput 22`,
   `worfy-throughput 23`, `worfy-polish 41`), `since`, `until` (не позже `since` + 14 дней).
2. `test/quarantine.ts` — helper, который test-файл вызывает вместо `it`/`test` для записи в карантине
   (`quarantined(it)('имя', …)` или похожий вызов — форма на выбор исполнителя). Без `WORFY_QUARANTINE`
   test пропускается с пометкой `skip (quarantine: <owner>, until <дата>)`; `WORFY_QUARANTINE=only` — идут
   только test-ы карантина; `WORFY_QUARANTINE=run` — идут все.
   Просроченная запись (сегодня позже `until`) снова краснит: helper больше не пропускает этот test, он идёт в
   каждом блокирующем run-е, а `quarantine.test.ts` красный с именем записи — починить или продлить словом
   владельца. Автоматического повтора упавшего test-а нет ни в одном run-е (решение владельца 2026-10-28).
3. Пометить test-ы из «Что происходит» (Mac — `darwin`, Windows — `win32`). `vitest.config.ts`,
   `package.json` и setup-файлы не трогать; e2e — Ticket 34.
4. `test/unit/quarantine.test.ts`: запись без `owner` или `until`, `until` дальше 14 дней от `since`,
   просроченная запись, запись на test, которого нет в файле, больше 15 записей — красный test с причиной.

Нужен ПК: нет. Трогает Harness: нет (одна строка в `rules.md` Profile-а — шаг Orchestrator-а после merge; слово
владельца дано 2026-10-28, решение 1). Вердикт Windows: runner `full`.

## Готово, когда

- [ ] `pnpm test` на Mac пропускает test-ы карантина `darwin` и печатает их как skip с владельцем; без
      записи тот же test идёт.
- [ ] `WORFY_QUARANTINE=only pnpm test` гоняет только их; код выхода — в «Итог».
- [ ] `test/unit/quarantine.test.ts` краснеет на каждой ошибке записи из пункта 4 (фикстуры) и на
      просроченной дате (время — через подставные часы, не системные); test с просроченной записью helper
      не пропускает (фикстура).
- [ ] `node scripts/windows-verdict-scope.mjs origin/main HEAD` на ветке — `runner` (код 0): PR не ждёт ПК.
- [ ] Записи в карантине — список в «Итог» с владельцем и датой выхода каждой.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; вердикт Windows — runner `full` на head; условие merge —
      `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

## Где в коде

- `test/quarantine.ts`, `test/quarantine/*.json`, `test/unit/quarantine.test.ts` — новые
- Пометки: `test/unit/canvas.test.tsx`, `test/unit/session-node-drop.test.tsx`,
  `test/contract/login-shell-capture.test.ts`, `test/contract/claude-home-registry.test.ts`,
  `test/contract/link-access.test.ts`, `test/contract/workflow-reader.test.ts`,
  `test/contract/workflow-branches-handles.test.ts`
- Только читать: `scripts/windows-verdict-scope.mjs`, `vitest.config.ts`

Вне репозитория (Orchestrator после merge; слово владельца дано 2026-10-28): строка в `rules.md` Profile-а worfy — «test в
карантине не краснит gate; новый flaky — запись с владельцем и датой, а не повтор gate full».

## Вне скоупа

- Починка самих test-ов — 22, 23, `worfy-polish` 41.
- `test/contract/terminal.test.ts` — файл `PC_ONLY`; остаётся в `worfy-polish` 41.
- Карантин e2e и shell test-ов Harness — 34 и `worfy-polish` 41.

## Итог

Ветка `worfy-throughput/20`, PR — #873.

**Что сделано.** `test/quarantine.ts` — helper `quarantined('<id>')(name, fn, timeout)` вместо `it(name, fn,
timeout)`; запись — `test/quarantine/<id>.json` с полями `file`, `test`, `platforms`, `reason`, `owner`, `since`,
`until`. Без `WORFY_QUARANTINE` test с действующей записью этой платформы пропускается: имя в отчёте vitest —
`<имя> (quarantine: <owner>, until <дата>)`, и строка `skip (quarantine: <owner>, until <дата>): <файл> > <test>`
в stderr (её видно и в reporter-е vitest под агентом); при `GITHUB_ACTIONS=true` — ещё строка
`::warning title=quarantine::<файл> > <test> (owner <owner>, until <дата>)`, чтобы пропуск был виден на странице
run-а (reporter `github-actions` vitest аннотирует только падения). `WORFY_QUARANTINE=run` и `=only` — test идёт; другое
значение — ошибка при сборе файла. Helper ничего не пропускает, если запись пропала, сломана, называет другой
test, не называет эту платформу или просрочена (сегодня по UTC позже `until`): test идёт под своим именем в
каждом run-е. Автоматического повтора нет. `test/unit/quarantine.test.ts` проверяет записи и пометки
репозитория и на фикстурах (часы — параметр `now`, не системные) краснеет с именем записи: нет `owner`, нет
`until`, `until` дальше 14 дней от `since` или раньше `since`, `since` позже сегодняшнего дня по UTC (иначе запись
с будущим `since` держала бы test в карантине дольше 14 дней), просроченная запись, test, которого нет в файле
под пометкой, пометка без записи, две записи на один test, больше 15 записей; helper на фикстуре просроченной
записи test не пропускает. 17 mutant-ов `test/quarantine.ts` — все красные; во втором раунде ещё 6 (правило
`since`, строка `::warning` и её экранирование `%`, CR, LF) — тоже красные.

**Записи в карантине (6):** `since` 2026-10-27 — дата создания по UTC (сначала стояла местная 2026-10-28,
её правило `since` не позже сегодняшнего дня по UTC краснило до полуночи UTC), `until` 2026-11-10.

| Запись | Test | Платформа | Владелец | Выход |
| --- | --- | --- | --- | --- |
| `login-shell-capture-late-writes` | `test/contract/login-shell-capture.test.ts` › keeps nothing of what that process writes after the answer | `darwin` | `worfy-throughput 22` | 2026-11-10 |
| `link-access-handlers-event-sender` | `test/contract/link-access.test.ts` › access on › handlers that read event.sender… | `win32` | `worfy-throughput 23` | 2026-11-10 |
| `link-access-switch-off-mid-subscription` | `test/contract/link-access.test.ts` › switching access off › in the middle of a subscription… | `win32` | `worfy-throughput 23` | 2026-11-10 |
| `link-access-read-only-mid-work` | `test/contract/link-access.test.ts` › read-only access › lowered from all to read-only… | `win32` | `worfy-throughput 23` | 2026-11-10 |
| `workflow-reader-auction-size` | `test/contract/workflow-reader.test.ts` › … diffs 682 Tickets in ≤ 300 ms… | `win32` | `worfy-throughput 23` | 2026-11-10 |
| `workflow-branches-handles-rounds` | `test/contract/workflow-branches-handles.test.ts` › 16 rounds of a worktree… | `win32` | `worfy-throughput 23` | 2026-11-10 |

**Отклонения от «Что делаем», пункт 3.**

- `test/unit/canvas.test.tsx` (`collectNodeTypes`) и `test/unit/session-node-drop.test.tsx` — без записи. Их
  flaky test — первый test файла, который делает медленный dynamic import в jsdom; пропуск переносит эти 5 s на
  следующий test. Замер: с пропущенным первым test-ом `collectNodeTypes` при load average 32 упал следующий,
  `names a React Flow wrapper…` (timeout 5004 ms). Карантин тут не убирает красный, а прячет имя причины;
  оба файла целиком остаются за Ticket-ом 22.
- `test/contract/claude-home-registry.test.ts` — без записи. Все его красные (7 test-ов) — в трёх run-ах
  «Windows tests» 2026-10-19 до 12:16 UTC, до мержа `a3514683` (#525, watcher Claude home на Windows, 15:46 UTC).
  В разборе run-ов с тех пор до 2026-10-27 красных в этом файле нет, в том числе в трёх красных полных run-ах
  (2026-10-22 и дважды 2026-10-23), где падали другие файлы. Запись спрятала бы зелёный test. Ticket 23 проверяет его повторами run-а, как и остальные.

**`WORFY_QUARANTINE=only pnpm test`.** Переменная сама не сужает run vitest: отобрать test-ы без пометки
можно только правкой `vitest.config.ts`, `package.json` или setup-файлов, а они в `PC_ONLY`. Run только test-ов
карантина — `WORFY_QUARANTINE=only pnpm test -t "\(quarantine: "`: на Mac код 0, `Tests  1 passed | 9699 skipped (9700)`, 35 s (идёт одна запись `darwin`).

**Вне следа (нужно для зелёного `pnpm typecheck` и `pnpm test`).** `tsconfig.test.node.json` — строка
`test/quarantine.ts` (project перечисляет файлы `test/*.ts` поимённо). `test/unit/e2e-no-spawn-on-load.test.ts`
— `quarantined` из `../quarantine` считается test-ом vitest (иначе запуск процесса в теле помеченного test-а
читается как запуск при загрузке файла), плюс фикстура; mutant без этой строки красный.

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test` на Mac под load average 37–43: lint и typecheck — 0; `pnpm test` — 1 красный вне PR (`harness-scripts.test.ts` › `guard-silent.test.sh`, EPIPE при запуске node под нагрузкой), отдельно — код 0. Прошлый прогон дал 5 jsdom timeout-ов 5 s в `canvas`, `chat-attachments`, `session-history-tail` — отдельно все пять файлов зелёные (код 0). `pnpm test` на Mac без `WORFY_QUARANTINE` пропускает запись `darwin` и печатает строку `skip (quarantine: worfy-throughput 22, until 2026-11-11): test/contract/login-shell-capture.test.ts > …`; записи `win32` на Mac идут. `node scripts/windows-verdict-scope.mjs origin/main HEAD` — `runner`, код 0.
gate fast на `3ba962ca` — `[gate] green (fast)`, код 0 (lint 13,5 s, typecheck 4,2 s, test 166,8 s). Вердикт Windows — run `full` на head (scope `runner`); на Windows-runner-е запись `win32` проверяется там же.

**После merge (Orchestrator).** Строка в `rules.md` Profile-а worfy: «test в карантине не краснит gate; новый
flaky — запись с владельцем и датой, а не повтор gate full».

**Закрытие.** PR #873 влит 2026-10-28. #877 добавил записи (их теперь 14, список — «Итог» Ticket-а 35),
#878 распространил тот же карантин на e2e Playwright. Долг (low, из VERIFIED-комментария): абзац «Проверки» выше приводит
`until 2026-11-11`, а у записей `until` 2026-11-10.
