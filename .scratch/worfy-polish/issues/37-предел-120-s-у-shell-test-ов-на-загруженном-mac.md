# 37 — Предел 120 s у shell-test-ов на загруженном Mac

Type: task
Status: claimed 2026-10-22T18:16Z
Branch: worfy-polish/32-37
Blocked by: —
Source: gate full на Mac перед мержем PR #725, #705, #727, #728 (2026-10-22, ночь): красный только на
shell-test-ах `harness/bin/tests/`, отдельно они зелёные. Продолжение
[32](32-wave-gate-test-sh-дольше-предела-harness-scripts-под-нагрузкой.md) (тот же предел, замер 2026-10-18).
Строки — по main `b1700b18`.

## Что происходит

`test/contract/harness-scripts.test.ts` запускает каждый `harness/**/tests/*.test.sh` отдельным процессом с
пределом `FILE_TIMEOUT_MS` (`:37`): 120 s на Mac, 900 s на Windows. Под полным `pnpm test`, пока на Mac работают
другие агенты, этого предела не хватает:

- **`harness/bin/tests/wave-gate.test.sh`.** Один на Mac — 68–93 s; при load average 24–35 — 131 s. В полном
  `pnpm test` его убивает предел 120 s (`× bin/tests/wave-gate.test.sh exits 0 with an empty HOME 120006ms`).
  После PR #705 он уже разделён: случаи замка e2e ушли в `wave-gate-lock.test.sh`, общая подготовка — в
  `wave-gate-world.sh`.
- **`harness/bin/tests/wave-gate-heartbeat.test.sh`.** Красный в gate full PR #725 (10,7 s, не по пределу). Под
  нагрузкой в 1 из 40 запусков на zsh после него остался процесс `sleep` heartbeat-а. Отдельно — 3 из 3 зелёные.
  Это не предел, а остаток процесса; почему он остаётся только под нагрузкой — не выяснено.

Gate full на Mac был красным только из-за этого на PR #725, #705, #727, #728 (2026-10-22). Каждый такой красный —
повтор gate full (7–11 min) или мерж с объяснением, почему красный не от PR.

## Что делаем

Решения нет. Взвесить варианты и записать выбор с замером:

1. **Разбить дальше.** `wave-gate.test.sh` (771 строка) — ещё на файлы по разделам: у каждого файла свой предел.
   Цена: подготовка (`wave-gate-world.sh`) идёт в каждом файле заново.
2. **Ускорить медленные случаи.** Сначала замерить по разделам, как в 32 («Итог», «Где уходило время»):
   какие `sleep` проверяют сам механизм, а какие просто ждут.
3. **Поднять предел на Mac с замеренной ценой.** Как для Windows в PR #705: комментарий рядом с
   `FILE_TIMEOUT_MS` называет, на сколько позже обрывается зависший `.test.sh`.
4. **Запускать shell-test-ы по одному.** Цена — время `pnpm test` целиком; замерить.

Отдельно: остаток `sleep` в `wave-gate-heartbeat.test.sh` — найти, кто не дожидается heartbeat-а, или записать,
почему это не дефект `harness/bin/wave-gate`.

## Готово, когда

- [x] Выбор из вариантов выше записан в «Итог» с замером: время файла один и под нагрузкой (load average 20+),
      до и после.
- [x] Под полным `pnpm test` при load average 20+ — 3 прогона из 3 без падения shell-test-ов по пределу.
- [ ] Остаток `sleep` в `wave-gate-heartbeat.test.sh`: причина записана; если это дефект — правка и test,
      красный до неё.
- [x] `pnpm lint`, `pnpm typecheck` — exit 0; на Windows предел 900 s не меняется без отдельного замера.

## Где в коде

- `test/contract/harness-scripts.test.ts:37` — `FILE_TIMEOUT_MS`; комментарий выше — история пределов Windows.
- `harness/bin/tests/wave-gate.test.sh`, `harness/bin/tests/wave-gate-lock.test.sh`,
  `harness/bin/tests/wave-gate-world.sh`, `harness/bin/tests/wave-gate-heartbeat.test.sh`.

## Итог

Ветка `worfy-polish/32-37`, 2026-10-22, вместе с [32](32-wave-gate-test-sh-дольше-предела-harness-scripts-под-нагрузкой.md).
База — `origin/main` `0437d084`.

### Выбор: вариант 1 — разбить дальше; пределы не тронуты

