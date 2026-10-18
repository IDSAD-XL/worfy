# 31 — Изменение Layout теряется, когда Project убирают из списка раньше отложенной записи

Type: task
Status: claimed 2026-10-18T15:06Z
Branch: worfy-windows/31
Blocked by: —
Source: «Итог» [Ticket-а 26](26-test-ы-на-windows-оставляют-папки-в-temp.md) (Windows Session назвала случай); первый круг ревью PR #276 на Mac, 2026-10-13 ([комментарий в PR #276](https://github.com/IDSAD-XL/worfy/pull/276#issuecomment-6138375749)) — воспроизведено двумя независимыми пробами

## Что происходит

- **Не про Windows.** Дефект есть на всех системах и на main; ветвления по системе в этом коде нет. Ticket лежит в этом Epic-е, потому что найден его Ticket-ом 26 и Epic сейчас в работе. На Windows не запускали.
- **Layout пишется на диск с задержкой.** `LayoutStore` пишет `layout.json` через 250 ms после последнего изменения (`LAYOUT_SAVE_DELAY_MS`, `src/main/layout/store.ts:28`). Каждое новое изменение сбрасывает timer и заводит его заново (`store.ts:229-232`). Верхней границы ожидания нет.
- **Запись спрашивает путь у списка Project-ов.** `flush()` берёт путь файла в момент записи (`store.ts:242`, через `layoutStore()` на `:257-263`). Для Project-а, которого в списке уже нет, `ProjectStore.get` бросает `No Project with id …` (`src/main/projects/store.ts:177-181`). `flush()` ловит ошибку, пишет строку в лог и оставляет запись «несохранённой» в памяти (`store.ts:244-246`).
- **Удаление из списка ничего не дописывает.** Обработчик `projects.remove` (`src/main/ipc/projects.ts:314-317`) сразу зовёт `store.remove`. Другого вызова `ProjectStore.remove` (`projects/store.ts:283-289`) нет.
- **При выходе то же самое.** `flushAll()` на `will-quit` (`src/main/ipc/layout.ts:18`) идёт через тот же `flush()`: строка в лог, на диск ничего.

### Что измерено на Mac (настоящие store-ы и IPC-вызовы, две пробы разных ревьюеров, exit 0)

- **A.** Изменение записано. Второе изменение, и сразу `projects.remove`. Через 750 ms в `layout.json` только первое. В логе: `[layout] could not save the Layout of <id> … No Project with id <id>`. Выход пишет ту же строку ещё раз и ничего не сохраняет.
- **B.** Тот же репозиторий добавлен снова в том же запуске: Layout показывает оба изменения — запись осталась в памяти. На диске по-прежнему одно, пока не придёт новое изменение или выход.
- **C.** Выход, новый запуск, добавить снова: второго изменения нет.
- **D.** Двенадцать изменений с шагом 100 ms (1,2 s): на диске ничего, пока они идут. После удаления из списка, ожидания и выхода `layout.json` так и не появился. Потеряно всё, включая первое.
- **Контроль.** Без удаления timer пишет всё. С `layoutStore().flush(id)` перед удалением всё на диске, ошибок нет.

### Как до этого дойти и что теряется

- **Теряется всё, что изменилось после последней записи**, а не «последние 250 ms», как сказано в тексте PR #276 и в «Итоге» Ticket-а 26.
- **Видно только после перезапуска** и нового добавления того же репозитория. Id Project-а — имя папки плюс hash пути (`projects/store.ts:69-72`), папка данных при удалении из списка остаётся намеренно (`worfy-mvp` Ticket 04), так что прежний Layout читается снова — без потерянных изменений.
- **Руками после своей правки — маловероятно.** Пункт меню «Remove from list» срабатывает с одного щелчка, без вопроса (`src/renderer/shell/sidebar/ProjectsSection.tsx:261-263`), но успеть за 250 ms трудно.
- **Реально, пока Layout пишет кто-то ещё:** Session агента (id Session и стоимость после каждого хода — `src/main/agent/orchestrator.ts:392`, `:423`; `src/main/agent/node-sessions.ts:275`), инструменты canvas (`src/main/mcp/canvas-server.ts:126`, `:213`, `:275`), наблюдатель HANDOFF (`src/main/ipc/docs.ts:42-53`), экран Linked machine — оттуда можно убрать любой Project, кроме активного. Пока такие записи идут чаще, чем раз в 250 ms, на диск не попадает ничего.
- **Побочное:** запись остаётся в памяти до выхода и пишет ошибку в лог при каждом выходе.

