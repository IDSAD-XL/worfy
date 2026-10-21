# 0076 — Автоархив законченных Session-ов: правило в main, поле `archived` в Layout, история у Ticket-а или Epic-а, не Trash
Дата: 2026-10-19. Статус: принят.

**Контекст.** Session Node (карточка одного разговора с Claude Code) появляется при старте Session и
остаётся, finished, после того как процесс ушёл (`src/renderer/canvas/overlays/SessionNodes.tsx:1-5`).
Новый внешний Session Node встаёт под последним (`nextPlace`,
`src/renderer/claude-home/session-nodes.ts:200`). На Canvas Project-а CanvasForAI слева растёт длинная
колонка Session-ов, почти все finished. Убрать Node может только пользователь, по одному: Hide и Remove
(`src/renderer/canvas/nodes/SessionNode.tsx:381-391`, `:502-506`). Автоуборки и настройки нет. Код не
связывает «Session кончилась» и «её Ticket done». Подробно — исследование
[2026-10-19-организация-canvas.md](../research/2026-10-19-организация-canvas.md), разделы 2.2 и 3, P2.

Данные для правила уже есть:

- реестр живых Session-ов: `status` `idle` / `busy` / `unknown`, `startedAt`, `updatedAt`
  (`src/shared/ipc/claude-home.ts:25-34`); main получает его через `liveSessionListeners`
  (`src/main/ipc/claude-home.ts:39`);
- транскрипт: `lastAt`, `modifiedAt`, `gitBranch`, `cwd` (`src/shared/ipc/claude-home.ts:37-52`);
- Binding (связь Session с Ticket-ом или Epic-ом, `src/shared/binding/resolve.ts:1-20`) и статусы
  Ticket-ов из модели workflow;
- `pinned`, `hidden`, `tags` у Node-а Layout-а (`src/shared/layout/types.ts:47-57`).

Ограничения: main — единственный писатель Layout (ADR-0003); автоматические операции идут мимо ⌘Z
(ADR-0016); Trash хранит удалённое пользователем 3 дня (`src/shared/ipc/trash.ts:12`, ADR-0016); Project
открыт на нескольких экранах (ADR-0053); read-only экран Linked machine ничего не пишет (ADR-0066);
Node-ы не перекрываются (ADR-0038); «не знаем — не закрываем» (ADR-0031).

**Решение** (владелец, 2026-10-19: «Да на все 11 рекомендаций, заводи Epic worfy-canvas с ADR и
Ticket-ами», вопросы 4–6 исследования; Epic [worfy-canvas](../../.scratch/worfy-canvas/spec.md),
решения 4–6).

1. **Кандидат в архив** — Node вида `session`, у которого Session не живая (её нет в реестре живых
   Session-ов) и выполнено одно из двух:
   - простой дольше порога: от `lastAt` транскрипта прошло больше порога (по умолчанию 24 ч);
   - её Ticket done (Binding к Ticket-у) и с `lastAt` прошло больше 1 ч. Это правило выключается в
     Settings отдельно.
2. **Не архивируются никогда:**
   - живая Session;
   - Session со статусом `unknown`: не знаем — считаем живой (как ADR-0031);
   - Orchestrator (Node вида `orchestrator` — другой вид, правило его не видит);
   - закреплённый Node (`pinned`);
   - Node с флагом Keep (новое поле `keep`, ставит пользователь кнопкой Keep у Session Node);
   - недавно тронутый Node: пользователь открывал Session view или двигал Node меньше порога назад.
     Время касания — новое поле `touchedAt` у Node-а Layout-а. Main ставит его на каждой операции
     пользователя над Node-ом и по операции `touch`, которую renderer шлёт при открытии Session view.
3. **Кто архивирует — main**, по таймеру: при старте и раз в 10 минут. Так архив идёт один раз, даже
   если Project открыт на двух экранах (ADR-0053), и работает, когда Project смотрит только read-only
   Linked machine. Время — часы Machine Project-а. Операции автомата идут мимо ⌘Z (ADR-0016).
