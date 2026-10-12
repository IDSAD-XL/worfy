# 22 — Оболочка Terminal, которая вышла сама (`exit`), оставляет `conhost.exe` до выхода из worfy

Type: task
Status: open
Blocked by: 10
Source: нашла Session на Windows-ПК, 2026-10-12, при правках PR #239 (Ticket [10](10-terminal-на-powershell.md) — Terminal на PowerShell); причину подтвердило ревью на Mac чтением исходников node-pty. PR #239 правит тот же файл и вливается раньше. Делается после Ticket-а [20](20-chokidar-не-идёт-по-ссылке-на-unc.md) (watcher-ы chokidar и ссылка на share). Делает Session на Windows-ПК; проверяет и вливает Session на Mac, как у Ticket-а 20.

## Что происходит

Замер на ПК владельца, 2026-10-12. В Terminal Node оболочка завершается сама: пользователь набрал
`exit`. Её дочерний `conhost.exe` остаётся, пока worfy не выйдет. 20 таких выходов оставляют 20
`conhost.exe` — и до правок PR #239, и после них. Каждый — процесс и сколько-то памяти; сколько,
не мерили.

Причина — по исходникам node-pty 1.1.0, файл `node_modules/node-pty/src/win/conpty.cc`:

- pseudo-console закрывает только `PtyKill` (`:534`): `ClosePseudoConsole(handle->hpc)`
  (`:554-559`) — и только если запись о ней найдена (`:547`, `:549`).
- Когда оболочка вышла, поток ожидания убирает запись: `assert(remove_pty_baton(baton->id))`
  (`:105-106`). После этого `kill()` закрывать нечего. Вызов стоит внутри `assert`. В
  prebuild `win32-x64` текст этого assert есть (в UTF-16), значит вызов собран.
- Ссылку, которая держит conhost, отпускает `ConptyReleasePseudoConsole`. Он зовётся только при
  `useConptyDll` (`:431-437`); по умолчанию опция выключена (`lib/windowsPtyAgent.js:31`). worfy её
  не передаёт (`src/main/terminal/pty.ts:415`, main `f9c005b`; сверить после PR #239).

PR #239 чинит закрытие самим worfy (закрыт Terminal Node): `pty.kill()` идёт при живой оболочке,
рабочий поток node-pty и conhost освобождаются. Для оболочки, которая вышла сама, PR #239
освобождает поток, но не conhost. Этот Ticket — только про второй случай.

## Что делаем

- (а) **Новая версия node-pty**, которая закрывает pseudo-console при выходе оболочки. Есть ли
  такая, по `node_modules` не определить: там только 1.1.0 (`package.json:33`), changelog в пакете
  нет — проверить в upstream (microsoft/node-pty). Цена: на macOS и Linux `scripts/postinstall.mjs`
  пересобирает node-pty под Electron (`:25`); на Windows он ничего не делает (`:22`) — берётся
  готовый `prebuilds/win32-x64` (`:7`), сборка из исходников там падает (`:8-9`). Новый prebuild
  должен грузиться в Electron 44.5.1: проверить на ПК. В packaged-сборке node-pty лежит вне
  app.asar (`electron-builder.yml:42-43`).
- (б) **`useConptyDll: true`** при `win32`. node-pty грузит `conpty\conpty.dll` рядом с
  `conpty.node` (`conpty.cc:181`) вместо системной. Оба файла в пакете есть:
  `prebuilds/win32-x64/conpty/conpty.dll` и `OpenConsole.exe`. В typings опция помечена
  `(EXPERIMENTAL)` (`typings/node-pty.d.ts:99-104`); с ней `kill()` идёт другой веткой
  (`lib/windowsPtyAgent.js:153-159`) и зовёт `TerminateProcess` оболочки (`conpty.cc:562-563`).
- (в) Свой native-вызов — только если (а) и (б) не подошли. Способ выбирает исполнитель; выбор и
  причина — в «Итог».

- **Остатки ревью PR #239** (Ticket 10, все low; тот же файл и те же test-ы):
  - `src/main/terminal/pty.ts:710`: половина `ended &&` в условии `if (ended && terminal.closing)`
    не закреплена. Ни один test не печатает ничего между `close()` и выходом оболочки.
  - `src/main/projects/settings.ts:35`: запись настроек через мягкую схему проходит все test-ы.
  - gate предупреждает: `test/contract/terminal.test.ts` вырос до 1418 строк при пороге 1000.
    Вынести случаи Windows на настоящем pty в отдельный файл.

## Готово, когда

- [ ] ПК: 20 Terminal-ов, оболочка каждого завершена через `exit`. Через несколько секунд у worfy
      0 дочерних `conhost.exe`. Числа до и после — в «Итог».
- [ ] Закрытие Terminal Node — как после PR #239: потоки и `conhost.exe` возвращаются к исходному.
- [ ] Остатки ревью PR #239 из «Что делаем»: сделаны и закреплены test-ами, либо в «Итог» записано,
      почему нет.
- [ ] Один новый test на настоящем pty (только `win32`): после `exit` дочерних `conhost.exe` — 0.
- [ ] Windows-ПК: test-ы Ticket-а 10 на настоящем pty зелёные; `pnpm lint`, `pnpm typecheck`,
      `pnpm test` — без новых падений относительно main.
- [ ] macOS: `test/contract/terminal.test.ts` и e2e `test/e2e/terminal.spec.ts`, включая случай
      `@packaged`, зелёные в gate full на Mac. Вызов `spawn` на macOS не меняется.
- [ ] Packaged-сборка запускает Terminal и на Windows — вручную на ПК: e2e `@packaged` ищет только
      `dist/mac*/worfy.app` (`test/e2e/terminal.spec.ts:650`).
- [ ] Если node-pty обновлён, в «Итог»: версия; пересборка под Electron на Mac; prebuild
      `win32-x64` грузится в Electron на ПК; `pnpm install` на обеих системах — exit 0.

## Тесты

Сначала падающий test (только `win32`, настоящий pty): оболочка получает `exit`; после `onExit`
test считает дочерние `conhost.exe` своего процесса и ждёт 0. До правки он красный: остаётся 1. На
Mac и в Linux CI он пропущен с причиной. В «Итог» — как он падал.

## Где в коде

- `src/main/terminal/pty.ts` (вызов `spawn`; строки сверить после PR #239)
- `package.json`, `pnpm-lock.yaml`, `scripts/postinstall.mjs` — если выбран (а)
- `test/contract/terminal.test.ts`, `test/contract/node-pty.test.ts`

## Вне скоупа

- Закрытие Terminal Node самим worfy и дерево процессов оболочки — Ticket 10 (PR #239).

## Риски

- (б): `OpenConsole.exe` и `conpty.dll` из пакета работают вместо системного conhost. Подписаны ли
  они и что скажут SmartScreen и Defender о неподписанном файле — не проверялось.
- (б): попадают ли оба файла в packaged-сборку Windows (Ticket 12 — сборка NSIS и Stable copy,
  PR #237, не влит) — не проверялось. Шаблон `electron-builder.yml:43` их покрывает.
- (б): опция экспериментальная: test-ы Ticket-а 10 на настоящем pty должны остаться зелёными.
