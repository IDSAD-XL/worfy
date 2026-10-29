# 47 — Медленные Harness test-ы в shard-е 3/3 Windows: короткие timeout-ы в guard-silent, тела bash и zsh в heartbeat параллельно

Type: task
Status: claimed 2026-10-29T01:12Z
Branch: worfy-throughput/47
Blocked by: 35
Source: договорённость моста и Orchestrator-а 2026-10-29: находка Ticket-а 15 вне его скоупа (out_of_scope), замер по
run-у 40788089367 на `main`.

## Что происходит

После #927 PR только с unit-test-ами или только с Harness не запускает ни одного job-а на macOS. Самый долгий job такого
PR — `windows / full-suite`: shard-ы 1/3 и 3/3 идут около 480–490 s. В shard-е 3/3 лежит
`test/contract/harness-scripts.test.ts`, он идёт около 354 s на Windows (180 s на Linux, 232 s на macOS; run
40788089367 на `main`).

Два файла внутри него тратят время на фиксированные ожидания:

1. `harness/hooks/tests/guard-silent.test.sh` — случаи, где stub `bin/silent-check` висит и guard ждёт свой timeout до
   конца. Каждый такой try длится `TRY_MS` (3 s или 5 s), и случай ждёт его целиком, иногда дважды. Ещё один случай —
   два timeout-а по умолчанию (по 10 s).
2. `harness/bin/tests/wave-gate-heartbeat.test.sh` — внешний цикл `for sh in "${SHELLS[@]}"` гоняет все случаи сначала
   под bash, потом под zsh, друг за другом.

## Что делаем

1. **guard-silent.** Где случай проверяет, что timeout случился, а не его длину, — короткий
   `CLAUDE_SILENT_CHECK_TIMEOUT_MS`. Где после timeout-а повтор должен успеть ответить, try остаётся с запасом на старт
   node под нагрузкой. Проверки те же. Случай с настоящим timeout-ом по умолчанию остаётся как есть: только он
   показывает, что hook укладывается в свой предел из `hooks.json`.
2. **heartbeat.** Тела bash и zsh идут параллельно, каждое в своём subshell-е и своей рабочей папке `$W`. Файл ждёт
   оба, затем печатает их вывод и складывает счёт pass и fail в постоянном порядке (порядок `SHELLS`). Опросы
   `until_ok`, `run_limited` и `FAST=0.2` не меняются.

Если параллельный heartbeat даёт недетерминированный вывод или flaky test в трёх run-ах, половина про heartbeat
отбрасывается, guard-silent остаётся, и это записано в «Итог».

Нужен ПК: по брифу — да, `check/windows` с ПК (платформенный PR, ADR-0056: Harness-скрипты); его организует мост.
`node scripts/windows-verdict-scope.mjs origin/main HEAD` для этой ветки печатает `runner` (код 0): по правилу Profile
вердикт Windows тогда — job `windows / full-suite` в `ci-ok`; нужен ли ещё ПК, решает мост.
Трогает Harness: да, только test-ы `harness/**/tests/`.

## Готово, когда

- [x] В обоих файлах все проверки на месте: число проверок до и после равно, или каждая разница объяснена.
- [x] Время каждого файла на Mac до и после: три run-а, медиана, с командой. Run-ы отдельные (`bash <файл>` под
      временным HOME), не внутри vitest.
- [x] Mutant на каждый файл показывает, что укороченные проверки ловят ошибку: для guard-silent — guard без timeout-а,
      для heartbeat — сломанное тело одного shell-а. Каждый mutant красный, восстановление проверено `cmp`.
- [x] `node scripts/vitest-electron.mjs test/contract/harness-scripts.test.ts` — exit 0, со временем.
- [x] `pnpm lint`, `pnpm typecheck`, gate fast — exit 0 каждый.
- [ ] `check/windows` (платформенный PR, ADR-0056) — организует мост, не implementer.

## Где в коде

- `harness/hooks/tests/guard-silent.test.sh` — `TRY_MS` и комментарий к нему в разделе про stub `silent-check`.
- `harness/bin/tests/wave-gate-heartbeat.test.sh` — внешний цикл по `SHELLS`.
- `.scratch/worfy-throughput/spec.md` — строка Ticket-а 47 в таблице Ticket-ов.

## Вне скоупа

- Timeout-ы и опросы в других файлах (правило владельца: timeout-ы test-ов не подстраивают по одному).
- Код `harness/hooks/guard.mjs` и блок heartbeat в `harness/skills/epic-wave/SKILL.md`.
- Разбиение shard-ов Windows и порядок `RUN_FIRST` в `test/contract/harness-scripts.test.ts`.

## Итог

Замер 2026-10-29 на Mac владельца, implementer Ticket-а 47.

### guard-silent: какие ожидания были и какие стали

На базе `TRY_MS` был 3000 только у случая «timeout twice» (`:232`); с `:237` и до конца раздела он 5000, так что
случаи `sleep,0`, `sleep,traces` и «two checks, one budget» ждали по 5 s и 10 s, а не по 3 s, как сказано в брифе.