- **Где уходило время** (копия test-а с отметкой времени у каждого `# --- … ---` и `new_world`, один, load ~5):
  74,6 s на 75 миров, самые долгие разделы — замок e2e 13,3 s, экран во время gate full 9,8 s, экран до gate
  7,9 s, red set 6,2 s, resume 4,1 s, блоки SKILL.md 4,5 s; остальные — по 0,3–3,9 s. Долгих «просто ждущих»
  `sleep` после #497 не осталось: оставшиеся `sleep` проверяют сам механизм (опрос замка и экрана раз в 1 s,
  «ждёт 3 s и не берёт замок»). Ускорять нечего, кроме подготовки миров, — поэтому разбиение (вариант 1).
- **Варианты 3 и 4 не нужны.** После разбиения самая долгая часть под нагрузкой до load average 55 — 55 s при
  пределе 120 s; `FILE_TIMEOUT_MS` (120 s на Mac, 900 s на Windows) не менялся. Запуск по одному не нужен.
- **Как разбито** (`harness/bin/tests/`, общий «мир» — по-прежнему `wave-gate-world.sh`):
  - `wave-gate.test.sh` — наборы PR, вердикты, плохой ввод, блоки SKILL.md (bash и zsh);
  - `wave-gate-merge.test.sh` (новый) — resume, squash-merge (база ушла, дерево не совпало, продолжение после
    обрыва, ошибка посреди merge, отказ `gh pr merge`), pid-файл, сборка между прогонами, batch CI;
  - `wave-gate-lock.test.sh` — живой замок e2e (ждёт, holder.json, старый и молодой замок, heartbeat, SIGTERM)
    перед прежними случаями убитого `wave-gate`;
  - `wave-gate-screen.test.sh` (новый) — экран до и во время gate full, `caffeinate`, нет `ioreg` и `caffeinate`.
- **Ни одна проверка не потеряна:** до — 165 `ok` в `wave-gate.test.sh` и 14 в `wave-gate-lock.test.sh` (179);
  после — 79 + 53 + 28 + 25 = 185. Лишние 6 — три строки «мира» и конца файла (`off Windows no case is skipped`,
  `no stub caffeinate of any test is left`, `the real ~/.claude … are unchanged`) теперь в двух новых файлах.
  Множество имён проверок до и после совпадает (`diff` отсортированных строк `ok`).
- `test/contract/harness-scripts.test.ts`: `RUN_FIRST` — по новому замеру (самые долгие файлы теперь
  `skill-blocks`, `guard-silent`, `profile`, `gate-verdict`, потом `wave-gate-lock` и `wave-gate`).
- `docs/lessons/agents.md`: три строки «Проверка:» указывали на строки `wave-gate.test.sh`, ушедшие в новые файлы,
  — переведены на `wave-gate-lock.test.sh:22`, `wave-gate-screen.test.sh:21`, `wave-gate-screen.test.sh:111`
  (без этого `pnpm lint` — exit 1).

### Ещё два места, где под нагрузкой не хватало ожидания

- **`qmd.test.sh`, «refresh: SIGTERM during --describe»** — красный в gate 2026-10-21 и 2026-10-22 (шесть
  логов gate, строка `FAIL refresh: SIGTERM during --describe left:` с пустым списком). Причина: test ждал pid
  stand-in-а `--describe` только 2 s (20 × 0,1 s); под нагрузкой `qmd-refresh` не доходил до него за 2 s, SIGTERM
  приходил раньше, pid-файла не было — и проверка краснела, хотя временный файл не остался. Теперь test ждёт pid
  до 30 s опросом, а stand-in не выходит, пока test его не отпустит (тоже до 30 s): SIGTERM гарантированно
  приходит во время `--describe`. Красный до правки: копия с задержкой 2,5 s в stand-in (как медленный старт
  `qmd-refresh`) — `origin/main` exit 1 с той же строкой FAIL, ветка exit 0. Мутант `qmd-refresh` без очистки
  (`trap ':' EXIT` вместо `rm -f`) — новая проверка exit 1, `left: qmd-refresh-describe.XXXXXX`.
- **`caf_gone` в `wave-gate-world.sh`** — ждал конца stub `caffeinate` 3 s; при load average 55 (раунд 4 ниже)
  `wave-gate-lock.test.sh` покраснел на `stub caffeinate left` (не по пределу). Stub сам опрашивает свой pid
  раз в 0,2 s; ожидание стало 15 s опросом, раунд 5 после правки — зелёный.

### Замер (Mac, 18 ядер; на машине работали другие агенты)

Нагрузка — под замком e2e: 9 процессов `yes > /dev/null` и одновременно полный `pnpm test` того же дерева и
`node scripts/vitest-electron.mjs --project contract test/contract/harness-scripts.test.ts`. Время — из
вывода vitest для каждого `.test.sh`.

