# 08 — Файл или картинку можно бросить прямо на Узел Session-а

Type: task
Status: done 2026-10-15
PR: #352
Blocked by: —
Source: [spec.md](../spec.md), кандидат U2; «Итог»
[`worfy-mvp` 20](../../worfy-mvp/issues/20-поле-ввода-slash-и-вложения.md): «Перетаскивание на Узел не
сделано. `SessionNode.tsx` вне следа тикета; файлы принимает поле ввода Session view. Узел Сессии —
отдельная правка».

## Что происходит

- Вложения есть только в поле ввода Session view: `MessageInput.tsx` читает брошенные и вставленные
  файлы (`attachFiles`, `src/renderer/session/MessageInput.tsx:195-215`), проверяет их в main
  (`agent.attach`, `:183-189`) и показывает чипами; `agent.send` берёт `attachments`
  (`src/shared/ipc/agent.ts:43`). Обработчики `onDragOver` и `onDrop` — `:294-323`. Лимиты — в
  `src/shared/agent/attachments.ts` (картинка до 3,75 МБ, файл до 20 МБ, число вложений `MAX_ATTACHMENTS`).
- Узел живой Session-и (`data.origin: 'worfy'`) на Canvas тоже имеет поле ввода
  (`src/renderer/canvas/nodes/SessionNode.tsx:312-321`), но `send` (`:198-211`) шлёт только текст, а
  файл, брошенный на Узел, никто не принимает. Чтобы отдать Claude-у скриншот, приходится открывать
  Session view.

## Что делаем

1. **Общий код.** Чтение файлов и вызов `agent.attach` выносятся из `MessageInput.tsx` в
   `src/renderer/session/attach-files.ts` (чистая функция над `File[]` и `invoke`, без React). Поведение
   `MessageInput` не меняется.
2. **Узел живой Session-и принимает файлы.** `onDragOver` на Узле (с файлами в `dataTransfer`) —
   подсветка рамки Узла цветом акцента (токены); `onDrop` — файлы проверяются тем же `agent.attach` и
   встают чипами над полем ввода Узла. Отправка — как сейчас, Enter или кнопка: текст и вложения вместе;
   сообщение только из вложений тоже уходит (правило `agent.ts:44`).
3. Узел Session-и не из worfy (только чтение) и Узел без поля ввода файлы не принимают: курсор
   «нельзя», ничего не происходит.
4. Если Session не запущена, бросок сначала делает то же, что отправка (`ensure()` — Resume), и только
   потом `agent.attach`: вложение привязано к `sessionId`.
5. Отказы (слишком большой файл, лишние вложения) — та же строка проблемы Узла, что у отправки.
6. Бросок на Узел не двигает Node и не создаёт Binding: `nodrag`, обработчики Canvas не получают событие.

## Готово, когда

- [x] Unit test: бросок картинки и текстового файла на Узел живой Session-и — два чипа; отправка зовёт
      `agent.send` с `attachments` из `agent.attach`.
- [x] Unit test: Узел внешней Session-и — `agent.attach` не зовётся.
- [x] Unit test: файл больше лимита — отказ в строке проблемы, чипа нет, `agent.attach` для него не зовётся.
- [x] Test-ы `message-input-attach.test.tsx` зелёные без изменения ожиданий (общий код не поменял поведение).
- [ ] (вручную) Stable copy: скриншот из Finder на Узел Session-и → Enter — Claude видит картинку.
      Не проверено: шаг владельца на Stable copy после влития.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный. Lint, typecheck, test и gate fast — exit 0;
      gate full делает оркестратор перед merge.

## Тесты

- `test/unit/session-node-drop.test.tsx` — новый; событие `drop` с `DataTransfer` в jsdom, `invoke` — mock,
  как в `test/unit/message-input-attach.test.tsx`.
- Сначала красный: «бросок на Узел даёт чип» на нынешнем коде.
- Мутанты: `send` без `attachments`; `attachments` не очищаются после успешной отправки; бросок на
  внешний Узел зовёт `agent.attach`. Каждый краснит свой test.

## Где в коде

