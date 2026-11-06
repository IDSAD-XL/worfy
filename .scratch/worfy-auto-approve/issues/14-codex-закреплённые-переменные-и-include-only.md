# 14 — Codex: закреплённые переменные и `include_only` владельца

Type: task
Status: done 2026-11-06T14:11Z
PR: #1498
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

- `/bin/zsh -lc 'rm -rf "$TMPDIR"/opt/x'` policy судит как `<runTemp>/opt/x` и даёт `allow files-inside-roots`, а
  shell выполнит `rm -rf /opt/x`;
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
4. Contract test на поддельном app-server: при пути (а) `rm -rf "$TMPDIR"/opt/x` → не `allow`; git-команда, которой
   нужны защитные переменные Run-а, → не `allow`.

## Готово, когда

- [x] В «Итог» — ссылка на исходник Codex и порядок `set` / `include_only` / `exclude` / `inherit`.
  - evidence: commit pass · docs: worfy-auto-approve 14 result — Codex order of set and include_only · - - · 3c63c20ff575f7d295d659eb85496f0466d8b0cc
- [x] Путь выбран и записан; при (а) — test-ы п. 4 зелёные, при «set последним» — комментарий исправлен.
  - evidence: test-run pass · `pnpm test test/unit/auto-approve-shell.test.ts test/unit/auto-approve-run.test.ts test/contract/auto-approve-codex.test.ts test/contract/auto-approve-claude.test.ts` exit 0 · mac - · 3c63c20ff575f7d295d659eb85496f0466d8b0cc
  - evidence: gate pass · `gate fast` exit 0 · mac - · 3c63c20ff575f7d295d659eb85496f0466d8b0cc
  - evidence: gate pass · `gate fast` exit 0 · mac - · 759e265ba37fb83673ea997c1bb13ff346276a89
  - evidence: test-run pass · `pnpm test test/unit/auto-approve- test/contract/auto-approve- test/unit/codex- test/contract/codex-` exit 0 · mac - · 759e265ba37fb83673ea997c1bb13ff346276a89
  - evidence: gate pass · `gate fast` exit 0 · mac - · 4c11061c0f95c47819d4b21616a4ad87a0fac38c
- [x] `docs/features/autopilot.md` говорит, какие переменные Codex-Run раскрывает при суде.
  - evidence: commit pass · docs: the Codex shell wrappers the policy judges, and TMPDIR on Codex (worfy-auto-approve 14) · - - · 3c63c20ff575f7d295d659eb85496f0466d8b0cc
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Где в коде

- `src/main/vendors/codex/approvals.ts` (`codexPinned`, `codexPinConfig`, комментарий `:147`)
- `src/main/vendors/codex/session.ts` (`open()`, `known`)
- `src/main/agent/auto-approve/run-approval.ts:487` (git-окружение по `at.started`)
- `test/contract/auto-approve-codex.test.ts`
- `docs/features/autopilot.md`

## Итог

**Порядок по исходнику.** worfy ставит `@openai/codex` 0.166.0 (`package.json`). В теге `rust-v0.166.0` файл
`codex-rs/core/src/exec_env.rs` только зовёт `codex_protocol::shell_environment::create_env`; сам порядок — функция
`populate_env` в
https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/protocol/src/shell_environment.rs:
1. `inherit` (`all` / `none` / `core`) — с чего начать;
2. исключения по умолчанию (`*KEY*`, `*SECRET*`, `*TOKEN*`), если не `ignore_default_excludes`;
3. `exclude`;
4. `set`;
5. `include_only` — оставляет только подходящие имена;
6. `CODEX_THREAD_ID`, затем снимаются `NON_INHERITABLE_ENV_VARS`.

`include_only` применяется после `set`: `include_only` владельца без закреплённых имён снимает их из shell-а команды.

**Путь (а).** На Codex при суде известен только `HOME` (и `USERPROFILE`, если есть) — `codexKnown`
(`src/main/vendors/codex/approvals.ts`), передаётся в `known` из `src/main/vendors/codex/session.ts`. TMPDIR и
git-окружение Run-а по-прежнему закрепляются ключами `shell_environment_policy.set` (у владельца без `include_only` они
работают), но policy на них не опирается:
- `rm -rf "$TMPDIR"/opt/x` — `deny not-judged` (неизвестная переменная);
- `T=$(mktemp -d)` вне macOS берёт TMPDIR только из `known` (`src/main/agent/auto-approve/shell.ts`, `surely`), иначе
  `mktemp without TMPDIR`; на macOS без изменений;
