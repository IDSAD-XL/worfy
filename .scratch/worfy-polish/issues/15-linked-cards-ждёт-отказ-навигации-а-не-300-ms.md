# 15 — e2e `linked-cards`: проверка «навигация не случилась» ждёт знак отказа, а не окно 300 ms

Type: task
Status: claimed — 2026-10-15
Blocked by: —
Source: решение владельца 2026-10-15 по «Итог» Ticket-а
[05](05-waitfortimeout-в-e2e-на-ожидание-состояния.md) («Слабое место», решено без владельца,
подтвердить) и его Gate (раздел «Gate оркестратора (2026-10-15)», Noted: окно 300 ms под нагрузкой
может дать ложный зелёный); [docs/lessons/agents.md](../../../docs/lessons/agents.md) — ложные
таймауты e2e под нагрузкой.

## Что происходит

e2e `test/e2e/linked-cards.spec.ts` проверяет Card с Linked machine B в окне worfy A. В конце Card B
пробует уйти на чужую страницу: на свою Card машины A и на другую Card машины B
(цикл `:263-274`).

- После попытки test ждёт **300 ms** (`waitForTimeout(300)`, `:269`). Потом проверяет: фрейм с
  origin B один, заголовок в нём прежний, фреймов с origin A нет.
- Знака «отказ случился» нет. Main отказывает в `will-frame-navigate` (`src/main/window.ts:206-209`,
  `details.preventDefault()`) и ничего не шлёт обратно (комментарий над ожиданием, `:265-268`).
- Своя Card машины A грузится с этой машины и показалась бы намного быстрее 300 ms. Другая Card
  машины B идёт по link: около 0,2 s в покое. Под нагрузкой ошибочная навигация может не успеть
  показаться за 300 ms — test зелёный, хотя main навигацию пропустил. Это ложный зелёный, не
  красный: test не ловит дефект, а не падает зря.
- Ticket 05 оставил это окно с комментарием и не удлинил его: время spec-а. Это последнее из пяти
  оставленных окон, у которого есть риск ложного зелёного (`card-runtime.spec.ts:170` — та же
  проверка, но страница только локальная).

## Что делаем

1. **Сначала мутант.** На копии main пропускает навигацию из Card в другую Card той же машины B
   (`allowFrameNavigation`, `src/main/cards/protocol.ts:367`). Прогнать нынешний spec с мутантом: в покое и
   под нагрузкой. Ожидание — под нагрузкой он хотя бы раз зелёный (ложный зелёный). Число прогонов
   и итог — в «Итог». Если ложный зелёный не воспроизвёлся, записать как есть.
2. **Знак вместо времени.** Test ждёт знак, что сторона, которая решает, обработала попытку, и
   только потом проверяет фреймы. Варианты (выбор — за исполнителем, проверить на Electron проекта):
   - событие отменённой загрузки фрейма в main A (`did-fail-provisional-load` или `did-fail-load` с
     кодом `-3`, `ERR_ABORTED`) для фрейма Card B, через `a.app.evaluate`;
   - свой слушатель `will-frame-navigate` в main A, поставленный до попытки: пишет цель и итог
     (отказано или нет), test ждёт запись для своей цели через `expect.poll`.
   Знак должен приходить и при отказе, и при пропуске. Тогда мутант пункта 1 краснит test сразу, а
   не по времени.
3. **Без `waitForTimeout`** в этом месте. Если общий helper нужен и другим spec-ам — положить его в
   `test/e2e/wait.ts` и дописать файл в «Где в коде» при claim.
4. Комментарий над проверкой — по новому способу; строку «Слабое место» в «Итог» Ticket-а 05 не
   править (это история).

## Готово, когда

- [x] В `linked-cards.spec.ts` нет `waitForTimeout` в проверке навигации; `grep -n waitForTimeout
      test/e2e/linked-cards.spec.ts` — пусто.
- [x] Мутант «main пропускает навигацию в другую Card B» краснит новый spec 5 из 5 под нагрузкой и 5
      из 5 без неё; старый spec под нагрузкой — как получилось в пункте 1 (оба вывода в «Итог»).
