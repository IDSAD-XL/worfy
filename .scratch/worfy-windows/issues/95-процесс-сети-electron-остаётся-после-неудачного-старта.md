# 95 — После неудачного старта на Windows остаётся процесс сети Electron

Type: task
Status: open
Blocked by: —
Source: направление Session на Mac 2026-10-22, PR #750 (группа 3 Ticket-а 14: test-ы собранного приложения на
Windows). Замер на ПК 2026-10-22, строки — по main `5b099be9`; сборка и `node_modules` — из worktree PR #750
(`wt14p`, только чтение).

## Что происходит

Когда старт worfy проваливается сразу после `ready` (шаг `loadURL`), главный процесс выходит с кодом 1 через
`app.exit(1)` (`src/main/startup-failure.ts:125`), а дочерний процесс сети Chromium
(`electron.exe --type=utility --utility-sub-type=network.mojom.NetworkService`) остаётся жить без родителя.
Он не выходит сам: живые сироты прожили 120 s и больше (под наблюдением), один — около 10 минут, пока его не
сняли `Stop-Process`. После полного e2e на ПК такой процесс остаётся каждый раз; его оставляет test
`test/e2e/packaged.spec.ts:662` («with an ELECTRON_RENDERER_URL that is not a URL stops with exit code 1»).

Это может быть ошибка продукта: тот же процесс остался бы и у пользователя, у которого старт worfy провалился на
шаге после `ready`. Папку данных он не держит (её можно переименовать, пока он жив), но висит в списке процессов
до перезагрузки или `Stop-Process`.

## Доказательства (замер на ПК, 2026-10-22)

Как воспроизвести, без Playwright: PowerShell-скрипт замера (`%TEMP%\wt95-measure.ps1`, в репозиторий не входит)
запускает процесс с временными `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `HOMEDRIVE`, `HOMEPATH`, `HOME`,
временными `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME`, `WORFY_GH` = `test/fixtures/gh/gh-stub.mjs`,
`WORFY_STARTUP_DIALOG=off`; каждые 200 ms пишет дерево процессов (`Get-CimInstance Win32_Process`: дети главного
pid и любой процесс, в командной строке которого есть временная папка запуска — у детей Chromium там
`--user-data-dir=<WORFY_DATA_DIR>`); после выхода главного ждёт и снимает только тех выживших, кого записал сам
(тот же pid, время создания и командная строка). Эквивалент одной командой (после `pnpm build`):

```powershell
$env:ELECTRON_RENDERER_URL = 'not a url'; $env:WORFY_STARTUP_DIALOG = 'off'; $env:WORFY_DATA_DIR = "$env:TEMP\worfy-95-data"
# плюс временные USERPROFILE, APPDATA, LOCALAPPDATA и WORFY_CLAUDE_HOME
node_modules\electron\dist\electron.exe . -ApplePersistenceIgnoreState YES   # выходит с кодом 1 за 0,7–0,8 s
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$env:WORFY_DATA_DIR*" } |
  Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine
```

Дерево процессов одного запуска (dev, `ELECTRON_RENDERER_URL=not a url`):

| pid | родитель | процесс | создан |
|---|---|---|---|
| 37132 | 37716 (PowerShell замера) | `electron.exe C:\…\wt14p -ApplePersistenceIgnoreState YES` (главный) | 14:31:00.268 |
| 49640 | 37132 | `electron.exe --type=utility --utility-sub-type=network.mojom.NetworkService --lang=ru --service-sandbox-type=none --user-data-dir="…\wt95-run-348f1a14\data" …` | 14:31:00.759 |

Главный вышел с кодом 1 через 0,8 s после старта, в stderr — «worfy could not start / Step: loadURL (loading the
window from the dev server) failed». Через 0,5 s после выхода жив 49640, его родитель 37132 — нет. Через 120 s
49640 всё ещё жив; снят `Stop-Process`. Процессов GPU и renderer в этом запуске не было: старт провалился до
первого окна.

Сколько раз и где:

| Запуск | Как проваливается | Сирота сети |
|---|---|---|
| dev Electron (`electron.exe <repo>`), `ELECTRON_RENDERER_URL=not a url` | шаг `loadURL`, после `ready`, `app.exit(1)` | 8 из 9 запусков |
| собранный `dist\win-unpacked\worfy.exe`, `WORFY_DATA_DIR` — файл | шаг `checkDataFolder`, до `ready`, `app.exit(1)` | 0 из 3: детей нет вовсе |
| dev Electron, `WORFY_DATA_DIR` — файл | то же | 0 из 3 |
| Electron без worfy: `app.whenReady().then(() => app.exit(1))` | — | 3 из 4 |
| Electron без worfy: `app.whenReady().then(() => app.quit())` | — | 0 из 4 |
| Electron без worfy: `app.exit(1)` через 200 ms после `ready` | — | 0 из 4 |
| Electron без worfy: `app.exit(1)` через 1500 ms после `ready` | — | 0 из 4 (GPU и сеть успели запуститься и вышли с главным) |

Вывод замера: сироту оставляет `app.exit()` Electron 44.5.1, вызванный сразу после `ready`, пока процесс сети ещё
запускается; `app.quit()` в тот же момент и `app.exit()` чуть позже его не оставляют. worfy попадает ровно в это
окно: шаг `loadURL` (`src/main/index.ts:133`) — синхронный и идёт почти сразу после `whenReady()`
(`src/main/index.ts:121`). Это чтение по замеру, исходники Electron не разбирались.

Собранный `worfy.exe` тот же Electron, но `ELECTRON_RENDERER_URL` в собранном приложении не действует, а другой
провал после `ready` извне не вызвать: на собранном приложении случай не воспроизведён (см. «Не проверено»).

## Код

- `src/main/startup-failure.ts:116-126` — `reportStartupFailure`: печатает причину, показывает окно ошибки (если не
  `WORFY_STARTUP_DIALOG=off`) и зовёт `app.exit(1)`. Комментарий `:111-114` объясняет выбор: у `app.quit()` нет кода
  выхода, а обработчики `before-quit` и `will-quit` написаны для запущенного приложения.
- `src/main/index.ts:41`, `:77-85` — `dataFolderUsable()` до `ready`: провал там детей не оставляет (замер выше).
- `src/main/index.ts:121-133` — `whenReady()` и шаг `loadURL`: провал здесь оставляет сироту.
- `src/main/window.ts:197` — провал загрузки первого окна тоже идёт в `reportStartupFailure`; он случается позже, когда
  процесс сети уже запущен, и не замерен.
- Ничего в worfy не останавливает дочерние процессы Chromium при `app.exit()`: их жизнью управляет Electron.

## Что делаем

1. Test, который сегодня красный (раздел «Готово, когда»).
2. Выбрать исправление и проверить его тем же test-ом. Варианты, не проверены:
   - выход после провала через `app.quit()` и код 1 по `will-quit` / `quit` (например, `app.exit(1)` в обработчике
     `quit`, когда старт провалился), с обработчиками `before-quit`, которые знают о провале старта;
   - `app.exit(1)` не сразу: дождаться, пока Electron поднимет процесс сети (например, `setImmediate` / короткая
     пауза, или событие), — хрупко, зависит от времени;
   - снять детей самому перед `app.exit(1)` (`app.getAppMetrics()` даёт pid-ы и типы) — обходит причину, но
     надёжно на всех системах.
3. На Mac — проверка из «Mac checks» до и после правки.

## Готово, когда

- [ ] В `test/e2e/packaged.spec.ts` test «with an ELECTRON_RENDERER_URL that is not a URL stops with exit code 1»
  после выхода главного процесса проверяет, что через 5 s нет ни одного процесса, в командной строке которого есть
  `--user-data-dir=<WORFY_DATA_DIR этого запуска>` (Windows — `Get-CimInstance Win32_Process`, macOS — `ps -axo
  pid=,command=`). На main этот test на ПК красный (сирота в 8 из 9 запусков), с правкой — зелёный в 10 запусках
  подряд (`--repeat-each 10`).
- [ ] Код выхода, текст stderr («worfy could not start», шаг `loadURL`) и отказ без окна ошибки — как прежде; test
  `:662` проверяет их по-прежнему.
- [ ] После полного `pnpm test:e2e` на ПК нет `electron.exe` с `NetworkService` без родителя.
- [ ] На Mac тот же test зелёный, и после него нет процесса `Electron Helper` с папкой данных запуска.

## Где в коде

- `src/main/startup-failure.ts`
- `src/main/index.ts`
- `test/e2e/packaged.spec.ts`
- `test/e2e/helpers.ts` (если проверку процессов понадобится вынести в helper)

## Mac checks

На macOS этот замер не делался: Session на Windows-ПК не может запустить macOS. Mac проверяет, остаётся ли там
процесс-помощник:

```sh
pnpm build
D=$(mktemp -d); ELECTRON_RENDERER_URL='not a url' WORFY_STARTUP_DIALOG=off WORFY_DATA_DIR="$D" \
  WORFY_CLAUDE_HOME="$(mktemp -d)" node_modules/.bin/electron . -ApplePersistenceIgnoreState YES; echo "EXIT=$?"