### Что не затронуто (прочитано)

- Откладывает запись ещё только `src/main/layout/viewports.ts:119-136` — положение камеры. Камеру убранного Project-а он сбрасывает намеренно (`:106-117`) и список при записи не спрашивает.
- Остальные store-ы пишут внутри вызова: данные Card, настройки Project-а и приложения, bindings, корзина, настройки Session, Limits, сам список Project-ов.
- Существующий test `test/contract/layout-store.test.ts:229` зовёт `flushAll()` до удаления, поэтому отложенную запись не покрывает.

## Что делаем

1. **Перед удалением из списка дописать Layout этого Project-а.** В `projects.remove` — `layoutStore().flush(id)` до `store.remove(…)`.
2. **После удаления убрать запись из памяти** — новый метод `LayoutStore`. Тогда повторное добавление читает файл, а выход не пишет ошибку.
3. **Решить про верхнюю границу ожидания записи.** Сейчас непрерывные изменения откладывают запись без конца, и аварийное завершение теряет их все. Вариант: писать не позже чем через N секунд после первого несохранённого изменения. Решение и число — за исполнителем, записать в «Итог».
4. **Поправить формулировку** в «Итоге» Ticket-а 26: «всё после последней записи» и «видно после перезапуска».

Другой путь для пунктов 1–2, если окажется проще: хранить путь файла в записи при первом чтении (`store.ts:175-183`) и писать по нему, не спрашивая список. Тогда запись придёт по timer-у, а не сразу, и запись в памяти останется: первые два пункта «Готово, когда» и мутанты формулируются иначе — записать это в «Итог».

## Готово, когда

- [x] Test (contract, все системы): изменение Layout, сразу `projects.remove`; `layout.json` содержит изменение; в логе нет строки об ошибке; `flushAll()` после этого ничего не пишет и ничего не логирует.
- [x] Test: после удаления и нового добавления в том же запуске Layout читается с диска.
- [x] Пункт 3: решение записано в «Итог»; если граница введена — test «двенадцать изменений с шагом 100 ms: файл появляется не позже границы».
- [ ] Формулировка в «Итоге» Ticket-а 26 исправлена.
- [ ] `gate full` зелёный на Mac.

## Тесты

- `test/contract/layout-store.test.ts` — оба случая и, если введена, граница ожидания.
- Мутанты: убрать `flush` перед удалением; убрать сброс записи — каждый должен падать.

## Где в коде

- `src/main/layout/store.ts` — `schedule`, `flush`, `flushAll`, `layoutStore`.
- `src/main/ipc/projects.ts:314-317` — `projects.remove`.
- `src/main/projects/store.ts` — `get`, `remove`, `projectId`.
- `src/main/ipc/layout.ts:18` — запись при выходе.

## Вне скоупа

- Вопрос перед «Remove from list».
- Удаление папки данных Project-а.
- `saveLayoutNow()` в test-ах (Ticket 26) и его остатки — [Ticket 32](32-остатки-ревью-pr-276.md).

## Риски

- **Запись при удалении может не пройти** (диск, права). Тогда Project всё равно уходит из списка, а ошибка идёт в лог — как сейчас; молча не глотать.
- **Удаление с Linked machine** идёт тем же обработчиком: проверить, что `flush` стоит до проверки `keepActive` или не мешает её отказу.

## Итог

Windows Session, 2026-10-18, ветка `worfy-windows/31` от main 3c23d7a4. Commit с правкой — 6555361a.

### Причина (подтверждена на текущем коде)

- `flush()` берёт путь `layout.json` у списка Project-ов в момент записи (`src/main/layout/store.ts:242` до правки). Для убранного Project-а это бросает `No Project with id …`, ошибка уходит в лог (`:245`), запись остаётся «несохранённой».
- `projects.remove` сразу звал `store.remove` (`src/main/ipc/projects.ts:310` до правки), отложенную запись ничто не дописывало. Red run воспроизвёл это на Windows: в логе та же строка `[layout] could not save the Layout of auction-… No Project with id …`.

### Что сделано

