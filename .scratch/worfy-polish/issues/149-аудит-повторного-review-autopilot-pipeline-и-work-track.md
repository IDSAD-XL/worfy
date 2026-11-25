# 149 — Аудит повторного review: Autopilot, Pipeline и Work track

Type: bug
Status: open
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