- `src/renderer/canvas/nodes/SessionNode.tsx`
- `src/renderer/session/MessageInput.tsx`
- `src/renderer/session/attach-files.ts`
- `test/unit/session-node-drop.test.tsx`
- `test/unit/message-input-attach.test.tsx`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/shared/agent/attachments.ts`, `src/shared/ipc/agent.ts`, `src/main/agent/attachments.ts`,
`test/unit/session-nodes.test.tsx`.

## Вне скоупа

- Бросок на Canvas вне Узла (создать Card из файла).
- Бросок на Узел Ticket-а или Terminal-а.
- Кнопка «+» (выбор файла в диалоге) и вставка картинки из буфера на Узле — только бросок.

## Итог

- Общий код вынесен в `src/renderer/session/attach-files.ts`: `readFiles` (чтение, отказ по размеру
  до чтения, лишние сверх `MAX_ATTACHMENTS`), `checkFiles` (`agent.attach`), `attachFiles` (оба шага),
  `takeAttached` (чипы и строка отказов по ответу main). `MessageInput.tsx` зовёт их; разметка
  чипов вынесена в `AttachmentChips` (там же) и общая с Узлом. Ожидания
  `message-input-attach.test.tsx` не менялись; добавлены два test-а броска на поле.
- Узел живой Session-и (`SessionNode.tsx`) принимает файлы: рамка при `dragover` — пунктир и кольцо
  `--accent`; `drop` — `preventDefault` и `stopPropagation` (Canvas событие не получает); чипы над
  полем ввода; отправка несёт `attachments`, сообщение только из вложений тоже уходит; при отказе
  отправки текст и чипы возвращаются. Узел только для чтения и Узел без Session-и: курсор «нельзя»
  (`dropEffect = 'none'`), ничего не прикрепляется.
- Решено без владельца, подтвердить: (1) если ни один брошенный файл не прошёл проверку размера,
  Session не запускается (Resume не делается ради отказа); (2) вторая отправка, пока первая в пути,
  не уходит — иначе вложения ушли бы дважды; (3) список чипов на Узле — до 64 px высоты, дальше
  прокрутка.
- Круг 2 ревью: отправка с Узла снимает текст и чипы с поля сразу, как поле Session view; они
  возвращаются, если Resume не удался, `agent.send` ответил отказом или бросил исключение. Вложения
  сообщения в пути считаются в лимит 20 один раз.
- Test-ы: `test/unit/session-node-drop.test.tsx` (22 test-а), мутанты — 23 из 23 убиты. Снимки обеих тем
  (рамка при броске, чипы, после отправки на fake agent) — в scratchpad, в репозиторий не кладутся.

### Gate оркестратора (2026-10-15)

- Wave Epic-а под Autopilot: Ticket-ы 01–05, 07–11 параллельно, общих файлов в «Где в коде» нет; 06 и 12 в команду не входили. Worktree — `.claude/worktrees/pol-<NN>`: пути `04`, `10`, `11` заняты деревьями других Epic-ов. Нагрузку CPU (`yes > /dev/null`) по своему «Готово, когда» дают 04 и 05; оркестратор пустил их параллельно с остальными, и timeout-ы под этой нагрузкой краснили gate соседей — ошибка плана, не implementer-ов.
- Гейт — два круга. Круг 1 — `VERIFIED` на `4b8cf7e` ([комментарий в PR #352](https://github.com/IDSAD-XL/worfy/pull/352#issuecomment-6190098765)); оркестратор вернул на один круг два пункта Consider: чип, удалённый во время Resume, всё равно уходил Claude, `room()` считал вложения в пути дважды; выживший мутант без сброса `sendingNow` (Send на Узле умирает после первого сообщения). Круг 2, только доработка, — `VERIFIED; debt` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/352#issuecomment-6190624472)): текст и чипы уходят из поля при Send, возвращаются в четырёх случаях неудачи; дублей и залипания нет.
- Мерж: база `e342f02`, head `8380829`; `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `9e2a208`.
- Act on — нет.
- Consider (круг 1, исправлено): см. выше.
- Noted ([low]): debt круга 2 — `src/renderer/canvas/nodes/SessionNode.tsx:272`, `:273`: ветки восстановления (текст, набранный во время неудачной отправки; файлы, брошенные за это время) не держит ни один test. При неудаче Resume во время броска видна только его ошибка, отказы по размеру того же броска — нет (`:275`).
- Dismissed — нет.
