# 149 — Аудит повторного review: Autopilot, Pipeline и Work track

Type: bug
Status: claimed 2026-11-25T19:13Z
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
- [ ] 55: test `test/contract/autopilot-queue.test.ts` рядом с `:358` и `:495` — alpha ждёт владельца, beta и gamma
      `elsewhere`: `run-stopped` с причиной `waits-owner` и Ticket-ом alpha; mutant «вернуть `effect` вместо
      `waits-owner`» (`run.ts:1762`) — красный.
- [ ] 206: unit test `test/unit/pipeline.test.ts` в `describe('stageOf: a Ticket over several repositories')` — `lib`
      вошёл в Stage в 10:00, `app` прошёл его в 13:00 и ушёл вперёд: `enteredAt` = 13:00. Красный на origin/main.
- [ ] 209: unit test `test/unit/pipeline.test.ts` — три repository, `lib-a` первый в `Repo:`, строка `Release:`
      `lib-b` не выполнена, CI PR-а `lib-a` красный: Ticket на Stage CI с красным, а не на `release`. Красный на
      origin/main.
- [ ] 212: unit test `test/unit/work-track-lanes.test.ts` — 17 marks в одну минуту дают одну группу со счётчиком 17, с
      красным CI цвет группы красный; render-test (`test/unit/work-track-panel.test.tsx` или
      `work-track-view.test.tsx`) видит счётчик. Красный на origin/main.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

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
  repository — как прежде, ждёт всё, кроме своей.
- **212.** `markGroups` в `src/shared/work-track/lanes.ts` и `MarkRows` в `src/renderer/work-track/Lanes.tsx`:
  mark, который начинается раньше, чем кончается предыдущий (его конец или начало плюс ширина mark-а — 4 px у
  CI, 8 px у статуса), входит в его группу. Группа рисуется одной mark-ой со счётчиком, в цвете худшего mark-а,
  tooltip — счётчик и строка на каждый mark, клик открывает худший (самый поздний из худших). Стиль —
  `.w-wt-mark--group` в `work-track.css`.
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
  retry есть); в `run.ts` `return effect` вместо `{ reason: 'waits-owner', … }` — test 55 красный (`run-stopped`
  `blocked-tickets`). Оба файла восстановлены.
- Test-ы 206, 209 и оба test-а 212 красные на origin/main до правки (`enteredAt` 10:00 вместо 13:00; Stage
  `release` вместо `ci` `failing`; `markGroups is not a function`; 19 mark-ов CI вместо 3).