- git: `run-approval.ts` считает `GIT_CONFIG_PARAMETERS` и `GIT_NO_LAZY_FETCH` только из `known`, поэтому git-команда,
  которую policy одобрила бы, на Codex паркуется `git-without-run-environment`;
- `git config --get` читает `HOME` только из `known`; `XDG_CONFIG_HOME`, которого нет в `known`, даёт чтение обоих мест.

Остальные прямые чтения окружения в `shell.ts` и `policy.ts` (`GIT_` переменные, `IFS`, `CDPATH`, файлы запуска shell-а,
присваивание экспортируемой, корни `XDG_CONFIG_HOME` / `APPDATA`) проверяют наличие и только запрещают — переменная,
снятая `include_only`, их не ослабляет.

HOME остаётся известным, хотя `include_only` может снять и его: путь `$HOME/…`, который policy считает внутри корня,
тогда указывает на `/` и путь корня ниже домашней папки (`/Stuff/<project>/…`) — папку, которой обычно нет.

Путь Claude Code не меняется: он не передаёт `known`, и все проверки читают окружение как раньше
(`test/contract/auto-approve-claude.test.ts` 15/15 до и после).

Test-ы: `test/contract/auto-approve-codex.test.ts` («the owner's include_only may drop…»),
`test/unit/auto-approve-run.test.ts` (git с `known`), `test/unit/auto-approve-shell.test.ts` (`mktemp -d`, `git config
--get` с `known`); `docs/features/autopilot.md` — какие переменные Codex-Run раскрывает при суде.

## Итог раунда 1

Ревью PR #1498, раунд 1 (три medium, один low):

1. **HOME и USERPROFILE на Codex тоже неизвестны** — абзац «HOME остаётся известным» выше больше не верен. Без `HOME`
   bash и sh раскрывают `"$HOME"/x` в `/x`, так что `/bin/bash -lc 'rm -rf "$HOME"/repo/…/build'` одобрялся бы как
   удаление внутри корня, а выполнял `rm -rf /repo/…`. Теперь `known` на Codex пуст
   (`src/main/vendors/codex/session.ts`, `judged`), `codexKnown` убран. `~` в начале слова по-прежнему — домашняя папка
   из окружения app-server-а (`shell.ts`, `variable(…, anyway)`): bash и zsh без `HOME` берут её из базы пользователей.
   Проверено на macOS: `env -u HOME /bin/bash -c 'echo ~'`, то же для `/bin/sh` (на macOS это bash) и `/bin/zsh` —
   печатают домашнюю папку. Не проверено: dash (`/bin/sh` на Linux) без `HOME` оставляет `~` буквально, то есть путь
   `~/…` ниже папки команды; Git Bash без `HOME` и `USERPROFILE`.
2. **Off → On во время Run-а.** Session, запущенная в Off, ничего не закрепляет; после переключения на On её запрос
   судится с пустым `known` — contract test «a Session started in Off and judged after the owner switched to On…».
3. **ADR-0098** — раздел `## Amendments` с датированной строкой; `docs/features/autopilot.md` говорит то же.
4. Список платформ в `codexKnown` ушёл вместе с функцией.

Известный предел (был до этого Ticket-а, Ticket 05): владелец своим `shell_environment_policy.set` в config Codex может
добавить в shell команды `BASH_ENV`, `CDPATH`, `IFS` или `XDG_CONFIG_HOME`, которых нет в окружении app-server-а, и
проверки наличия их не увидят. Записать этот config может только владелец.

## Итог раунда 2

Ревью PR #1498, раунд 2: все четыре пункта раунда 1 исправлены, high и medium нет. Три low исправлены только в
комментариях и документах, логика не менялась:

1. ADR-0098 (`## Amendments`) и `docs/features/autopilot.md` называют допущение: политика берёт `~` из `HOME`
   app-server-а, а bash, zsh и Git Bash без `HOME` берут домашнюю папку из базы пользователей. Считается, что это одна
   папка; на Windows со своим `HOME` (например `D:\home`) они могут различаться.
2. Комментарии `AnalyzeContext.known` (`src/main/agent/auto-approve/shell.ts`) и `ApprovalWhere.known`
   (`src/main/vendors/session.ts`) говорят, что Codex передаёт пустой список.
3. Известный предел, без правки кода: dash (`/bin/sh` на Linux) без `HOME` оставляет `~` буквально, и `~/x` становится
   `<папка команды>/~/x`. `ln` политика не одобряет, Linux — не целевая платформа worfy.