| Случай | Что проверяет | Try до → после | Ожидание до → после |
| --- | --- | --- | --- |
| `stub sleep` «timeout twice» | что timeout случился дважды и отказ о нём говорит | 3000 → 500 ms | 6 → 1 s |
| `stub sleep,0` | timeout, затем повтор отвечает 0 | 5000 → 3000 ms | 5 → 3 s |
| `stub sleep,traces` | timeout, затем повтор находит следы | 5000 → 3000 ms | 5 → 3 s |
| «two checks, one budget» (`sleep,0,sleep`) | второй check получает остаток бюджета двух try, hook кончается быстрее `2,5 × TRY_MS` | 5000 → 3000 ms | 10 → 6 s |
| «default tries, both time out» | настоящий try по умолчанию (10 s) дважды укладывается в предел hook-а из `hooks.json` (30 s) | без изменений | 20 s |

Где после timeout-а повтор должен ответить, try не стал коротким: повтор — это старт node под нагрузкой, а 500 ms
под load average 30 на это не хватит. 3 s — тот же запас, что был у случаев «только timeout» до этого Ticket-а.
Случай с настоящим timeout-ом по умолчанию — единственный, он остался как был.

### Число проверок

| Файл | Проверок в run-е до | после | Вызовов `ok`/`bad` в тексте до | после |
| --- | --- | --- | --- | --- |
| `guard-silent.test.sh` | 103 (`passed 103, failed 0`) | 103 | 17 / 17, плюс 65 вызовов `expect`/`stub`/`fake` | то же |
| `wave-gate-heartbeat.test.sh` | 25 (`passed 25, failed 0`) | 25 | 16 / 25 | 16 / 26 |

Лишний `bad` в heartbeat срабатывает только при сбое: тело shell-а кончилось, не записав свой счёт. Строки `ok` в
выводе heartbeat те же и в том же порядке, что на базе, во всех шести run-ах после правки (сравнение `diff` строк
`ok`/`FAIL`/`skip`/`passed`; разница только в пути к `SKILL.md` и в миллисекундах).

### Время на Mac, медиана трёх run-ов

Команда: `HOME=<mktemp -d с пустыми .zshenv, .zprofile, .zshrc> bash <harness>/<файл>`; база — копия `harness/` с
`origin/main` `eeaa39d4b`, после — worktree Ticket-а. Run-ы «до» и «после» шли через один, чтобы нагрузка была одна.

| Файл | До, ms | После, ms | Медиана до → после | Load average |
| --- | --- | --- | --- | --- |
| `guard-silent.test.sh` | 64 408, 68 609, 61 040 | 48 313, 50 372, 47 085 | 64,4 → 48,3 s (−16 s, −25 %) | 17–29 |
| `wave-gate-heartbeat.test.sh` | 39 030, 38 668, 38 039 | 19 341, 19 160, 19 254 | 38,7 → 19,3 s (−19 s, −50 %) | 5–6 |

Ещё по три run-а подряд (сначала все «до», потом все «после»): guard-silent 60,2 s до (load 8–11) и 57,3 s после
(load 30); heartbeat 38,1 → 19,5 s (load 4–7). Heartbeat после правки зелёный во всех шести run-ах, вывод в
постоянном порядке, оставшихся heartbeat `sleep` нет: обе половины Ticket-а остаются.

**Что это даст Windows.** На Windows heartbeat гоняет только bash (zsh в Git Bash нет, `SHELLS=(bash)`), так что
параллельные тела там ничего не экономят: выигрыш heartbeat — на Linux и macOS. На Windows остаётся выигрыш
guard-silent: 13 s фиксированных ожиданий из 46 s. Сколько это даст shard-у 3/3, покажет run `windows / full-suite`
этого PR: файлы `harness-scripts.test.ts` идут по пять сразу, и файл сокращает shard, только если он на критическом пути.

### Mutant-ы

- **guard-silent, guard без timeout-а** (из `spawnSync` в `harness/hooks/guard.mjs` убран `timeout: t`): exit 1,
  `passed 91, failed 12`, 614 s. Красные — все укороченные случаи: «timeout twice» (5 проверок), `sleep,0` (число
  вызовов), `sleep,traces` (2), «two checks, one budget» (2), «default tries» (2). Файл восстановлен из копии, `cmp` — 0.
- **heartbeat, сломанное тело zsh** (в теле zsh `touch -c` заменён на `true`: heartbeat не трогает замок): exit 1,
  `passed 24, failed 1`, красная — «zsh: … the heartbeat … did not touch its own lock within 3 s». Восстановлен, `cmp` — 0.
- **heartbeat, тело zsh кончается без счёта** (`exit 0` в начале subshell-а zsh): exit 1, `passed 16, failed 1`,
  красная — «zsh: the body ended without its pass and fail counts». Восстановлен, `cmp` — 0.

### Проверки

- `node scripts/vitest-electron.mjs test/contract/harness-scripts.test.ts` под временным HOME — exit 0, 115 s
  после rebase на `caf7a914` (vitest: 114 s, 68 passed, 1 skipped — случай только для Windows); guard-silent в нём 47,8 s, heartbeat 19,5 s.
  Все 25 shell test-ов, что подключают `real-home.sh` и `gh-stand-in.sh` (список — `rg -l`), в нём зелёные.
- Отдельно под временным HOME: `wave-gate-lock-killed`, `wave-gate-lock`, `wave-gate-merge`, `wave-gate-screen`,
  `wave-gate` — exit 0 каждый. Других `guard-*.test.sh`, кроме guard-silent, в `harness/hooks/tests/` нет.
- `pnpm lint`, `pnpm typecheck`, gate fast — exit 0.
