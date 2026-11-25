# 149 — Аудит повторного review: Autopilot, Pipeline и Work track

Type: bug
Status: done 2026-11-25T22:59Z
PR: #2235
Branch: worfy-polish/149
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «В Ticket-ы»; checked open on main b0e073620 2026-11-25

Кто: агент. Глубина review — `low`. Не платформенный PR.

Пять finding-ов аудита повторного review смёрженных PR (`.scratch/audit-pr-rereview-2026-11-13/spec.md`, номера 53, 55,
206, 209, 212): два пробела в test-ах Autopilot и три ошибки в том, как Pipeline и Work track показывают Ticket.
Каждое проверено на main b0e073620: все пять открыты.

## Что происходит

- **53. Запись вызовов при возврате Session человеку не проверена.** `src/main/agent/orchestrator-continue.ts:265-267`
  передаёт `tool_use` и `tool_result` в `entry.retry.observe`, пока Session принадлежит run (`owned`, `:247`,
  `:449-455`). По этим вызовам модуль решает, можно ли продолжить turn после ошибки API (529). Ни один test в
  `test/contract/orchestrator-continue.test.ts` не возвращает Session человеку посреди turn-а (ближайшие: `:485`, `:566`,
  `:720`), mutant выживает. Сценарий: Orchestrator Autopilot-а запустил `git push`, пользователь забрал Session себе до
  результата, turn упал с 529 — без записи вызова Autopilot отправит «continue» и повторит незавершённый push.
- **55. Остановка waits-owner в середине очереди не проверена.** `src/main/autopilot/run.ts:1761-1763`: если после
  Epic-а, где остался только Ticket, ждущий владельца, все следующие Epic-и идут на другой Machine, run
  останавливается с причиной `waits-owner`. Test-ы `test/contract/autopilot-queue.test.ts` проверяют «следующий Epic
  идёт» (`:358`), последний Epic очереди и `elsewhere` без waits-owner (`:495`), но не этот случай; mutant выживает.
  Сценарий: очередь alpha, beta, gamma; в alpha ждёт владельца один Ticket, beta и gamma идут на ПК; run должен сказать
  «waits for the owner: alpha NN», а с mutant-ом говорит `blocked-tickets`, и владелец не знает, что ход за ним.
- **206. Время на Stage прыгает назад у Ticket-а на нескольких repository.** `src/shared/workflow/pipeline.ts:307-311`:
  Ticket стоит на самом раннем Stage своих repository, и `enteredAt` берётся `latest` только среди отстающих repository
  (`behind`). Ticket вошёл в этот Stage, когда последний repository прошёл предыдущий Stage, а repository, ушедший
  вперёд, тоже мог пройти его позже. Сценарий: Ticket на `lib` и `app`; `lib` вошёл в «CI» в 10:00, `app` прошёл туда
  же в 13:00 и ушёл дальше; Ticket показывает «на CI с 10:00», пометка «stuck» появляется на три часа раньше, а при
  переходе `app` вперёд время Stage прыгает с 13:00 на 10:00.
- **209. Цепочка из трёх repository скрывает красный CI.** `pipeline.ts:301-302` (`awaited`): каждый repository ждёт
  все невыполненные строки `Release:` других repository. Сценарий: Ticket на `lib-a`, `lib-b`, `app` (в таком порядке
  в строках `Repo:`), `lib-b` зависит от `lib-a`; `lib-a` ждёт release `lib-b`, который сам ждёт `lib-a`, стоит на
  Stage `release`, и красный CI PR-а `lib-a` не виден.
- **212. Marks в строках CI и статусов не раздвигаются.** `src/renderer/work-track/Lanes.tsx:289-300` рисует по
  одному `<span>` на mark; marks, попавшие в одну точку шкалы, лежат друг на друге. Сценарий: 17 смен статуса за одну
  минуту видны одной точкой; красный CI run под зелёными не виден.

## Что делаем

1. 53: contract test: run владеет Session, turn делает `git push` (`tool_use` без `tool_result`), Session возвращается
   человеку посреди turn-а, turn падает с 529 — «continue» не отправлен.
2. 55: contract test на случай из сценария.
3. 206: `enteredAt` Ticket-а на нескольких repository — самый поздний момент, когда какой-либо из его repository вошёл в
   Stage с этим индексом или прошёл его (по всем repository, не только по отстающим).
