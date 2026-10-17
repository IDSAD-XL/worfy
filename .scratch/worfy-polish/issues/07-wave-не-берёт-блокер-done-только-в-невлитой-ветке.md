# 07 — Готовая Wave не считает блокер закрытым, пока его `done` только в невлитой ветке

Type: task
Status: done 2026-10-15
PR: #349
Blocked by: —
Source: [spec.md](../spec.md), кандидат R9; `HANDOFF.md`, «Дальше» — «Кандидаты в Ticket-ы: `done` с
невлитой ветки, `reader.ts:329` (`worfy-harness` 22)»; «Итог»
[`worfy-harness` 22](../../worfy-harness/issues/22-silent-mode-в-harness.md), «Долги ревьюеров»;
[ADR-0033](../../../docs/adr/0033-autopilot-names-wave-tickets.md).

## Что происходит

- worfy кладёт Status Ticket-а из ветки его worktree поверх Status-а checkout-а (ADR-0033):
  `branchOverrides` (`src/main/workflow/reader.ts:395-397`) — ветка перекрывает checkout, если в checkout-е
  не `blocked` и не `done`, а в ветке не `open` и не `none`. Ticket получает `state` ветки и поле
  `fromBranch` (`:412-415`). Значит, Ticket, у которого `done` записан коммитом в его ветке, но ветка ещё
  не влита, показывается `done`. **Показ верен** и остаётся: ADR-0033 разбирает этот случай
  («Отвергнуто: … в ветке уже `blocked` или `done`, показывался бы `work`»).
- **Дефект — в готовой Wave.** `readyWave` (`src/shared/workflow/waves.ts:158`) считает блокер закрытым по
  `state === 'done'` (`:173`) и не смотрит, откуда этот `done`. Тип `WaveTicket` (`:48`) `fromBranch` не
  берёт. Ticket, чей блокер `done` только в невлитой ветке, попадает в `ready`, хотя кода блокера в main
  ещё нет: worktree зависимого Ticket-а режется от `origin/main` (Profile, `worktree.base`).
- Когда так бывает. При `pr-green-ci` `ticket done --pr N` пишется после мержа, окна нет. При
  `local-green` skill `ship-ticket` коммитит документы с `done` в ветку Ticket-а перед fast-forward, и
  прямо описывает сбой: «a break between the documents commit and the fast-forward, or a fast-forward
  that failed: the branch carries `done` but is not in the main branch» (`ship-ticket/SKILL.md`, раздел
  о `MERGED=`). Ещё — исполнитель, который по ошибке записал `done` в своей ветке PR. Во всех этих случаях
  зависимый Ticket стартует без кода блокера. Кроме того, файлы такого блокера не держатся (`held` —
  только `work`, `:162-163`), и зависимый Ticket может взять те же файлы.
- `readyWave` зовут Autopilot (`src/shared/autopilot/cycle.ts:202`, `:207`), «Run wave» и шаблоны
  действий (`src/shared/actions/render-template.ts:75`, `:150`) и раскладка рамки
  (`src/renderer/canvas/epic-layout.ts:205`).

## Что делаем

1. `WaveTicket` берёт `fromBranch` (необязательное поле: старые вызовы без него ведут себя как checkout).
2. Блокер закрыт для готовой Wave, только если `state === 'done'` и `fromBranch` пуст. Блокер `done` из
   ветки — причина ожидания `blockers` с этим номером, как незакрытый.
3. Файлы Ticket-а `done` из ветки держатся, как у `work`: ветка ещё не влита.
4. Показ Status-а на Canvas не меняется (ADR-0033).
5. Шапка `waves.ts` — одна фраза о правиле. Если Orchestrator решит, что правилу нужен ADR, номер
   выдаёт он при взятии (spec, «Соглашения»).

## Готово, когда

- [x] Unit test: блокер `done` с `fromBranch` — зависимый Ticket в `waiting` с `blockers: [N]`; тот же
      блокер без `fromBranch` — зависимый в `ready`.
- [x] Unit test: файлы блокера `done` из ветки держатся — зависимый с общим файлом ждёт по `files`.
- [x] Unit test: старый вход без поля `fromBranch` даёт прежний результат (все test-ы `waves.test.ts`
      зелёные без правок).
- [x] Contract test `cycle` Autopilot или `render-template`: Wave не называет такого Ticket-а (если
      существующие test-ы это уже покрывают через `readyWave` — указать какие, в «Итог»).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/waves.test.ts` — новые случаи.
- Сначала красный: «блокер `done` из ветки не делает Ticket готовым» на нынешнем коде.
- Мутанты: проверять `fromBranch` только у первого блокера; не держать файлы `done` из ветки; держать
  файлы и у `done` из checkout-а. Каждый краснит свой test.

## Где в коде

- `src/shared/workflow/waves.ts`
- `test/unit/waves.test.ts`
- `src/renderer/canvas/elk/client.ts` (добавлен в круге доработки)
- `test/unit/elk-client.test.tsx` (добавлен в круге доработки)

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/main/workflow/reader.ts`, `src/shared/workflow/types.ts`, `src/shared/autopilot/cycle.ts`,
`src/shared/actions/render-template.ts`, `src/renderer/canvas/epic-layout.ts`,
`docs/adr/0033-autopilot-names-wave-tickets.md`.

## Вне скоупа

- Показ Status-а из ветки (ADR-0033) и `branchOverrides`.
- Status-ы `blocked` из ветки: они и так не делают Ticket готовым.

