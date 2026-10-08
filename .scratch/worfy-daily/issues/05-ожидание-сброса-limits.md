# 05 — Ожидание сброса Limits и продолжение

Type: task
Status: done — 2026-10-06, [PR #40](https://github.com/IDSAD-XL/worfy/pull/40)
Blocked by: 04
Source: [spec.md](../spec.md), тема A, риск 3; [CONTEXT.md](../../../CONTEXT.md), термины Limits и Autopilot; Ticket 22 worfy-mvp (Limits); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md)

## Что делаем

**Что есть сейчас.** Каждое SDK-сообщение каждой Session проходит через `appLimits().observe`
(`src/main/agent/app-registry.ts:65`; `src/main/agent/limits.ts:100-108`). Функция
`limitUpdatesFromSdk` (`src/shared/agent/limits.ts:69-93`) разбирает `rate_limit_event`:

- статус — `allowed`, `allowed_warning` или `rejected` (`:26`);
- `resetsAt`;
- `utilization` по окнам `five_hour` и `seven_day`.

Состояние пишется в `<dataRoot>/limits.json`. На `rejected` никто не реагирует: Limits только
показываются.

**Первый шаг — проверка, итог в «Итог» до кода:**

- Как SDK сообщает об упоре в Limits внутри Session: `rate_limit_event` со статусом `rejected`,
  `result` с ошибкой или и то, и другое.
- В каких единицах приходит `resetsAt`. Status line отдаёт `resets_at` в Unix-секундах (Ticket 22
  worfy-mvp).

Где смотреть: `test/fixtures/sdk-messages` и обработка `result` в `src/main/agent/session.ts:478`.
Записать вместе с версией Claude Code.

**`src/shared/autopilot/resume-at.ts`** — чистая функция. Вход: события Limits, состояние
`limits.json` и `now`. Выход: время продолжения или «неизвестно».

- Время продолжения — `resetsAt` того окна, в которое упёрлись, плюс небольшой запас.
- При «неизвестно» — повторная проверка через фиксированный интервал.
- Есть предел ожидания. Превышен — прогон останавливается с причиной.
- Интервал и предел — константы с комментарием.

**`src/main/autopilot/limits-wait.ts`** — что происходит, когда Session прогона получила
`rejected`:

1. Прогон переходит в состояние `waiting`. keep-awake держится.
2. Ставится таймер до времени продолжения.
3. По таймеру Orchestrator получает текст-константу: «Продолжай с того места, где остановился. Перед
   продолжением добавь в HANDOFF запись о паузе по Limits: с какого и до какого времени».

HANDOFF пишет сам Orchestrator: worfy в репозиторий Project не пишет (ADR-0005).

**Остальное:**

- `src/main/agent/limits.ts` — подписка на смену статуса по одной Session. Сейчас есть только общая
  рассылка.
- `run.ts` — состояние `waiting`. Таймер отменяется на Stop и на `will-quit`.
- Журнал: события `limits-hit` (окно и `resetsAt`), `waiting-until`, `resumed`.
- Строка состояния Autopilot: «waiting for limits · resumes 14:20».
- Формат события уже менялся: несовпадение даёт `[]` без ошибки (`src/shared/agent/limits.ts:4-8`).
  Если `result` говорит об ошибке Limits, а событие не разобралось, ожидание всё равно идёт по
  `limits.json`.

## Готово, когда

- [x] В «Итог» записано, как SDK сообщает об упоре в Limits и в каких единицах `resetsAt`, с версией Claude Code.
- [x] Fake-сценарий `rejected` с `resetsAt` на фиксированных часах: прогон переходит в `waiting`. В момент сброса Orchestrator ровно один раз получает текст продолжения, и прогон снова `running`.
- [x] Если в событии нет `resetsAt`, время берётся из `limits.json`. Если нет и там — повторная проверка по интервалу, а по пределу — остановка с причиной в журнале.
- [x] Stop во время ожидания отменяет таймер, сообщение не уходит.
- [x] Текст продолжения просит Orchestrator записать паузу в HANDOFF. Сам worfy в репозиторий Project не пишет: test сравнивает дерево временного Project до и после.
- [x] В журнале `limits-hit`, `waiting-until` и `resumed` идут по порядку.
- [x] Снимки строки состояния `waiting` в двух темах сверены с F-SPEC.

