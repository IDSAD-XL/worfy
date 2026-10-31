# 118 — Git Bash пишет history после каждой команды: закрытию не нужен сигнал

Type: task
Status: open
Branch: worfy-windows/118
Blocked by: —
Source: решение владельца Q10, 2026-10-31 («со всем согласен»); остаток тикета 116 (#1148): под нагрузкой 2 из 120
закрытий Git Bash без `.bash_history`, потому что `kill.exe` не всегда успевает доставить SIGHUP. Платформенный: делает
Session на ПК, проверяет и вливает Mac (ADR-0056).

## Что происходит

Bash дописывает `.bash_history` только при выходе: по `exit` или по SIGHUP. worfy закрывает Terminal Git Bash на Windows через
`kill.exe` (src/main/terminal/windows-pty.ts). На занятой машине сигнал иногда не доходит до bash в отведённые 1500 ms, и
команды этой Session теряются.

## Что делаем

В окружении Terminal-а Git Bash, который запускает worfy, задаём `PROMPT_COMMAND`, который выполняет `history -a`. Тогда bash
дописывает каждую команду в файл сразу после неё, и закрытию сигнал для history больше не нужен.

- Только Git Bash на Windows. macOS, Linux, WSL, PowerShell и cmd не трогаем.
- Если в окружении уже есть `PROMPT_COMMAND`, `history -a` дописывается к нему, а не заменяет его.
- Если `.bashrc` пользователя сам переопределяет `PROMPT_COMMAND`, наш не действует. Это ожидаемо, и worfy с этим не борется.
- Закрытие через `kill.exe` остаётся как есть. `exit` и SIGHUP по-прежнему пишут history.

Цена, известная владельцу: при двух открытых Terminal-ах строки в `.bash_history` перемежаются. History внутри каждой
Session от этого не меняется.

## Готово, когда

- [ ] Terminal Git Bash, запущенный worfy, получает `PROMPT_COMMAND` с `history -a`; уже заданный `PROMPT_COMMAND` сохранён.
- [ ] Другие оболочки и другие ОС окружения не получают.
- [ ] Замер ПК под нагрузкой из тикета 116, 120 закрытий: 0 закрытий без history. Если не 0 — в «Итог» число и причина.
- [ ] `docs/features/terminal.md`: одна фраза о том, что Git Bash в worfy пишет history после каждой команды.

## Тесты

- unit: сборка окружения Git Bash (`PROMPT_COMMAND` пустой, заданный, другая оболочка, не win32).
- contract на Windows: `test/contract/terminal-git-bash-close.test.ts` — команда видна в `.bash_history` до закрытия, без
  сигнала.

## Где в коде

- `src/main/terminal/pty.ts` (запуск оболочки и её окружение), `src/main/agent/env.ts` (`findGitBash`, `gitBashKill`),
  `src/main/terminal/windows-pty.ts` — только чтение.
- Долги low из ревью #1148, если правка трогает эти строки: видимый skip при `outOfTime` (test/contract/terminal-git-bash-close.test.ts:111, :128), ожидание 1500 ms без запущенного `kill.exe` (windows-pty.ts:128), комментарий :23-25.

## Итог
