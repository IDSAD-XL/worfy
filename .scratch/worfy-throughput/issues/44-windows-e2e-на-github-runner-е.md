# 44 — Windows e2e на GitHub runner-е: job в `ci-ok`, сначала только статистика, блокирует после пяти зелёных run-ов подряд

Type: task
Status: claimed 2026-10-28T18:00Z
Branch: worfy-throughput/44
Blocked by: 35
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», решение 15 (Windows e2e —
отдельным job-ом в `ci-ok`, сначала не блокирующим, блокирующим после примерно пяти зелёных run-ов подряд;
начать с разбора красных Windows e2e); условие merge `ci-ok` —
[ADR-0083](../../../docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md).

## Что происходит

- После Ticket-а 35 `ci-ok` собирает Linux, macOS (`macos-tests`, `macos-e2e`, `macos-package`) и
  `windows / full-suite` — это `pnpm test` (unit и contract) из `windows-tests.yml`. e2e Playwright на Windows
  в CI не идут нигде: `windows-tests.yml` их не запускает (комментарий в начале файла: «no e2e»).
- Windows e2e гоняет только ПК владельца в gate full. Когда-то красными там были 128 e2e; База ПК на `main`
  `2e70bf0f` — раздел «База ПК 2026-10-28» ниже: 0 красных e2e.
- Карантин Ticket-а 20 после #878 работает и для Playwright (`test/e2e/quarantine.ts`, записи
  `test/quarantine/<id>.json` с `"runner": "playwright"` и полем `platforms`), так что пропуск e2e на `win32` с
  владельцем и датой уже есть.

## Что делаем

1. **Разбор красных Windows e2e первым.** Взять базу ПК на `2e70bf0f` (или первый run нового job-а, если база
   ПК ещё не пришла): каждый красный spec — в одну группу: дефект кода (Ticket или исправление в этом PR),
   отличие runner-а (окна, фокус, путь, время) или flaky. Таблица групп с run-ами — в «Итог».
2. Job `windows-e2e` в `ci.yml` (на `windows-latest`, тот же `changes` для выбора по путям, что у `macos-e2e`),
   shard-ами, если один job дольше 20 min.
3. **Сначала не блокирует.** `ci-ok` видит результат job-а, но красный `windows-e2e` его не краснит:
   статистика — run-ы и красные spec-и — копится в комментарии PR или в «Итог». Способ (`continue-on-error`,
   отдельный список необязательных job-ов в `scripts/ci-ok.mjs` или другое) — на implementer-е, закрепить
   contract test-ом.
4. **Блокирует после пяти зелёных run-ов подряд** на `main` (push-run-ы). Переключение — отдельный маленький
   PR со ссылками на пять run-ов; до него — нет.
5. Flaky и отличия runner-а, которые не чинятся в этом Ticket-е, — записи карантина с владельцем и датой выхода
   (не больше 15 записей всего), а не повтор run-а.

Нужен ПК: только база красных (п. 1), работа и merge — без ПК. Трогает Harness: нет (условие merge — `ci-ok`,
ADR-0083).

## Готово, когда

- [x] «Итог»: таблица разбора красных Windows e2e — spec, группа, run, что сделано (исправление, Ticket или
      запись карантина).
- [x] Job `windows-e2e` запускается на каждом PR и push в `main`, где `changes` его ждёт; contract test в
      `test/contract/ci-workflow.test.ts` закрепляет триггеры, права только на чтение и место job-а в `ci-ok`.
