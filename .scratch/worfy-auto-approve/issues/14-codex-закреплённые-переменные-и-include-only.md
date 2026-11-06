# 14 — Codex: закреплённые переменные и `include_only` владельца

Type: task
Status: open
Blocked by: 05
Source: review PR #1469 (Ticket 05), раунд 3; предел трёх раундов review: medium после раунда 3 уходит в отдельный Ticket

Глубина ревью: high (безопасность policy).

## Что происходит

Ticket 05 (PR #1469) судит команду Codex так. Значение при раскрытии слов команды есть только у переменных из списка
`known`: HOME, USERPROFILE, TMPDIR и git-окружение Run-а. worfy закрепляет их в config `thread/start` ключами
`shell_environment_policy.set.<NAME>` (`src/main/vendors/codex/approvals.ts:147-158`, `codexPinned` в
`src/main/vendors/codex/session.ts`).

Если Codex применяет `shell_environment_policy.include_only` после `set`, то `include_only` в config владельца
(`~/.codex/config.toml`) без этих имён снимет их из shell-а команды. Тогда:

- `/bin/zsh -lc 'rm -rf "$TMPDIR"/Users/x'` policy судит как `<runTemp>/Users/x` и даёт `allow files-inside-roots`, а
  shell выполнит `rm -rf /Users/x`;
- `GIT_CONFIG_PARAMETERS` и `GIT_NO_LAZY_FETCH` Run-а пропадут из shell-а, а `run-approval.ts:487` считает git-окружение
  безопасным по значениям на старте.

Условие задаёт только config владельца: агент его записать не может (`~/.codex` под hard deny, корень Project-а вне
корней). Порядок `set` и `include_only` в Codex 0.166 не проверен: исходников на диске нет, настоящий binary в test-ах
не запускается. Комментарий `approvals.ts:147` («whatever `shell_environment_policy` of the owner's leaves out») неверен,
если порядок такой.

## Что делаем

1. Установить порядок по первоисточнику — исходник Codex `exec_env.rs` той версии, что ставит worfy (GitHub
   `openai/codex`, тег версии), и записать ссылку и вывод в «Итог».
2. Если `include_only` применяется после `set` (или порядок не удаётся установить), выбрать один из путей и записать
   решение:
   - (а) **Рекомендую:** TMPDIR и git-окружение не входят в `known` на Codex. Ссылка на них — неизвестная переменная,
     policy никогда не даёт `allow`; HOME остаётся (путь под HOME вне корней и так не одобряется). Для git-окружения
     Codex-Run судит git-команды так, будто защитных переменных Run-а нет.
   - (б) Перекрыть `shell_environment_policy.include_only` пустым списком в том же config. Это снимает фильтр владельца
     целиком: в shell команды попадут переменные, которые владелец намеренно убрал (например секреты). Не брать без
     владельца.
3. Если `set` применяется последним — исправить только комментарий `approvals.ts:147` и добавить ссылку на исходник.
4. Contract test на поддельном app-server: при пути (а) `rm -rf "$TMPDIR"/Users/x` → не `allow`; git-команда, которой
   нужны защитные переменные Run-а, → не `allow`.

## Готово, когда

- [ ] В «Итог» — ссылка на исходник Codex и порядок `set` / `include_only` / `exclude` / `inherit`.
- [ ] Путь выбран и записан; при (а) — test-ы п. 4 зелёные, при «set последним» — комментарий исправлен.
- [ ] `docs/features/autopilot.md` говорит, какие переменные Codex-Run раскрывает при суде.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Где в коде

- `src/main/vendors/codex/approvals.ts` (`codexPinned`, `codexPinConfig`, комментарий `:147`)
- `src/main/vendors/codex/session.ts` (`open()`, `known`)
- `src/main/agent/auto-approve/run-approval.ts:487` (git-окружение по `at.started`)
- `test/contract/auto-approve-codex.test.ts`
- `docs/features/autopilot.md`
