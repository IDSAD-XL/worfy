# 50 — «Sign in with gh» на Windows: pseudo-terminal запускает `/bin/sh`, а голый `gh` node-pty не находит

Type: task
Status: open
Blocked by: —
Source: срез 3 Ticket-а [14](14-gate-full-на-windows.md) на Windows-ПК, 2026-10-14: дефект продукта найден при подмене `gh` в test-ах и вынесен из PR подмены в свой Ticket. Черновой commit — `29c4159` на ветке `worfy-windows/14-gh-stand-in` (не для merge). Код перечитан на Mac по main `1c1beadd`; node-pty — 1.1.0 из `node_modules`.

## Что происходит

- **Кнопка «Sign in with gh»** (шаг учётной записи GitHub при подключении Project-а,
  `src/renderer/projects/GithubAccount.tsx:226`) запускает `gh auth login` в
  pseudo-terminal (псевдотерминале, через node-pty), чтобы пользователь вошёл в GitHub сам.
  Команду строит `signInCommand`: `/bin/sh -c 'exec "$0" auth login' <gh>` на любой системе
  (`src/main/github/accounts.ts:199-206`, строка — `:205`). Pseudo-terminal создаёт
  `signInRegistry` (`:219-225`). Программа `gh` — `appGh()` (`src/main/ipc/projects.ts:133-136`):
  `gh` с окружением `agentEnv()` либо `WORFY_GH` (подмена в test-ах) с окружением
  процесса worfy. Регистр создаётся при первом входе (`:168`).
- **На Windows нет `/bin/sh`.** node-pty отвечает «File not found:» (`node_modules/node-pty/src/win/conpty.cc:274-288`),
  вход не начинается. Это дефект продукта, а не только test-ов.
- **Запуск самой программы без оболочки тоже не находит голый `gh`.** node-pty 1.1.0 на Windows
  ищет относительное имя только в `Path` процесса worfy (`GetEnvironmentVariableW(L"Path")`,
  `node_modules/node-pty/src/win/path_util.cc:54-92`). `.exe` он не добавляет, а `Path` окружения,
  переданного pseudo-terminal, не читает. Поэтому голый `gh` не находится, даже когда `gh.exe` лежит
  в `Path`.
- **Черновик.** Commit `29c4159` делает `signInCommand` зависимым от системы: вне Windows ничего не
  меняется, на Windows pseudo-terminal запускает программу с `auth login`. Он стоит на `818e56de`
  (добавляет `src/main/program.ts`, `programStart` — запуск подмены `.mjs` через
  `process.execPath`), а тот — на старом main `88769ca8`. На main `src/main/program.ts` нет. В
  описании commit-а записаны обе оставшиеся проблемы: голый `gh` не найден, а подмена `.mjs` под
  `process.execPath` не получает терминала (исполняемый файл Electron — программа GUI). Два test-а
  `test/contract/github-accounts.test.ts` на настоящем pseudo-terminal (`:236`, `:257`) на Windows
  по-прежнему падают.
- **Готовый helper для поиска.** `findOnPath(name, env)` (`src/main/agent/env.ts:392-401`) отдаёт
  первый `<name>.exe` из `Path` переданного окружения и пропускает неполные пути. Так уже находится
  `pwsh` для Terminal (`src/main/terminal/pty.ts:204`).

## Что делаем

1. **На Windows pseudo-terminal запускает саму программу** с аргументами `auth login`, без
   `/bin/sh`. Вне Windows команда прежняя.
2. **Полный путь к `gh` на Windows** — `findOnPath('gh', env)` по окружению, которое получает
   pseudo-terminal (`agentEnv()`). Не нашёлся — понятная ошибка в окне («gh не найден в Path»), а не
   «File not found:» из node-pty. `WORFY_GH` с полным путём идёт как есть.
3. **Черновик `29c4159` — образец, не основа.** Он тянет `programStart` из `818e56de`. Если PR
   подмены `gh` (Ticket 14, срез 3b–3c, ветка `worfy-windows/14-stand-in-launcher`) влит раньше,
   `programStart` уже на main и пригоден; если нет — этому Ticket-у он не нужен: вход с `.mjs` в
   pseudo-terminal на Windows всё равно не работает (терминала нет).
4. **Test-ы на настоящем pseudo-terminal на Windows** (`github-accounts.test.ts:236`, `:257`):
   подмена `gh` для них — исполняемый файл с терминалом (например, `node.exe` со скриптом) либо
   пропуск на Windows с причиной. Решение — в «Итог».

## Готово, когда

- [ ] На Windows-ПК «Sign in with gh» в установленной сборке открывает `gh auth login`, вход
      проходит, новая учётная запись видна в списке. Снимок или запись в «Итог». Это проверяет
      владелец или Session на Windows-ПК.
- [ ] Unit-test: команда для `darwin`, `linux`, `win32` на любой машине; на `win32` — полный путь из
      `findOnPath`, без `/bin/sh`.
- [ ] Unit-test: `gh` нет в `Path` — ошибка с понятным текстом.
- [ ] Решение по двум test-ам на настоящем pseudo-terminal записано в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac; `gate full` зелёный; Linux CI
      зелёный; ручной job «Windows tests» без новых по имени падений против main.

## Тесты

- Unit над подменённым pty: с чем запускается pseudo-terminal на каждой системе.
- Мутант: `/bin/sh` на `win32` — test красный; голое `gh` вместо полного пути — test красный.

## Где в коде

- `src/main/github/accounts.ts:199-206` (`signInCommand`), `:219-225` (`signInRegistry`).
- `src/main/ipc/projects.ts:133-136` (`appGh`), `:168`.
- `src/main/agent/env.ts:392-401` (`findOnPath`); образец вызова — `src/main/terminal/pty.ts:204`.
- `test/contract/github-accounts.test.ts:231-257`.
- node-pty 1.1.0: `src/win/conpty.cc:274-288`, `src/win/path_util.cc:54-92`.

## Вне скоупа

- Подмена `gh` и `claude` в test-ах на Windows — Ticket 14, срез 3b–3c.
- `gh` бейджей PR (`src/main/ipc/checks.ts`): его запускает `child_process` Node, а не node-pty.
  Работает ли он на Windows с голым `gh`, этот Ticket не проверяет.

## Риски

- **`gh` из Microsoft Store или scoop** может быть ярлыком, а не `.exe`; `findOnPath` принимает и
  ярлыки (`fileOrAlias`). Проверить на ПК, какой `gh` у владельца.
- **Окружение на Windows.** `agentEnv()` берёт `Path` из реестра (Machine и User); если реестр не
  прочитался, остаётся `Path` процесса worfy (`env.ts:483-487`), и `gh` может не найтись. Тогда —
  ошибка из пункта 2.

## Итог

На ПК владельца GitHub CLI 2.89.0 из MSI (WinGet) в C:\Program Files\GitHub CLI\gh.exe; проверку входа (настоящий gh auth login) делает владелец.