4. **Где хранится.** Новое поле Node-а Layout-а `archived: { at, rule, batch } | null`. `rule` — какое
   правило сработало (`idle` или `ticket-done`), `batch` — id партии одного прогона таймера. Не
   `hidden`: скрытое пользователем и убранное автоматом различаются, иначе «показать скрытые» вернёт
   сотню старых Session-ов. Архивный Node не на плоскости (`onThePlane`,
   `src/shared/layout/derived.ts:38`): его не рисует Canvas, его обходят рамки и `freePlace`. Дерево
   Subagent-ов уходит вместе с Session-ом — оно производное от Session.
5. **Куда смотреть.** Session с Binding — в истории своего Ticket-а или Epic-а: badge «N sessions» у
   Ticket-а и в шапке Epic frame-а, клик открывает список. Session без Binding — в popover «Archive»
   рядом с кнопкой Trash внизу Canvas: список по дате, поиск, Restore. Срока хранения у архива нет.
   **Не Trash:** Trash удаляет записи через 3 дня и принимает только удаления пользователя (ADR-0016).
6. **Возврат.**
   - Show (из истории) и Restore (из popover) — жест пользователя, шаг ⌘Z. Node встаёт на прежнее
     место, если оно свободно, иначе на ближайшее свободное (`freePlace`, ADR-0038). Show из истории
     Ticket-а ставит Node рядом с Ticket-ом.
   - Session, которую продолжили (`claude --resume`), снова живая: main снимает `archived` сам, мимо
     ⌘Z, и Node возвращается по тому же правилу места.
7. **Включено по умолчанию во всех Project-ах.** Настройка Machine-а в Settings → Canvas: «Archive
   finished sessions after: Never / 6 h / 24 h / 3 days / 7 days», по умолчанию 24 h, и галочка «…and
   when their Ticket is done», по умолчанию включена. «Never» выключает таймер. Действует настройка
   Machine Project-а: Linked machine её не меняет.
8. **Toast с Undo.** После каждой партии все экраны Project-а показывают toast «Archived N finished
   sessions · Undo». Undo — отдельная операция «вернуть эту партию» (`batch`), не шаг ⌘Z: автомат идёт
   мимо истории, и ⌘Z не должен отменять работу таймера. На read-only экране toast без кнопки Undo.
   Toast — общий компонент Ticket-а 16 Epic-а `worfy-ui` (внутренние toast-ы).
9. **Команда «Archive finished sessions now»** (палитра команд) — жест пользователя: те же правило и
   исключения, сразу, один шаг ⌘Z. На read-only экране команды нет.
10. **Порядок включения.** Пока нет истории и popover (где найти убранное) и toast-а с Undo, таймер
    выключен: Ticket 07 вливает правило и таймер со значением «Never», Ticket 10 (toast с Undo, после
    Ticket-ов 08 и 09) ставит значение по умолчанию 24 h. Так ни на одном main Session-ы не пропадают
    молча.

**Последствия.**

- **Canvas короче:** finished Session-ы старше суток уходят сами. Ничего не удаляется, транскрипты не
  трогаются.
- **Пользователь может не найти вчерашнюю Session на Canvas.** Смягчают история у Ticket-а и Epic-а,
  поиск в popover «Archive» и уже существующая History в боковой панели.
- **Layout растёт на три поля** (`archived`, `keep`, `touchedAt`) и операции `archive`, `restore`,
  `keep`, `touch`. Старый `layout.json` читается: поля по умолчанию пустые.
- **Две модели «убрать»:** Hide и Remove пользователя (Remove — в Trash на 3 дня) и архив автомата без
  срока. Разные кнопки, разные места, разные слова.
- **Таймер идёт только на Machine Project-а.** Порог считается от `lastAt` — абсолютного времени,
  поэтому часовой пояс Linked machine на него не влияет.
- **Строить: Ticket-ы 07–10** Epic-а [worfy-canvas](../../.scratch/worfy-canvas/spec.md).

## Considered Options

- **Свернуть Node в полоску на месте** (вариант 2a исследования, как Chrome Memory Saver). Отвергнуто:
  колонка короче примерно в 4 раза, но через месяц снова длинная.
- **Только popover «Archive»** (2c). Отвергнуто как единственное место: связь Session с работой
  теряется. Взят для Session-ов без Binding.
- **Только история у Ticket-а и Epic-а** (2b). Отвергнуто как единственное место: Session без Binding
  туда не попадает. Взят для Session-ов с Binding.