Настоящий упор в Limits этот Ticket не проверяет. Wave-ы Autopilot на стабильной копии начинаются
только после него (Wave 4 плана), а Ticket-ы 06–09 ждут его закрытия. Поэтому настоящий упор —
условие готовности Epic 4 в [spec.md](../spec.md). В «Итог» записать: «настоящий упор в Limits не
проверен, его проверяет условие готовности Epic».

## Тесты

- `test/unit/autopilot-resume-at.test.ts` (новый) — секунды и миллисекунды, окна `five_hour` и `seven_day`, нет `resetsAt`, предел.
- `test/contract/autopilot-limits.test.ts` (новый) — fake-сценарий `test/fixtures/agent-scripts/autopilot-limits.jsonl`, фиксированные часы (`LimitsTracker` принимает `now`, `src/main/agent/limits.ts:36`).
- Сначала падающий test: `rejected` с `resetsAt`, а после сброса Orchestrator продолжения не получает.

## Где в коде

- `src/shared/autopilot/resume-at.ts` (новый)
- `src/main/autopilot/limits-wait.ts` (новый)
- `src/main/autopilot/run.ts` (из 04: файл создаёт Ticket 04)
- `src/main/agent/limits.ts`
- `src/renderer/canvas/actions/AutopilotAction.tsx` (из 04: файл создаёт Ticket 04)
- `test/fixtures/agent-scripts/autopilot-limits.jsonl` (новый)
- `test/unit/autopilot-resume-at.test.ts` (новый)
- `test/contract/autopilot-limits.test.ts` (новый)

## Итог

**Как SDK сообщает об упоре в Limits** (Claude Code 2.1.289, `@anthropic-ai/claude-agent-sdk`
0.3.289 — версии из `package.json` и `test/fixtures/sdk-messages/README.md`). Настоящего упора в
снятых фикстурах нет; вывод — по типам SDK и по бинарнику Claude Code из пакета SDK:

- `rate_limit_event` со `status: "rejected"`, окно — в `rateLimitType` (`five_hour`, `seven_day`,
  `seven_day_opus`, …), время — в `resetsAt` (`SDKRateLimitInfo`, `sdk.d.ts`). Событие приходит,
  «когда информация о Limits меняется»: повторный отказ в том же процессе может прийти без нового
  события.
- Затем синтетическое сообщение assistant с `error: "rate_limit"` и текстом вида «You've hit your
  limit · resets 3pm» (в бинарнике — `cs({content:…, error:"rate_limit"})` на ответ 429), и
  `result` с `is_error: true` и тем же текстом — как у «Not logged in» в `error.jsonl`
  (`subtype: success`, `terminal_reason: api_error`). То есть «и то, и другое».
- `resetsAt` — Unix-секунды: в фикстурах `1791184200` (2026-10-05T07:10Z), в бинарнике
  `n*1000>e.state.fireAtMs` и `resetsAt-Date.now()/1000`. Так же, как `resets_at` status line.
  `resume-at.ts` всё равно принимает и миллисекунды (`toMs`: меньше 1e11 — секунды).

**Что сделано.**

- `src/shared/autopilot/resume-at.ts` — `resumeAt`: `resetsAt` события, иначе окно из
  `limits.json`, иначе самое позднее время сброса окон со статусом `rejected`; время в прошлом не
  считается. Константы: запас `RESUME_MARGIN_MS` = 2 мин, повторная проверка `RECHECK_MS` = 30 мин,
  предел `MAX_WAIT_MS` = 24 ч от первого отказа ожидания. `isLimitsMessage` — запасной признак по
  тексту ошибки `result`.
- `src/main/autopilot/limits-wait.ts` — `LimitsWait` одного прогона и `CONTINUE_TEXT`. Отказ —
  ход Wave закончился ошибкой (не Interrupt), и либо статус `rejected` пришёл в течение этого хода
  (отсчёт хода — от события `prompt`), либо текст ошибки `result` — про Limits. Claude Code шлёт
  статус только при его смене, поэтому `rejected` из прошлого хода сам по себе отказом не считается:
  иначе окно, которое ходы не блокирует (`seven_day_opus` с переключением модели, overage), делало
  бы любую позднюю ошибку хода («API Error: 500») отказом по Limits. Такой `rejected` годится только
  как источник окна и времени, когда текст ошибки — про Limits. Таймер идёт по настенным часам
  (проверка не реже раза в минуту): `setTimeout` на часы вперёд отстал бы на время сна Mac.
