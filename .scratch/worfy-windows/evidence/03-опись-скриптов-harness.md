# Evidence Ticket-а 03 — опись скриптов Harness на main 5ee66a7

Продолжение раздела 18 файла [01-факты-windows.md](01-факты-windows.md): тот же вид описи, снятой заново к началу
[Ticket-а 03](../issues/03-gate-на-node.md). Вынесено в свой файл, чтобы первый файл не перешёл 1000 строк.

## Опись заново на main 5ee66a7 (к началу Ticket-а 03, 2026-10-13)

Пункт «Готово, когда» Ticket-а 03, перенесённый из Ticket-а 01. Опись в разделе 18 первого файла не меняется; здесь — та же
опись на main `5ee66a7` (от него идёт ветка `worfy-windows/03`). Команда — из шага 4 Ticket-а 01, с
одной заменой: файлы и их первые строки читаются из commit-а, а не с диска. Причина: рабочее дерево
ветки в это время правит Ticket 03 (`gate.sh` → `gate.mjs`). Вместо `git ls-files` — `git ls-tree -r
--name-only 5ee66a7`, вместо `head -n1 "$f"` — `git show 5ee66a7:"$f"`. Git Bash, вывод каждой
команды — в файл `%TEMP%\worfy-01\t03c-*.txt`, затем `echo "EXIT=$?"`. Столбцы: путь, число строк
(`wc -l`), первая строка.

```
$ git rev-parse --verify '5ee66a7^{commit}'
5ee66a724955b2d81c3b56f481411809af1a2ebd
EXIT=0
$ git rev-parse --short HEAD; git branch --show-current
5ee66a7
worfy-windows/03
EXIT=0
$ git ls-tree -r --name-only 5ee66a7 -- harness/bin harness/hooks > t03c-new-all.txt; echo "EXIT=$?"
EXIT=0                                                    (47 строк: 26 вне tests, 21 в tests)
$ while read f; do git show "5ee66a7:$f" > blob; printf '%s\t%s\t%s\n' "$f" "$(wc -l < blob)" "$(head -n1 blob | tr -d '\r')"; done < t03c-new-all.txt      (вне tests)
harness/bin/TICKETS.md               59   # Glossary of tickets and epics
harness/bin/decision-log             142  #!/usr/bin/env node        (новый против 08e8256)
harness/bin/epic-board               371  #!/usr/bin/env node
harness/bin/epic-status              331  #!/usr/bin/env bash
harness/bin/preflight                480  #!/usr/bin/env bash
harness/bin/profile                  376  #!/usr/bin/env node
harness/bin/project-connect          512  #!/usr/bin/env node        (новый против 08e8256)
harness/bin/qmd-collections          394  #!/usr/bin/env node
harness/bin/qmd-mcp                  95   #!/bin/zsh
harness/bin/qmd-refresh              203  #!/bin/zsh
harness/bin/qmd-sync-main            110  #!/bin/zsh
harness/bin/silent-check             235  #!/usr/bin/env node
harness/bin/ticket                   322  #!/usr/bin/env node
harness/bin/worktree-lock            289  #!/usr/bin/env node
harness/hooks/gate-resolve.mjs       248  #!/usr/bin/env node
harness/hooks/gate.sh                536  #!/usr/bin/env bash
harness/hooks/gh-token-env.sh        66   #!/usr/bin/env bash
harness/hooks/guard.mjs              414  #!/usr/bin/env node
harness/hooks/hooks.json             146  {
harness/hooks/inject-rules.sh        46   #!/usr/bin/env bash
harness/hooks/rules/common.md        78   # worfy Harness — common rules
harness/hooks/rules/orchestrator.md  160  # worfy Harness — orchestrator rules
harness/hooks/session-end.sh         37   #!/usr/bin/env bash
harness/hooks/session-start.sh       126  #!/usr/bin/env bash
harness/hooks/stop.sh                197  #!/usr/bin/env bash
harness/hooks/worktree-create.sh     92   #!/usr/bin/env bash
EXIT=0
$ diff <опись 08e8256: путь и первая строка> <опись 5ee66a7: путь и первая строка>      (обе сняты из git этой же командой)
1a2
> harness/bin/decision-log	#!/usr/bin/env node
5a7
> harness/bin/project-connect	#!/usr/bin/env node
EXIT=1
$ git diff --stat=200 08e8256 5ee66a7 -- harness/bin harness/hooks ':!harness/bin/tests' ':!harness/hooks/tests'      (полосы из `+` и `-` сокращены)
 harness/bin/decision-log            | 142 +
 harness/bin/profile                 |  14 +-
 harness/bin/project-connect         | 512 +
 harness/hooks/gate.sh               |  71 +
 harness/hooks/guard.mjs             |  10 +-
 harness/hooks/rules/orchestrator.md |   4 +
 6 files changed, 751 insertions(+), 2 deletions(-)
EXIT=0
$ git log --format='%h %ad %s' --date=short 08e8256..5ee66a7 -- harness/bin/decision-log harness/bin/project-connect
d0c3d30 2026-10-12 worfy-review/06: decision-log appends a wave's decisions to decisions.tsv (#232)
119425a 2026-10-09 worfy-harness/24: connect a Project from "Add project" (#176)
EXIT=0
$ git log --format='%h %ad %s' --date=short 08e8256..5ee66a7 -- harness/hooks/gate.sh harness/bin/profile harness/hooks/guard.mjs
067e783 2026-10-13 worfy-harness/35: attribution is off by default in Silent mode (#268)
c80d43a 2026-10-10 worfy-review/03: the gate warns when a diff takes a file over 1000 lines (#221)
EXIT=0
$ git diff --stat 08e8256 5ee66a7 -- harness/hooks/hooks.json harness/.mcp.json
EXIT=0                                                    (вывод пуст: оба файла не менялись)
$ git grep -c 'worktree-create' 5ee66a7 -- harness/hooks/hooks.json
EXIT=1                                                    (вхождений нет: hook не зарегистрирован)
$ git merge-base --is-ancestor 5ee66a7 origin/main; echo "EXIT=$?"; git log --format='%h %ad %s' --date=short 5ee66a7..origin/main
EXIT=0
2a6dfee 2026-10-13 worfy-windows 12: the PC checks left to the owner's word, read by scripts; the leftovers removed (#285)
412709c 2026-10-13 worfy-windows/28: the review leftovers of PR #257 — the waits of a removal, the rmSync ban, tests for removals that had none (#283)
EXIT=0
$ git diff --name-status 5ee66a7 origin/main -- harness/bin harness/hooks
EXIT=0                                                    (вывод пуст)
```