- **В Trash** (2d). Отвергнуто: Trash удаляет через 3 дня и по ADR-0016 принимает только удаления
  пользователя; автомат с удалением теряет данные.
- **Флаг `hidden` вместо `archived`.** Отвергнуто: «показать скрытые» вернёт всё убранное автоматом.
- **Архив в renderer, в каждом окне.** Отвергнуто: два экрана Project-а архивировали бы дважды, а при
  открытом только read-only экране — никто.
- **Архив автомата как шаг ⌘Z.** Отвергнуто: ⌘Z пользователя отменял бы работу таймера вместо его
  собственных шагов (ADR-0016).
- **Подтверждение перед архивом.** Отвергнуто: Undo после действия лучше подтверждения до него
  (исследование, источник 25); архив обратим.
- **Выключено по умолчанию.** Отвергнуто (решение 6): уборка нужна тем, кто сам не чистит Canvas.

## Amendments

- **2026-10-21, Session без транскрипта** (worfy-canvas Ticket 16, ревью PR #536). Claude Code удаляет
  транскрипты старше своего срока хранения (по умолчанию 30 дней), и правило пункта 1 не находило
  `lastAt`: такой Session Node не архивировался никогда. Теперь простой Session без времени в
  транскрипте (транскрипта нет, или в нём нет записи со временем) считается от `touchedAt` её Node-а.
  Если нет и `touchedAt`, прогон таймера ставит его сам — операцией `touch` без экрана (мимо ⌘Z), —
  и Node уходит в архив через порог после того, как архив его впервые увидел. Исключения пункта 2
  остаются: живая Session, Keep, закреплённый Node. «Archive finished sessions now» и «Never» часы не
  ставят. Время создания Node-а Layout не хранит, поэтому оно не используется. Если за прогон
  `git worktree list` упал — timeout 5 с или любая другая ошибка, кроме двух, — worktree вне корня
  Project-а пропадает из живых Session-ов (и, возможно, из транскриптов): такой прогон не архивирует
  ничего и часов не ставит
  (`worktreesListed`, `src/main/layout/archive.ts`), «Archive finished sessions now» в нём не находит
  кандидатов. Иначе живая Session в таком worktree выглядела бы законченной. Две ошибки сбоем не
  считаются, worktree-ов тогда просто нет: папка Project-а — не git-репозиторий (git выходит с кодом
  128 и словами «not a git repository») и git не установлен (ENOENT).
- **2026-10-21, команды раскладки не трогают Node-ы** (worfy-canvas Ticket 16, ревью PR #536).
  «Tidy up» и «Arrange by Epic» двигают все Node-ы одним `moveMany` с пометкой `arrange: true`; main
  не ставит по нему `touchedAt` (`src/main/layout/store.ts`, `touchedBy`). Раньше после «Tidy up»
  архив молчал ещё порог для каждого сдвинутого Node-а. Перетаскивание руками по-прежнему считается
  касанием. Отмена такой команды (⌘Z) пока шлёт `moveMany` без пометки и считается касанием.
- **2026-10-21, архив при первом чтении Layout, 24 h по умолчанию, toast с Undo** (worfy-canvas
  Ticket 10, ревью PR #686). Таймер не читает `layout.json` Project-а, который никто не открывал: прогон
  берёт только Project, чей Layout main уже держит. Project архивируется в момент, когда main впервые
  читает его Layout (окно открыло Project, Linked machine его запросила, `LayoutStore.onFirstRead`), и
  дальше раз в 10 минут. Так Project, открытый при старте, архивируется при старте, а исправления
  первого чтения (наложения, ADR-0038) не идут раньше, чем Layout кто-то попросил. Порог по умолчанию —
  24 h (пункт 10 выполнен); выбравший «Never» его сохраняет. После каждой партии таймера main шлёт
  окнам `layout.archived`; окно показывает один toast на Project «Archived N finished sessions» с Undo,
  следующая партия заменяет его. Undo — `layout.restoreBatch`: `restore` без экрана только тех Node-ов
  партии, что ещё в архиве, мимо ⌘Z. Toast закрывается сам, когда в архиве не осталось ни одного Node-а
  его партии. На read-only экране toast без Undo.
