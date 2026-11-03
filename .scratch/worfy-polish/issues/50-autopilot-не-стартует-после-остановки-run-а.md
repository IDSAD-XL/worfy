# 50 — Autopilot не стартует после остановки Run-а, пока у Session Orchestrator-а живы фоновые задачи

Type: task
Status: open
Blocked by: —
Source: слово владельца 2026-11-03: «Будем фиксить этот момент: почему при нажатии на автопилот ничего не происходит на
конвейсе и почему ты отсюда не можешь стартануть»; выбор владельца 2026-11-03 — чинить обе стороны (возврат Session и toast
отказа).

## Что происходит

2026-11-03 16:06Z Run Autopilot-а (Epic `worfy-multi-vendor`, Wave 12) остановился с `run-stopped` reason `turn-error` после
`API Error: 500` в Session Orchestrator-а. После этого:

- `autopilot_start` из этой Session отвечает «No one is at this Session… runs unattended», хотя владелец в чате;
- нажатие Autopilot на рамке Epic-а на Canvas ничего не делает.

Причина (diagnosis scout-а, проверить первым шагом):

- `Autopilot.end` (`src/main/autopilot/run.ts`, около `:1767-1805`) зовёт `setUnattended(false)`. Пока у Session живы фоновые
  задачи (Bash `run_in_background`, Agent-ы), `src/main/agent/orchestrator.ts:257-258` только ставит
  `entry.wanted = ATTENDED`; `relaunchIfFree` (`:571-575`) ждёт, пока `liveTasksOf(entry) === 0`. Session, которая сама
  запускает новые фоновые задачи, так и остаётся unattended.
- A: `src/main/autopilot/chat-confirm.ts:228` читает `deps.unattended(session)` и отказывает `UNATTENDED_MESSAGE`.
- B: кнопка (`src/renderer/canvas/actions/AutopilotAction.tsx`) → `autopilot.start` (`src/main/ipc/autopilot.ts`) →
  `setUnattended(true)` отказывает `ORCHESTRATOR_HAS_TASKS` (`orchestrator.ts:270`: `entry.wanted !== null`). Отказ виден
  только в `title` и `data-error` кнопки (`src/renderer/canvas/actions/action-button.ts:41-43`) — без toast.

## Что делаем

1. **Новый Run в Session, которая ждёт возврата.** Когда launch Session уже unattended и `entry.wanted === ATTENDED`
   (остановленный Run ждёт её задач), `setUnattended(true)` не отказывает: снимает ожидание (`entry.wanted = null`) и
   оставляет текущий launch, без relaunch — живые задачи не трогаются. Так кнопка Canvas стартует Run и в этом состоянии.
   Отказы `ORCHESTRATOR_IN_TURN` и `ORCHESTRATOR_HAS_QUEUE` остаются; `ORCHESTRATOR_HAS_TASKS` остаётся для attended
   launch с живыми задачами (там relaunch остановил бы их).
2. **`autopilot_start` из такой Session.** Отказ «unattended» — только когда Run Autopilot-а идёт сейчас (в Session никого
   нет). Session, чей Run остановлен и которая лишь ждёт возврата, — attended по смыслу: tool показывает владельцу диалог
   подтверждения как обычно, затем идёт путём п. 1.
3. **Toast отказа.** Любой отказ старта по кнопке Autopilot на Canvas — toast ошибки с причиной (`showToast` из
   `src/renderer/toast/toasts`), а не только `title` кнопки. Текст причины — тот же, что сейчас в `data-error`.
4. Возврат Session после остановки Run-а с живыми задачами по-прежнему ждёт их конца: relaunch остановил бы фоновые задачи
   (Agent-ы и CI wait-ы Orchestrator-а). Владелец подтвердил 2026-11-03: вместо выбранного сначала «Session сразу снова attended,
   даже с живыми задачами»; п. 1–2 дают тот же результат для старта Autopilot-а и не убивают задачи.
5. Страница `docs/features/autopilot.md` и её перевод `docs/features/ru/autopilot.md` — абзац о старте после остановки Run-а
   и о toast отказа, если страница описывает эти случаи.

## Готово, когда

- [ ] Contract test (`test/contract/autopilot-background.test.ts` или рядом): Run остановлен `turn-error` при живой фоновой
      задаче → `setUnattended(true)` проходит без relaunch, задача жива, новый Run стартует.
