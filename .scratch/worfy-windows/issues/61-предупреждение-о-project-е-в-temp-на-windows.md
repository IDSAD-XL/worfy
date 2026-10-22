# 61 — Windows: предупреждение, когда папка Project-а или его worktree лежит внутри `%TEMP%`

Type: task
Status: done 2026-10-22T03:24Z
PR: #728
Branch: worfy-windows/61
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

- [x] Unit test helper-а: таблица путей — внутри `%TEMP%`, вне его, короткое имя 8.3, `C:/` против
      `C:\`, другой регистр буквы диска, сам `%TEMP%`, соседняя папка с тем же началом имени
      (`Temp2`). На не-Windows — всегда «нет».
- [x] Test формы «Add project»: папка в `%TEMP%` даёт предупреждение на шаге «Folder», добавить её
      можно; папка вне `%TEMP%` — без предупреждения.
- [x] Test списка worktree-ов: worktree в `%TEMP%` помечен, остальные — нет.
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
- Project в `%TEMP%`, который Harness уже знает, без worktree-ов и без Session: предупреждения нет
  нигде. Форма его не показывает (диалог пропускается), а badge-ей без worktree-а Ticket-а и без
  Session нет.
- Follow-up: перенести сравнение путей (`isInsidePath`, сейчас в `src/main/claude-home/registry.ts`)
  в `src/shared/paths.ts`, где по решению Ticket-а 49 живут helper-ы путей. Сейчас
  `src/main/projects/temp-folder.ts` импортирует его из `registry.ts` и тянет за собой chokidar и
  `child_process`. В этом PR не перенесено: импорты `src/shared/paths.ts` держит PR #705.

## Риски

- Ложное предупреждение, если `%TEMP%` переопределён на папку, которую Storage Sense не трогает.
  Пункт 4 «Что делаем» решает это ценой чтения реестра.

## Итог

Session на Mac 2026-10-22, ветка `worfy-windows/61` от main `54c1c59a`. Поведение Windows
смоделировано в unit test-ах (пути win32, подменённые TEMP и TMP, realpath, который даёт длинное имя
вместо 8.3); на настоящем `%TEMP%` test-ы ещё не запускались.

- **Helper** — `insideUserTemp` в `src/main/projects/temp-folder.ts`. `%TEMP%` берётся так же, как у
  `os.tmpdir()`: TEMP, иначе TMP. Оба пути проходят через `realpathOrSelf` (на Windows —
  `realpathSync.native`, он раскрывает 8.3), потом сравниваются через `isInsidePath(…, 'win32')` из
  `src/main/claude-home/registry.ts`: без учёта регистра и вида разделителя, `Temp2` не внутри `Temp`,
  сам `%TEMP%` — внутри. На macOS и Linux ответ всегда «нет».
- **Пункт 4 (чтение настроек Storage Sense в реестре) — решено не читать.** Предупреждение
  показывается всегда, когда путь лежит в `%TEMP%`. Причины: Storage Sense можно включить в любой
  момент после добавления папки, а чтение реестра стоило бы запуска процесса на каждую проверку.
  Риск из раздела «Риски» остаётся: `%TEMP%`, перенесённый в папку, которую Storage Sense не чистит,
  тоже получит предупреждение.
- **Форма «Add project»:** `ProjectConnector.inspect` помечает новую папку (`insideTemp: true` в
  `ConnectFolder`). Проверяется корень, который будет подключён, а не выбранная подпапка. Шаг
  «Folder» показывает знак «in %TEMP%» и текст: причина и совет перенести checkout. Это не ошибка:
  «Write draft» работает как обычно. Папку, которую Harness уже знает, диалог пропускает, и
  предупреждения в форме у неё нет. Знак у её checkout-а виден только на badge Session, которая
  работает в checkout-е (`worktreeOfCwd`). Badge Ticket-а находит worktree по ветке Ticket-а
  (`worktreeOfTicket`), а checkout на `main` по ней не находится.
- **Список worktree-ов:** в UI он виден только через snapshot `checks.get` (gate badge на Ticket-е и
  на Session). Пометку ставит `readChecks` в `src/main/ipc/checks.ts` (`insideTemp: true` в
  `WorktreeChecks`). Знак тот же, tooltip — текст предупреждения и путь worktree-а.
  `src/main/claude-home/registry.ts:99` и `src/main/gate/state.ts:452` из «Где в коде» не менялись:
  первый список ищет транскрипты и не показывается в UI, а у второго test-ы на настоящих временных
  папках сломались бы на Windows, если пометка жила бы в `listWorktrees`.
- Test-ы: `test/unit/temp-folder.test.ts`, `test/unit/read-checks.test.ts`,
  `test/unit/connect-project.test.tsx`, `test/unit/checks-badges.test.tsx`,
  `test/contract/projects-connect.test.ts`. Mutation testing: 14 mutant-ов, все убиты.
- В `test/contract/github-prs.test.ts` у двух `checksHandlers` стоит `insideTemp: () => false`: их
  корни лежат во временной папке системы (на Windows это `%TEMP%`), а snapshot сравнивается целиком.
  Mutant «всё внутри %TEMP%» в значении по умолчанию у `readChecks` до этой правки ронял два test-а
  файла, после неё — ни одного.

### Мерж (2026-10-22)

PR #728 влит 2026-10-22, merge commit `a451d4be`. Head `719a4200`: gate full на Mac — зелёный (lint, typecheck,
test, e2e, package — exit 0); до этого запуска gate full падал только на shell-test-ах под нагрузкой Mac
([worfy-polish 37](../../worfy-polish/issues/37-предел-120-s-у-shell-test-ов-на-загруженном-mac.md)).

- Windows runner (`windows-tests.yml`, run 39714307426, head `719a4200`): шаг test-ов — 6 файлов PR, 194 passed,
  5 skipped. Сам job кончился `cancelled`: он упёрся в предел 10 min во время уборки после test-ов
  (post-шаги `actions/checkout`). На настоящем `%TEMP%` runner-а `test/unit/temp-folder.test.ts` прошёл.
- Последний пункт «Готово, когда» закрыт не весь: `pnpm lint` и `pnpm typecheck` на Windows-ПК не запускались.
