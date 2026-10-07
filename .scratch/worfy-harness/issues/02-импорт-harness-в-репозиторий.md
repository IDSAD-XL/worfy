# 02 — Импорт Harness из `~/.claude` в `harness/` с историей git; test-ы скриптов Harness в CI

Type: task
Status: claimed — 2026-10-07
Blocked by: —
Source: решения владельца 2026-10-07 (Q2, Q3, Q13, Q19, Q33); [spec.md](../spec.md); [ADR-0019](../../../docs/adr/0019-harness-claude-code-plugin.md); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md); [ADR-0047](../../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md)

## Что происходит

- Harness живёт только в `~/.claude` владельца. Это локальный git-репозиторий без remote, 26
  коммитов (первый — 331a6ca «Snapshot of Claude Code workflow before generalization»).
  `~/.claude/.gitignore` версионирует только `CLAUDE.md`, `settings.json`, `agents/`, `skills/`,
  `bin/`, `hooks/`, `profiles/`, `gate/config.json`. В репозитории worfy папки `harness/` нет.
- По ADR-0019 исходник Harness — `harness/` репозитория worfy. По Q3 история `~/.claude`
  импортируется: уроки ссылаются на её коммиты — `docs/lessons/process.md:53` (364070b), `:62`
  (70b50c4), `docs/lessons/agents.md:82` (8d2fbea, f0132fb), `:91` (ec8412c),
  `docs/lessons/ci-merge.md:49` (f5f0cbb, 8d2fbea), `docs/adr/0033-autopilot-names-wave-tickets.md:53`
  (364070b). Все шесть коммитов меняют файлы Harness.
- В истории `~/.claude` есть и то, что в Harness не входит: личные скрипты (`bin/telegram-mcp`,
  `bin/auction-staging-db-mcp`, `bin/agent-time-split`), удалённые агенты и hooks отдельных
  Project-ов (`agents/atakama-*`, `agents/auction-*`, `hooks/atakama-*`), Profile-ы, реестр Gate.
- Test-ы Harness — 7 файлов в `~/.claude/bin/tests/` и 3 в `~/.claude/hooks/tests/`, каждый
  запускается руками (`bash ~/.claude/bin/tests/<имя>.test.sh`, код 0 — прошёл). В CI их нет.
  - Скрипт под test-ом ищется в `~/.claude`: `PROFILE="$HOME/.claude/bin/profile"`
    (`~/.claude/bin/tests/profile.test.sh:8`), `~/.claude/bin/tests/preflight.test.sh:9`,
    `~/.claude/bin/tests/skill-blocks.test.sh:9`, `~/.claude/hooks/tests/session-hooks.test.sh:9-10`.
    Часть принимает другой каталог через `BIN_DIR` / `HOOKS_DIR`
    (`~/.claude/bin/tests/tickets-root.test.sh:8`, `~/.claude/hooks/tests/gate-unregistered.test.sh:8`,
    `~/.claude/hooks/tests/gate-notverified.test.sh:13`).
  - Скрипты зовут друг друга тоже через `$HOME/.claude` с переопределением через env:
    `CLAUDE_TICKET_BIN` (`~/.claude/bin/epic-status:53`), `CLAUDE_GATE_CONFIG`, `CLAUDE_GATE_STATE`,
    `CLAUDE_GATE_RESOLVE` (`~/.claude/hooks/gate.sh:34-38`), `CLAUDE_PROFILE_BIN`
    (`~/.claude/hooks/session-start.sh:36`, `~/.claude/hooks/session-end.sh:22`),
    `QMD_REFRESH_SYNC` (`~/.claude/bin/qmd-refresh:35`), `QMD_SYNC_PROFILE_BIN`
    (`~/.claude/bin/qmd-sync-main:29`).
  - Проверки по живым репозиториям Auction, Atakama и worfy пропускаются строкой `skip …`, когда
    репозитория нет (`~/.claude/bin/tests/profile.test.sh:59`, `:83`, `:94`).
  - `~/.claude/bin/tests/atakama-tickets.test.sh` проверяет `profiles/atakama/bin/tickets.mjs`, а
    `~/.claude/bin/tests/production-check.test.sh` — `deploy.production_check` Profile-а auction.
    Это код личных Profile-ов, а не Harness.
  - Скрипты `qmd-mcp`, `qmd-refresh`, `qmd-sync-main` написаны на zsh.