## Итог

- Правило — в `src/shared/workflow/waves.ts`: блокер закрыт для готовой Wave, только если `state === 'done'`
  и `fromBranch` пуст (`closed`). Ticket `done` из невлитой ветки считается «в работе» (`inFlight`): его
  файлы держатся, зависимые ждут его с причиной `blockers`, блокированный Ticket за ним не попадает в
  `skipped`. `WaveTicket` берёт `fromBranch` необязательным полем: вход без поля читается как checkout.
  Показ Status-а на Canvas и `branchOverrides` не тронуты (ADR-0033).
- **Решено без владельца, подтвердить:** `waveNumbers` (номера Wave на Card-ах и в «Run wave»)
  обращается с `done` из ветки так же, как с `work`: Ticket номера не получает, зависимые идут в
  следующую Wave после него. Без этого зависимые такого Ticket-а остались бы вовсе без номера.
  `readyWaveNumber` / `planWaveNumber` считают план по всем Ticket-ам как `open` — их это не меняет.
- Test-ы (`test/unit/waves.test.ts`, блок «a blocker done only in its worktree branch, not yet merged» и
  «numbers the dependants of a Ticket done only in a branch…»): ожидание по `blockers`, тот же блокер из
  checkout-а, проверка каждого блокера, удержание файлов, неудержание файлов `done` из checkout-а,
  `skipped`, вход без поля `fromBranch`, номера Wave. Старые test-ы файла не правились.
- Пункт о `cycle` / `render-template`: test-ы этих файлов вне «Где в коде», поэтому случай проверен из
  `waves.test.ts` через настоящие `runWaveState` и `step` Autopilot («is not named by "Run wave" nor started
  by Autopilot»): «Run wave» не называет зависимого, Autopilot останавливается с `no-ready-wave`; после
  мержа блокера (`fromBranch: null`) — `send-wave`.
- Мутанты (на копии, восстановление через `cmp`): код origin/main; `fromBranch` только у первого блокера;
  без удержания файлов `done` из ветки; удержание файлов и у `done` из checkout-а; `waveNumbers` без
  учёта `done` из ветки — каждый краснит свой test.
- Круг 2 (замечание ревью, след расширен оркестратором на `src/renderer/canvas/elk/client.ts` и его test):
  ключ запроса ELK (`elkKey`) теперь включает признак «`done` только в ветке» (`doneOnlyInBranch`,
  экспорт из `waves.ts`). Без него мерж ветки менял только `fromBranch`, ключ не менялся, новый запрос не
  уходил, и рамка оставляла старую подсветку ready и «Ready wave · N». Ключ берёт признак, а не саму
  строку `fromBranch`: ветка у Ticket-а в работе на раскладку не влияет и лишнего запроса не даёт.
  Test-ы — `test/unit/elk-client.test.tsx`: ключ до и после мержа, ключ без лишних изменений, рамка
  сразу после мержа и после нового ответа ELK, ответ на старые входы, пришедший после мержа, отброшен.
- Не сделано здесь: «Ship ticket» (`shipTicketState`, `src/shared/actions/render-template.ts:128`) по-прежнему
  считает блокер закрытым по одному `state === 'done'` — кандидат в следующий Ticket.

### Gate оркестратора (2026-10-15)

- Wave Epic-а под Autopilot: Ticket-ы 01–05, 07–11 параллельно, общих файлов в «Где в коде» нет; 06 и 12 в команду не входили. Worktree — `.claude/worktrees/pol-<NN>`: пути `04`, `10`, `11` заняты деревьями других Epic-ов. Нагрузку CPU (`yes > /dev/null`) по своему «Готово, когда» дают 04 и 05; оркестратор пустил их параллельно с остальными, и timeout-ы под этой нагрузкой краснили gate соседей — ошибка плана, не implementer-ов.
- Гейт — два круга. Круг 1 — `REJECTED` на `615dddd` ([комментарий в PR #349](https://github.com/IDSAD-XL/worfy/pull/349#issuecomment-6188814064)): ключ кэша раскладки ELK (`src/renderer/canvas/elk/client.ts:72`) не учитывал `fromBranch`; после merge ветки блокера рамка Epic-а оставляла зависимый Ticket неготовым, хотя «Run wave» уже включён. Круг 2, только доработка `615dddd..05360e4`, — `VERIFIED; debt` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/349#issuecomment-6189245469)): ключ несёт `doneOnlyInBranch` (`waves.ts:58`, одно правило с `inFlight`); Ticket, у которого меняется только `fromBranch`, доходит до renderer-а новым объектом (`reader.ts:414-415` → `diffModels` → `applyWorkflowDelta` → `sources/epics.ts:396`).
- Мерж: база `4c21410`, head `10301b4`; `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `be68c08`.
- Act on (круг 1, исправлено): ключ ELK — см. выше. След расширен на `src/renderer/canvas/elk/client.ts` и `test/unit/elk-client.test.tsx`.
- Consider, Dismissed — нет.
- Noted: debt круга 2 — раздел «Где в коде» не называл двух новых файлов, дописаны; вне скоупа, подтверждено verifier-ом — «Ship ticket» (`src/shared/actions/render-template.ts:128`, `shipTicketState`) считает блокер закрытым по одному `state`, кандидат в Ticket; **подтверждено владельцем 2026-10-15** — зависимые Ticket-а с `done` из ветки получают номер Wave на Card-ах на один позже.