- [x] Без мутанта spec зелёный: `--repeat-each=5` в покое и под нагрузкой.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- e2e `test/e2e/linked-cards.spec.ts` под замком e2e (`/tmp/worfy-e2e.lock`).
- Нагрузка — `yes > /dev/null`, половина ядер; процессы убиты после каждого прогона. Прогоны под
  нагрузкой — только когда других агентов Wave нет (Gate Ticket-ов 04 и 05: нагрузка одного
  Ticket-а краснила gate соседей).

## Где в коде

- `test/e2e/linked-cards.spec.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `src/main/window.ts`, `src/main/cards/protocol.ts`,
`test/e2e/wait.ts`, `test/e2e/card-runtime.spec.ts`, `test/e2e/helpers.ts`.

## Вне скоупа

- `card-runtime.spec.ts:170` — та же проверка, но для страницы этой машины; 300 ms там с запасом.
- Остальные три окна из «Итог» Ticket-а 05 (`handoff.spec.ts`, `card-drag.spec.ts`,
  `packaged.spec.ts`).
- Код приложения: отказ навигации в main не меняется.

## Итог

Реализовано в ветке `worfy-polish/15` (PR — в отчёте исполнителя).

- **Знак — вердикт main в `will-frame-navigate`.** В `linked-cards.spec.ts` перед циклом попыток
  `recordNavigations(a.app)` ставит в main A свои слушатели на все web contents. Слушатель
  `will-frame-navigate` стоит после слушателя приложения (тот ставится при создании web contents), поэтому
  `details.defaultPrevented` — решение main: `true` — отказано, `false` — пропущено. Запись приходит при
  обоих исходах, до загрузки цели. Test ждёт её через `expect.poll` (10 s), затем проверяет
  `prevented === true` и что навигация не закончилась commit-ом (`did-frame-navigate`). Потом — прежние
  проверки фреймов. `waitForTimeout` из spec-а убран, общий helper в `test/e2e/wait.ts` не понадобился.
- **Вариант с `did-fail-provisional-load` (`-3`) не работает на Electron 44.5.1.** Проверено: при
  отказе в `will-frame-navigate` навигация не начинается, и ни `did-fail-provisional-load`, ни
  `did-frame-navigate` не приходят. Первая версия test-а ждала конец навигации и падала по таймауту
  10 s 5 из 5 (запись `{"prevented": true}` без конца). Поэтому знак — сама запись вердикта (решено без
  владельца, подтвердить).

### Проверки

Нагрузка — 9 процессов `yes > /dev/null` (половина из 18 ядер), только под замком `/tmp/worfy-e2e.lock`;
после каждой серии убиты по PID, `pgrep -x yes` — пусто. Прогоны —
`playwright test test/e2e/linked-cards.spec.ts --repeat-each=5` после `electron-vite build`.

- **Пункт 1, старый spec с мутантом** (на копии `src/main/cards/protocol.ts` из `allowFrameNavigation`
  убрано сравнение `cardId`: main пропускает навигацию в другую Card той же машины B; восстановлено с
  `cmp`): в покое 5 failed из 5, под нагрузкой 5 failed из 5, все на проверке «фрейм с origin Card B
  один» (`Expected length: 1, Received length: 0`). Ложный зелёный не воспроизвёлся: под этой нагрузкой
  test шёл 3,8 s, как в покое, и навигация через link успевала за 300 ms.
- **Новый spec с тем же мутантом:** в покое 5 failed из 5, под нагрузкой 5 failed из 5, все на проверке
  вердикта: `worfy-card://c2.…/index.html: {"prevented":false}`, `Expected: true, Received: false`.
- **Новый spec без мутанта:** в покое 5 passed (3,7–3,9 s), под нагрузкой 5 passed (3,6–6,6 s).
- `pnpm lint && pnpm typecheck && pnpm test` (временный HOME) — exit 0, 257 файлов passed, 6 skipped.
  gate fast — exit 0, `[gate] зелено (fast)`. gate full и Linux CI — у оркестратора и в PR.