- CI (`.github/workflows/ci.yml`) на `ubuntu-latest` гоняет `pnpm lint`, `pnpm typecheck` и vitest
  (`pnpm test`); shell-test-ов в нём нет.
- `eslint .` применяет `js.configs.recommended` ко всем `.mjs` (`eslint.config.js:82`), а глобальные
  имена Node даёт только `src/main`, `src/preload`, `test` и конфигам (`eslint.config.js:84-87`).
  `harness/hooks/gate-resolve.mjs` и `harness/hooks/guard.mjs` попадут в линт без них.
- Реестр Gate (`~/.claude/gate/config.json`, запись `worfy`) запускает корневые скрипты, только если
  дифф задел файл по `root_if`: TS/JS/CSS/HTML, `package.json`, `tsconfig*`, `eslint*`,
  `pnpm-*.yaml`. Файлы `.sh`, `.md` и скрипты без расширения туда не входят: по диффу только в
  `harness/` Gate fast ответит «ничего не прогналось», если не задан `GATE_SCOPE=all`.
- PR-ы worfy вливаются squash-ем (`~/.claude/skills/ship-ticket/SKILL.md:252`,
  `gh pr merge <N> --squash`). Squash склеил бы импортированную историю в один коммит.
- Claude Code не грузит `CLAUDE.md` из корня plugin-а (`claude plugin validate` предупреждает). А
  `CLAUDE.md` в подпапке репозитория он подмешивает Session, которая читает файлы этой подпапки.
  Значит, правила Harness под именем `CLAUDE.md` внутри `harness/` попадали бы в Session-ы,
  правящие `harness/`.

## Что делаем

1. **Что импортируется** (Q19). Только эти файлы, из `~/.claude` в `harness/`:

   | Источник в `~/.claude` | Цель в репозитории |
   |---|---|
   | `CLAUDE.md` | `harness/rules/global.md` |
   | `agents/implementer.md`, `agents/reviewer.md`, `agents/scout.md` | `harness/agents/` |
   | `skills/{epic-wave,ship-ticket,retro,qmd,overnight-fix-loop,continuous-audit,tickets-to-tasks}/SKILL.md` | `harness/skills/<имя>/SKILL.md` |
   | `bin/profile`, `bin/ticket`, `bin/epic-status`, `bin/preflight`, `bin/worktree-lock`, `bin/epic-board`, `bin/qmd-mcp`, `bin/qmd-refresh`, `bin/qmd-sync-main`, `bin/ТИКЕТЫ.md` | `harness/bin/` |
   | `bin/tests/{preflight,profile,qmd,skill-blocks,tickets-root}.test.sh` | `harness/bin/tests/` |
   | `hooks/gate.sh`, `hooks/gate-resolve.mjs`, `hooks/guard.mjs`, `hooks/session-start.sh`, `hooks/session-end.sh`, `hooks/stop.sh` | `harness/hooks/` |
   | `hooks/tests/{gate-notverified,gate-unregistered,session-hooks}.test.sh` | `harness/hooks/tests/` |
   | `profiles/README.md` | `harness/profiles/README.md` |

   `CLAUDE.md` получает другое имя по причине из последнего пункта «Что происходит». Части правил
   для hooks из него делает Ticket 05. Контракт Profile (`profiles/README.md`) — общий документ
   Harness: на него ссылается `~/.claude/CLAUDE.md:18`, его меняет Ticket 11. Скрипты `qmd-*`
   входят в Harness по Q5 и Q15; подключает их Ticket 17. Содержимое файлов не меняется, кроме
   test-ов (пункт 3).

   **Не импортируются** — ни сами файлы, ни их история: `bin/telegram-mcp`,
   `bin/auction-staging-db-mcp`, `bin/agent-time-split` (личные, Q19);
   `bin/tests/atakama-tickets.test.sh`, `bin/tests/production-check.test.sh` (test-ы кода личных
   Profile-ов, остаются с Profile-ами); `agents/atakama-*`, `agents/auction-*`, `hooks/atakama-*`
   (удалены раньше, принадлежали отдельным Project-ам); `settings.json`, `gate/`,
   `profiles/{worfy,auction,atakama}/` (состояние машины; его переносят Ticket-ы 11 и 14); личные
   skills и `skills/synced/`.