| | load average | wave-gate.test.sh | -lock | -merge | -screen | harness-scripts | полный `pnpm test` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| до, один (load ~5) | 5 | 74,6 s | 23,2 s | — | — | — | — |
| до, contract без своей нагрузки | 19–25 | 105,4 s | 26,2 s | — | — | exit 0, 144 s | — |
| до, под нагрузкой | 29–36 | **119,2 s** | 26,0 s | — | — | exit 0, 163 s | exit 0, 189 s |
| после, один (load ~5) | 5 | 23,5 s | 36,0 s | 20,0 s | 22,6 s | — | — |
| после, contract без своей нагрузки | 14–19 | 43,7 s | 45,2 s | 20,1 s | 21,7 s | exit 0, 142 s | — |
| после, раунд 1 | 25–29 | 45,8 s | 49,1 s | 30,1 s | < 30 s | exit 0, 172 s | exit 0, 193 s |
| после, раунд 2 | 31 | 44,7 s | 51,2 s | 27,8 s | < 28 s | exit 0, 168 s | exit 0, 169 s |
| после, раунд 3 | 51 | 49,4 s | 55,0 s | 34,0 s | 28,8 s | exit 0, 186 s | exit 1 ¹ |
| после, раунд 4 | 55 | 49,1 s | 53,4 s ² | 35,9 s | < 32 s | exit 1 ², 190 s | exit 1 ¹ |
| после, раунд 5 (с правкой `caf_gone`) | 42 | 44,1 s | 45,7 s | 34,4 s | < 30 s | exit 0, 171 s | exit 0, 174 s |

¹ Не shell-test: по одному test-у с пределом 10 s в каждом раунде (`takes the answer into the line and nothing runs
until Enter`, `a program the shell starts finds no connection to the socket on any descriptor`), при load 50+.
² `FAIL stub caffeinate left` — ожидание `caf_gone` 3 s, исправлено (выше).

Итог по «Готово, когда»: в пяти полных `pnpm test` при load average 25–55 и в пяти отдельных прогонах
harness-scripts ни один shell-test не упал по пределу 120 s (до правки `wave-gate.test.sh` — 119,2 s из 120).
Самые долгие shell-test-ы теперь — `skill-blocks` (до 90 s при load 51), `guard-silent` и `gate-verdict` (до
82 s): вне этого Ticket-а, следующие кандидаты на разбиение.

### Остаток `sleep` в `wave-gate-heartbeat.test.sh`: причина

Воспроизведено под той же нагрузкой: в раундах 1–4 красные 3, 1, 2 и 2 из 6 одновременных копий test-а (и bash,
и zsh). Под одной нагрузкой CPU (`yes`), без полного `pnpm test` рядом, — 0 из 18: нужен поток созданий процессов. В копии test-а trap блока записывал состояние перед `pkill -P $HB`, stub `hbsleep` — свой
ppid и время старта. Пример (раунд 4): trap — `HB=77893 stat=TN kids=` (heartbeat остановлен, детей нет) в
…061,735; `hbsleep` с `ppid=77893` стартовал в …061,970 — после `pkill`. Второй случай — `ppid=1`: heartbeat уже
убит, когда его ребёнок начал работу.

Причина: в trap блока «gate full одного PR» (`harness/skills/epic-wave/SKILL.md`) `kill -STOP $HB`, ожидание `T` в
`ps` и `pkill -P $HB` не закрывают `fork`, который heartbeat начал до STOP: `ps` уже показывает `T`, а ребёнок
появляется позже, `pkill` его не видит, `kill -KILL $HB` оставляет его сиротой. Замена на `pkill -KILL -P` не
помогает (раунды 3–4 с ней — тоже остатки): сигнал не теряется, его просто некому послать. Это не дефект
`harness/bin/wave-gate`. Последствие в работе — процесс `sleep 300` живёт до 5 минут: вывод у него `/dev/null`, замок
он не трогает (цикл heartbeat-а убит). Правка — в trap блока SKILL.md и его test-е, вне следа этого Ticket-а:
открыта для Orchestrator-а (например, повторный `pkill -P $HB`, пока heartbeat ещё остановлен).

### Проверки

`pnpm lint` — exit 0, `pnpm typecheck` — exit 0; `bash harness/bin/tests/<файл>.test.sh` с пустым `HOME` — exit 0
для `wave-gate`, `wave-gate-merge`, `wave-gate-lock`, `wave-gate-screen`, `qmd`; `gate.mjs fast` — в PR.
На Windows не проверено: предел 900 s не менялся; новые файлы — те же случаи и тот же «мир», нужен вердикт Windows
(ADR-0056).