- [ ] Contract test `autopilot_start` (`test/contract/autopilot-start-tool.test.ts`): Session ждёт возврата → диалог
      подтверждения, не `UNATTENDED_MESSAGE`; во время идущего Run-а — по-прежнему `UNATTENDED_MESSAGE`.
- [ ] Unit test кнопки (`test/unit/canvas-actions.test.tsx`): отказ старта → toast ошибки с причиной.
- [ ] Прежние test-ы Autopilot-а и Orchestrator-а зелёные без ослабления ожиданий.
- [ ] `pnpm lint`, gate fast — exit 0.

## Где в коде

- `src/main/agent/orchestrator.ts` — `setUnattended`, `relaunchIfFree`, `ORCHESTRATOR_HAS_TASKS`.
- `src/main/autopilot/run.ts` — `Autopilot.end`, release.
- `src/main/autopilot/chat-confirm.ts` — `autopilotStarter`, `deps.unattended`.
- `src/main/ipc/autopilot.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/renderer/canvas/actions/action-button.ts`.
- `test/contract/autopilot-background.test.ts`, `test/contract/autopilot-start-tool.test.ts`, `test/unit/canvas-actions.test.tsx`.

## Итог

Diagnosis подтвердился: красный contract test упал на `ORCHESTRATOR_HAS_TASKS` из
`src/main/agent/orchestrator.ts` (`setUnattended`, проверка `entry.wanted !== null`), а `autopilot_start` —
на `UNATTENDED_MESSAGE` из `chat-confirm.ts`.

- **Старт в Session, которая ждёт возврата.** `orchestrator.ts`: `awaitsGiveBack(entry)` — launch unattended и
  `entry.wanted` = attended. Тогда `setUnattended(true)` не отказывает за живые задачи: снимает ожидание и оставляет
  текущий launch без relaunch. `ORCHESTRATOR_IN_TURN` и `ORCHESTRATOR_HAS_QUEUE` остались; `ORCHESTRATOR_HAS_TASKS`
  остался для attended Session с живыми задачами (новый contract test это держит).
- **Прежний Run, который ждал задачи** (`linger` в `run.ts`): когда новый Run забирает Session, ожидание старого Run-а
  кончается без строки в его journal-е. Keep-awake старого Run-а снимается, задачи пишет journal нового Run-а. Иначе
  старый journal получал бы те же строки `background-tasks` до конца нового Run-а, а `orchestrator-returned` — только
  при возврате после нового Run-а. Новый вид строки в journal не заводил. **Решено без владельца, подтвердить.**
- **`autopilot_start`.** Новый dep `awaitsGiveBack` (`Orchestrators.awaitsGiveBack(sessionId)`): unattended Session,
  которая лишь ждёт возврата, получает диалог; пока Run идёт — по-прежнему `UNATTENDED_MESSAGE`. Вызов из хода самой
  Session идёт через `ChatStarts.startAfterTurn` → `orchestratorRefusal`: в этом состоянии живые задачи тоже не отказ
  (иначе после диалога пришёл бы `ORCHESTRATOR_HAS_TASKS`).
- **Toast.** Любой отказ `autopilot.start` по кнопке — toast `error` с той же причиной, что в `title`/`data-error`
  (key на Project, testId `autopilot-start-refused`). Отказ «running on <Machine>» тоже даёт toast, рядом с chip и
  «Start anyway»: тикет говорит «любой отказ». **Решено без владельца, подтвердить.**
- Старый contract test «refuses a new run while the Orchestrator of a stalled run waits for the last task's turn» ждал
  `ORCHESTRATOR_HAS_TASKS`. По п. 1 это поведение снято, и test теперь проверяет обратное: старт проходит, Session та
  же, relaunch-а нет.
- `docs/features/autopilot.md`: причина отказа — в tooltip и toast; старт во время ожидания возврата; `autopilot_start`
  в такой Session. Перевод `docs/features/ru/autopilot.md` не правил: по `rules.md` в PR с поведением правится только
  английская страница.

Снимки toast отказа (e2e `test/e2e/autopilot.spec.ts`, Orchestrator в ходе): `../evidence/50/50-refused-toast-light.png`,
`../evidence/50/50-refused-toast-dark.png`.
