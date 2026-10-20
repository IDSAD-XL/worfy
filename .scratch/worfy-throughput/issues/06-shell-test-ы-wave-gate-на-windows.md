# 06 — Shell test-ы `wave-gate` на Windows: stub-ы `gh` и gate, которые Windows может запустить

Type: task
Status: done 2026-10-20T03:01Z
PR: #555
Blocked by: 02
Source: решение владельца 2026-10-16 — вердикт Windows Ticket-ов 01 и 02 = gate full на ПК без новых
падений, shell test-ы `wave-gate` на Windows — известный долг до этого Ticket-а;
[ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2; «Итог» Ticket-а 02 на
ветке `worfy-throughput/02` (пункт «вердикт Windows»).

## Что происходит

- **Ticket-ы 01 и 02 — платформенные PR** по ADR-0056, пункт 2
  (`docs/adr/0056-windows-checks-and-two-sessions.md:38-43`): они меняют скрипт Harness
  `harness/bin/wave-gate` (скрипт, который гоняет один gate full на набор готовых PR Wave и вливает
  их). 01 влит (PR #384, `c53f8a8`). 02 (PR #392) — `VERIFIED` на Mac, не влит.
- **Shell test `harness/bin/tests/wave-gate.test.sh` на Windows не проходит.** Его гоняет `pnpm test`:
  `test/contract/harness-scripts.test.ts` запускает каждый `*.test.sh` как `bash <file>` (`:1-3`). На
  Windows-ПК этот case красный в каждом gate full.
- **Как сделаны stub-ы** (строки — по ветке `origin/worfy-throughput/02`, файл `wave-gate.test.sh`):
  - stub gate (`:33`) и stub `gh` (`:71`) — bash-скрипты без расширения в `$T/stubs`, `chmod +x` (`:88`);
  - stub-ы `ioreg` (`:96`) и `caffeinate` (`:106`) — так же, в `$T/power` (`:95`, `:113`);
  - `export WAVE_GATE_GATE="$STUBS/gate" PATH="$STUBS:$POWER:$PATH"` (`:114`).
- **Как `wave-gate` (Node) их запускает** (та же ветка, `harness/bin/wave-gate`):
  - gate — `spawn(cmd, args)` без shell (`:361`), `cmd` — путь из `WAVE_GATE_GATE` (`:385`);
  - `gh` — `spawnSync("gh", …)` по имени (`:645`);
  - `ioreg` — `spawnSync("ioreg", …)` (`:204`); ошибка запуска (ENOENT) = экран не заблокирован;
  - `caffeinate` — `spawn("caffeinate", …)` (`:233`); ошибку глушит `child.on("error")` (`:237`).
- **Почему на Windows не работает.** Node на Windows запускает без shell только `.exe` и `.com`:
  bash-скрипт без расширения Windows не исполнит, `.cmd` по имени не найдётся, а `.cmd` по пути Node
  без `shell: true` запускать отказывается (EINVAL). Это знание о Node и libuv, на ПК не проверено.
  `ioreg` и `caffeinate` есть только на macOS: на Windows их нет в PATH, и `wave-gate` их пропускает.
  Блок test-а «no ioreg and no caffeinate in PATH» (`:531-545`) это уже проверяет.

- **Проверено на Windows-ПК 2026-10-16** (вердикт PR #392, Git Bash): `wave-gate.test.sh` — ветка 23 ok / 89 FAIL, main 18 / 68. Два механизма:
  1. **Пути в `state.json` в POSIX-форме** (в первой версии этого Ticket-а его не было): test пишет `"repo"` и `e2e_lock` как `/tmp/tmp.xxx/…`; `wave-gate` (Node) на Windows ищет `C:\tmp\…`, отказывает `"repo" must be the absolute path of a checkout` (`harness/bin/wave-gate:126`), дальше — каскад. С `cygpath -m` для этих двух путей загрузка проходит.
  2. **Stub без расширения не запускается**: `spawnSync` существующего bash-скрипта без расширения — ENOENT (errno -4058) и по полному пути, и по имени в PATH; gate stub — `unverified (exit -4058)`, 0 прогонов. С обходом пути 1: ветка 29 / 83, main 24 / 62.

## Что делаем

Рекомендация: **stub-ы gate и `gh` — Node-скрипты (`.mjs`), и `wave-gate` запускает их через
`process.execPath`.** Для `gh` нужен env override по образцу `WAVE_GATE_GATE` (например
`WAVE_GATE_GH`). Override, который кончается на `.js`, `.mjs` или `.cjs`, `wave-gate` запускает как
`process.execPath <файл> <args>`; иначе — как сейчас.

Почему так:
- рабочий путь не меняется: настоящий `gh` на Windows — `gh.exe`, по имени он находится; gate по
  умолчанию уже идёт как `process.execPath gate.mjs` (`:386`);
- `.cmd` shim-ы требуют `shell: true` в `wave-gate`, а с ним — экранирование аргументов `cmd.exe` в
  рабочем коде ради test-а;
- свой resolver по PATHEXT — лишний код в рабочем пути, который на Mac и Linux ничего не делает.

Stub-ы `ioreg` и `caffeinate` остаются bash-скриптами. Блоки test-а про экран и `caffeinate` идут
только на macOS (`uname -s` = `Darwin`). На других системах test печатает строку о пропуске с причиной,
не молча. Блоки с сигналами (SIGKILL и SIGTERM `wave-gate`, `kill -0` в stub-е) — проверить в Git Bash
на ПК. Не работают — пропуск с причиной в выводе и запись в «Итог».

Этот Ticket — **платформенный PR** по ADR-0056, пункт 2: он трогает скрипты Harness
(`wave-gate.test.sh`, а с override-ом и `wave-gate`). Он вливается вне набора `wave-gate`, с вердиктом
Windows.

## Готово, когда

- [ ] Stub-ы gate и `gh` запускаются на Windows: Node-скрипты (или другой путь — с причиной в «Итог»).
- [ ] `bash harness/bin/tests/wave-gate.test.sh` — exit 0 на Mac.
- [ ] (вручную, владелец или Session на Windows-ПК) тот же test в Git Bash на Windows-ПК — exit 0;
      пропущенные блоки названы в выводе.
- [ ] Мутанты: override `.mjs` идёт без `process.execPath` — test красный на Mac; блок экрана на macOS
      не пропускается (мутант «пропуск всегда» — красный).
- [ ] `harness/bin/tests/profile.test.sh` — exit 0, не изменён.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; Linux CI зелёный. gate full на Mac — шаг
      Orchestrator-а; вердикт Windows по ADR-0056, пункт 2 — gate full на ПК, где case
      `bin/tests/wave-gate.test.sh` в `harness-scripts.test.ts` зелёный.

## Тесты

- `bash harness/bin/tests/wave-gate.test.sh; echo "EXIT=$?"` — на Mac, в Linux CI (через `pnpm test`)
  и в Git Bash на ПК.
- Сначала красный: новый test override-а `gh` до правки `wave-gate`.

## Где в коде

- `harness/bin/tests/wave-gate.test.sh`
- `harness/bin/wave-gate` — только override `gh` и запуск `.mjs` через `process.execPath`

## Вне скоупа

- Кандидат отдельного Ticket-а `worfy-windows` (найдено на ПК 2026-10-16): `epic-status` под Git Bash не завершается, а `harness-scripts` по timeout-у убивает только bash — по 3 процесса `epic-status` на прогон остаются и занимают по ядру, их останавливали по pid.

- Проверка экрана и `caffeinate` на Windows — их нет и не нужно (Ticket 02).
- Другие shell test-ы Harness на Windows — Epic `worfy-windows`.
- Запуск `wave-gate` Orchestrator-ом на Windows-ПК.

## Итог

Закрыт PR #555 (`8ec95d3e`, Ticket [worfy-windows 71](../../worfy-windows/issues/71-harness-test-sh-на-windows.md)),
2026-10-20; заметка Session на Windows-ПК 2026-10-20. `bash harness/bin/tests/wave-gate.test.sh` в Git Bash на ПК —
exit 0, 0 failed из 125, 267 s (было exit 1, 30 из 126, 451 s; таблица и пункт 4 «Итог» Ticket-а 71).

- Stub-ы gate и `gh` на Windows — Node stand-in-ы (`node_stand_in` в `wave-gate.test.sh:145`), `wave-gate` запускает
  override `.mjs` через `process.execPath` (`harness/bin/wave-gate:433`, override `WAVE_GATE_GH`).
- Пропущены на win32, каждый строкой `skip …` в выводе: случаи экрана и `caffeinate`, `sig` (SIGTERM из Git Bash
  завершает node без его обработчика), zsh. Снятие замка e2e по сигналу на Windows — Ticket
  [worfy-windows 72](../../worfy-windows/issues/72-wave-gate-не-снимает-замок-e2e-по-сигналу-на-windows.md).