2. **Импорт с историей** (Q3). Работа идёт на временном clone `~/.claude`, сам `~/.claude` не
   меняется. В clone остаются только пути из таблицы, и они переезжают в `harness/` с самого
   первого коммита: `git log --follow harness/<путь>` ведёт до перенесённого 331a6ca («Snapshot of Claude Code
   workflow before generalization»). Коммиты, в которых не
   осталось изменений, выпадают. В сообщение каждого перенесённого коммита дописывается строка
   `Imported-from: ~/.claude <полный SHA>`: SHA меняются, а уроки ищут коммит по старому SHA через
   `git log --grep`. Инструмент выбирает исполнитель (`git filter-repo`, если есть, иначе
   встроенный `git filter-branch --index-filter … --msg-filter … --prune-empty`); выбор — в «Итог».
   Затем ветка `worfy-harness/02` вливает результат: `git merge --allow-unrelated-histories`.
   SHA коммита `~/.claude`, с которого сделан импорт (база), — в «Итог» и в `harness/README.md`.
3. **Test-ы Harness — в `pnpm test` и в CI.**
   - В каждом test-е скрипт под проверкой ищется рядом с test-ом
     (`$(dirname "$0")/..`), а не в `$HOME/.claude`; `BIN_DIR` и `HOOKS_DIR` по-прежнему его
     переопределяют. Test сам ставит переопределения из «Что происходит» (`CLAUDE_TICKET_BIN`,
     `CLAUDE_PROFILE_BIN`, `CLAUDE_GATE_RESOLVE`, `QMD_REFRESH_SYNC`, `QMD_SYNC_PROFILE_BIN` и
     другие) на копии в `harness/`, а реестр, состояние Gate и Profile-ы — на временные папки. Сами
     скрипты в этом Ticket-е не меняются: их пути по умолчанию переводит на plugin Ticket 08.
   - Проверки по живым репозиториям идут, только когда есть и репозиторий, и живой реестр Gate;
     иначе — строка `skip …`, как сейчас. Руками с настоящим `HOME` они идут, как раньше:
     `bash harness/bin/tests/profile.test.sh`.
   - Новый contract test `test/contract/harness-scripts.test.ts` находит
     `harness/{bin,hooks}/tests/*.test.sh` и запускает каждый отдельным case-ом: `bash <файл>` с
     `HOME` во временной пустой папке, с пределом времени на файл; ждёт код 0, при ошибке печатает
     хвост вывода. Так test-ы Harness идут в `pnpm test`, то есть в CI на Linux и в Gate. В пустом
     `HOME` нет настроек git: test, который делает коммиты, задаёт автора через env
     (`GIT_AUTHOR_NAME`, `GIT_COMMITTER_NAME` и адреса).
   - Test падает на Linux из-за команды, которая есть только в macOS, — переносимая правка в этом
     скрипте (образец — `fstat` в `~/.claude/hooks/stop.sh:74`). Каждая такая правка — в «Итог».
   - На `ubuntu-latest` нет `zsh` — шаг его установки в `.github/workflows/ci.yml`. В CI test-ы не
     пропускаются из-за отсутствующих `zsh`, `jq`, `git`, `node`.
