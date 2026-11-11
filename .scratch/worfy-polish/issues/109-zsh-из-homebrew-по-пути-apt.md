# 109 — CI: zsh из Homebrew лежит там же, где zsh из apt

Type: bug
Status: done 2026-11-11T17:14Z
PR: #1801
Branch: worfy-polish/109
Blocked by: none
Source: бриф Orchestrator-а 2026-11-11: `main` красный после #1798 (worfy-polish 107, merge e66d9cf4f). Правило владельца:
красный `main` чинится вперёд за час, иначе revert.

## Что происходит

Зеркала Ubuntu всё ещё недоступны: `apt-get update` упирается в предел 180 с, и `scripts/ci-install-zsh.sh` берёт zsh из
Homebrew. Ссылку он клал в `/usr/local/bin/zsh`. Run-ы полного набора (PR #1794, run 43052624782, job 130633699932;
run `main` на e66d9cf4f) красные в `linux-tests (3/4)` и `(4/4)`:

- `test/contract/terminal-ai-zle.test.ts:1256` «a zsh started in the Terminal has no widget and no socket»;
- `test/contract/terminal-shell-integration.test.ts:335`, `:342` (`commandRunning` не становится true после `zsh -i`);
- `test/contract/terminal-shell-integration.test.ts:507` «without SHELL /bin/zsh starts, with the integration».

Причина: Terminal test-ы запускают shell с `PATH` = `SYSTEM_PATH` (`src/main/agent/env.ts:36`,
`/usr/bin:/bin:/usr/sbin:/sbin`). Набранный в Terminal `zsh -i` ищется по этому `PATH`, а `/usr/local/bin` в нём нет. Без
`SHELL` worfy запускает `/bin/zsh` (`src/main/terminal/pty.ts:180`). apt кладёт zsh в `/usr/bin/zsh`, а `/bin` в Ubuntu —
ссылка на `/usr/bin`. Поэтому с zsh из apt оба пути есть, а со ссылкой в `/usr/local/bin` нет ни одного.

Что ещё отличает zsh из Homebrew: он читает свои системные файлы из `etc/` Homebrew, а не `/etc/zsh/zshenv` и
`/etc/zsh/zshrc`. Test-ы на это не опираются: `skip_global_compinit` (`QUIET_ZSH`) нужен только против compinit из
Ubuntu-ского `/etc/zsh/zshrc`. Regex конца prompt-а в `terminal-ai-zle.test.ts:1264` принимает keypad-режим Debian, но не
требует его. `terminal-shell-integration.test.ts:281` ждёт на Linux `HISTFILE` из `.zshenv`; так и будет, когда
`/etc/zsh/zshrc` не читается. `ZDOTDIR` test-ы ставят сами.

## Что делаем

1. Путь 4 скрипта (Homebrew) ставит ссылку в `/usr/bin/zsh` (`ZSH_LINK`, как раньше, для test-а) и дописывает её в
   `/etc/shells` через `sudo tee -a`, если её там нет (`SHELLS` для test-а).
2. `test/contract/ci-install-zsh.test.ts`: ссылка записана в список shell-ов через `sudo`, повторно не дописывается;
   значения по умолчанию `ZSH_LINK` и `SHELLS` закреплены по тексту скрипта.

## Готово, когда

- [ ] Путь Homebrew ставит ссылку по `ZSH_LINK` и дописывает её в `SHELLS` один раз; по умолчанию ссылка — `/usr/bin/zsh`,
      список — `/etc/shells`. Contract test `test/contract/ci-install-zsh.test.ts`; mutant-ы (ссылка в `/usr/local/bin`,
      дописывать всегда, `tee` без `-a`) роняют его.
  - evidence: test-run pass · `pnpm test test/contract/ci-install-zsh.test.ts test/contract/ci-workflow.test.ts` exit 0; 3 mutants each fail it · mac - · d6fdc92510c75da3a4a23087ef0b54b8945531b2
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · d6fdc92510c75da3a4a23087ef0b54b8945531b2
- [ ] Terminal test-ы (`terminal-ai-zle.test.ts`, `terminal-shell-integration.test.ts`) зелёные в `linux-tests` с zsh из
      Homebrew — CI полного набора (`main` после merge или следующий PR с полным набором).

## Где в коде

- `scripts/ci-install-zsh.sh`.
- `test/contract/ci-install-zsh.test.ts`.

## Вне скоупа

- `scripts/affected-tests.mjs origin/main HEAD` для этого PR-а даёт 33 файла test-ов, Terminal test-ов среди них нет: от zsh
  на runner-е они зависят, но скрипт не читают. Их проверит run полного набора.