Локальная ссылка `origin/main` — `2a6dfee`, на два commit-а новее `5ee66a7` (`git fetch` не делался).
В `harness/bin` и `harness/hooks` эти два commit-а ничего не меняют: опись верна и для `2a6dfee`.

**Числа.** Вне `tests` — 26 файлов: 22 скрипта и 4 файла без shebang (`TICKETS.md`, `hooks.json`,
два файла `rules`). В `harness/bin` — 13 скриптов: Node 8, bash 2, zsh 3. В `harness/hooks` — 9
скриптов: Node 2, bash 7. Всего: Node 10, bash 9, zsh 3.

**Что изменилось против описи на 08e8256.** Добавлены два скрипта, оба на Node:
`harness/bin/decision-log` (Epic worfy-review, Ticket 06, PR #232) и `harness/bin/project-connect`
(E3 Ticket 24, PR #176). Удалённых скриптов нет. Язык не сменил ни один скрипт. Из прежних скриптов
менялись три: `gate.sh` (465 → 536 строк), `profile` (364 → 376), `guard.mjs` (406 → 414). Остальные
скрипты на bash и zsh совпадают с 08e8256 побайтно. `hooks.json` и `harness/.mcp.json` не менялись:
строки вызовов те же. Исходы «в Git Bash как есть» заново не снимались: рабочее дерево занято
Ticket-ом 03; для скриптов без изменений держатся исходы таблицы выше.

Числа строк в Ticket-ах устарели: Ticket 03 пишет про `gate.sh` «465 строк», на 5ee66a7 их 536;
Ticket 05 про `epic-status` — 313, на 5ee66a7 — 331; Ticket 06 про `preflight` — 459, на 5ee66a7 —
480. Номера строк перед работой перечитать.

**Скрипты на bash и zsh — по одному Ticket-у.** «Кто зовёт» — по `git grep` на 5ee66a7. Основание —
цитата из текста Ticket-а.

| Скрипт | Язык | Строк | Кто зовёт (5ee66a7) | Ticket | Основание |
|---|---|---|---|---|---|
| `harness/hooks/gate.sh` | bash | 536 | `hooks.json:67`, `:78` (`TaskCompleted`, `TeammateIdle`); skills `epic-wave`, `ship-ticket`, `overnight-fix-loop`; agent `implementer`; `rules/common.md` | 03 | Ticket 03, «Что делаем», пункт 1: «`harness/hooks/gate.mjs` заменяет `gate.sh`; `gate.sh` удаляется». Ticket 04: «Не входит: Gate (Ticket 03)» |
| `harness/hooks/inject-rules.sh` | bash | 46 | `hooks.json:9`, `:18`, `:56` (`SessionStart`, `SubagentStart`) | 04 | Ticket 04, пункт 1: «Четыре hooks на Node …: `inject-rules.mjs`, `session-start.mjs`, `session-end.mjs`, `stop.mjs` в `harness/hooks` вместо `.sh`; файлы `.sh` удаляются» |
| `harness/hooks/session-start.sh` | bash | 126 | `hooks.json:27` (`SessionStart`) | 04 | тот же пункт 1 Ticket-а 04 |
| `harness/hooks/session-end.sh` | bash | 37 | `hooks.json:118` (`SessionEnd`) | 04 | тот же пункт 1 Ticket-а 04 |
| `harness/hooks/stop.sh` | bash | 197 | `hooks.json:89` (`Stop`) | 04 | тот же пункт 1 Ticket-а 04. Ticket 03 правит в нём только имя Gate: «В stop.sh, profile и preflight меняются только имя Gate в тексте и комментариях: сами эти скрипты переводят на Node Ticket-ы 04, 05 и 06» |
| `harness/hooks/gh-token-env.sh` | bash | 66 | `hooks.json:36` (`SessionStart`) | 04 | Ticket 04, пункт 7: «Hook E3 на bash — `gh-token-env.sh` — переводится так же, вместе со своим test-ом» |
| `harness/bin/epic-status` | bash | 331 | skills `epic-wave`, `ship-ticket`, `continuous-audit`; `preflight`, `epic-board`; worfy (`src/main/workflow/reader.ts`) | 05 | Ticket 05, пункт 1: «`epic-status` на Node (Q19, ADR-0055 пункты 1 и 3)». Ticket 06 его только зовёт: «`epic-status` на bash, пока не влит Ticket 05» |
| `harness/bin/preflight` | bash | 480 | skills `epic-wave` (`:77`, `:675`), `ship-ticket` (`:108`) | 06 | Ticket 06, пункт 1: «`preflight` на Node (Q19, ADR-0055 пункты 1 и 3)». Ticket 05: «Не входит: `preflight` (Ticket 06)» |
| `harness/bin/qmd-mcp` | zsh | 95 | `harness/.mcp.json:4` (по shebang) | 15 | Ticket 15, пункт 1: «`qmd-mcp`, `qmd-refresh` и `qmd-sync-main` переписаны с zsh на Node» |
| `harness/bin/qmd-refresh` | zsh | 203 | `hooks.json:107` (`Stop`) | 15 | тот же пункт 1 Ticket-а 15. Ticket 04: «`bin/qmd-refresh` (`:107`, его переводит Ticket 15)» |
| `harness/bin/qmd-sync-main` | zsh | 110 | `harness/bin/qmd-collections:48` (строка `update:` коллекций) | 15 | тот же пункт 1 Ticket-а 15. Ticket 05: «Не входит: … обёртки qmd (Ticket 15)» |

Итог по Ticket-ам: 03 — 1 скрипт, 04 — 5, 05 — 1, 06 — 1, 15 — 3. Это 11 из 12 скриптов на bash и
zsh.

**Не приписан — 1 скрипт: `harness/hooks/worktree-create.sh`** (bash, 92 строки). Решение здесь не
принимается; ниже — что о нём сказано.

- Ticket 04 его называет, но не переводит. Пункт 7: «`worktree-create.sh` не портируется до решения
  E3 Ticket-а 24 (не зарегистрирован в `hooks.json`; evidence Ticket-а 01, раздел 18); проверка «нет
  `.sh` в `harness/hooks`» ниже его не считает». «Готово, когда»: «в `harness/hooks` нет скриптов на
  bash вне test-ов, кроме незарегистрированного `worktree-create.sh` (ждёт E3 Ticket 24)».
- Ticket-ы 03, 05, 06 и 15 его не называют (поиск `worktree-create` по папке Ticket-ов Epic-а даёт
  только Ticket-ы 01 и 04).
- Условие Ticket-а 04 уже наступило, а судьбу скрипта не решило. E3 Ticket 24 закрыт 2026-10-09 (PR
  #176, `119425a`). В его тексте `worktree-create.sh` не назван; там сказано: «Worktree вне
  репозитория в этот Ticket не входят». На 5ee66a7 скрипт по-прежнему не зарегистрирован в
  `hooks.json` (команда выше, EXIT=1), его никто не зовёт; сам скрипт и его шапку проверяют test-ы
  `silent-mode.test.sh` и `epic-wave-ship-ticket.test.sh`. Его же называет открытый E3 Ticket 28 (git
  и `HARNESS_HOME` в прогонах eval) в «Где в коде».
- Вопрос владельцу: перевести скрипт на Node в Ticket-е 04, удалить его или оставить на bash как
  незарегистрированный черновик. Пока ответа нет, пункт «каждый скрипт на bash и zsh приписан ровно
  к одному Ticket-у» для этого скрипта не выполнен.

**Приписан к двум — нет.** Некоторые скрипты названы в нескольких Ticket-ах: `gate.sh` — в 03 и 04,
`stop.sh` — в 03 и 04, `epic-status` — в 05 и 06, `preflight` — в 03, 05 и 06, обёртки qmd — в 04,
05 и 15. На Node каждый из них переводит один Ticket. Остальные правят в нём текст, зовут его или
прямо пишут «не входит» (цитаты в таблице).

**Test-ы (`tests/`) — отдельно.** По решению владельца Q19 bash остаётся в test-ах: эти файлы на Node
не переводятся и к Ticket-ам порта не приписываются. На 5ee66a7 их 21: 20 с первой строкой
`#!/usr/bin/env bash` и `harness/bin/tests/real-home.sh` без shebang (его подключают через `source`).

```
$ то же, для путей с /tests/                                (путь, число строк)
harness/bin/tests/agents-text.test.sh            276
harness/bin/tests/decision-log.test.sh           510   (новый против 08e8256)
harness/bin/tests/epic-wave-ship-ticket.test.sh  363
harness/bin/tests/harness-home.test.sh           347
harness/bin/tests/preflight.test.sh              154
harness/bin/tests/profile.test.sh                401
harness/bin/tests/project-connect.test.sh        334   (новый против 08e8256)
harness/bin/tests/qmd-collections.test.sh        193
harness/bin/tests/qmd.test.sh                    166
harness/bin/tests/real-home.sh                   41    (без shebang)
harness/bin/tests/silent-mode.test.sh            486
harness/bin/tests/skill-blocks.test.sh           174
harness/bin/tests/tickets-root.test.sh           133
harness/hooks/tests/gate-file-size.test.sh       317   (новый против 08e8256)
harness/hooks/tests/gate-notverified.test.sh     153
harness/hooks/tests/gate-unregistered.test.sh    73
harness/hooks/tests/gate-verdict.test.sh         188
harness/hooks/tests/gh-token-env.test.sh         190
harness/hooks/tests/guard-silent.test.sh         148
harness/hooks/tests/rules-hooks.test.sh          314
harness/hooks/tests/session-hooks.test.sh        210
EXIT=0
```

**Скрипты на Node** в пункт «Готово, когда» не входят: он требует приписать скрипты на bash и zsh.
Два новых — для сведения. `harness/bin/project-connect` зовут worfy (`src/main/ipc/projects.ts`,
`src/main/projects/connect.ts`) и skill `connect-project`; его запуск из worfy через `node` — в
Ticket-е 30 («Add project» на Windows). Сам он зовёт соседа `qmd-collections` по пути, то есть по
shebang (`project-connect:52`, `:498`), а домашнюю папку берёт из `HOME` с запасным `os.homedir()`
(`:48`). `harness/bin/decision-log` зовёт skill `epic-wave` (`SKILL.md:167`) по shebang из Bash tool;
ни в одном Ticket-е Epic-а worfy-windows он не назван. Поиск `process.env.HOME`, `spawn` и `execFile`
по обоим файлам (`git grep` на 5ee66a7, EXIT=0) нашёл совпадения только в `project-connect`.