4. **Манифест plugin-а** (Q2, Q19). `harness/.claude-plugin/plugin.json`: `name` — `worfy`,
   описание, зависимость от `mattpocock-skills` (marketplace `claude-plugins-official`, так он
   включён в `enabledPlugins` `~/.claude/settings.json`; его skills зовут `continuous-audit` и
   `tickets-to-tasks`). Формат поля — по docs plugins-reference. Поля `version` нет: его пишет сборка
   (Ticket 04). `hooks/hooks.json` (Ticket 05) и `.mcp.json` (Ticket 17) здесь не заводятся.
5. **ESLint.** `harness/**/*.{js,mjs}` линтятся с глобальными именами Node (блок в
   `eslint.config.js`). Если правила находят настоящую ошибку в `.mjs` Harness — минимальная правка,
   каждая в «Итог»; поведение скриптов не меняется (их test-ы зелёные).
6. **`harness/README.md`** — по-английски, как будет весь Harness (ADR-0044): что лежит в папке,
   база импорта, как найти коммит по старому SHA `~/.claude`, как запустить test-ы. Указать, что до
   Ticket-а 16 `harness/` на Session-ы не действует: Wave-ы E3 идут на замороженном `~/.claude`.
7. **Заморозка и влитие** (Q13, Q33). После мержа исходник Harness — `harness/`, а Harness в
   `~/.claude` заморожен до Ticket-а 16; правило уже записано в Profile worfy
   (`~/.claude/profiles/worfy/rules.md`, раздел «Harness во время E3»). Этот Ticket `~/.claude` не
   меняет, реестр Gate тоже. Перед мержем исполнитель проверяет, что после базы импорта в
   `~/.claude` не было коммитов в импортированные файлы; были — импортирует их тем же способом.
   - PR вливается merge-коммитом (`gh pr merge <N> --merge`), не squash. Ветку на свежий `main`
     переносит `git merge origin/main`, а не rebase.
   - Строку `root_if`, которая включает `harness/` в Gate, исполнитель предлагает в «Итог». Её
     вносит владелец; до того Ticket-ы, которые правят только `harness/`, гоняют Gate с
     `GATE_SCOPE=all`.

**Не входит:** перевод на английский, пути через `${CLAUDE_PLUGIN_ROOT}`, состояние в
`~/.claude/worfy-harness/` (Ticket-ы 05–08); `hooks/hooks.json` (05); версия (04); установка
plugin-а (13); перенос и уборка `~/.claude` (14, 16); qmd (17).

## Готово, когда

- [ ] Импортированные файлы совпадают с базой побайтно и сохраняют права: для каждой пары таблицы, кроме test-ов, `git -C ~/.claude show <база>:<источник> | cmp -s - <цель>` — exit 0; `test -x` для каждого скрипта `harness/bin/*` (кроме `ТИКЕТЫ.md`) и `harness/hooks/*` — exit 0.
- [ ] История на месте: последняя строка `git log --format=%s -- harness/skills/epic-wave/SKILL.md` — «Snapshot of Claude Code workflow before generalization»; `for s in 364070b 70b50c4 8d2fbea f0132fb ec8412c f5f0cbb; do [ "$(git log --format=%h --grep="Imported-from: ~/.claude $s" | wc -l)" -eq 1 ] || exit 1; done` — exit 0.
- [ ] Лишнего нет ни в дереве, ни в истории: `git log --format= --name-only HEAD -- harness | grep -E 'telegram-mcp|auction-staging-db-mcp|agent-time-split|atakama|auction-|production-check|settings\.json|gate/|profiles/(worfy|auction|atakama)/'` — exit 1; `git log -p HEAD -- harness | grep -E 'ghp_|gho_|github_pat_|sk-ant-'` — exit 1.
- [ ] `harness/.claude-plugin/plugin.json`: `name` — `worfy`, зависимость `mattpocock-skills`, поля `version` нет. Проверяет `test/contract/harness-plugin.test.ts`. `claude plugin validate harness` бинарём SDK — exit 0, предупреждения — в «Итог».
- [ ] `pnpm test test/contract/harness-scripts.test.ts` — exit 0 локально; в CI PR тот же файл зелёный на Linux, все test-ы Harness прошли, без пропусков из-за отсутствующих `zsh`, `jq`, `git`, `node`.
- [ ] Test-ы не трогают настоящий `~/.claude`: вывод `git -C ~/.claude status --porcelain` одинаков до и после `pnpm test` (пустым он быть не обязан: 2026-10-07 там `?? skills/synced/` — личная папка, Q19).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный; перед мержем `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` под замком e2e — exit 0 и «[gate] зелено».
- [ ] На момент мержа `~/.claude` не менял импортированные файлы после базы: `test -z "$(git -C ~/.claude log --format=%h <база>..HEAD -- CLAUDE.md agents/implementer.md agents/reviewer.md agents/scout.md skills/epic-wave skills/ship-ticket skills/retro skills/qmd skills/overnight-fix-loop skills/continuous-audit skills/tickets-to-tasks bin hooks profiles/README.md)"` — exit 0.
- [ ] После мержа импортированные коммиты — в `main`: `git log origin/main --format=%h --grep='Imported-from: ~/.claude 331a6ca' | wc -l` печатает 1.

