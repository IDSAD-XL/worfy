# 88 — Flaky test: в `e3-sandbox.test.ts` два run-а `lock-run` держат lock одновременно

Type: bug
Status: done 2026-11-10T08:20Z
PR: #1775
Blocked by: —
Source: CI run 42741932918 (PR #1763, ветка `worfy-multi-repo-ticket/06`, job `linux-tests (4/4)`, 2026-11-10T02:23Z).
Изменения PR-а этого test-а и `scripts/e3-sandbox.sh` не касались. Раньше тот же test дал строку FLAKY (упал, прошёл
на retry) в CI run 42711434694 (ветка `worfy-multi-repo-ticket/04`, `linux-tests (4/4)`, 2026-11-09T22:26Z). Строки
перечитаны по main `100acec94`.

## Что происходит

`test/contract/e3-sandbox.test.ts:1114` — test «two runs that find the same abandoned lock do not both take it: the
one that removed it pauses first». Два `lock-run` (`first` и `second`) находят один брошенный lock (папка с mtime
31 минуту назад, :1191). Stand-in-ы `rmdir` (:1138) и `sleep` (:1149) ждут друг друга через файлы-метки в
`<scratch>/race`, так что порядок шагов не зависит от скорости машины. Команда под lock-ом (`under-lock.sh`, :1164)
пишет `enter <run>` и `exit <run>` в общий log.

В CI упали обе попытки (первая и retry). Проверка на :1202:

```
AssertionError: expected [ [ 'enter first', …(3) ], …(1) ] to deep equally contain [ 'enter first', 'enter second', …(2) ]
AssertionError: expected [ [ 'enter first', …(3) ], …(1) ] to deep equally contain [ 'enter second', 'enter first', …(2) ]
```

То есть log был `enter first, enter second, exit second, exit first` (во второй попытке — наоборот): второй run
вошёл под lock, пока первый его держал. Файла `stuck` не было (проверка на :1194 прошла), оба run-а вышли с
exit code 0. Это ровно тот случай, от которого test охраняет: `lock_run` в `scripts/e3-sandbox.sh:376` берёт lock
через `mkdir`, а брошенный lock снимает `rmdir` с паузой перед новой попыткой (:379–387). Пока неизвестно, где
дыра: в самом `lock_run` (тогда это настоящая ошибка lock-а e2e-песочницы, а не flaky test) или в порядке
stand-in-ов test-а.

## Что делаем

- Сначала воспроизвести и понять: прогнать один этот test много раз (например, 200) под нагрузкой, похожей на
  `linux-tests` (параллельный полный `pnpm test` или `stress`), на Linux и на Mac. Сохранить при падении весь
  `<scratch>/race` (метки, `log`, `*.pauses`) и порядок событий. Счёт падений и найденная последовательность — в
  «Итог».
- По найденной последовательности решить, чья ошибка:
  - дыра в `lock_run` — исправить скрипт так, чтобы два run-а не держали lock одновременно; test остаётся как есть
    и должен ловить старую версию скрипта;
  - дыра в stand-in-ах — закрыть её в порядке меток test-а так, чтобы test по-прежнему краснел без паузы в
    `lock_run` (проверить, убрав паузу: test должен упасть).
- Пределы времени test-а (`ms(120_000)`, 90 s на run) не поднимаем: test падает не по времени.

## Готово, когда

- [x] Причина названа одной последовательностью шагов двух run-ов; она и счёт падений до исправления — в «Итог».
  - evidence: test-run pass · `bash loop.sh e3-sandbox.sh@origin/main 25 8` (bash copy of the test) on Ubuntu 26.04, uutils mkdir 0.8.0 exit 0: 12 of 200 rounds both runs under the lock · mac - · aab8b44e9dabcba825f4e906f50673ed007c1410
- [x] `node scripts/vitest-electron.mjs test/contract/e3-sandbox.test.ts -t "abandoned lock"` 200 раз подряд под
      нагрузкой — 0 падений; команда и счёт — в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/e3-sandbox.test.ts -t "abandoned lock"` 200 times, 4 loops + 12 yes, macOS exit 0: 0 of 200 failed · mac - · aab8b44e9dabcba825f4e906f50673ed007c1410
- [x] С `lock_run` без паузы после `rmdir` брошенного lock-а test красный (mutation-проверка, результат — в «Итог»).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/e3-sandbox.test.ts -t "lock"` with no pause after rmdir (mutant) exit 1: abandoned lock test red 3 of 3 · mac - · aab8b44e9dabcba825f4e906f50673ed007c1410
- [x] Пределы времени test-а не изменены.
  - evidence: commit pass · Take the e2e lock with a bare mkdir(2): uutils mkdir let two lock-run calls hold it (worfy-polish 88) · - - · aab8b44e9dabcba825f4e906f50673ed007c1410
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · aab8b44e9dabcba825f4e906f50673ed007c1410

## Где в коде

- `test/contract/e3-sandbox.test.ts:1114` — test; :1138 — stand-in `rmdir`; :1149 — stand-in `sleep`;
  :1164 — `under-lock.sh`; :1191 — брошенный lock; :1202 — проверка порядка в log.
- `scripts/e3-sandbox.sh:376` — `lock_run`; :379–387 — цикл `mkdir`, снятие брошенного lock-а и пауза;
  :372 — `mtime_of`.

## Вне скоупа

- Остальные test-ы `e3-sandbox.test.ts` и heartbeat lock-а.
- Остальные flaky test-ы из таблицы `worfy-polish` 66.

## Итог

**Причина — настоящая дыра lock-а, не stand-in-ы test-а.** `lock_run` брал lock командой `mkdir`, а `mkdir` образа
`ubuntu-26.04` (на нём идёт `linux-tests`, строка `Image: ubuntu-26.04` в log-е CI run 42741932918) — uutils
coreutils 0.8.0 (Rust). Он сначала смотрит, есть ли папка, потом делает её, и если его `mkdir(2)` упал, а папка есть,
выходит с exit code 0. Два `mkdir` одной папки в одно время оба «берут» её. Upstream это исправлено коммитом uutils
«mkdir: do not ignore EEXIST on non-recursive creation» (2026-08-28), уже после 0.8.0.

Последовательность двух run-ов (по `bash -x` и меткам упавшего раунда bash-копии test-а на Ubuntu 26.04):

1. Оба run-а не смогли `mkdir`, оба прочли старое время брошенного lock-а, оба дошли до `rmdir`.
2. `first` снял lock (`rmdir` — код 0) и ушёл в паузу; `second` сделал свой `rmdir` (код 1, папки уже нет) и тоже ушёл
   в паузу.
3. Паузы кончились почти одновременно (пауза `first` ждёт конца `rmdir` у `second`, пауза `second` — сразу).
4. Оба вызвали `mkdir "$LOCK"`: оба uutils `mkdir` увидели, что папки нет; один её сделал, у второго `mkdir(2)` дал
   EEXIST, папка есть — exit 0.
5. Оба run-а запустили команду под lock-ом: log `enter first, enter second, exit second, exit first`. В xtrace каждого
   run-а ровно два `mkdir` и ни одного ожидания чужого lock-а.

На macOS (BSD `mkdir`) и в Debian 12 (GNU `mkdir`) падения нет: там `mkdir` — голый системный вызов.

**Замеры до исправления.**

| Где | Команда | Падения |
|---|---|---|
| macOS 26.6.1, 18 ядер, 4 параллельных цикла + 12 процессов `yes` | `node scripts/vitest-electron.mjs test/contract/e3-sandbox.test.ts -t "abandoned lock"`, 200 раз (`vitest-loop.sh`) | 0 из 200 |
| Ubuntu 26.04 (контейнер из `ubuntu-base-26.04.1-base-arm64.tar.gz`, uutils 0.8.0) | два `mkdir` одной папки разом, 2000 раундов | оба exit 0 в 1332 из 2000 |
| тот же контейнер | то же с `gnumkdir` (GNU coreutils 9.7 того же образа) | 0 из 2000 |
| macOS / Debian 12 (GNU) | два `mkdir` разом, 2000 раундов | 0 из 2000 / 0 из 2000 |
| Ubuntu 26.04 | копия test-а на bash (те же stand-in-ы `rmdir`/`sleep`, `lib.sh`, `under-lock.sh`, `E3_LOCK_PAUSE=7`), 8 параллельных циклов | 12 из 200 |
| Ubuntu 26.04 | та же копия, 40 параллельных циклов | 7 из 1000 |
| Debian 12 (GNU), 40 параллельных циклов | та же копия | 0 из 2000 |

Сам vitest с Electron в Linux-контейнере не запускался; на Linux мерила bash-копия test-а (`bash -x`) — тот же скрипт, те же
stand-in-ы, та же проверка log-а.

**Исправление.** `scripts/e3-sandbox.sh`: новая функция `take_lock` делает папку lock-а через
`perl -e 'mkdir($ARGV[0]) or exit 1'` — это голый `mkdir(2)`, он падает, когда папка есть. Perl есть в macOS, в Git for
Windows и в каждой Ubuntu (`perl-base`). Код выхода perl кроме 0 и 1 (нет perl) завершает скрипт, а не крутит цикл.
Формат lock-а прежний — пустая папка, её по-прежнему берут `mkdir` skill-ы и gate. Пауза после `rmdir` брошенного
lock-а и heartbeat не менялись. Пределы времени test-ов (`ms(120_000)`, 90 s на run) не менялись.

**Новый test** — `test/contract/e3-sandbox.test.ts`, «two runs that try at once do not both take the lock when mkdir
looks first and then makes the folder». Stand-in `mkdir` ведёт себя как uutils 0.8.0 и держит каждый run между
«посмотрел» и «сделал», пока другой run тоже не посмотрит, так что lock через команду `mkdir` берётся дважды на любой
машине, без отсчёта по часам.

**Mutation-проверка** (отдельная копия `git worktree add --detach /tmp/claude-501/p88-mut origin/main`, удалена):

- старый `scripts/e3-sandbox.sh` (`until mkdir`) + новый test — новый test красный 5 из 5, та же ошибка, что в CI:
  `expected [...] to deep equally contain [ 'enter first', 'enter second', …(2) ]`;
- новый скрипт без паузы после `rmdir` брошенного lock-а (`continue` вместо `sleep`) — test «abandoned lock» красный
  3 из 3, остальные 14 test-ов lock-run зелёные.

**Замеры после исправления.**

| Где | Команда | Падения |
|---|---|---|
| Ubuntu 26.04 | bash-копия test-а, 8 параллельных циклов | 0 из 200 |
| Ubuntu 26.04 | bash-копия test-а, 40 параллельных циклов | 0 из 1000 |
| macOS 26.6.1, 4 цикла + 12 `yes` | `node scripts/vitest-electron.mjs test/contract/e3-sandbox.test.ts -t "abandoned lock"`, 200 раз | 0 из 200 |

**Тот же lock в skill-ах Harness — без Ticket-а** (решение владельца 2026-11-10). Lock e2e в skill-ах Harness берётся
тем же `until mkdir`, и на `ubuntu-26.04` (uutils `mkdir` 0.8.0 выходит с кодом 0 на EEXIST) его тоже могут взять
двое. Это важно только на Linux, а lock skill-ов сегодня работает на Mac и на ПК, поэтому остаётся эта запись.