4. 209: repository ждёт только строки `Release:` repository, стоящих раньше него в порядке строк `Repo:`.
   `docs/features/workflow.md` (раздел про Stage `release`) — правило порядка.
5. 212: marks строки CI и строки статусов, которые при текущем масштабе ближе ширины mark-а, рисуются одной mark-ой со
   счётчиком; цвет — худший (красный CI видно), tooltip перечисляет все.

## Готово, когда

- [ ] 53: test `test/contract/orchestrator-continue.test.ts` рядом с `:566` — `unattended` меняется с true на false
      посреди turn-а с `git push` без результата, turn падает с 529: «continue» нет; mutant «не звать
      `entry.retry.observe` для `tool_use`» — красный.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-release.test.ts test/unit/pipeline.test.ts test/unit/work-track-lanes.test.ts test/unit/work-track-view.test.tsx test/unit/work-track-panel.test.tsx test/contract/orchestrator-continue.test.ts test/contract/autopilot-queue.test.ts` exit 0 (224 passed); mutant if (!owned) entry.retry.observe red · mac - · 0cf57a82c6c299cde2f7f7f473d0d77a9e20c302
  - evidence: review pass · PR #2235 · - - · a0693e460748c885b0797d44352cde3c2b37af36
- [ ] 55: test `test/contract/autopilot-queue.test.ts` рядом с `:358` и `:495` — alpha ждёт владельца, beta и gamma
      `elsewhere`: `run-stopped` с причиной `waits-owner` и Ticket-ом alpha; mutant «вернуть `effect` вместо
      `waits-owner`» (`run.ts:1762`) — красный.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-release.test.ts test/unit/pipeline.test.ts test/unit/work-track-lanes.test.ts test/unit/work-track-view.test.tsx test/unit/work-track-panel.test.tsx test/contract/orchestrator-continue.test.ts test/contract/autopilot-queue.test.ts` exit 0 (224 passed); mutant return effect in moveOn red · mac - · 0cf57a82c6c299cde2f7f7f473d0d77a9e20c302
  - evidence: review pass · PR #2235 · - - · a0693e460748c885b0797d44352cde3c2b37af36
- [ ] 206: unit test `test/unit/pipeline.test.ts` в `describe('stageOf: a Ticket over several repositories')` — `lib`
      вошёл в Stage в 10:00, `app` прошёл его в 13:00 и ушёл вперёд: `enteredAt` = 13:00. Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-release.test.ts test/unit/pipeline.test.ts test/unit/work-track-lanes.test.ts test/unit/work-track-view.test.tsx test/unit/work-track-panel.test.tsx test/contract/orchestrator-continue.test.ts test/contract/autopilot-queue.test.ts` exit 0 (224 passed); red on origin/main (enteredAt 10:00) · mac - · 0cf57a82c6c299cde2f7f7f473d0d77a9e20c302
  - evidence: review pass · PR #2235 · - - · a0693e460748c885b0797d44352cde3c2b37af36
- [ ] 209: unit test `test/unit/pipeline.test.ts` — три repository, `lib-a` первый в `Repo:`, строка `Release:`
      `lib-b` не выполнена, CI PR-а `lib-a` красный: Ticket на Stage CI с красным, а не на `release`. Красный на
      origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-release.test.ts test/unit/pipeline.test.ts test/unit/work-track-lanes.test.ts test/unit/work-track-view.test.tsx test/unit/work-track-panel.test.tsx test/contract/orchestrator-continue.test.ts test/contract/autopilot-queue.test.ts` exit 0 (224 passed); red on origin/main (Stage release) · mac - · 0cf57a82c6c299cde2f7f7f473d0d77a9e20c302
  - evidence: review pass · PR #2235 · - - · a0693e460748c885b0797d44352cde3c2b37af36