- `run.ts`: ход Wave с отказом не кончает Wave и не останавливает прогон как `turn-error`. Прогон
  пишет `limits-hit`, `waiting-until`, становится `waiting` (keep-awake держится), по таймеру
  пишет `resumed` и шлёт Orchestrator текст продолжения ровно один раз; дальше ход продолжения
  кончает Wave как обычно. Stop, `app-quit` (на `before-quit`, до `will-quit`), ошибка и закрытие
  Session отменяют таймер. У каждого ожидания свой номер (`LimitsWait.isCurrent`): таймер, который
  сработал, а его шаг ещё ждал очереди прогона, пока ожидание отменили или сменили новым, ничего не
  продолжает. Ход Wave без отказа (в том числе ход человека во время ожидания)
  отменяет ожидание и сбрасывает отсчёт предела.
- `src/main/agent/limits.ts`: `observeSessionLimits` — подписка на смену статуса Limits одной
  Session (её события `rate_limit`).
- `src/shared/agent/limits.ts`, `mergeLimits`: обновление окна без `resetsAt` больше не стирает
  известное время сброса, пока оно впереди `receivedAt` обновления: иначе `rejected` без `resetsAt`
  (как в `limits.jsonl`) затирал бы ровно то время, по которому надо ждать. Правило живёт в
  `mergeLimits`, единственном месте, где одно обновление окна заменяет другое, и действует для
  обоих источников — событий SDK и status line.
- Строка состояния: «waiting for limits · resumes 14:20» (местное время). Stop предлагается и во
  время ожидания.

**Неочевидные решения.**

- «Неизвестно» значит «попробовать снова»: через `RECHECK_MS` Orchestrator получает тот же текст
  продолжения. Пока Limits отказывают, попытка стоит один отказанный запрос; другого способа узнать
  сброс без событий нет (`limits.json` сам не обновится, пока ничего не идёт).
- Предел 24 ч — как у самого Claude Code («resets more than 24 hours out … will not resume on its
  own»). Сброс окна `seven_day` дальше предела — остановка сразу, причина `limits-timeout`, текст —
  в `message` состояния прогона.
- Статус прогона в IPC: `status` получил `waiting`, добавлено поле `resumesAt` (мс). Новая причина
  остановки `limits-timeout` — в `AUTOPILOT_STOP_REASONS` (`cycle.ts`). Сама фаза ожидания в чистый
  цикл не введена: цикл остаётся в `turn`, ожидание ведёт `run.ts`.
- Строка состояния теперь стоит над кнопкой абсолютно (не занимает ширину ряда), в верхнем поле
  шапки Epic-а (над кнопками шапки 18 px свободны), и шире: 220 px вместо 160. При 160 px время
  обрезалось («resumes 1…»), а колонка шириной в строку съедала заголовок Epic-а. Под кнопкой
  длинная строка выходила за низ шапки и ложилась на карточку Orchestrator: новый Node ставится в
  точку 40,40 Canvas (`src/main/layout/place.ts`), а рамка Epic-а в Layout не входит, поэтому
  карточка лежит поверх нижней части шапки. Даже короткая «Wave 1 · running» Ticket-а 04 задевала
  рамку карточки. e2e проверяет, что строка не обрезана, лежит внутри шапки и не пересекается ни с
  кнопками шапки, ни с заголовком Epic-а, ни с карточкой Orchestrator.

**Файлы вне «Где в коде»** (без них пункты «Готово, когда» не выполнить):
`src/shared/ipc/autopilot.ts` (статус `waiting`, `resumesAt`, строка состояния),
`src/shared/autopilot/cycle.ts` (причина `limits-timeout`), `src/main/ipc/autopilot.ts` (Limits в
Autopilot приложения), `src/shared/agent/limits.ts` (правило времени сброса в `mergeLimits`),
`test/unit/limits.test.ts` (test этого правила), `test/contract/autopilot.test.ts` (`resumesAt:
null` в состоянии теста каналов), `test/e2e/autopilot.spec.ts` (подготовка вынесена в
`prepare()`/`recordPower()`, новый test ожидания со снимками, проверка места строки состояния),
`test/e2e/limits.spec.ts` (полоса 7-day после `rejected` без `resetsAt` теперь показывает известное
время сброса; время сброса в сценарии test-а — через три дня от запуска, а не фиксированное).

**Проверено.** `test/unit/autopilot-resume-at.test.ts`, `test/contract/autopilot-limits.test.ts`
(fake-агент `autopilot-limits.jsonl`, фиксированные часы, таймер в руках теста; дерево Project до и
после), `test/e2e/autopilot.spec.ts` — ожидание в собранном приложении. Снимки
`autopilot-waiting-{light,dark}.png` — в выводе этого e2e; макета Autopilot в F-SPEC нет, сверено
со стилем действий F-SPEC: вторичный текст 11 px у кнопки, строка целиком, внутри шапки, ничего не
закрывает.

