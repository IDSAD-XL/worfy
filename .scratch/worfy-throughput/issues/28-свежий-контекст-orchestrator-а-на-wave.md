# 28 — Свежий контекст Orchestrator-а на каждую Wave: `bin/wave-brief` и остановка в конце Wave

Type: task
Status: done 2026-10-29T03:13Z
PR: #941
Blocked by: 27
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 4, решение 13;
аналитика 2026-10-27: Orchestrator — 21 % расхода,
около 295k token-ов контекста на вызов.

## Что происходит

- Session Orchestrator-а ведёт Wave за Wave-ой в одном контексте: в нём отчёты агентов, логи, решения прошлых
  Wave. Каждый следующий вызов модели читает их снова.
- Раздел «How to resume a wave» skill-а `epic-wave` (`:1400`) описывает, как продолжить после обрыва, но не
  требует начинать Wave с чистого контекста; брифа для новой Session нет — он собирается из `epic-status`,
  PR, журнала Wave и state file-ов руками.
- Модель не может сама выполнить `/clear`: новую Session начинает Autopilot, владелец или bridge.

## Что делаем

1. `harness/bin/wave-brief <epic>`: печатает до ~3k token-ов — что влито в последней Wave (PR, SHA), какие
   Ticket-ы ждут и чего (`Waits:`, метки `check/*`), открытые PR Epic-а с head и метками, последний
   `LAND=` из state file `land`, следующая Wave по `epic-status`, путь к журналу. Только чтение.
2. Skill `epic-wave`, раздел 5 «Report»: в конце Wave — отчёт, `wave-brief` в журнал Wave и остановка
   (решение владельца 2026-10-28, решение 13: «бриф и стоп»). Orchestrator сам следующую Wave не начинает:
   новую Session начинает worfy Autopilot или владелец, и её первая команда — `wave-brief`. Merge внутри Wave —
   только через `land` в фоне (Ticket 27).
3. `harness/hooks/rules/orchestrator.md`: вывод `land` и агентов читать сводкой (одна строка на PR), лог — по
   ссылке, не в контекст.

Нужен ПК: нет. **Трогает Harness: да** — новый `harness/bin/wave-brief`, skill `epic-wave`,
`harness/hooks/rules/orchestrator.md`; слово владельца дано 2026-10-28 (решение 1). Вердикт Windows: runner
`full` (скрипт Harness).

## Готово, когда

- [x] `harness/bin/tests/wave-brief.test.sh` на фикстуре Epic-а (Ticket-ы в разных Status, state file `land`)
      — вывод содержит влитые PR, ждущие Ticket-ы с причиной и следующую Wave; без state file — строка «land не
      запускался», код 0; неизвестный Epic — код 1.
- [x] Вывод `wave-brief` на фикстуре меньше 12 000 байт (test проверяет).
- [x] Тексты skill-а и `orchestrator.md` — фразы об остановке в конце Wave и о чтении сводкой;
      `skill-blocks.test.sh` / `agents-text.test.sh` — exit 0.
- [x] Shell test-ы Harness — exit 0; вердикт Windows — runner `full`; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
- [ ] (вручную) Две Wave-ы в свежих Session-ах; средний контекст на вызов Orchestrator-а до и после — по
      Ticket-у 19, в «Итог».
      Не проверено: нужны настоящие Wave после merge; под Autopilot Wave-ы идут в одной Session
      (`src/main/autopilot/run.ts:4-6`) — свежая Session на Wave требует отдельного Ticket-а.

## Где в коде

- `harness/bin/wave-brief`, `harness/bin/tests/wave-brief.test.sh` — новые
- `harness/skills/epic-wave/SKILL.md` — раздел 5 «Report» (`:1352`), «How to resume a wave» (`:1400`)
- `harness/hooks/rules/orchestrator.md`
- Только читать: `harness/bin/epic-status`, `harness/bin/land` (Ticket 27)

## Вне скоупа

- Запуск новой Session из worfy Autopilot — если Autopilot сейчас ведёт несколько Wave в одной Session, это
  отдельный Ticket по итогу этого (проверить при claim).

## Итог

- `harness/bin/wave-brief <epic> [--land <state file>]…` — Node, только чтение. Печатает: строку Stage из
  `epic-status`, ветку и commit checkout-а; по каждому state file `land` — последнюю строку `LAND=`, строку на
  PR (`#N <epic>/<NN> merged <sha>` или `waits (<kind>): <причина>`) и на documents PR, путь к логу; Ticket-ы
  `claimed` и `blocked` с `Waits:`, причиной и PR; открытые PR Epic-а (`gh pr list`, одна команда только на
  чтение; ветка `<epic>/…`, строка `Branch:` или `PR:` Ticket-а) с head, labels, отметками (`review`,
  `check/*`) и счётом CI check-ов; следующую Wave (open, все блокеры `done`); последнюю папку run-а Epic-а
  (`<HARNESS_HOME>/runs/<project>/<epic>-wave-<время>/`, `decisions.tsv`). Списки обрезаны до 25 строк,
  значения — до 160 символов. Без `--land` state file-ы берутся из строк `Land state:` последнего
  сохранённого брифа (`wave-brief.txt` в папке run-а); нет ни того, ни другого — «land has not run», код 0.
  Неизвестный Epic — код 1, без аргумента — 2. С `workflow.finish` `local-green` gh не вызывается.
- Skill `epic-wave`, раздел 5: абзац «Report, brief, stop» — Orchestrator не начинает следующую Wave в той же
  Session; merge Wave — только через `land` в фоне, его вывод читается строками на PR; последняя команда Wave —
  `wave-brief … >"<run folder>/wave-brief.txt"` (без человека) или вывод в отчёт (с человеком); строка
  `Wave brief:` в отчёте; затем стоп. «How to resume a wave»: первая команда новой Session — `wave-brief <epic>`.