- [ ] 212: unit test `test/unit/work-track-lanes.test.ts` — 17 marks в одну минуту дают одну группу со счётчиком 17, с
      красным CI цвет группы красный; render-test (`test/unit/work-track-panel.test.tsx` или
      `work-track-view.test.tsx`) видит счётчик. Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-release.test.ts test/unit/pipeline.test.ts test/unit/work-track-lanes.test.ts test/unit/work-track-view.test.tsx test/unit/work-track-panel.test.tsx test/contract/orchestrator-continue.test.ts test/contract/autopilot-queue.test.ts` exit 0 (224 passed); red on origin/main (markGroups missing, 19 CI marks) · mac - · 0cf57a82c6c299cde2f7f7f473d0d77a9e20c302
  - evidence: test-run pass · `node scripts/vitest-electron.mjs <7 touched test files>` exit 0 (225 passed); review round 1 layouts red on the 4/8 px grouping ([17, 1]), role img red without it · mac - · 86071e2ec6a14f60777e719a9aefa8a8f6af3fc8
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45701071965/job/139567377116 · ci - · a0693e460748c885b0797d44352cde3c2b37af36
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: review pass · PR #2235 · - - · a0693e460748c885b0797d44352cde3c2b37af36

## Где в коде

- `src/main/agent/orchestrator-continue.ts:240-270`, `:445-456`
- `src/main/autopilot/run.ts:1745-1765`
- `src/shared/workflow/pipeline.ts:289-320` (`stageOf`, `awaited`, `behind`, `entered`)
- `src/renderer/work-track/Lanes.tsx:280-310`
- `test/contract/orchestrator-continue.test.ts:480-580`, `test/contract/autopilot-queue.test.ts:355-515`,
  `test/unit/pipeline.test.ts:328-420`, `test/unit/work-track-lanes.test.ts`
- `docs/features/workflow.md` (Stage `release`), `docs/features/work-track.md` (строки CI и статусов)

## Вне скоупа

- Остальные находки `triage.md`.
- Другие строки Work track (deploy, gate): группировка только для строк CI и статусов.

## Итог

Реализовано в ветке `worfy-polish/149` (PR — в отчёте исполнителя). Все пять finding-ов подтвердились на
origin/main 2af5f760e.

- **53.** Contract test «a Session given back to the person mid-turn keeps the calls…» в
  `test/contract/orchestrator-continue.test.ts`, новый fake-скрипт
  `test/fixtures/agent-scripts/orchestrator-continue-handback-push.jsonl` (`git push` без `tool_result`, ожидание
  release `handback`, затем 529). Run владеет Session (`setUnattended(true)`) при старте turn-а и во время push-а;
  до 529 Session возвращается человеку. Итог: таймера нет, «continue» не отправлен, в transcript строка
  `not retried: git push … may or may not have run`. Код модуля не менялся: поведение было верным, не хватало test-а.
- **55.** Contract test «an Epic that waits for the owner, then every Epic left runs on another Machine…» в
  `test/contract/autopilot-queue.test.ts`: alpha ждёт владельца (Ticket 02), beta и gamma на ПК — `epic-finished`
  alpha `waits-owner 02`, beta и gamma `elsewhere`, `run-stopped` `waits-owner` с Ticket-ом `02`. Код `run.ts` не
  менялся.
- **206.** `stageOf` (`src/shared/workflow/pipeline.ts`): `enteredAt` Ticket-а на нескольких repository — самый
  поздний момент, когда какой-либо repository дошёл до Stage-а Ticket-а: у стоящего на нём — его `enteredAt` (с
  rework), у ушедшего вперёд — момент, когда он вошёл в этот Stage (`reached[index]`, самое позднее время Stage-ей,
  пройденных до него). `stageOfOne` теперь отдаёт ещё массив `reached`.
- **209.** `awaited` в `stageOf`: repository ждёт строки `Release:` repository, стоящих раньше него в строках
  `Repo:`, и строки библиотек, которых нет среди repository Ticket-а; свою и более поздних — нет. Ticket одного
  repository — как прежде, ждёт всё, кроме своей. Contract test `test/contract/workflow-release.test.ts` («both PRs
  open, app listed first») утверждал обратное — «порядок строк `Repo:` не важен», Ticket ждёт на `release` из-за
  `app`, стоящего первым. По правилу этого Ticket-а и ADR-0104, пункт 1 (порядок строк — порядок merge-ей) `app`
  первым не ждёт строк `lib`: ожидание test-а заменено на `human-review` с пройденным `release`. Файла нет в «Где в
  коде»; правка — прямое следствие пункта 4 «Что делаем».
- **212.** `markGroups` в `src/shared/work-track/lanes.ts` и `MarkRows` в `src/renderer/work-track/Lanes.tsx`:
  группировка идёт по тому, что рисует экран. CI run — от начала до конца, не уже 4 px; смена статуса — точка 8 px
  по центру своего времени; группа — счётчик шириной `groupPx(n)` (14 px, 18 px для двух цифр, 24 px для трёх) от
  первого run-а или по центру первой смены. Mark, левый край которого левее правого края группы перед ним, входит в
  неё. `Lanes.tsx` ставит ту же ширину inline (CI — `min-width`, статус — `width` и `translateX(-n/2)`), так что
  счётчик не закрывает соседей. Группа рисуется одной mark-ой со счётчиком, в цвете худшего mark-а, `role="img"` с
  `aria-label` («17 CI runs»), tooltip — счётчик и строка на каждый mark, клик открывает худший (самый поздний из
  худших). Стиль — `.w-wt-mark--group` в `work-track.css`. Review round 1: прежняя группировка по 4/8 px оставляла
  run в 5 px за группой CI и `blocked`-точку в 8 px за группой статусов поверх счётчика; unit test с этими двумя
  раскладками красный на прежнем коде (`[17, 1]` вместо `[18]`). Снимки статичной страницы с CSS PR-а (chromium,
  светлая и тёмная тема) — в scratchpad, в репозиторий не кладутся.
- Feature pages: `docs/features/workflow.md` (порядок строк `Repo:` для Stage `release`, время входа в Stage),
  `docs/features/work-track.md` (группы marks).

### Решено без владельца (подтвердить)

- **206: «вошёл» — не «прошёл».** Ticket просил брать момент, когда repository «вошёл в Stage или прошёл его».
  Взят момент входа в Stage и для ушедшего вперёд repository: Ticket вошёл в Stage, когда последний repository
  прошёл предыдущий Stage (сценарий «Что происходит»). Время прохождения Stage-а ушедшим repository сдвинуло бы
  «на CI с» на момент зелёного CI `app`, позже реального входа. В test-е `app` вошёл в CI в 13:00 и прошёл его в
  13:20, ожидается 13:00.
- **209: строки `Release:` чужой библиотеки.** Строку библиотеки, которой нет среди `Repo:` Ticket-а, ждут все
  его repository, как до правки. Строгое «только строки repository раньше него» сняло бы ожидание внешнего
  release совсем.
- **212: ширина трека до замера.** Пока трек не измерен (и в test DOM), группировка считает его шириной 1000 px
  (`UNMEASURED_TRACK_PX`). Клик по группе открывает панель худшего mark-а, а не список; порядок худшего у CI:
  `failed`/`rejected`, потом `stopped`/прочие, потом идущий, потом `ok`; у статусов — `blocked`.

### Проверки

- Mutant-ы: в `orchestrator-continue.ts` `if (!owned) entry.retry.observe(event)` — test 53 красный (таймер
  retry есть). Finding 55 в описании Ticket-а неточен: mutant `return effect` вместо `{ reason: 'waits-owner', … }`
  (`run.ts:1763`) убивают и старые test-ы `autopilot-queue.test.ts:383` и `:417` (последний Epic очереди ждёт
  владельца). Без test-а оставался случай в середине очереди: mutant `if (!last) return effect` сразу после
  `run.ts:1760` убивает только новый test `:534` (1 failed из 39 в файле). Оба файла восстановлены.
- Test-ы 206, 209 и оба test-а 212 красные на origin/main до правки (`enteredAt` 10:00 вместо 13:00; Stage
  `release` вместо `ci` `failing`; `markGroups is not a function`; 19 mark-ов CI вместо 3).
- Полный `pnpm lint && pnpm typecheck && pnpm test` на dacdf30f7: exit 1, один красный —
  `test/contract/workflow-release.test.ts` «both PRs open, app listed first» (ждал старое правило, см. пункт 209
  выше); исправлен в 0cf57a82c, файл зелёный. Повтор полного прогона на 0cf57a82c: exit 1, четыре timeout-а в
  модулях, которых правка не касается (`flight-recorder-service`, `gate-failures-rerun`, `harness-scripts-2`
  `land.test.sh`, `pr-search-view`), при load average 60–88; в первом прогоне все четыре были зелёными.
- gate fast на 0cf57a82c: exit 2, красный один test — `harness-scripts-2` `bin/tests/land.test.sh` убит после
  360 s (load average 65–88). Правка не трогает `harness/`. Повтор ради зелёного не делался.
- Review round 1 (86071e2ec): 7 изменённых PR-ом файлов test-ов и `test/unit/work-track-panel.test.tsx` — exit 0,
  225 test-ов; `pnpm lint` и `pnpm typecheck` — exit 0; gate fast — exit 0, `[gate] green (fast)` (lint, typecheck,
  test) при load average 55–68.