## Тесты

Сначала падающий test — `test/contract/harness-scripts.test.ts`: он ждёт не меньше 8 файлов
`harness/{bin,hooks}/tests/*.test.sh`. На нынешнем main папки `harness/` нет — test красный. В
«Итог» — как он падал.

- `test/contract/harness-scripts.test.ts` — новый: каждый shell-test Harness с пустым временным
  `HOME`.
- `test/contract/harness-plugin.test.ts` — новый: поля `plugin.json`; в `harness/` нет файлов из
  списка «Не импортируются».
- Изменённые shell-test-ы — те, что в таблице; новых сценариев в них нет, только поиск скриптов и
  env.

## Где в коде

Импорт (новые файлы; исходный путь — в таблице «Что делаем», пункт 1):

- `harness/rules/global.md` (новый; из `~/.claude/CLAUDE.md`)
- `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/agents/scout.md` (новые)
- `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/skills/retro/SKILL.md`, `harness/skills/qmd/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`, `harness/skills/continuous-audit/SKILL.md`, `harness/skills/tickets-to-tasks/SKILL.md` (новые)
- `harness/bin/profile`, `harness/bin/ticket`, `harness/bin/epic-status`, `harness/bin/preflight`, `harness/bin/worktree-lock`, `harness/bin/epic-board`, `harness/bin/qmd-mcp`, `harness/bin/qmd-refresh`, `harness/bin/qmd-sync-main`, `harness/bin/ТИКЕТЫ.md` (новые)
- `harness/bin/tests/preflight.test.sh`, `harness/bin/tests/profile.test.sh`, `harness/bin/tests/qmd.test.sh`, `harness/bin/tests/skill-blocks.test.sh`, `harness/bin/tests/tickets-root.test.sh` (новые; правится поиск скриптов)
- `harness/hooks/gate.sh`, `harness/hooks/gate-resolve.mjs`, `harness/hooks/guard.mjs`, `harness/hooks/session-start.sh`, `harness/hooks/session-end.sh`, `harness/hooks/stop.sh` (новые)
- `harness/hooks/tests/gate-notverified.test.sh`, `harness/hooks/tests/gate-unregistered.test.sh`, `harness/hooks/tests/session-hooks.test.sh` (новые; правится поиск скриптов)
- `harness/profiles/README.md` (новый)

Свои файлы Ticket-а:

- `harness/.claude-plugin/plugin.json` (новый)
- `harness/README.md` (новый)
- `test/contract/harness-scripts.test.ts` (новый)
- `test/contract/harness-plugin.test.ts` (новый)
- `eslint.config.js`
- `.github/workflows/ci.yml` — только если на `ubuntu-latest` нет `zsh`

Не меняются: `~/.claude` (только читается), реестр Gate, `src/`. Общих файлов с Ticket-ами 01,
03 и 10 (та же Wave) нет.

## Итог

Заполняется при закрытии.