- [x] Пока job не блокирует, красный `windows-e2e` не краснит `ci-ok`; contract test это закрепляет.
- [ ] Пять зелёных push-run-ов `windows-e2e` подряд на `main` — ссылки в «Итог»; после них PR делает job
      блокирующим, и contract test закрепляет это.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok`.

## База ПК 2026-10-28

Стартовая точка триажа на runner-е. gate full (`GATE_SCOPE=all`) на ПК владельца, `main` `2e70bf0f`, 08:21–09:06 EET,
CPU на старте 18 %. Exit 2 — красное только в шаге `test`. Логи на ПК:
`C:/Users/Alexey/.claude/worfy-harness/gate/state/logs/c848baa6/2026-10-28T06-21-26Z-69084/`.

| Шаг | Итог |
| --- | --- |
| lint, typecheck | зелёные |
| test (unit и contract) | 2 файла красные, 9371 passed, 462 skipped |
| test:e2e | 323 passed, 16 skipped, 0 failed (23,7 min) |
| test:package | 16 passed, 1 skipped |

- Красные test-ы — flaky под нагрузкой, оба зелёные 2 из 2 в тихих повторах (CPU 25–27 %, 7 файлов, 304 passed):
  `test/contract/terminal-git-bash-close.test.ts` (Git Bash вывел только escape-коды режима, без строки готовности;
  `terminal-harness.ts:300`) и `test/contract/harness-evals-outcome.test.ts` (hook timeout 300 000 ms, файл 705 с).
  Оба — Ticket 23.
- Все 8 красных e2e базы 2026-10-23 (тогда 295 passed, 8 failed) зелёные, в карантине их нет: browser-mcp service worker
  (`:406`), done-stack (`:139`), epic-frame-undo (`:125`), linked-machines — Project машины B (`:780`), linked-notify
  (`:108`), palette-find (`:107`), projects-connect (`:217`), window — размер и положение после перезапуска (`:179`).
- 16 skipped e2e — по платформе: login shell, PATH из Finder, dev-запуск упакованной сборки, terminal-ai (zsh),
  `window:153` (кнопки окна macOS).
- В `test/quarantine` на тот момент 14 записей, все vitest (13 — `win32`, 1 — `darwin`), e2e — ни одной.
- Что падает на runner-е, но не на ПК, — первый шаг этого Ticket-а.

## Где в коде

- `.github/workflows/ci.yml`, `.github/workflows/windows-tests.yml` (если e2e удобнее держать там),
  `scripts/ci-ok.mjs`, `scripts/ci-scope.mjs`
- `test/contract/ci-workflow.test.ts`, `test/contract/windows-tests-workflow.test.ts`
- `playwright.config.ts`, `test/e2e/helpers.ts`, `test/e2e/quarantine.ts` — только если runner Windows требует
  настройки
- `test/quarantine/` — записи `win32` для e2e
- При claim: `test/e2e/deny-ace.ts` (новый), `test/e2e/linked-add-project.spec.ts`,
  `test/e2e/linked-machines.spec.ts`; `docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md` — раздел
  «Amendments»

## Вне скоупа

- Починка каждого красного Windows e2e — здесь только разбор и записи; дефекты кода — свои Ticket-ы
  (Epic `worfy-windows`).
- Flaky unit- и contract-test-ы Windows — Ticket 23.
- Вердикт `check/windows` и scope `pc` — Ticket-ы 24 и 30.

## Итог

### Разбор красных Windows e2e на runner-е

Run-ы — workflow `Windows e2e triage` черновика PR #914 (ветка `triage/windows-e2e`, никогда не вливается):
4 shard-а, шаг e2e под Git Bash, карантин не пропускает (`WORFY_QUARANTINE=run`). Первый run —
[40710168910](https://github.com/IDSAD-XL/worfy/actions/runs/40710168910) (head `69763183`, до #916): 11 красных,
те же 11 в 40716640768 и 40719521332. После #916 (merge 2026-10-28 17:02 UTC, `21c15b78`) — run-ы
[40732166767](https://github.com/IDSAD-XL/worfy/actions/runs/40732166767) (head `c3b19ef4`),
40734607356 (head `69213c64`, шаг диагностики) и
[40737039070](https://github.com/IDSAD-XL/worfy/actions/runs/40737039070) (head `62fd7adb`): 337 из 339 зелёные,
красные только два spec-а группы C.

Группы причин:

- **A — короткий путь TEMP.** На runner-е `%TEMP%` — 8.3-имя `C:\Users\RUNNER~1\…`, приложение показывает длинный
  `C:\Users\runneradmin\…`; test ждал путь из `mkdtemp`. Отличие runner-а, не дефект кода.
- **B — перенос строки.** Набранная в Terminal команда переносится по ширине окна (`ping -n 3` / `1`), test искал
  её одной строкой. Отличие runner-а.
- **D — linked-opening.** Тот же короткий путь (A) в fixture Linked machine: Epic-и не находились, счётчик `0`.
- **C — deny ACE не действует.** Test закрывает папку записью ACL (`icacls /deny`), а приложение её всё равно
  читает или пишет в неё. Причина доказана диагностикой в run-ах 40734607356 и 40737039070: пользователь runner-а —
  администратор, в его token есть SeBackupPrivilege и SeRestorePrivilege (выключены). Git Bash (runtime MSYS2)
  включает обе при старте, каждый дочерний процесс — pnpm, Playwright, Electron приложения B — получает их
  включёнными, а libuv открывает папку с `FILE_FLAG_BACKUP_SEMANTICS`, и ACL не проверяется. Под `shell: pwsh`
  обе выключены, и deny даёт `EPERM`. В token-е ПК владельца этих привилегий нет — там оба test-а зелёные.
  Отличие runner-а, не дефект кода.

| Spec | Группа | Run | Что сделано |
| --- | --- | --- | --- |
| `checks-badges.spec.ts:113` | A | 40710168910 | исправлено в #916 (`realpathSync.native` для временных папок test-ов) |
| `own-sessions.spec.ts:198` | A | 40710168910 | исправлено в #916 |
| `projects-connect.spec.ts:67` | A | 40710168910 | исправлено в #916 |
| `projects.spec.ts:85` | A | 40710168910 | исправлено в #916 |
| `terminal.spec.ts:212` | A | 40710168910 | исправлено в #916 |
| `terminal.spec.ts:464` | A | 40710168910 | исправлено в #916 |
| `ticket-focus.spec.ts:64` | A | 40710168910 | исправлено в #916 |
| `terminal.spec.ts:387` | B | 40710168910 | исправлено в #916 (test сравнивает команду без переносов строки) |
| `linked-opening.spec.ts:171` | D | 40710168910 | исправлено в #916 |
| `linked-add-project.spec.ts:204` | C | 40710168910, 40737039070 | этот PR: шаг e2e под `shell: pwsh`; в test-е проверка во время run-а — если процесс B всё же читает закрытую папку, `test.skip` с причиной «process holds SeBackup/SeRestore: deny ACE cannot apply» (`test/e2e/deny-ace.ts`) |
| `linked-machines.spec.ts:411` | C | 40710168910, 40737039070 | этот PR: то же — `shell: pwsh` и проверка записи в закрытую папку во время run-а |
| `trash-undo.spec.ts:115` | flaky? | 40719521332 (1 из 6 run-ов) | кандидат во flaky: красный один раз, в остальных run-ах зелёный; записи карантина нет |
| `controls.spec.ts:189` | flaky? | 40716640768 (1 из 5 run-ов, где шёл shard 1/4) | кандидат во flaky: красный один раз (cursor после reload Browser), в остальных run-ах зелёный; записи карантина нет |

Записей карантина для группы C нет и не будет: причина постоянная, пока e2e идут из Git Bash на elevated token,
и запись со сроком просто истекла бы в красный. Слепого пропуска на runner-е тоже нет: test пропускается, только
когда процесс под test-ом действительно проходит сквозь deny; на macOS и на ПК оба test-а идут как раньше
(macOS, этот worktree: `pnpm test:e2e --workers=1 test/e2e/linked-add-project.spec.ts:205
test/e2e/linked-machines.spec.ts:412` — 2 passed; с mutant-ом, где проверка всегда видит обход, — 2 skipped).

### Job `windows-e2e`

- `ci.yml`: job `windows-e2e` на `windows-latest`, 4 shard-а (самый долгий shard в run-ах разбора — 14,5 min,
  run 40719521332), `timeout-minutes: 45`, шаг e2e под `shell: pwsh` с комментарием о причине. Выбор по путям —
  тот же, что у `macos-e2e` (`scripts/ci-scope.mjs`, ключ `windows-e2e`); ручной запуск `check`/`full-macos` его
  не просит.
- Не блокирует: `scripts/ci-ok.mjs`, набор `NON_BLOCKING`. Нужный run-у `windows-e2e` с любым результатом
  оставляет `ci-ok` зелёным; результат не `success` — строка `::warning::` в сводке run-а. Ненужный run-у
  `windows-e2e` должен быть `skipped`, как любой другой job.
- Contract test — `test/contract/ci-workflow.test.ts`: место job-а в `needs` у `ci-ok`, `windows-latest`, 4 shard-а,
  шаг e2e под `pwsh`, pnpm action по commit, выбор по путям как у `macos-e2e`, зелёный `ci-ok` при красном,
  отменённом и пропущенном `windows-e2e`, красный при запуске без нужды и при падении любого другого job-а.
- ADR-0083 — раздел «Amendments», запись 2026-10-28 о неблокирующем job-е.
- Пять зелёных push-run-ов подряд на `main` — ещё нет; переключение на блокирующий — отдельный PR.

### Первый run job-а `windows-e2e`

PR #921, run [40742646874](https://github.com/IDSAD-XL/worfy/actions/runs/40742646874), head `68491cf9`, шаг e2e
под `pwsh`: все 4 shard-а зелёные — 321 passed, 2 flaky (прошли со второй попытки), 16 skipped, 0 failed из 339.

| Shard | Время | Итог |
| --- | --- | --- |
| 1/4 | 10,7 min | 85 passed, 1 flaky: `browser.spec.ts:279` (Note тянется через страницу Browser) |
| 2/4 | 7,7 min | 80 passed, 1 flaky: `linked-machines.spec.ts:783` (A открывает Project машины B), 3 skipped |
| 3/4 | 8,0 min | 83 passed, 3 skipped |
| 4/4 | 7,2 min | 73 passed, 10 skipped |

Оба spec-а группы C под `pwsh` прошли, а не пропущены: `linked-add-project.spec.ts:205` — `ok 58`,
`linked-machines.spec.ts:412` — `ok 68` (shard 2/4). Значит, deny ACE действует, и проверка в test-е обход не нашла.
Два flaky — кандидаты, по одному разу; записей карантина нет. Если они повторятся, правило то же: 3 строки
FLAKY одного test-а за неделю — Ticket на причину (ADR-0083, Amendments).