- **Пункт 1.** `projects.remove` сначала зовёт `layoutStore().flush(id)`, пока Project ещё в списке (`src/main/ipc/projects.ts:315`).
- **Пункт 2.** Новый метод `LayoutStore.forget(id)` (`src/main/layout/store.ts:291`): останавливает timer-ы и убирает запись из памяти. Зовётся после `store.remove` (`projects.ts:317`). Повторное добавление читает файл, выход ничего не пишет и не логирует. Если запись перед удалением не прошла (диск, права), `flush` пишет ошибку в лог, а `forget` пишет вторую строку — что несохранённые изменения потеряны. Молча не глотается.
- **Revision не начинается с 0 (круг ревью, commit 1c454be3).** Первая версия `forget` выбрасывала запись вместе со счётчиком `revision`. Повторное добавление в том же запуске начинало с revision 0. А экран хранит последний полученный Layout и отбрасывает состояние с меньшей revision (`acceptLayoutState`, `src/renderer/canvas/useLayout.ts:24`; так же сравнивают отметки undo в `src/renderer/canvas/history.ts`). Без перезагрузки окна Canvas показывал бы старую копию. Теперь `forget` запоминает последнюю revision (`store.ts:171`, `:296`), а новое чтение файла продолжает с неё + 1 (`store.ts:204-208`).
- **Риск с Linked machine.** `flush` не бросает исключений, поэтому отказ `keepActive` (удаление активного Project-а с Linked machine) проходит как раньше. `forget` при отказе не вызывается: исключение летит раньше. **Ответ на замечание ревью:** первая версия test-а этого не ловила (`forget` выше `store.remove` или в `finally` проходили). Теперь test проверяет, что после отказа `layout.get` отдаёт ту же revision. `forget` на пути отказа заставил бы прочитать файл заново, уже с revision + 1. Мутанты «`forget` до `store.remove`» и «`forget` в `finally`» этим test-ом убиты — после правки revision они не стали безвредными.
- **Пункт 3 — граница введена: 1000 ms.** `LAYOUT_SAVE_MAX_DELAY_MS = 1000` (`store.ts:37`). Первое несохранённое изменение заводит второй timer (`store.ts:257`), следующие изменения его не сдвигают. `flush` останавливает оба. Почему 1000: аварийное завершение теряет не больше секунды. При непрерывных изменениях запись идёт раз в секунду, это дёшево. Число меньше 1,2 s, поэтому ticket-овый test «двенадцать изменений с шагом 100 ms» проверяет именно границу. Опция конструктора `maxDelayMs` — для test-ов.
- **Существующий test** «debounces writes: a burst of operations is one write» укорочен: было 20 операций по 125 ms (2,5 s), стало 6 (750 ms). Иначе burst длиннее границы и по новому правилу пишется по ходу. Смысл test-а прежний.
- **Другой путь** (хранить путь файла в записи) не выбран: в памяти осталась бы запись, а повторное добавление не перечитывало бы файл.

### Test-ы (`test/contract/layout-store.test.ts`)

- describe «layout store: projects.remove of a Project with a change not yet written», на настоящем `projects.add`/`projects.remove` через IPC и git-репозитории во временной папке:
  - изменение ждёт записи, сразу `projects.remove` → оно в `layout.json`, ошибок `[layout]` нет. Затем файл удаляется и вызываются обработчики `will-quit`: файл не появился, в логе пусто. Настоящее ожидание 2 × 250 ms из первой версии убрано: оно не убивало ни одного мутанта;
  - после удаления и нового добавления в том же запуске Layout читается с диска (файл изменён, пока Project вне списка);
  - после нового добавления первое состояние имеет revision больше последней до удаления, следующая операция идёт с revision + 1;
  - Linked machine удаляет активный Project → отказ. Запись в памяти та же (revision не изменилась), Layout продолжает работать и пишется.
- «operations with no quiet period between them are still written, LAYOUT_SAVE_MAX_DELAY_MS at the latest after the first one» — двенадцать изменений с шагом 100 ms.
- «the bound holds for every stretch of a long stream…» — операции каждые 100 ms в течение 2,5 s: записей не меньше двух, вторая не позже 2 × `LAYOUT_SAVE_MAX_DELAY_MS`. Ловит `flush`, который не сбрасывает timer границы: тогда граница работает только для первой серии.
- «forget() of a Layout whose write failed…» — `write` бросает. После `flush` + `forget` в логе ровно две строки `[layout]`: неудачная запись и потерянные изменения. Затем ни timer, ни `flushAll` не пытаются писать.
- `start()` в test-е принимает `{ trash, projects }` вместо одного флага; `call()` принимает sender.

