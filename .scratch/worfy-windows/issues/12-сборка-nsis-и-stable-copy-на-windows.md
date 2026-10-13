# 12 — Сборка на Windows: неподписанный NSIS, иконки, Stable copy

Type: task
Status: done — 2026-10-12, [PR #237](https://github.com/IDSAD-XL/worfy/pull/237)
Blocked by: 08, 09
Source: решения владельца 2026-10-07: Q22 (неподписанный NSIS собирает Session на ПК владельца, подпись — E4; если включён Smart App Control — вопрос подписи сразу), Q24 (только x64), Q23 (gate full на ПК владельца перед мержем платформенных PR) ([spec.md](../spec.md)); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port» (пункт 5; «Последствия» — Stable copy на Windows); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions»; [ADR-0008](../../../docs/adr/0008-claude-code-native-binary-path.md) (`claude` вне app.asar); [ADR-0023](../../../docs/adr/0023-separate-data-roots-packaged-and-dev.md) (папки данных dev и упакованной сборки)

## Что происходит

- **Сборка.** `pnpm package` — это `electron-vite build && electron-builder --mac dir`
  (`package.json:12`). `electron-builder.yml` описывает только macOS: шапка «Local macOS build»
  (`:1-2`), секция `mac:` (`:36-43`), секции `win:` нет. `appId: dev.worfy.app` (`:3`).
- `electronDist: node_modules/electron/dist` (`:23`) — Electron, который pnpm поставил для своей
  системы; на Windows-ПК это Electron для Windows. `asarUnpack` (`:32-34`) уже покрывает
  `node_modules/node-pty/**` и `node_modules/@anthropic-ai/claude-agent-sdk-*/**`, то есть
  `claude.exe` и модуль node-pty. node-pty ищет модуль в `build/Release`, `build/Debug`, затем в
  `prebuilds/<platform>-<arch>` (`node_modules/node-pty/lib/utils.js:19`); в
  `prebuilds/win32-x64` есть `conpty.node` и `pty.node`. `npmRebuild: false` (`:27`).
- `supportedArchitectures` не задан ни в `package.json`, ни в `pnpm-workspace.yaml`. На Mac pnpm не
  ставит `claude-agent-sdk-win32-x64`, поэтому сборка под Windows на Mac не положит `claude.exe`
  (ADR-0054). На Windows-ПК pnpm ставит пакет своей системы сам: на ПК владельца —
  `@anthropic-ai/claude-agent-sdk-win32-x64@0.3.289` с `claude.exe` (evidence Ticket-а 01, раздел 14).
- node-pty из `prebuilds/win32-x64` грузится в Electron 44.5.1 без пересборки (evidence, раздел 09):
  `npmRebuild: false` для Windows подходит.
- **Иконки.** `scripts/make-icons.mjs` рисует PNG через `sips` и пакует `icon.icns` через
  `iconutil` — только macOS (`:101`). Пишет `build/icon.icns`, `build/icon.png` (1024 px) и
  `build/icons.json` с sha256 (`:118-124`). 16 и 32 px — из `build/brand/mark.svg`, от 64 px — из
  `build/brand/icon.svg` (`:26-39`, Ticket 31 Epic-а `worfy-mvp`). `.ico` нет.
  `test/contract/make-icons.test.ts:159-174` сверяет закоммиченные файлы на любой системе; `:176` и
  дальше запускает скрипт, только на macOS (один из пяти test-ов `skipIf(platform !== 'darwin')`,
  их разбирает Ticket 14). На ПК этот test красный: sha256 `build/brand/icon.svg` и `mark.svg` в
  рабочем дереве (CRLF, `core.autocrlf=true`) не совпадают с `build/icons.json` (evidence Ticket-а 01,
  разделы 03 и 17). LF для `build/brand/*.svg` задаёт `.gitattributes` Ticket-а 02 (его пункт 1);
  к началу этого Ticket-а случай sha256 зелёный.
- **Stable copy** (собранная копия worfy вне репозитория, из которой Autopilot ведёт Wave-ы самого
  worfy) ставит `scripts/install-stable.sh` — bash, только `.app`:
  - цель по умолчанию — `~/Applications/worfy-stable.app` (`:25`), цель обязана кончаться на `.app`
    (`:29-32`);
  - отказ, пока копия запущена, — по `ps -axo` (`:41-50`);
  - источник — `dist/mac*/worfy.app` (`:62`) или `WORFY_STABLE_PREBUILT` (`:56-58`); копирование —
    `ditto` во временную папку рядом и переименование (`:76-84`); время сборки — `stat -f %m` от
    `Contents/Info.plist` (`:71`);
  - рядом с копией — `<target>.json` с полями `commit`, `dirty`, `builtAt`, `installedAt`, `source`
    (`:91-99`).
- Вызов — `pnpm install:stable` (`package.json:19`) запускает `.sh` напрямую. pnpm на ПК исполняет
  скрипты через cmd.exe (evidence Ticket-а 01, раздел 10); `.sh` без bash не запустится.
- `test/e2e/packaged.spec.ts` зовёт скрипт через `bash` (`:18`, `:36-40`, `runScript` `:125-127`).
  Блок «with a stand-in app» (`:507` и дальше) идёт в gate full на Mac, блоки `@packaged` — в
  `pnpm test:package`. Test `:518-528` подменяет `HOME` и ждёт копию в `<HOME>/Applications`.
- **Отказ Autopilot над worfy.** `selfProjectRefusal` (`src/main/autopilot/run.ts:168-180`)
  отказывает только не упакованной сборке (`:174`). Установленный worfy и Stable copy — упакованные,
  им отказа нет. Пути сравниваются после `realpath` (`canonical`, `:154-160`). Общая папка git —
  `git rev-parse --path-format=absolute --git-common-dir` (`gitCommonDir`,
  `src/main/ipc/autopilot.ts:33-38`, не экспортирована); на Windows git печатает путь с `/`: в
  worktree на ПК — `C:/Users/Alexey/worfy/.git` (evidence Ticket-а 01, раздел 06). Как он сравнится с
  `realpath` от пути `C:\…`, не проверялось. `test/contract/autopilot.test.ts:708-730`
  подменяет `gitCommonDir`, настоящий git не зовёт.
- **SmartScreen.** Неподписанный установщик: «Windows protected your PC» → More info → Run anyway.
  Smart App Control на Windows 11 неподписанное блокирует (ADR-0054, пункт 5). На ПК владельца он
  выключен: `VerifiedAndReputablePolicyState = 0` (evidence Ticket-а 01, раздел 02), и владелец
  подтвердил это в окне Windows Security 2026-10-09 (раздел 27).
- После 4f983ef `electron-builder.yml` меняли E3 Ticket 15 (#134, мост Limits в ресурсах сборки) и
  worfy-link Ticket 02 (#158); `scripts/install-stable.sh` не менялся; `package.json` — четыре коммита,
  строки сдвинулись (evidence Ticket-а 01, раздел 24). Строки выше — main 4f983ef. Перед началом
  перечитать оба файла и `package.json` на свежем main.

## Что делаем

1. **NSIS x64** (Q22, Q24). В `electron-builder.yml` — секция `win:`: цель `nsis`, `arch: x64`,
   `icon: build/icon.ico`. Настройки `nsis:` — по умолчанию electron-builder (установка для
   текущего пользователя, без прав администратора). Куда установщик ставит worfy — в Итог. Подписи
   нет: сертификата нет, подпись — E4. Шапка файла говорит про обе системы.
   `electronDist` и `supportedArchitectures` не меняются: установщик собирается на Windows-ПК (Q22).
   Если на ПК в `node_modules` нет `claude-agent-sdk-win32-x64` — сначала выяснить почему;
   `supportedArchitectures` в `pnpm-workspace.yaml` — только по этому факту.
2. **Сборка по системе.** `package` — `electron-vite build && electron-builder` без флага системы:
   electron-builder берёт цели своей системы из yml (`mac.target: dir`, `win.target: nsis`). На Mac
   результат прежний — `dist/mac*/worfy.app`. Если нет — `scripts/package.mjs` выбирает
   `--mac dir` или `--win nsis --x64`.
3. **`.ico`.** `scripts/make-icons.mjs` пишет ещё `build/icon.ico`:
   - размеры 16, 24, 32 — из `mark.svg`, 48, 64, 128, 256 — из `icon.svg` (правило Ticket-а 31:
     мелкие размеры — из `mark.svg`);
   - PNG рисует, как прежде, `sips`; упаковка `.ico` — отдельная функция на чистом Node, её
     unit-test идёт на любой системе;
   - sha256 `icon.ico` и список его размеров — в `build/icons.json`;
   - формат записей внутри `.ico` (PNG или BMP) — на выбор Ticket-а; проверка — значок установщика,
     `worfy.exe` в Проводнике, меню Пуск и панель задач.

   Скрипт работает только на macOS. `pnpm icons` запускается на Mac, `build/icon.ico` коммитится в
   ветку PR-а до сборки установщика на ПК. Это шаг на Mac — тот же заход, что gate full на Mac
   перед мержем.
4. **Stable copy на обеих системах.** `scripts/install-stable.sh` переписан на Node:
   `scripts/install-stable.mjs`, `.sh` удаляется, `install:stable` — `node scripts/install-stable.mjs`.
   - Mac — как сейчас: цель `<…>.app`, по умолчанию `~/Applications/worfy-stable.app`; дом —
     `os.homedir()`, на Mac он читает `HOME` (на это опирается `packaged.spec.ts:518-528`); источник
     `dist/mac*/worfy.app`; копирование `ditto`; время сборки — mtime `Contents/Info.plist`.
   - Windows — цель — папка, по умолчанию `%LOCALAPPDATA%\worfy-stable` (решение владельца
     2026-10-12; до него Ticket предлагал `%LOCALAPPDATA%\Programs\worfy-stable`), рядом
     `worfy-stable.json`; источник — `dist\win-unpacked`; копирование — `fs.cp` во временную папку
     рядом и переименование; время сборки — mtime `worfy.exe`. Цель не может совпасть с папкой
     установщика (пункт 1).
   - Отказ, пока копия запущена: Mac — по списку процессов, как сейчас; Windows — по процессам, чей
     исполняемый файл лежит в папке цели (например, `Get-CimInstance Win32_Process` в PowerShell).
   - `pnpm package` скрипт зовёт с `shell: true` на Windows: там `pnpm` — это `pnpm.cmd`, а Node
     без shell `.cmd` не запускает (`EINVAL`).
   - `<target>.json` — прежние поля и формат; `WORFY_STABLE_PREBUILT` работает на обеих системах.
   - Чистые части (цель по умолчанию, проверка цели, поиск запущенной копии в списке процессов)
     — функции с системой параметром, для unit-test-а.

   Путь Stable copy на Windows — в `CONTEXT.md` (термин «Stable copy», сейчас только
   `~/Applications/worfy-stable.app`, `:63-64`) и в разделе «Stable copy» `README.md`. Путь —
   предложение Ticket-а, подтвердить у владельца.
5. **Отказ Autopilot на путях Windows.** `gitCommonDir` экспортируется из
   `src/main/ipc/autopilot.ts`. Новый contract test в `test/contract/autopilot.test.ts` берёт
   настоящий git: временный репозиторий и worktree; dev-сборка отказывает и в checkout, и в
   worktree, упакованная — нет. На Windows-ПК он проверяет пути `C:/…` от git против `realpath`.
   `selfProjectRefusal` правится, только если test покажет расхождение.
6. **Smart App Control.** На ПК он выключен (evidence Ticket-а 01, разделы 02 и 27: реестр и Windows
   Security). Если к сборке он
   окажется включён и установщик не запустится — Status `blocked`, вопрос подписи уходит владельцу
   сразу (Q22).

**Не входит:** подпись и репутация SmartScreen (E4); arm64 (Q24); первый запуск и установка
Harness (Ticket 13); `@packaged` e2e на Windows (Ticket 14); шаг для Windows в skill `ship-ticket`
(Ticket 07); Terminal на PowerShell (Ticket 10).

## Готово, когда

- [x] Contract `test/contract/make-icons.test.ts`, на любой системе: `build/icon.ico` — заголовок
  ICO и семь записей 16, 24, 32, 48, 64, 128, 256 px; sha256 файла совпадает с `build/icons.json`.
  На Mac запуск скрипта пишет `icon.icns`, `icon.ico`, `icon.png` и `icons.json` и ничего больше
  (`:192-196`; на Mac — через раздел Mac checks PR, Q33).
- [x] Unit `test/unit/install-stable.test.ts` (новый): цель по умолчанию и путь `<target>.json` для
  `darwin` и `win32`; Windows-цель, равная папке установщика, отвергается; Mac-цель без `.app`
  отвергается; запущенная копия находится в фикстуре списка процессов обеих систем.
- [x] Contract `test/contract/autopilot.test.ts`, настоящий git: dev-сборка отказывает в checkout и
  в worktree репозитория, упакованная — нет; зелёный на Mac и на Windows-ПК.
- [ ] Mac: блок «with a stand-in app» в `test/e2e/packaged.spec.ts` (теперь про
  `scripts/install-stable.mjs`) зелёный в gate full; `pnpm test:package` — exit 0;
  `pnpm install:stable "$(mktemp -d)/worfy.app"` — exit 0, `worfy.json` рядом с прежними полями (через раздел Mac checks PR, Q33);
  gate full на Mac зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).
- [x] Windows-ПК: `pnpm package` — exit 0; в `dist\` есть установщик `.exe` и
  `dist\win-unpacked\worfy.exe`;
  `Test-Path dist\win-unpacked\resources\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe`
  печатает `True`.
- [ ] Windows-ПК: `pnpm test test/unit/install-stable.test.ts test/contract/make-icons.test.ts test/contract/autopilot.test.ts`
  — exit 0.
- [ ] Windows-ПК, проверка платформенного PR (Q23, ADR-0056): gate full — строка вердикта и код выхода
  в отчёт. Пока Gate не на Node (Ticket 03) — `pnpm lint`, `pnpm typecheck`, `pnpm test` с кодами
  выхода и пометка «Gate не запускался». Падения `pnpm test` сверены со списком Ticket-а 02: новых
  нет.
- [x] (вручную) Windows-ПК: установщик из `dist\` ставит worfy (SmartScreen: More info → Run
  anyway). Значок worfy — у установщика, в меню Пуск и на панели задач, не значок Electron.
  Установленный worfy открывается, новая Session отвечает. Папка установки — в Итог. Как проверить:
  Проводник, меню Пуск, окно worfy.
- [x] (вручную) Windows-ПК: `pnpm install:stable` ставит Stable copy в
  `%LOCALAPPDATA%\worfy-stable` и пишет `%LOCALAPPDATA%\worfy-stable.json` с `commit`, равным
  `git rev-parse HEAD`; повторный запуск заменяет копию; при запущенной копии — ненулевой код выхода,
  копия на месте. Stable copy открывается, Session в ней отвечает. В `pnpm dev` Autopilot над
  Project-ом worfy отказывает с «Autopilot does not run on worfy itself from a development build».
  `pnpm install:stable "$env:LOCALAPPDATA\Programs\worfy-stable"` (прежняя папка по умолчанию)
  отказывает: «the target cannot start with the path of the folder the installer of worfy uses».
  Как проверить: PowerShell и окно worfy.
- [x] (вручную) Windows-ПК, проверка установщика из первого круга ревью: руками скопировать
  `dist\win-unpacked` в `%LOCALAPPDATA%\Programs\worfy-stable` (скрипт туда больше не ставит),
  запустить оттуда `worfy.exe`, затем запустить установщик из папки `dist`. Что он показал и что
  стало с запущенной копией — в Итог. Ожидание по шаблону NSIS: «worfy is running», и по OK копия
  останавливается. После проверки папку `Programs\worfy-stable` удалить.
- **Три ручных пункта закрыты 2026-10-13: проверка владельца и скриптовая перепроверка на ПК.**
  Владелец прошёл все три — «всё прошло нормально», кроме частей про Session: Project в worfy на
  Windows не добавить ([Ticket 30](30-add-project-на-windows.md)). Затем он разрешил Session на
  Windows-ПК перепроверить пункты скриптами. Она сделала это 06:01–06:17 на сборке с main
  `c64a9db`, через PowerShell, в настоящем профиле. До начала процессов `worfy.exe` не было.
  - **Сборка.** `pnpm package` — exit 0, 63 s; `dist\worfy Setup 0.2.0.exe`, 204 912 757 байт, не
    подписан.
  - **Пункт 1, установщик.** Exit 0 за 17 s, окно «Установка worfy», после установки сам запустил
    worfy. `%LOCALAPPDATA%\Programs\worfy\worfy.exe` на месте, hash равен
    `dist\win-unpacked\worfy.exe`. Ярлык в меню Пуск и на рабочем столе ведёт на установленный
    `worfy.exe`. Значок 32 px против `build\icon.ico`, средняя разница на канал: `worfy.exe` 0,00,
    установщик 0,00, `Uninstall worfy.exe` 0,00; ярлык — 30,11 (похоже на стрелку ярлыка, не
    проверено; `notepad.exe` для сравнения — 75,64). Окно по CDP: страница загружена, версия
    `v0.2.0+c64a9db` равна commit-у сборки.
  - **Session отвечает.** Project `worfy-d5750da7` (`C:/Users/Alexey/worfy`) записан в
    `%APPDATA%\worfy\projects.json` руками, как в Ticket-е 08. Установленный worfy показал его в
    списке. Одно сообщение Orchestrator-у — ответ `pong` за 16,0 s. Файл после проверки удалён: до
    неё его не было.
  - **Пункт 2, `pnpm install:stable`.** Первый запуск — exit 0, 61 s, `commit` в
    `worfy-stable.json` равен `git rev-parse HEAD`. Второй — exit 0, `installedAt` сменился. При
    открытой Stable copy — exit 1 за 2 s, копия на месте и работает. Цель
    `%LOCALAPPDATA%\Programs\worfy-stable` — exit 1 с текстом «the target cannot start with the path
    of the folder the installer of worfy uses». Stable copy открывается, версия `v0.2.0+c64a9db`.
    Session в самой Stable copy не запускали: её `worfy.exe` равен по hash установленному, папка
    данных та же. Отказ Autopilot в `pnpm dev` скриптом не проверяли — он остаётся за словом
    владельца.
  - **Пункт 3, установщик при копии, запущенной из старой папки.** Установщик показал окно
    «Приложение worfy запущено. Нажмите «OK», чтобы закрыть его…» с кнопками «ОК» и «Отмена» и
    ждал: за 120 s не завершился, копия работала. После «ОК» — exit 0 через 14 s, процесс копии
    завершён, установленный worfy запущен. Файлы старой папки установщик не тронул; папка затем
    удалена. Владелец при своей повторной установке окна не видел — судя по этому результату,
    копия из старой папки тогда запущена не была (вывод, не его слова).
  - **Не проверить скриптом:** SmartScreen и значок на панели задач — тут слово владельца.
  - **Экран первого запуска** в этой проверке не показался: владелец закрыл его раньше
    (`first-run.json`: `failing: ["qmd"]`). Закрыть его с неустановленным qmd можно.
  - **Замечено в Session на Windows:** один Stop hook завершился с кодом 127 («Stop hook error
    occurred») — hooks Harness на Windows ещё не перенесены (Ticket 04); в боковой панели
    «epic-status not found» (Ticket 05).
  - **Остаток test-а в настоящем профиле.** В `%LOCALAPPDATA%\Programs\worfy-stable` лежали
    `worfy.exe` и `resources\app.asar` по 18 байт от 2026-10-10, рядом —
    `Programs\worfy-stable.json`. Значит, какой-то прогон test-ов `install-stable` тогда писал в
    настоящий профиль. Сейчас test подменяет `LOCALAPPDATA`; пишет ли что-то туда теперь, Session на
    ПК проверяет отдельно.
  - **Среда Session на ПК.** Её Bash работает внутри контейнера приложения Claude: записи в
    `%LOCALAPPDATA%` и `%APPDATA%` уходят в приватную папку пакета, настоящий профиль видит только
    PowerShell. Прежние результаты про файлы в AppData, полученные через Bash, относились к
    приватной папке. Test-ов это не касается: они пишут в `%TEMP%`.
  - **Осталось на ПК, решает владелец:** `%LOCALAPPDATA%\Programs\worfy-stable.json` (остаток
    test-а); приватная копия Stable copy в папке пакета Claude, 662 MB; папка данных Project-а и
    один транскрипт Session из проверки.
- **Довесок вечером 2026-10-13: то, что утром осталось «за словом владельца», и остатки на ПК.**
  Session на Windows-ПК, сборка с main `48b0b9f`, системный Node 24.21.0. Владелец разрешил в чате
  Session computer use, но снимок экрана на его ПК (три монитора) не делается: вызов не завершается,
  запроса согласия нет — три попытки. Поэтому **экран никто не видел.** Всё ниже прочитано у Windows
  скриптами: заголовки и классы окон, значки окон, ответ страницы приложения.
  - **SmartScreen у установщика из `dist\`.** Установщик не подписан, пометки «из интернета»
    (`Zone.Identifier`) на нём нет, Smart App Control выключен (`VerifiedAndReputablePolicyState = 0`,
    только чтение). Запуск через ShellExecute — так запускает двойной щелчок в Проводнике: exit 0 за
    20 s. Из окон, появившихся за это время, к установке относится одно: «Установка worfy» (класс
    `#32770`) самого установщика. Процесс `smartscreen.exe` запускался (один) и окна не показал.
    **Для сборки, собранной на этом же ПК, шага «More info → Run anyway» нет.** Его увидит тот, кто
    скачал установщик: файл с пометкой «из интернета» не проверялся — диалог SmartScreen должен
    закрывать человек.
  - **Значок на панели задач.** Окно worfy своего значка не задаёт (`WM_GETICON` пуст для большого и
    малого), Windows берёт значок класса окна. Он 48×48 px и совпадает с изображением 48 px из
    `build\icon.ico` пиксель в пиксель (средняя разница на канал 0,00) — и у установленного worfy
    (сборка `48b0b9f`), и у Stable copy в `%LOCALAPPDATA%\worfy-stable` (сборка `c64a9db`). Для
    сравнения: значок `notepad.exe` против изображения 32 px — 67,85. Саму панель задач никто не видел.
  - **Отказ Autopilot в `pnpm dev`.** `pnpm dev` над отдельной папкой данных (`WORFY_DATA_DIR` в
    `%TEMP%`), Project — клон worfy. Страница dev-сборки (`http://localhost:5173/`) вызвала
    `autopilot.start` так же, как кнопка. Ответ: `ok: false`, «autopilot.start failed: Autopilot does
    not run on worfy itself from a development build: its agents would rebuild the app the run lives
    in. Run it from the stable copy (pnpm install:stable).» Epic в вызове назван несуществующий: без
    отказа запуск остановился бы на «The Project has no Epic» и ничего бы не начал. Саму кнопку никто
    не нажимал.
  - **Остатки на ПК убраны** с «да» владельца, по списку полных путей:
    `%LOCALAPPDATA%\Programs\worfy-stable.json`; приватная копия Stable copy в папке пакета Claude
    (303 файла, 661,6 MB) и файл `.json` при ней; папка данных пробного Project
    `%APPDATA%\worfy\worfy-d5750da7`; один транскрипт пробного сообщения. Установленный worfy и
    Stable copy в `%LOCALAPPDATA%\worfy-stable` оставлены.
  - **После проверки установленный worfy — сборка main `48b0b9f`** (был `c64a9db`): его заменил
    запуск установщика. Stable copy не менялась.
- [x] `CONTEXT.md` («Stable copy») и раздел «Stable copy» `README.md` называют путь Stable copy на
  Windows.

## Тесты

Сначала падающий test — `test/contract/make-icons.test.ts`: `build/icon.ico` нет. Затем unit
`test/unit/install-stable.test.ts`: цель по умолчанию на `win32` (скрипта на Node ещё нет). Затем
contract `selfProjectRefusal` с настоящим git.

Ветка `win32` скрипта Stable copy проверяется unit-test-ом на Mac и в Linux CI. Настоящие
установщик, копия и SmartScreen — ручные пункты на ПК. `@packaged` e2e на Windows — Ticket 14. В
«Итог» — как test-ы падали до правки, папка установки, путь Stable copy и размер установщика.

## Где в коде

- `electron-builder.yml`
- `package.json`
- `scripts/make-icons.mjs`
- `build/icon.ico` (новый)
- `build/icons.json`
- `scripts/install-stable.sh` (удаляется)
- `scripts/install-stable.mjs` (новый)
- `src/main/ipc/autopilot.ts`
- `test/contract/make-icons.test.ts`
- `test/unit/install-stable.test.ts` (новый)
- `test/contract/autopilot.test.ts`
- `test/e2e/packaged.spec.ts`
- `CONTEXT.md`
- `README.md`

`src/main/autopilot/run.ts` меняется, только если test на Windows покажет расхождение путей; тогда
исполнитель добавляет его в этот список.

## Итог

Заполняла Session на Windows-ПК. Ticket закрыт 2026-10-12: PR #237 влит (main `83212ec`) после трёх
кругов ревью на Mac и зелёного `gate full` на слиянии `afee930` (main `25efbbe` + `2f3dcb6`): exit
code 0, строка `[gate] зелено (full): lint typecheck test test:e2e test:package`. Три ручных пункта
владельца на ПК мерж не держат (решение владельца 2026-10-12); они записаны в «Ждёт владельца» в
`HANDOFF.md`. Остатки третьего круга (все low) и шесть пробелов в test-ах `.ico` — пункт 6 «Что
делаем» Ticket-а 23 (общая функция удаления; тот же скрипт).

- **Что сделано.**
  - **`.ico`.** `scripts/ico.mjs` — упаковка и чтение `.ico` на чистом Node (`packIco`, `readIco`).
    `scripts/make-icons.mjs` рисует через `sips` ещё семь PNG (16, 24, 32 px из `mark.svg`; 48,
    64, 128, 256 px из `icon.svg`), пакует их в `icon.ico` и пишет его sha256 и список размеров в
    `icons.json`.
  - **Сборка.** В `electron-builder.yml` — секция `win:` (цель `nsis`, `x64`, значок
    `build/icon.ico`); `package` — `electron-vite build && electron-builder` без флага системы.
  - **Stable copy.** `scripts/install-stable.mjs` вместо `scripts/install-stable.sh`; на Mac —
    прежнее поведение, на Windows — папка, по умолчанию `%LOCALAPPDATA%\worfy-stable` (после
    первого круга ревью; до него — `…\Programs\worfy-stable`), рядом `worfy-stable.json`. `install:stable` — `node scripts/install-stable.mjs`.
    `test/e2e/packaged.spec.ts` зовёт скрипт через Node.
  - **Отказ Autopilot.** `gitCommonDir` экспортирован; новый contract test берёт настоящий git.
    Править `selfProjectRefusal` не пришлось (ниже).
  - **Документы.** Путь Stable copy на Windows — в `CONTEXT.md` и в разделе «Stable copy»
    `README.md`.
- **Значок с Mac.** `build/icon.ico` и новый `build/icons.json` даёт только `pnpm icons` на Mac
  (`sips`). Session на Mac запустила его и закоммитила оба файла в ветку (fc5938b):
  `icon.ico` — 27 222 байта, семь PNG-записей (522, 721, 979, 2012, 2841, 6411 и 13 618 байт);
  `icon.icns` и `icon.png` не изменились; второй запуск даёт тот же файл байт в байт. До этого
  коммита четыре случая `make-icons.test.ts` были красными, а сборка шла только с временным
  значком (следующий пункт).
- **Сборка на ПК с настоящим значком** (после fc5938b).
  - `pnpm package` — exit 0 (`ELECTRON_BUILDER_CACHE` направлен в `%TEMP%\worfy-01\eb-cache`).
  - В `dist\`: `worfy Setup 0.2.0.exe` — 204 899 379 байт; `win-unpacked\worfy.exe`.
  - `Test-Path dist\win-unpacked\resources\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe`
    — `True`. `Get-AuthenticodeSignature` установщика — `NotSigned`.
  - Значок: картинка 32 px, которую оболочка Windows отдаёт для `worfy.exe` и для установщика,
    совпала с записью 32 px из `build/icon.ico` пиксель в пиксель (средняя разница 0,00); у
    `electron.exe` разница 45,53.
- **Пробная сборка на ПК.** Значок временный, вне репозитория: семь PNG, уменьшенных из
  `build/icon.png`, упакованы `packIco`.
  - Команда: `pnpm exec electron-vite build`, затем `pnpm exec electron-builder
    --config.win.icon=<временный .ico>`; оба — exit 0. Кэш electron-builder направлен в
    `%TEMP%\worfy-01\eb-cache` (`ELECTRON_BUILDER_CACHE`); туда он скачал `nsis-3.0.4.1`,
    `nsis-resources-3.4.1` и `7zip`.
  - Получилось: `dist\worfy Setup 0.2.0.exe` — 204 914 954 байта; `dist\win-unpacked\worfy.exe`.
    `Test-Path dist\win-unpacked\resources\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe`
    — `True`. `Get-AuthenticodeSignature` для установщика и для `worfy.exe` — `NotSigned`.
  - Установщик: `oneClick=true perMachine=false` (строка electron-builder) — для текущего
    пользователя, без прав администратора. Папка установки по этим настройкам —
    `%LOCALAPPDATA%\Programs\worfy`; установщик на ПК не запускался, папку подтвердит ручной пункт.
  - Значок: картинка 32 px, которую оболочка Windows отдаёт для `worfy.exe` и для установщика
    (`Icon.ExtractAssociatedIcon`), совпала с временным значком пиксель в пиксель (средняя разница
    0,00); у `electron.exe` разница 43,57. То есть `.ico` из PNG-записей попадает и в программу,
    и в установщик.
  - Запуск: `dist\win-unpacked\worfy.exe` стартовал как упакованный worfy 0.2.0
    (`app.isPackaged` — `true`), окно «worfy» открылось, в ресурсах есть `harness` и
    `statusline-bridge.mjs`. Временный spec Playwright, папки данных и `.claude` — временные; spec
    удалён.
- **Решения этого Ticket-а.**
  - **Записи `.ico` — PNG**, все семь. Проверено пробной сборкой (выше); в меню Пуск и на панели
    задач — ручной пункт.
  - **Значок Windows нарисован на сетке macOS**: те же SVG, поля около 10 % с каждой стороны.
    Значки Windows обычно занимают всё поле, рядом с ними значок worfy будет мельче. Ticket
    называл только источники; обрезать ли поля для Windows — вопрос владельцу (ниже).
  - **Существующую папку, не похожую на копию, скрипт не заменяет** (Windows): в ней должен быть
    `worfy.exe`, либо она пуста. Иначе `pnpm install:stable D:\Documents` удалил бы папку.
  - **Папка установщика, папка внутри неё и папка вокруг неё** отвергаются как цель; диск целиком
    — тоже.
  - **Сообщение о лишних аргументах** теперь «expected at most one argument, the target path»
    (было «…the target .app path»).
- **Отказ Autopilot на путях Windows.** На ПК git печатает общую папку как `C:/…/.git`, папки
  приходят из `realpath` как `C:\…`. После `realpath` обе стороны совпадают: test с настоящим git
  (checkout, worktree, папка внутри worktree, другой репозиторий, папка вне git) зелёный на
  Windows без правки `src/main/autopilot/run.ts`.
- **Как test-ы падали до правки.**
  - `make-icons.test.ts`: `ENOENT … build\icon.ico` и `expected undefined to deeply equal
    [ Array(7) ]` (списка `ico` в `icons.json` нет) — и падают так до шага на Mac.
  - Contract `selfProjectRefusal` с настоящим git: `TypeError: gitCommonDir is not a function`.
  - `test/unit/install-stable.test.ts` и `test/unit/ico.test.ts` написаны вместе со скриптами, а
    не до них.
- **Мутанты.** 36, по одному, на unit-файле своего скрипта: все 36 валят test-ы — 13 из 13 в
  `scripts/ico.mjs`, 23 из 23 в `scripts/install-stable.mjs`.
  - В первом прогоне было 37, выжили два. Строка `process.noAsar = true` в скрипте Stable copy
    оказалась лишней и убрана: файл `app.asar` копируется файлом и без неё, а неверно читал его
    только сам test (его исполняет Electron). Отказ «`WORFY_STABLE_PREBUILT` is not a folder» не
    имел test-а — добавлен.
  - Мутант «принимается лишний аргумент» в том же прогоне поставил фальшивую копию в папку `a`
    в корне репозитория: test передавал относительные пути. Папка и `a.json` удалены, test теперь
    запускает скрипт из временной папки и с путями внутри неё.
  - `make-icons.mjs` мутантами не проверялся: на ПК он не запускается.
- **Windows-ПК** (Gate не запускался — он на bash, Ticket 03):
  - `pnpm lint` — 0, `pnpm typecheck` — 0. `pnpm install --frozen-lockfile` для этой ветки не
    повторялся: зависимости не менялись;
  - `pnpm test test/unit/ico.test.ts test/unit/install-stable.test.ts` — exit 0: 18 passed. Случаи
    со скриптом на Windows прошли: установка по умолчанию с подменённым `LOCALAPPDATA`, замена
    прежней копии, отказы, отказ при запущенной программе копии (настоящий список процессов);
  - `pnpm test test/unit/install-stable.test.ts test/contract/make-icons.test.ts
    test/contract/autopilot.test.ts` — exit **1**, не 0, как просил пункт «Готово, когда».
    После fc5938b: `install-stable` — 13 passed; `make-icons` — 5 passed | 7 skipped (блок
    macOS), четыре прежде красных случая зелёные; `autopilot.test.ts` — 37 passed | 9 failed:
    три новых случая с настоящим git зелёные, девять падений («call rejected…» у каналов и
    четыре случая журнала) те же, что на main. Код выхода 1 — из-за этих девяти;
  - `pnpm test` — exit 1, как на main: 54 failed | 141 passed файлов, 667 failed | 3251 passed | 32
    skipped. Main `11ca93c`: 53 failed | 140 passed файлов, 661 failed | 3234 passed | 31 skipped;
    ветка стоит на `2e8a6ff`, который отличается только документами. По именам новых семь:
    четыре — `make-icons` до шага на Mac; три — время под нагрузкой: `e3-sandbox.test.ts`
    («exits 3 with what gh said…», `Test timed out in 15000ms`; отдельно этот случай проходит),
    `startup-failure.test.ts` («a createMainWindow that throws…», плавает и на main) и первый
    test `canvas.test.tsx` (`Test timed out in 5000ms`). Ушёл один: «holds the sha256 of
    build/brand/icon.svg and build/brand/mark.svg» — он падал из-за состояния этого клона (SVG
    были выписаны с CRLF до `.gitattributes`), файлы выписаны заново;
  - полный прогон сделан до последних правок test-а Stable copy и до удаления строки
    `process.noAsar`; два unit-файла, lint этих файлов и typecheck после них повторены.
- **Решения владельца** (2026-10-10, переданы Session на Mac):
  1. Путь Stable copy на Windows — `%LOCALAPPDATA%\Programs\worfy-stable`: подтверждён. **Заменено
     2026-10-12** (пункт 1 ревью): по умолчанию `%LOCALAPPDATA%\worfy-stable`.
  2. Значок Windows остаётся на сетке macOS, с полями. Владелец посмотрит на настоящей сборке;
     если значок покажется мелким, обрезка полей для `.ico` пойдёт отдельной небольшой правкой
     `scripts/make-icons.mjs` и этот Ticket не держит.
  3. Два ручных пункта на ПК делает владелец сам, после настоящей сборки: установщик и запуск
     worfy; Stable copy и отказ Autopilot в `pnpm dev`.
- **Шаги на Mac** (раздел «Mac checks» PR), по сообщению Session на Mac от 2026-10-10:
  - сделано: `pnpm icons` и коммит fc5938b; `pnpm test test/contract/make-icons.test.ts` — exit
    0, 12 passed, блок macOS включён; `pnpm test test/contract/autopilot.test.ts -t "git of this
    machine"` — exit 0, 3 passed;
  - осталось: `pnpm package` без `--mac dir` даёт прежний `dist/mac*/worfy.app`; блок «with a
    stand-in app» в `packaged.spec.ts` и `pnpm test:package`; `pnpm install:stable "$(mktemp
    -d)/worfy.app"`.
- **Первый круг ревью (2026-10-12): что изменено и что показал ПК.** Пробы — скрипты в папке
  `%TEMP%\worfy-01` на ПК, в репозитории их нет.
  - **1. Папка по умолчанию — `%LOCALAPPDATA%\worfy-stable`** (решение владельца). Установщик
    worfy останавливает любую программу, чей путь начинается с текста его папки, без обратной
    черты в конце; копию в `…\Programs\worfy-stable` остановила бы установка, обновление или
    удаление worfy. `checkTarget` теперь отвергает и любой путь, начинающийся с пути папки
    установщика (`…\Programs\worfy-2`). Сам установщик на ПК не запускался — это прочитано Mac-ом
    по шаблону NSIS; что он покажет при запущенной копии из старой папки, запишет владелец в
    ручном пункте.
  - **2. Порядок замены.** Прежняя копия переименовывается в сторону (`<цель>.replaced-<pid>`),
    новая встаёт на место, и только потом прежняя удаляется (`swapIn`). Не удалось отодвинуть —
    прежняя остаётся как была; не удалось поставить новую — прежняя возвращается. На ПК, на
    настоящем скрипте: программа с рабочей папкой внутри копии не даёт переименовать папку
    (EPERM/EBUSY) — скрипт выходит с ошибкой «could not be moved aside», копия цела вместе с
    `worfy-stable.json`, рядом ничего не осталось. Откат после второго шага проверен только на
    подменённой файловой системе: на настоящей его не вызвать по заказу.
  - **3 и 4. Другое написание пути.** На ПК (`probe-spellings.cjs`): `realpathSync` возвращает
    путь, как он набран (`\\?\C:\…`, другой регистр); `realpathSync.native` — как на диске,
    без приставок (`\\?\C:` и `\\.\C:` становятся `C:`), а `\\localhost\C$\…` оставляет как
    есть. Теперь:
    - `\\?\C:\…` и `\\.\C:\…` принимаются без приставки уже в `checkTarget`;
    - существующая цель проверяется ещё раз по написанию диска (junction на папку установщика —
      отказ), и запущенная копия ищется по трём написаниям цели;
    - папка с `Uninstall worfy.exe` не считается копией никогда — это закрывает и
      `\\localhost\C$\…`, и worfy, поставленный в другую папку (`/D=`);
    - `worfy.exe`, путь которого Windows не отдаёт (чужой пользователь, запуск с повышением),
      считается возможной копией: скрипт отказывает.
    Короткие имена 8.3 на ПК не проверены: получить такое имя пробой не удалось.
  - **5. Прерванный запуск.** В начале скрипт убирает `<цель>.installing-<pid>` от запусков,
    которых уже нет, а отодвинутую ими прежнюю копию (`.replaced-<pid>`) возвращает на место,
    если цель пуста. Обработчика Ctrl+C нет: копирование синхронное, сигнал до его конца не
    обрабатывается. Остаток прерванного запуска лежит до следующего запуска.
  - **6. Test-ы, которые идут в Linux CI.** Чистые функции `builtApp`, `buildCommand`,
    `leftovers`, `swapIn`; отказы скрипта (второй аргумент, не сборка, не папка) вынесены из
    блока Windows; пара написаний цели, где ни одно не содержит другого; имена, похожие на
    `worfy.exe`; `installerDir` на четырёх входах; оба вызова `refuseIfRunning`; новый
    `test/contract/packaging.test.ts` читает `electron-builder.yml` и `package.json`. Целый
    install идёт на macOS и Windows (на Linux нет ни `ditto`, ни Windows-ветки), поле `source`
    проверяется там.
  - **Junction как цель — найдено тестом из пункта 6.** Под Node 24.21.0 (его несёт Electron
    44.5.1, им же идут test-ы) `fs.rmSync(путь, { recursive: true })` проходит сквозь junction и
    удаляет содержимое папки за ним; под Node 22.13.0 — нет; `fs.promises.rm` и ссылка вида
    `dir` не затронуты (`probe-rm-junction.cjs`, `probe-rm2.cjs`). Прежний код ветки при цели-junction
    опустошил бы папку за ним. Теперь на Windows скрипт удаляет своим обходом, ссылку — как
    ссылку; test: файл за junction-ом цел, цель становится обычной папкой. То же поведение
    `rmSync` касается main-процесса worfy — передано Session на Mac, в этот Ticket не входит.
  - **7.** `cpSync` копирует ссылку на папку как ссылку (проба на ПК): копия стала бы ссылкой на
    сборку. Сборка теперь копируется из своей настоящей папки; в `worfy-stable.json` — путь, как
    он был дан.
  - **8.** У списка процессов (PowerShell) timeout 30 с.
  - **9. Девять строк macOS, которые отличаются от старого `.sh`** (таблица Mac-ревью, данных не
    теряет ни одна): пустой аргумент `""` — отказ (раньше шла цель по умолчанию); `x.app//`
    принимается; сборка без `Contents/Info.plist` отвергается до любых изменений; папка на месте
    `<цель>.json` даёт после установки копии exit code 1 и строку «the copy is installed at …,
    but … could not be written» с причиной от системы (до второго круга — необработанный EISDIR);
    `sub/../y.app` не оставляет пустой `sub/`; упавшая сборка даёт exit code 1 и строку
    `pnpm package exited with <код>` (у `.sh` был exit code самой сборки); три различия только в
    тексте сообщений. Этот круг добавил ещё одно: на macOS тоже прежняя копия сначала
    отодвигается, а остатки прерванного запуска убираются.
  - **10.** README говорит: папка с `worfy.exe` заменяется целиком, своё в ней не держать.
  - **11.** `packIco` принимает только PNG RGBA по 8 бит на канал с целым IHDR; `readIco`
    проверяет «32 бита» в записи и тот же формат PNG.
  - **12, 13.** Комментарий в `electron-builder.yml` (папка первой установки, имя из `name`,
    `InstallLocation`, `/D=`) и папки данных Windows в README (`%APPDATA%\worfy`,
    `%APPDATA%\worfy-dev`).
  - **Сборка без готового приложения** идёт через `pnpm package` одной строкой для shell (Node 24
    предупреждает об аргументах рядом с shell). Шаг сборки в `installStable` — параметр `build`:
    test подменяет его, и `pnpm` в test-ах не запускается. Сам вызов `spawnSync` в
    `packageApp` test-ами не выполняется.
  - **Ошибка в ходе работы.** Проба с заглушкой `pnpm.cmd` на `Path` дважды запустила настоящий
    `pnpm`: в окружении оказались и `PATH`, и `Path`. Он выполнил `pnpm install` в рабочей
    папке проб (там лежала копия `package.json`); созданное там удалено, клон и домашняя папка
    не тронуты, в общий store pnpm докачалось 32 пакета. Test с заглушкой убран.
  - **Windows-ПК после правок,** на слиянии с main `d803f93` (Gate не запускался — он на bash):
    - `pnpm lint` — 0, `pnpm typecheck` — 0; `pnpm package` в этом круге не повторялся: настройки
      сборки не менялись;
    - шесть файлов Ticket-а одной командой — exit 1: `install-stable` 38 passed, `ico` 6,
      `packaging` 5, `make-icons` 5 passed | 7 skipped (блок macOS), `gitattributes` 14,
      `autopilot` 37 passed | 9 failed — девять падений main, три случая с настоящим git проходят.
      Сам скрипт на Windows прошёл 14 случаев на настоящих папках и процессах;
    - `pnpm test` — exit 1, как на main: 52 failed | 146 passed файлов, 703 failed | 3365 passed |
      32 skipped. Main `f9c005b` двумя часами раньше: 52 failed | 143 passed файлов, 701 failed |
      3313 passed | 31 skipped. По именам: новых два, ушедших нет. Оба — случаи
      `startup-failure.test.ts` («the start in src/main/index.ts …»); файл падает на Windows и на
      main, отдельно даёт 10 failed | 25 passed, и эти два в нём проходят.
  - **Мутанты после правок.** 63 в списке, по одному; все 63 валят test-ы: 10 в `ico.mjs`, 48 в
    `install-stable.mjs`, 5 в настройках сборки.
    - Первый прогон убил 59 из 63. «Написание диска не сравнивается» и «при удалении идём по
      ссылке» закрыты усилением test-ов. «Настоящая папка не проверяется» показал второй вызов,
      дублировавший первый: два вызова стали одним, добавлен test на `Programs`, перенесённый с
      оставленной ссылкой. «Остаток чужой цели принят за свой» эквивалентен (дальше стоит
      проверка «pid — только цифры») и из списка убран.
    - Остальные 59 после этой последней правки одной строки не повторялись.
- **Второй круг ревью (2026-10-12).**
  - **1. Порядок замены внутри `installStable` закреплён и на macOS.** Переименование в замене —
    параметр `rename`; случай «a whole install» идёт на macOS и Windows: перенос новой копии
    падает — прежняя на месте и цела, рядом ничего не осталось, три переноса идут в порядке «в
    сторону → на место → назад».
  - **2. Чистка остатков берёт только своё:** имя `<цель>.installing-<n>` или
    `<цель>.replaced-<n>`, где `n` — число, которое может быть pid (1…4 194 304, без ведущих
    нулей), и только настоящая папка (не файл и не ссылка). Чистка идёт перед копированием, когда
    сборка уже есть: запуск, получивший отказ, ничего не меняет. Оба имени названы в README.
  - **3.** Остаток, который не удалось убрать, называется в выводе («remove it by hand»), и
    установка идёт дальше. На ПК: программа с рабочей папкой внутри остатка — установка проходит,
    exit 0. Остаток, чей pid — живой процесс, тоже называется.
  - **4.** Прежняя копия удаляется до записи `<цель>.json`; если файл не пишется, сообщение
    говорит, что копия установлена, а файл называет старую сборку.
  - **5.** Текст Ticket-а и `spec.md` называют новую папку; ручной пункт владельца переписан, и
    добавлен пункт про установщик при копии, запущенной из старой папки.
  - **6. `rmSync` и файл «только для чтения» — замер на ПК** (`probe-t12-r2.cjs`):

    | | Node 22.13.0 | Node 24.21.0 (Electron 44.5.1) |
    | --- | --- | --- |
    | `rmSync(файл только для чтения, { force: true })` | удалён, 1 мс | **EPERM**, файл на месте |
    | `unlinkSync` того же файла | удалён | удалён |
    | `rmSync` файла, открытого другим процессом | EBUSY сразу | EPERM через 103 мс |
    | то же с `maxRetries: 5, retryDelay: 100` | EBUSY через 1529 мс | EPERM через 2137 мс |
    | `renameSync` папки с таким файлом | EPERM, 1 мс | EPERM, 1 мс |

    На Windows `maxRetries` ждёт (на Mac, по замеру ревью, — нет). Файлы теперь удаляет
    `unlinkSync`; удаление и переименования на Windows повторяются до пяти раз через 100 мс при
    EBUSY, EPERM, ENOTEMPTY, EACCES. Test: копия с файлом «только для чтения» заменяется.
  - **7.** Папка установщика сверяется по написанию диска и когда её ещё нет: берётся ближайшая
    существующая папка выше, остаток пути — как дан.
  - **8. 8.3 и subst — замер на ПК.** `subst W:` на папку: `realpathSync` отвечает `W:\…`,
    `realpathSync.native` — настоящий путь `C:\…`; значит, цель через subst-диск над папкой
    установщика отвергается (диск создан и удалён пробой). Короткие имена 8.3 в том круге не
    проверены: новым папкам том их не выдаёт (`ShortPath` равен длинному пути). Замер сделан в
    Ticket-е 23 на имени, которое на диске есть, — `C:\PROGRA~1`.
  - **9.** Остаются принятыми: путь через `\\localhost\C$` и worfy, установленный в другую папку
    (реестр, `/D=`), когда цель — не сама эта папка; у самой папки срабатывает
    `Uninstall worfy.exe`.
  - **10. Сообщения.** Ошибка замены не заслоняется ошибкой удаления незаконченной копии; имена с
    pid этого же запуска считаются остатком; пустой или нечитаемый список процессов от PowerShell
    — отказ с объяснением (test-а на это нет: PowerShell в test-ах не подменяется).
  - **11.** В список отличий macOS от старого `.sh` добавить: неудачная сборка даёт exit 1 (старый
    скрипт — 3 или 127). Отказ сборки без `Contents/Info.plist` снова идёт до любых изменений:
    чистка перенесена после проверки сборки.
  - **12. Закреплено:** имена остатков (одна функция `leftoverName` для записи и для чистки);
    «остаток живого pid не трогаем»; обе ветки возврата отодвинутой копии; снятие приставок
    устройства перед буквой диска (четыре написания, share не трогается); время сборки против времени установки;
    `mac.target: dir`. Случай «копия запущена» для macOS и Linux написан вслепую: на ПК он
    пропускается. Шесть пробелов в коде `.ico` из первого круга я не опознал — нужен список.
  - **Windows-ПК после второго круга,** на слиянии с main `3dc7bd1` (pnpm и скрипт — системный Node 22.13.0, test-ы — Node
    24.21.0 из Electron 44.5.1; Gate не запускался):
    - `pnpm lint` — 0, `pnpm typecheck` — 0;
    - шесть файлов Ticket-а одной командой — exit 1: `install-stable` 44 passed | 1 skipped (слепой
      случай для macOS и Linux), `ico` 6, `packaging` 6, `make-icons` 5 passed | 7 skipped,
      `gitattributes` 14, `autopilot` 37 passed | 9 failed (девять падений main);
    - `pnpm test` — exit 1: 51 failed | 150 passed файлов, 681 failed | 3481 passed | 35 skipped. Main
      `3dc7bd1` сразу после: 51 failed | 147 passed файлов, 681 failed | 3420 passed | 33 skipped. По
      именам: новый один (случай `startup-failure.test.ts`), ушёл один (случай
      `e3-sandbox.test.ts`); оба файла падают на Windows и на main, эти случаи зависят от нагрузки.
  - **Мутанты после второго круга.** 81, по одному; все 81 валят test-ы: 10 в `ico.mjs`, 65 в
    `install-stable.mjs`, 6 в настройках сборки. Первый прогон оставил одного — «при удалении идём
    по ссылке»: отдельная ветка для ссылок делала то же, что ветка для файлов (`unlinkSync` удаляет
    junction и оба вида symlink как ссылки под обоими Node, `probe-rm4.cjs`). Ветка убрана, мутант
    переписан (`statSync` вместо `lstatSync`) и красный. Остальные 80 после этого не повторялись.
- **Не проверено.**
  - Всё, что на Mac: скрипт значков с новым кодом ни разу не запускался (на ПК нет `sips`), ветка
    `darwin` скрипта Stable copy проверена только unit-test-ами чистых функций.
  - Установщик не запускался: SmartScreen, папка установки, значки в меню Пуск и на панели задач,
    установленный worfy и Session в нём — ручной пункт владельца.
  - `pnpm install:stable` в настоящий `%LOCALAPPDATA%` не запускался: test-ы ставят копию
    во временную папку, подменяя `LOCALAPPDATA`. Запуск Stable copy, Session в ней и отказ
    Autopilot в `pnpm dev` над Project-ом worfy — ручной пункт владельца.
  - Smart App Control: в реестре `VerifiedAndReputablePolicyState` = 0 (прочитано 2026-10-10,
    выключен). Пропустит ли Windows неподписанный установщик, покажет только его запуск.
