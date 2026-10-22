# 72 — `wave-gate` на Windows не снимает замок e2e, когда его останавливают сигналом

Type: bug
Status: done 2026-10-21T17:06Z
PR: #705
Blocked by: —
Source: Ticket [71](71-harness-test-sh-на-windows.md) (PR #555), 2026-10-20 — найдено при переносе
`wave-gate.test.sh` на Git Bash; проверка «e2e lock on signal» на win32 пропущена с причиной. Правка `harness/` —
свой PR с Mac gate (ADR-0056).

Приоритет — low: на Windows Wave пока не гоняют; замок не вечный, а только до порога устаревания.

## Что происходит

- `harness/bin/wave-gate` снимает замки и pid-файл в обработчике сигналов: `SIGNALS = { SIGHUP, SIGINT,
  SIGTERM }` (`:114`), `process.on(sig, …)` (`:842-845`) — «A signal is a broken-off run: … the locks go».
- На Windows node не получает SIGTERM от другого процесса: `process.kill(pid, 'SIGTERM')` и `kill` из Git Bash
  завершают процесс сразу, обработчик не выполняется. Из названных сигналов на Windows приходят только SIGINT
  (Ctrl+C в консоли) и SIGHUP (закрытие окна консоли); ещё бывает SIGBREAK (Ctrl+Break), его в списке нет.
- Итог: остановленный так `wave-gate` оставляет каталог замка e2e (`workflow.e2e_lock`). Следующий запуск ждёт,
  пока замок не устареет по возрасту: `WAVE_GATE_LOCK_STALE_S`, по умолчанию 1800 s (`:108`, проверка `:199-200`).
  Замок main (`:109`) — так же, 5400 s.
- Test `wave-gate.test.sh` «e2e lock on signal: exit 3, lock gone» на win32 после Ticket-а 71 пропускается с
  этой причиной; на macOS и Linux идёт.

## Что делаем

1. Замок e2e (и main) хранит pid владельца, как pid-файл (`:326-385` — захват устаревшего по pid). Ждущий
   `wave-gate` считает замок брошенным сразу, если процесса с этим pid нет, а не только по возрасту.
2. На win32 добавить SIGBREAK в `SIGNALS` — Ctrl+Break тоже снимает замки.
3. Test: замок с pid несуществующего процесса снимается без ожидания `stale`, на всех системах; проверка «e2e
   lock on signal» на win32 заменяется этим случаем (или остаётся пропуском только для самого SIGTERM).
4. pid на Windows — это pid Windows, а не MSYS. `process.kill(pid, 0)` (`harness/bin/wave-gate:333`) на Windows не
   смотрит на два младших бита pid: на ПК pid живого node плюс 2 отвечает «жив». В Git Bash `$!` — pid MSYS, не
   Windows, и он может попасть рядом с живым процессом Windows. Отсюда flaky test `wave-gate.test.sh` «pid dead»
   (`:434-438`, `sleep 0 & dp=$!`): 1 красный из 125 в прогоне файла отдельно на 5835f33f, 2026-10-20, и зелёный в том
   же файле внутри `harness-scripts.test.ts`. Пункт 1 (pid владельца в замке) — та же проверка, поэтому и pid-файл, и
   замок берут pid Windows: в test-е — из `/proc/<pid>/winpid` или `ps -W`; `wave-gate` пишет свой `process.pid`, он
   уже pid Windows. Сначала test, красный до правки: pid-файл с pid, который на 1–3 больше pid живого процесса
   Windows, — `wave-gate` должен считать его мёртвым (или test берёт winpid завершённого `sleep`). Случай «pid live»
   (`:428-431`, `$sp`) проверить так же: он зелёный на ПК, но опирается на тот же pid MSYS.

## Готово, когда

- [x] `wave-gate`, убитый на Windows (`taskkill /F` или `kill` из Git Bash), не задерживает следующий запуск
      дольше одного опроса замка (`WAVE_GATE_LOCK_POLL_S`).
- [x] `wave-gate.test.sh` — exit 0 в Git Bash на ПК; новый случай красный до правки.
- [ ] `wave-gate.test.sh` — exit 0 на Mac. Не проверено на ПК: Mac checks в PR.
- [ ] Mac gate (ADR-0056) зелёный.
- [x] «pid dead» и «pid live» в `wave-gate.test.sh` берут pid Windows; 5 прогонов файла подряд в Git Bash — без
      красного.

## Где в коде

- `harness/bin/wave-gate`: `:112` (`TAKEOVER_STALE_S`, возраст маркера перехвата), `:120` (`SIGNALS`, `SIGBREAK`
  на Windows), `:190-240` (`lock`: ожидание, возраст замка, `holder.json` с `host`), `:248` (`deadHolder`), `:267`
  (`takeOver`: маркер `<lock>.takeover`, повторное чтение `holder.json`, повтор `rmdir`), `:310` (`noteChild`, поле
  `child`), `:482` (`releasePid`), `:947-960` (обработчик сигналов: на Windows gate завершается `kill()` без
  сигнала, замки снимаются в любом случае).
- `harness/bin/tests/wave-gate.test.sh`: `:246` (`finish` — предел ожидания фонового запуска), `:631` (сигнал, который
  нельзя переслать: SIGHUP везде, SIGBREAK на Windows), `:656` («killed»), `:674` («orphan»), `:705` («twins»),
  `:716` («token», со старым замком), `:733` (`holder.json` без `host` и с чужим `host`).
- `harness/profiles/README.md`: `:184` (`workflow.e2e_lock`: для `bin/wave-gate` замок убитого прогона забирается
  сразу).
- Полный путь Windows проверяет одна функция `isWindowsAbsolutePath` (`src/shared/paths.ts:26`) вместо
  регулярного выражения `WINDOWS_FULL_PATH`: `src/main/agent/env.ts:475` (`findOnPath`), `src/main/program.ts:44`
  (`windowsProgramPath`), `src/main/harness/migrate/plan.ts:193` (`otherBuildBridge`). `\\srv` (сервер без общей
  папки) больше не считается полным путём: `test/unit/agent-env.test.ts:596`, `test/contract/github-accounts.test.ts:305`.
- `src/main/github/accounts.ts`: `:206`, `:227` (текст ошибки и JSDoc `signInCommand` называют `\\server\share\…`).
- Песочница `~/.claude` старого Harness собирается в одном месте: `test/claude-home-legacy.ts:13`
  (`copyLegacyFixture`, `SANDBOX_GIT_IDENTITY`). Её зовут `test/contract/harness-migrate-harness.ts:84`
  (`makeSandbox`) и `test/e2e/legacy-claude-home.ts:23` (`legacyClaudeHome`, общий для
  `test/e2e/harness-migrate.spec.ts` и `test/e2e/select.spec.ts`). `tsconfig.test.node.json` включает
  `test/claude-home-legacy.ts`.
- `test/contract/harness-migrate.test.ts:767` (диалог согласия: папка резервной копии задана явно, кавычки не
  зависят от пути репозитория).

## Найдено позже

2026-10-20, PC при проверке PR [#559](https://github.com/IDSAD-XL/worfy/pull/559) (worfy-harness 49 —
heartbeat замка e2e выходит, когда замка нет;
[комментарий](https://github.com/IDSAD-XL/worfy/pull/559#issuecomment-6283169991)). На merge не влияет:
Wave на Windows пока не гоняют.

- Блок замка e2e в `harness/skills/epic-wave/SKILL.md` ждёт, пока heartbeat остановится, через
  `ps -o stat= -p $HB`. У `ps` в MSYS нет `-o`, поэтому цикл ожидания кончается сразу (0 ms), а не
  после остановки.
- В Git Bash нет `pkill`. Дочерний `sleep 300` heartbeat-а живёт до 300 s после блока; замок к тому
  времени уже снят.
- `alive_of` в `harness/bin/tests/wave-gate-heartbeat.test.sh` тоже на `ps -o`: на Windows любой живой
  pid там считается живым процессом heartbeat-а.

## Итог

`wave-gate` больше не ждёт 30 min замок e2e, брошенный убитым `wave-gate`.

- В `holder.json` замка e2e `wave-gate` теперь пишет и `host` (`os.hostname()`), рядом с `pid` (свой
  `process.pid`; на Windows это уже pid Windows). Пока работает его дочерний процесс (gate, который гоняет e2e),
  в `holder.json` есть и `child` — pid этого процесса (`noteChild`).
- Ждущий `wave-gate` до проверки возраста читает `holder.json` (`deadHolder` в `harness/bin/wave-gate`). Если
  `host` — этой машины, процесса с этим `pid` нет и `child` тоже не работает, замок брошен, и его снимают сразу.
  На macOS и Linux убитый SIGKILL-ом `wave-gate` оставляет свой gate живым: пока gate гоняет e2e, замок держится.
  Не видно только внука — скрипта e2e, который пережил и `wave-gate`, и gate (shortcut в коде). На Windows дети
  node умирают вместе с ним: libuv кладёт их в job object, который закрывается с node. Проверено на ПК: после
  `taskkill /F` родителя-node его дочерний node мёртв.
- Захват (`takeOver`): ждущий сначала создаёт рядом папку `<замок>.takeover` через `mkdir` — из двух ждущих
  это удаётся одному. Под ней `holder.json` читается снова, и замок снимается, только если это всё ещё файл
  мёртвого держателя. Проигравший ждёт, как живой замок. Переименование (первый вариант: папку замка в своё имя)
  на Windows не исключает второго: libuv переименовывает через открытый handle, и два одновременных `renameSync`
  одного пути оба успешны — второй переносит уже перенесённое. Probe на ПК: папка — 30 из 30 раундов, файл — 22
  из 30; twins test падал 7 раз из 40 (два захвата одного мёртвого pid). С `mkdir`-маркером 40 из 40 зелёные.
  Маркер старше 60 s оставлен ждущим, убитым в эти миллисекунды, — его удаляют. `rmdir` снятого замка на
  Windows может упасть, пока другой ждущий читает удалённый `holder.json`; повтор до 1 s.
  Та же схема с переименованием есть в `guardPid` (pid-файл `wave-gate check`) — отдельный ticket Mac, здесь
  не трогаем.
  Мёртвый замок, чей маркер занят, по возрасту не снимается: его снимет держатель маркера (иначе ветка
  «по возрасту» обходила маркер — находка review).
  Shortcut (review, low): старый маркер удаляется в два шага (`stat`, потом `rmdir`). При трёх-четырёх
  одновременных ждущих один может удалить свежий маркер другого. Нужны и брошенный маркер, и толпа ждущих;
  переделать, если такое увидят. Twins test ловит двойной захват по таймингу, а не детерминированно (до
  исправления падал 7 раз из 40); пересечение двух прогонов gate по времени он не проверяет.
- Замок main (`merge`) остаётся только по возрасту, `holder.json` в нём нет: этот замок делят блоки main-ветки
  `harness/skills/epic-wave/SKILL.md` и `harness/skills/gate-queue/SKILL.md`, они снимают застрявший замок голым
  `rmdir`, и файл внутри им бы помешал. Пункт 1 «Что делаем» про main не сделан, по этой причине.
- По pid судят только `holder.json` с `host` этой машины. Блок gate full одного PR в
  `harness/skills/epic-wave/SKILL.md` пишет `"pid": $$` без `host`. В Git Bash `$$` — pid MSYS, не pid Windows,
  и `wave-gate` принял бы живой замок этого блока за брошенный. pid другой машины здесь ничего не значит. Такие
  замки по-прежнему ждут порога возраста.
- На win32 в `SIGNALS` добавлен SIGBREAK (Ctrl+Break), код выхода 149. Test-а нет: отправить Ctrl+Break
  процессу из test-а нельзя без общей консоли. SIGTERM от другого процесса node на Windows не получает по-прежнему;
  это закрывает пункт 1 выше, а не обработчик.

Test-ы в `harness/bin/tests/wave-gate.test.sh`, на всех системах:
- «killed»: gate stub убивает `wave-gate` SIGKILL-ом посреди прогона (на Windows — `kill -f -W` по pid Windows,
  как в случае resume). Замок остаётся с `pid` и `host`; следующий запуск берёт его сразу, сообщение «held by
  pid N, which is not running». Случай «e2e lock on signal» (SIGTERM) на win32 остаётся пропущенным с прежней
  причиной: обработчик сигнала там не выполняется, это проверяет случай «killed».
- «orphan»: убитый `wave-gate`, чей gate ещё работает (stub держит `hold`). `holder.json` называет gate как
  `child`; следующий запуск ждёт, пока gate не кончится, и сразу после этого берёт замок. На Windows gate умирает
  вместе с `wave-gate`: test оставляет `hold` и проверяет, что замок берут, пока он есть.
- «twins»: два запуска ждут один замок мёртвого `wave-gate`. Перехватывает один (одно сообщение «which is not
  running»), оба проходят gate, маркера `.takeover` не остаётся.
- «token»: мёртвый замок под молодым маркером ждут; старый маркер (60 s) удаляют и замок берут.
- `host` нет (запись блока SKILL.md) и `host` другой машины: молодой замок с мёртвым pid ждут.
- «pid dead» берёт pid завершившегося node (`process.pid`), а не `$!` от `sleep 0`: в Git Bash `$!` — pid MSYS,
  и он мог попасть рядом с живым процессом Windows (`process.kill(pid, 0)` на Windows не смотрит на два младших
  бита pid). «pid live» уже брал pid Windows (`/proc/<pid>/winpid`).

На ПК 2026-10-21 (вечер), Git Bash, после замены rename на маркер `mkdir`: на `wave-gate` из origin/main (файл
подменён на время прогона) — 136 passed, 7 failed, EXIT=1: «killed» (замок без `host`), «of a killed run» (следующий
запуск ждёт дольше 30 s), три случая «orphan», «twins» (оба ждут дольше 60 s) и «old token». Молодой маркер на
старом `wave-gate` проходит: старый код мёртвый замок не берёт вообще. На новом `wave-gate` — 5 прогонов файла
подряд, каждый 143 passed, 0 failed, EXIT=0, 272–295 s.

Low-ы ревью #678 (Mac, 2026-10-21; по выбору ПК — в этот тикет):
- Полный путь Windows проверяет одна функция, `isWindowsAbsolutePath` (`src/shared/paths.ts`): `findOnPath`
  (`src/main/agent/env.ts`), `windowsProgramPath` (`src/main/program.ts`) и `otherBuildBridge`
  (`src/main/harness/migrate/plan.ts`); `WINDOWS_FULL_PATH` убран. Разница: `\\srv` без share теперь не полный
  путь — `WORFY_GH=\\srv` отклоняется как относительный, запись Path `\\srv` пропускается. Текст отказа называет
  `\\server\share\…`.
- Песочница `~/.claude` старого Harness для e2e — один helper `test/e2e/legacy-claude-home.ts`
  (`legacyClaudeHome`) вместо копий в `harness-migrate.spec.ts` и `select.spec.ts`. Замена `__SANDBOX__` (и
  возврат концов строк к LF) — одна функция `substituteSandbox` в `test/claude-home-legacy.ts`, её берут и этот
  helper, и contract-helper `test/contract/harness-migrate-harness.ts`.
- Test строки диалога согласия (`test/contract/harness-migrate.test.ts`) — в своей группе «the consent dialog», с
  фиксированной папкой: кавычка в пути репозитория не даёт ложного красного.

На ПК, head после merge main `30649627`: unit/contract (`program`, `github-accounts`, `agent-env`,
`platform-paths`, `harness-migrate`, `first-run-windows`, `e2e-gh-stub`, `no-rmsync`, `e2e-no-spawn-on-load`) —
347 passed, 4 skipped, EXIT=0. typecheck сначала упал TS6307: новый `test/claude-home-legacy.ts` не был в
`tsconfig.test.node.json`, добавлен. e2e `harness-migrate` и `select` под watcher-ом `gh.exe` до merge — 4 passed,
gh.exe 0, EXIT=0; на этом head — после игры владельца (окна e2e забирают фокус). `pnpm typecheck`, `pnpm lint` — 0.