- `harness/hooks/rules/orchestrator.md`, «Long output»: вывод `land` и агентов — сводкой (строка на PR и
  вердикт), лог — по пути, не целиком в контекст. Файл упёрся в предел 10 000 символов
  (`rules-hooks.test.sh`, с длинным plugin root), поэтому правило в две строки.
- Test-ы: `wave-brief.test.sh` — 29 проверок, в том числе read-only (дерево и Harness home без изменений,
  gh вызван только как `pr list`), размер (1,2 KB на фикстуре, 5,8 KB на Epic-е из 90 Ticket-ов с длинными
  причинами; без обрезки — 12,6 KB), команды из skill-а, вырезанные из `SKILL.md` и запущенные как написаны.
  Пины фраз — отдельный блок в `agents-text.test.sh`. 17 mutant-ов (12 скрипта, 5 текста) — каждый красный.
- Проверка при claim (раздел «Вне скоупа»): Autopilot ведёт Wave за Wave-ой в одной Session Orchestrator-а,
  продолжая её SDK session (`src/main/autopilot/run.ts:1-9`). «Бриф и стоп» останавливает Orchestrator в
  конце Wave, но следующую Wave Autopilot пошлёт в ту же Session — свежего контекста на Wave из-за этого
  Ticket-а под Autopilot не будет. Нужен отдельный Ticket: Autopilot начинает новую Session на каждую Wave.
- Место state file-а `land` в разделе 4 (`<orchestrator scratchpad>/land-<epic>-1.json`) не менял (вне
  следа): новая Session находит его через строку `Land state:` сохранённого брифа; если scratchpad удалён,
  бриф скажет «not read» по этому файлу.

Круг 2 (REJECTED на head 2325f005, три находки med и шесть low):

- Autopilot: раздел 5 и «How to resume a wave» больше не запрещают Wave в той же Session без условия.
  Orchestrator не начинает следующую Wave по своей инициативе; Wave, которую прислал worfy Autopilot или
  владелец — в эту Session или в новую, — идёт как обычно. Фраза запинена в `agents-text.test.sh`, и там же
  проверка, что безусловного запрета («does not start the next wave in the same session», «Every wave runs
  in a session of its own») в skill-е нет.
- Пустой сохранённый бриф: redirect команды сохранения создаёт пустой `wave-brief.txt` до запуска
  `wave-brief`. Теперь `wave-brief` пропускает пустой бриф и берёт строки `Land state:` из предыдущего
  непустого, так что сохранение без `--land` переносит ждущий state file дальше. Skill передаёт `--land` для
  state file-ов этой Wave и для каждого прежнего, у которого PR ещё ждут.
- Ticket в работе: в Full mode `claimed` живёт на ветке Ticket-а, а на `main` он `open`. Ticket `open` с
  открытым PR Epic-а или с веткой `<epic>/<NN>[-…]` (локальной или любого remote) показан в «Waiting» как
  «in work: PR #N» или «in work: branch …» и в «ready» не попадает.
- Low: state file, который не разбирается (битый JSON, `null`, `prs:[null]`), — строка «not read», код 0;
  state file с полем `scope` помечен «outdated»; в skill-е «On the `land` path» и `cd <repo>` в команде
  сохранения; предел 11 000 байт теперь на весь бриф: списки укорачиваются по 5 строк, пока бриф не
  поместится, а если не помещается и без строк списков (80 state file-ов) — обрезка по строке с последней
  строкой об этом; read-only test сравнивает каждый файл и каждую папку под временной папкой test-а
  (ловит `mkdir` в Harness home и файл рядом со state file — mutant-ы m1 и m3 ревьюера).
- Test-ы: `wave-brief.test.sh` — 35 проверок; 25 mutant-ов (21 скрипта, 4 текста) — каждый красный.

**Проверка и merge (2026-10-29).** PR #941 влит как 5d15f9e5, head f120f969.
- Ревью: круг 1 — REJECTED на трёх находках med (безусловный запрет следующей Wave в той же Session спорил с
  Autopilot, который шлёт Wave-ы в одну Session; сохранённый бриф без `--land` терял ждущий state file `land`
  из-за пустого `wave-brief.txt`; в Full mode Ticket с открытым PR показан «ready», потому что `claimed`
  живёт на ветке Ticket-а) и нескольких low. Круг 2 — VERIFIED на f120f969.
- ПК на Windows: `wave-brief.test.sh` — 35 passed, 0 failed; `agents-text.test.sh` — 227/0;
  `epic-wave-ship-ticket` — 387/0; `rules-hooks.test.sh` — 201/0. Ручные проверки — 15/15: CRLF, ветка
  только на remote, предел 11 000 байт с UTF-8, команда сохранения с пробелом и обратными слешами в пути.
- CI run 40808883689 на f120f969: `ci-ok` — pass; `windows (1/3)`–`(3/3) / full-suite` — pass; метка
  `check/windows` — `success`.
- Не проверено: две Wave-ы в свежих Session-ах с замером контекста по Ticket-у 19 — нужны настоящие Wave
  после merge; под Autopilot Wave-ы идут в одной Session (`src/main/autopilot/run.ts:4-6`) — свежая Session
  на Wave требует отдельного Ticket-а.

Долги (low):

- `wave-brief:223-235`: ветка PR, закрытого без merge, не пускает переоткрытый Ticket в «ready».
- `wave-brief:337-345`: жёсткая обрезка брифа (примерно от 40 state file-ов `land`) теряет разделы
  «Next wave» и «Journal».
