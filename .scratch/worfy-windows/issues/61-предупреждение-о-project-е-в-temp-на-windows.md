# 61 — Windows: предупреждение, когда папка Project-а или его worktree лежит внутри `%TEMP%`

Type: task
Status: open
Blocked by: —
Source: «Итог» [Ticket-а 52](52-из-node_modules-соседних-worktree-пропадают-пакеты.md) (PR #495, вопрос 2
для reviewer-а: «нужно ли предупреждение, когда checkout лежит внутри `%TEMP%` на Windows»); ответ
владельца на Q26 2026-10-18: «26 ок».

Приоритет — low: так решил владелец.

## Что происходит

- **Windows Storage Sense («Контроль памяти») удаляет временные файлы**, когда на диске мало места
  (если в его настройках включено удаление временных файлов приложений). Под удаление попадает и
  `%TEMP%` пользователя (`C:\Users\<имя>\AppData\Local\Temp`).
- **Ticket 52 показал последствие.** На ПК владельца все worktree-ы лежали в `%TEMP%\worfy-01\`.
  Три прогона Storage Sense из трёх совпали с пропажей пакетов из `node_modules` этих worktree-ов с
  точностью до минуты (журнал `Microsoft-Windows-Storsvc/Diagnostic`, событие 1003). 2026-10-18 так
  опустели `node_modules` четырёх worktree-ов сразу.
- **worfy об этом не говорит.** Папку внутри `%TEMP%` можно добавить как Project, worktree-ы Project-а в
  `%TEMP%` показываются как обычные. Пользователь узнаёт о проблеме, когда test-ы или сборка падают на
  пропавших пакетах.
- worktree-ы ПК после Ticket-а 52 перенесены в `C:/Users/Alexey/worfy-wt` (Q25). Ticket — о том,
  чтобы следующий пользователь не наступил на то же.

## Что делаем

1. Helper в main: лежит ли путь внутри `%TEMP%` текущего пользователя. Сравнение — после `realpath`
   обоих путей и без учёта регистра и вида разделителя (как `sameProjectRoot`, `src/shared/paths.ts`),
   чтобы короткое имя 8.3 (`ALEXEY~1`) и `C:/…` против `C:\…` не прятали совпадение. На macOS и Linux
   helper всегда отвечает «нет»: там нет Storage Sense, и поведение не меняется.
2. Форма «Add project»: если выбранная папка внутри `%TEMP%` — строка-предупреждение на шаге «Folder»
   (не ошибка: добавить можно). Текст называет причину: Storage Sense может удалить файлы из этой
   папки, и советует перенести checkout.
3. Список worktree-ов Project-а (`git worktree list`, `src/main/claude-home/registry.ts:99`,
   `src/main/gate/state.ts:452`): у worktree-а внутри `%TEMP%` — тот же знак с tooltip.
4. Проверять ли настройки Storage Sense в реестре (`HKCU\…\StorageSense\Parameters\StoragePolicy`,
   `01` и `04`) — решить при работе. Без этой проверки предупреждение показывается всегда, когда путь в
   `%TEMP%`; с ней — только когда удаление временных файлов включено.

## Готово, когда

- [ ] Unit test helper-а: таблица путей — внутри `%TEMP%`, вне его, короткое имя 8.3, `C:/` против
      `C:\`, другой регистр буквы диска, сам `%TEMP%`, соседняя папка с тем же началом имени
      (`Temp2`). На не-Windows — всегда «нет».
- [ ] Test формы «Add project»: папка в `%TEMP%` даёт предупреждение на шаге «Folder», добавить её
      можно; папка вне `%TEMP%` — без предупреждения.
- [ ] Test списка worktree-ов: worktree в `%TEMP%` помечен, остальные — нет.
- [ ] Windows-ПК: `pnpm lint`, `pnpm typecheck` — exit 0; test-файлы PR — exit 0. Mac: gate full
      зелёный (по правилу needs-mac-gate).

## Тесты

Unit test-ы helper-а и формы на Mac и Linux (через подменённую систему); на ПК — те же файлы на
настоящем `%TEMP%`.

## Где в коде

- Форма «Add project»: `src/main/projects/connect.ts` (`inspectFolder`, `:206`).
- Сравнение путей Windows: `src/shared/paths.ts` (`sameProjectRoot`, `isWindowsAbsolutePath`).
- Список worktree-ов: `src/main/claude-home/registry.ts:99`, `src/main/gate/state.ts:452`.

## Вне скоупа

- Перенос папок или запрет добавлять их — решает пользователь.
- Изменение настроек Storage Sense из worfy — это настройки системы пользователя.
- Папки evidence и временные папки test-ов (они и должны лежать в `%TEMP%`).

## Риски

- Ложное предупреждение, если `%TEMP%` переопределён на папку, которую Storage Sense не трогает.
  Пункт 4 «Что делаем» решает это ценой чтения реестра.