### Команды и exit codes (Windows 11, `node scripts/vitest-electron.mjs …`, каждый run вместе с `test/unit/no-rmsync.test.ts` и `test/unit/e2e-no-spawn-on-load.test.ts`)

- **Red** (test-ы есть, правки нет): `layout-store.test.ts` — exit 1. Упали 3 из 108: два первых test-а нового describe и test границы. Test про Linked machine проходил и до правки: он сторожит риск, а не ловит дефект.
- **Green** по всем contract test-ам, которые импортируют `layout/store`, `ipc/projects` или `ipc/layout` (23 файла), плюс `test/unit/test-remove.test.ts`: exit 1, 22 failed / 656 passed / 6 skipped. Все 22 падения — в `projects.test.ts` (10), `canvas-tools.test.ts` (4), `projects-connect.test.ts` (4), `link-access.test.ts` (3), `link-server.test.ts` (1). Это пути `/` против `\`, symlink, linked worktree, код закрытия 1006 вместо 1009 — Windows-проблемы других ticket-ов. **Проверено, что не от этой правки:** те же пять файлов с `src/main/ipc/projects.ts` и `src/main/layout/store.ts` из HEAD — exit 1, те же 22 test-а (списки имён совпали, `diff` exit 0). Затем правка возвращена, `cmp` exit 0.
- **Green, финальный, на commit-е:** `layout-store`, `layout-pin-tag`, `viewport-store`, `trash` — exit 0, 157 passed / 1 skipped.
- `CI=true pnpm lint` — exit 0. `CI=true pnpm typecheck` — exit 0.

### Мутанты (каждый отдельно; файл восстановлен из копии, `cmp` exit 0, `git diff --quiet` exit 0 после каждого)

- Убран `flush` перед удалением — убит (exit 1): падают «the change is in layout.json…» и «added again…».
- Убран вызов `forget` после удаления — убит (exit 1): падает «added again…».
- В `forget` убрано `entries.delete` — убит (exit 1): падает «added again…».
- Убран timer границы (`entry.deadline ??= …`) — убит (exit 1): падает test границы.

### Круг ревью (commit 1c454be3): команды, exit codes, мутанты

- **Red:** новые test-ы против `store.ts` из 1f6b85b0 — exit 1, упал 1 из 111: «added again in the same run, the Layout goes on after the last revision…». Остальные три новых или изменённых test-а проходят и на старом коде: они сторожат мутанты ниже. Файл возвращён, `cmp` exit 0.
- **Green:** `layout-store.test.ts` — exit 0, 111 passed.
- **Мутанты** (на 1c454be3, каждый отдельно; после каждого `cmp` exit 0 и `git diff --quiet` exit 0). Все девять убиты, test exit 1 у каждого:
  - четыре мутанта первого круга — снова убиты;
  - `forget` не запоминает revision — падает test revision;
  - `forget` до `store.remove` — падает test отказа Linked machine;
  - `store.remove` в `try`, `forget` в `finally` — падает test отказа Linked machine;
  - `flush` не сбрасывает timer границы (убрано `entry.deadline = undefined`) — падает test «the bound holds for every stretch…»;
  - строка лога в `forget` убрана — падает test «forget() of a Layout whose write failed…».
- **Финальный run на 1c454be3:** `layout-store`, `layout-pin-tag`, `viewport-store`, `trash`, `no-rmsync`, `e2e-no-spawn-on-load` — exit 0, 160 passed / 1 skipped. `CI=true pnpm lint` — exit 0. `CI=true pnpm typecheck` — exit 0.

### Не проверено / не сделано

- **Пункт 4 не сделан:** правило Windows Session запрещает править другие ticket-ы. Править нужно `26-…md:197`: «Теряется то, что изменено за последние 250 ms» → «всё, что изменено после последней записи; видно после перезапуска и нового добавления».
- `gate full` на Mac не запускался.
- В живом приложении (Electron с окном) не проверялось — только contract test-ы. Что экран действительно принимает Layout после нового добавления, проверено только через revision в main, без renderer-а.