Первый test запуском красным до реализации записан не был (в ветке один commit). Восстановлено
после, на мутанте: без строки `if (hit !== null && !interrupted) return this.limitsHit(run, hit)`
в `run.ts` команда `ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run
test/contract/autopilot-limits.test.ts -t "waits for the reset after a refusal"` кончается с кодом 1:
`Error: timed out waiting for the wait for the Limits` — прогон не переходит в `waiting`.

Круг доработки 1 — каждое новое поведение проверено мутантом (вернуть правку назад — test красный):
ход без отказа сбрасывает отсчёт предела и отменяет ожидание (без `run.limits?.passed()` — 3
contract-сценария красные: второй отказ через сутки с лишним после первого, ход человека во время
ожидания, таймер прошлого ожидания); `rejected` прошлого хода не делает отказом ошибку другого рода
(без проверки «статус пришёл в этом ходе» или без `turnStarted()` на `prompt` — красный
contract-сценарий с `API Error: 500`); таймер отменённого ожидания не продолжает следующее (без
`isCurrent` — красный contract-сценарий); `wallTimer` идёт по настенным часам (с одним `setTimeout`
на всё время — красный test на fake timers vitest); правило времени сброса в `mergeLimits` (без него
— красные unit-test, contract-test и `test/e2e/limits.spec.ts`); место строки состояния (под
кнопкой, как было, — красные оба e2e Autopilot: строка пересекается с карточкой Orchestrator).

**Не проверено.**

- `rejected` окна, которое ходы не блокирует, пришедший в тот же ход, что кончился ошибкой другого
  рода, всё ещё считается отказом: поля overage (`isUsingOverage`, `overageStatus`) в событие
  `rate_limit` не разбираются, и отличить такой `rejected` от блокирующего не по чему.
- Настоящий упор в Limits не проверен, его проверяет условие готовности Epic (условие 3 spec.md).
  Ночью 2026-10-07 упора не было — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).
- Как поведёт себя настоящий Claude Code после `result` с ошибкой Limits в режиме SDK: по
  `init.jsonl` итератор SDK бросает исключение, если последний `result` Session был ошибкой. Если
  процесс при этом завершится, Session уйдёт в `error`, и прогон остановится с `session-error`, а
  не будет ждать.
- В Claude Code есть своё продолжение после сброса (строки бинарника `autoArm`, «the task will
  not resume on its own»). Срабатывает ли оно в режиме SDK, не установлено. Если да, Orchestrator
  получит продолжение дважды: от Claude Code и от worfy.


### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M2 второго круга ручных проверок), только чтение журналов
прогонов `2026-10-07T00-32-09-524Z-66ddaf` (Epic `worfy-week`, 4 Wave) и `…-b80351` (Epic
`worfy-daily`, 3 Wave) на Stable copy из 5060858.

- Не проверено: ни один прогон не упёрся в Limits — `limits-hit` 0 и `session-error` 0 в обоих
  журналах. Ожидание сброса на настоящем Claude Code переносится на следующий длинный прогон.

### Долги из HANDOFF (2026-10-08)

- [low] корректность: `observeSessionLimits` (`src/main/agent/limits.ts:213`) отбрасывает событие
  `rate_limit`, если статус, окно и время сброса те же, что в прошлом событии. Фильтр писался под прежний
  статус, который держится до смены. Признак «статус пришёл в этом ходе» (`fresh`,
  `src/main/autopilot/limits-wait.ts:122`) теперь сбрасывается на каждом `prompt`
  (`src/main/autopilot/run.ts:305`), поэтому одинаковый `rejected` в новом ходе по событию отказом не
  станет — только по тексту ошибки `result` (`isLimitsMessage`). Это подпункт (3) проверки упора в Limits.
- [low] test-ы: `expectStatusClear` в `test/e2e/autopilot.spec.ts:120` молча пропускает проверку
  пересечения, если у элемента нет bounding box (`if (box !== null)`). Среди проверяемых — Node
  Orchestrator-а, тот самый, который в круге 1 перекрывала строка состояния.
- [low] термины: «Итог» этого Ticket-а (строки 157–161 и 195) называет Node Orchestrator-а «карточкой».
  В CONTEXT.md (строка 23) это слово в _Avoid_: Card — отдельный тип Node; ADR-0017 требует английский
  термин из CONTEXT.md.