sleep 5; ps -axo pid,ppid,lstart,command | grep -F "$D" | grep -v grep
```

Ожидание, если на Mac всё в порядке: `EXIT=1` и пустой вывод `ps`. Если там остаётся `Electron Helper` с
`--utility-sub-type=network.mojom.NetworkService`, случай не только Windows.

## Не проверено

- Собранный `worfy.exe`: провал после `ready` извне не вызвать (`ELECTRON_RENDERER_URL` в собранном приложении не
  действует); провал до `ready` (папка данных — файл) детей не оставляет. Что собранное приложение ведёт себя как dev
  Electron, — вывод из того, что это тот же Electron 44.5.1, не замер.
- Провал загрузки первого окна (`src/main/window.ts`) — позже по времени, не замерен.
- macOS — см. «Mac checks».
- Почему именно процесс сети не узнаёт о смерти родителя — исходники Electron и Chromium не разбирались.

## Итог

2026-10-22, ветка `worfy-windows/95` (Session на Windows-ПК; пауза владельца на окна и фокус — Electron не
запускался ни разу).

**Причина (по исходникам Electron, ветка `main` на GitHub; что в 44.5.1 то же — не сверено).** Вне macOS Electron
шлёт `ready` изнутри `ElectronBrowserMainParts::PreMainMessageLoopRun`, до того как пошёл главный цикл сообщений;
`exit_code_` заводится только в `WillRunMainMessageLoop`. Пока его нет, `Browser::ExitWithCode` не может задать код
и зовёт C-шный `exit(code)` сразу — без упорядоченного завершения Chromium, и процесс сети, который в этот момент
запускается, переживает главный. Шаг `loadURL` проваливается в promise-callback-е `whenReady()`, то есть ровно в
этом окне. `app.quit()` в то же время не оставляет сироту, потому что `Browser::Shutdown` ждёт замыкания выхода из
цикла («exiting now would leave defunct processes behind»), а `app.exit(1)` через 200 ms — потому что цикл уже идёт.
Это объясняет все строки таблицы замера; на macOS `ready` приходит изнутри цикла, и случая там быть не должно.

**Выбор.** Из вариантов тикета: `app.quit()` + код 1 отпал — `quit` срабатывает внутри того же раннего
`Shutdown`, и `app.exit(1)` из него снова попал бы в C-шный `exit()`; кроме того, `before-quit` / `will-quit`
написаны для запущенного приложения. Снятие детей через `app.getAppMetrics()` ненадёжно: процесс, который ещё
запускается, может в метриках не появиться. Сделано: `app.exit(1)` после `ready` — в таймере (`setTimeout(…, 0)`),
до `ready` — сразу, как было (`src/main/startup-failure.ts`, `exitWithFailure`). Это не пауза по времени, а порядок:
после `ready` Node в Electron гоняет таймеры только из задач главного цикла (`NodeBindings::UvRunOnce` через
`PostTask`; синхронный `UvRunOnce` из `StartPolling` идёт раньше `DidFinishLaunching`). Код выхода 1, текст stderr,
отказ от окна при `WORFY_STARTUP_DIALOG=off` и обход `before-quit` / `will-quit` — прежние.

**Test-ы.** `test/contract/startup-failure.test.ts`: у mock-а `app` появились `isReady()` (true после
`whenReady()`); новые test-ы — до `ready` выход сразу; после `ready` выход не из того же callback-а и не из
microtask, а на следующем ходу цикла, один раз, с кодом 1; окно — до выхода; в старте `src/main/index.ts` шаг
`loadURL` не выходит в том же job-е. 38 из 38, три прогона подряд; mutant-ы — в «Круг ревью 2». `test/e2e/packaged.spec.ts`, test «with an ELECTRON_RENDERER_URL that is not a URL stops with exit code 1»: через
5 s после выхода главного нет процесса с `--user-data-dir` и папкой данных запуска (helper `processesWith` в
`test/e2e/helpers.ts`: Windows — `Get-CimInstance Win32_Process`, macOS — `ps -axo pid=,command=`); найденные
снимаются в `finally`. Lint и typecheck — код 0.

**Скрипт замера** на потом: `.scratch/worfy-windows/wt95-verify.ps1` (корень репозитория берёт из своего
места, другой tree — `-Repo`; 10 dev-запусков, временные профиль и папки, код выхода и живые через 5 s, снимает
только записанные им процессы по pid, времени создания и командной строке). Только разобран парсером PowerShell, не
запускался.

**Круг ревью 2.** Проверка «не из microtask» теперь подделывает только `setTimeout` и ждёт настоящего следующего
хода (`setImmediate`): mutant-ы `process.nextTick` и цепочка `Promise.then` красные (по 3 test-а), как и прежние
(голый `app.exit(1)` — 5, всегда отложенный — 12, `queueMicrotask` — 3, код 0 — 8). Второй провал — до хода
таймера. test-ы загрузки окна идут с `ready` = true и проверяют отложенный выход.

**«Готово, когда» — что не проверено и почему:**

- [ ] e2e-проверка процессов в `packaged.spec.ts` — написана, не запускалась: нужен запуск Electron (пауза на
  окна и фокус). Красный на main и зелёный в 10 запусках подряд (`--repeat-each 10`) не показаны;
  `windows-tests.yml` e2e не гоняет.
- [ ] Код выхода 1, stderr и отказ без окна — проверены только contract-test-ами с mock-ом `app`; e2e test `:790`
  (в тикете — `:662`) с правкой не запускался.
- [ ] Полный `pnpm test:e2e` на ПК без сироты — не запускался (пауза, и полный e2e не дело implementer-а).
- [ ] macOS — не проверено: нужен Mac («Mac checks» и test `packaged.spec.ts`).
- Что поведение Electron 44.5.1 совпадает с `main` на GitHub, — чтение, не сверка с исходником 44.5.1.
