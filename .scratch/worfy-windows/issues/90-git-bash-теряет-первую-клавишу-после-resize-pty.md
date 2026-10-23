# 90 — Git Bash на консоли Windows иногда теряет первую клавишу после resize pty

Type: task
Status: done 2026-10-23T00:14Z
Blocked by: —
Source: работа над [Ticket-ом 86](86-terminal-на-windows-экран-после-resize-и-alternate-screen.md) (PR #736) на ПК,
2026-10-22; ответ Session на Mac на вопросы PR #736. Строки `wheel-over-nodes.spec.ts` — по ветке PR #736
(`121b1e5d`): обход приходит с этим PR.

## Что происходит

Git Bash, запущенный на консоли Windows (ConPTY из node-pty, `useConptyDll`), иногда теряет первую клавишу,
набранную после resize pty. Остальные символы доходят. Например, вместо `echo d0` shell получает `cho d0` и
отвечает `bash: cho: command not found`.

Пользователь worfy это тоже может увидеть. main меняет размер pty, когда Terminal Node меняет размер или
Terminal уходит в tile focus mode. Первая клавиша после этого может пропасть.

## Воспроизведение вне worfy (ПК, 2026-10-22)

Скрипт на node-pty, без worfy. Он запускает `C:\Program Files\Git\bin\bash.exe --login -i` с `useConptyDll: true`
при 117×30 и временными USERPROFILE/APPDATA/LOCALAPPDATA. Скрипт отвечает на `ESC[c` и `ESC[6n`, как main.
Перед командами он выполняет `unset HISTFILE`. Команды скрипт пишет по одному символу с паузой 2–5 ms.
Скрипты лежат в `.scratch/worfy-windows/evidence/`: `90-probe-delay.mjs` (опыт 1) и `90-probe-focus.mjs` (опыт 2). Запуск:
`node 90-probe-delay.mjs bash out.json`. `createRequire` в них указывает на дерево с `node_modules/node-pty`;
при переносе путь надо поправить.

1. resize (81×14 и 81×21 по очереди), пауза N ms, потом `echo dN\r`:
   - 0 ms — потеряна `e` (`cho d0`);
   - 50 ms — потеряна (`cho d50`);
   - 200 ms, 600 ms, 1500 ms — дошла.
2. resize, через 100 ms focus report `ESC[I` (так делает xterm.js при фокусе), через 500 ms `echo fN\r`, то есть
   примерно через 600 ms после resize. Два прогона:
   - с resize: потеряна в 1 из 4 (`cho f3`);
   - без resize: 0 из 6.

Итого в probe: первая клавиша пропадает сразу после resize, а позже — изредка. В одном случае она пропала
примерно через 600 ms после resize.

В e2e worfy (`wheel-over-nodes.spec.ts`, Terminal Node уменьшен до 240 px, после этого клик и набор
`printf …`) shell получил `rintf` в 8 из 12 повторов. Это было в 4 прогонах по 3 повтора с разными паузами до и
после клика, до 500 ms. В выводе было `rintf: command not found`.

Не проверено:

- в каком слое теряется клавиша: MSYS2 runtime / readline у bash или `conpty.dll` из node-pty;
- теряет ли первую клавишу PowerShell на той же консоли.

## Версии

- node-pty `1.2.0-beta.15` (`useConptyDll`), Node.js `v24.21.0` для probe, Electron `44.5.1` для e2e.
- Git for Windows `2.45.1.windows.1`, GNU bash `5.2.26(1)-release (x86_64-pc-msys)`.
- Windows 11 Pro `10.0.26200`.

## Обход в test-е

`test/e2e/wheel-over-nodes.spec.ts:332`–`:336`: набранная команда начинается с пробела
(`" printf '\\033[?1049h'; cat -v"`). Shell игнорирует ведущий пробел, дошёл он или нет. Комментарий над этой
строкой называет причину.

Когда исправление выйдет вне worfy, этот обход можно убрать. Перед этим нужно проверить probe выше: 0 потерь
в 20 подряд при паузах 0, 50 и 600 ms.

## Что делаем

Правки продукта сейчас нет.

1. Определить, где теряется клавиша. Для этого прогнать тот же probe с другим shell-ом (PowerShell, `cmd.exe`)
   и с `conpty.dll` системы (`useConptyDll: false`).
2. Завести issue там, где ошибка: Git for Windows / MSYS2 или microsoft/terminal (ConPTY). В issue дать скрипт
   и замеры отсюда.
3. Когда исправление выйдет, обновить зависимость и убрать обход в test-е.

## Готово, когда

- [ ] Слой найден и записан в «Итог»; ссылка на issue вне worfy.
- [ ] После исправления: probe — 0 потерь в 20 подряд при паузах 0, 50 и 600 ms; ведущий пробел убран из
      `wheel-over-nodes.spec.ts`, spec зелёный на ПК 3 из 3 и на Mac.

## Где в коде

- `test/e2e/wheel-over-nodes.spec.ts:332`–`:336` — обход.
- `src/main/terminal/pty.ts` — resize pty (не меняется).

## Заметка: `terminal.spec.ts:648` (2026-10-22)

`test/e2e/terminal.spec.ts:648` (Git Bash выбран оболочкой Terminal-а) может иметь другую причину, чем этот
Ticket: здесь теряется первая клавиша после resize, а там набранная клавиша встала не на своё место — на экране
`cecho … ygpath`.

- Красный: ПК 2026-10-22, main `8f5238c8` (ветка `worfy-windows/14-paths`, один прогон `terminal`, `focus`,
  `wheel-over-nodes`): 18 зелёных, 1 красный — `:648`.
- Зелёный: ПК 2026-10-22, полный e2e на main `d06d2c2d` (пересчёт Ticket-а 14, PR #755): `:648` прошёл, 1 из 1.

Решение Session на Mac: новый Ticket — только если `:648` снова покраснеет; тогда записать прогон и экран.

**Решение владельца 2026-10-23:** вынесен из Epic-а — приёмку (16) не блокирует, причина вне worfy (Git for Windows / MSYS2 или ConPTY). Ticket закрыт без правок; если `:648` снова покраснеет — новый Ticket с прогоном и экраном.
