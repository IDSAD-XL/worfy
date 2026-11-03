# 36 — Гарантии Harness под Codex: gate, guard-ы, read-only reviewer и scout

Type: task
Status: open
Blocked by: 35, 44
Source: [spec.md](../spec.md), «Гарантии workflow на Codex», «Решения владельца» (Q5); решение 08 ([08-harness-для-codex.md](08-harness-для-codex.md)); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «Гарантии Harness без механизма в Codex»); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), «Гарантии workflow на Codex»; [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Gate fast — на `TaskCompleted` и `TeammateIdle` (`harness/hooks/hooks.json:62`, `:73`); `Stop` блокирует конец
  хода, пока gate красный (`:84`, `harness/hooks/stop.mjs`); guard Bash — `PreToolUse` (`:133`,
  `harness/hooks/guard.mjs`); учёт Session — `SessionEnd` (`:113`, `harness/hooks/session-end.mjs`).
- Read-only у Claude — список `tools` агентов `reviewer` и `scout` без `Edit` / `Write` (`harness/agents/`).
- У Codex нет `TaskCompleted` и `TeammateIdle`, нет списка `tools` у агента; `Stop` / `SubagentStop` с block
  продолжают ход; вход hook-а несёт `agent_type`; `SessionEnd` — не дольше 3 s.
- Владелец 2026-11-02 (Q5): гарантии workflow на Codex — те же, что на Claude, без «только совет».

## Что делаем

1. **Gate до конца Ticket-а.** `stop.mjs` под Codex (признак во входе hook-а) запускает gate fast на `Stop` и на
   `SubagentStop` и блокирует конец хода с причиной, пока gate красный: ни агент, ни Subagent не заканчивают работу
   с красным gate. `TeammateIdle` на Codex охранять нечего: agent teams у Codex нет.
2. **Read-only reviewer и scout** — ровно как у Claude сейчас: нет tool-а правки файлов, shell остаётся.
   `guard.mjs` под Codex отказывает `PreToolUse` на `apply_patch` (`Edit`, `Write`), когда `agent_type` —
   `worfy-reviewer` или `worfy-scout`; shell-команды им разрешены, как reviewer-у Claude (`Bash` в его `tools`). Первый шаг — проверить по записям Ticket-а 30 и по
   `codex-rs/hooks` закреплённой версии, что `agent_type` приходит в `PreToolUse`. Если нет — запасной путь в этом же
   Ticket-е: reviewer и scout идут отдельным thread-ом Codex с sandbox `read-only` (решение Q5), который
   запускает `bin/` Harness через app-server.
   Оба пути проверяемы на фейке Ticket-а 44 до выбора: он исполняет hook-и и эмулирует sandbox `read-only` thread-а.
3. **Guard-ы Bash и записи** — те же правила `guard.mjs` с matcher-ами Codex (`Bash`, `apply_patch`). Случай
   `write_stdin` в уже открытую unified exec Session (hook его не видит, Ticket 04) закрывается так: guard
   отказывает в интерактивной exec Session с записью ввода для `worfy-*` агентов.
4. **`SessionEnd` ≤ 3 s** — под Codex `session-end.mjs` делает только быстрые шаги (учёт и снятие lock-а);
   долгое — в следующий `SessionStart`.
5. **Verdict-ы review** — те же скрипты `bin/` и `gh`; `GH_TOKEN` для shell Codex — через env процесса app-server,
   если `SessionStart` Codex не может выставить env (Ticket 04, «Чего не знаем»).
6. README Harness: раздел «On Codex» — как держится каждая гарантия.

Под Claude поведение hook-ов не меняется.

## Готово, когда

- [ ] Test-ы hook-ов Claude (`harness/hooks/tests/`, `test/contract/harness-*.test.ts`) проходят без правок ожиданий.
- [ ] Test скриптов Harness на входах Codex: `Stop` и `SubagentStop` с красным gate — block с причиной, с зелёным —
      без блока; `PreToolUse` `apply_patch` от `worfy-reviewer` и `worfy-scout` — deny, от `worfy-implementer` —
      разрешено; shell-команда от reviewer — разрешена, как у Claude; `session-end.mjs` под Codex укладывается в 3 s.
- [ ] Выбранный путь read-only (п. 2) и его доказательство записаны в Ticket-е.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm lint` и test-ы Harness — exit 0.

## Где в коде

- `harness/hooks/stop.mjs`, `harness/hooks/guard.mjs`, `harness/hooks/session-end.mjs`
- `harness/hooks/hooks.json` — `:62`, `:73`, `:84`, `:113`, `:133`
- `harness/hooks/tests/`
- `harness/README.md`
- `src/main/vendors/codex/session.ts` — `GH_TOKEN` в env app-server (раунд 1)

## Шаг 1: приходит ли `agent_type` в `PreToolUse`

Приходит — внутри Subagent-а. Путь read-only — **A** (отказ `guard.mjs` по `agent_type`); запасной путь B (отдельный
thread с sandbox `read-only`) не нужен.

- Закреплённая версия: `codex-rs/hooks/src/schema.rs` тега `rust-v0.166.0`, `PreToolUseCommandInput` — поля
  `agent_id: Option<String>` и `agent_type: Option<String>` (`skip_serializing_if = "Option::is_none"`); их заполняет
  `SubagentCommandInputFields::from(Option<&SubagentHookContext>)` — `Some` внутри Subagent-а, иначе поля нет.
- Живая запись Ticket-а 30: `test/fixtures/codex-messages/hooks/PreToolUse.jsonl`, строки 13 и 14 — `apply_patch` и
  `Bash` Subagent-а с `"agent_id":"…","agent_type":"default"`; у строк главного агента полей нет. Так же
  `SubagentStop.jsonl` несёт `agent_type`.
- Имя tool-а правки во входе — `apply_patch` (`codex-rs/core/src/tools/hook_names.rs`: `Edit` и `Write` — только
  алиасы matcher-а), shell — `Bash`; поэтому matcher guard-а — `Bash|apply_patch`.
- На фейке Ticket-а 44 (`hook-runner.mjs`) проверены оба пути до выбора: `codex-fake-hooks.test.ts` держит и deny по
  `agent_type`, и отказ thread-а `read-only`; выбран A, потому что он ровно повторяет Claude (нет tool-а правки, shell
  есть) и не требует второго thread-а.
- `write_stdin` hook не проходит: `codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs`,
  `pre_tool_use_payload` возвращает `None`; вход `exec_command` в `PreToolUse` — только `{"command": …}`, без `tty`
  (`exec_command.rs`). Поэтому guard судит по самой команде: интерактивный shell, интерпретатор или multiplexer без
  script-а агенту `worfy-*` запрещён.
- `SessionStart` Codex не может выставить env Session: `SessionStartCommandOutputWire` знает только
  `additionalContext` (`deny_unknown_fields`), аналога `CLAUDE_ENV_FILE` в `hooks/src/engine/` нет.

## Итог

- Codex ставит ту же папку Harness и исполняет тот же `harness/hooks/hooks.json` (отдельного файла hook-ов для Codex
  нет: `codex-install.ts` ставит plugin как есть, а Codex читает `hooks/hooks.json`, пока в manifest-е нет `hooks`).
  Поэтому правки — в общем файле, и под Claude они ничего не меняют:
  - `Stop` → `stop.mjs`: timeout 10 → 900 s (под Codex hook сам гоняет gate; под Claude это только потолок);
  - новое событие `SubagentStop` → `stop.mjs`, 900 s; под Claude `stop.mjs` на нём сразу выходит с кодом 0;
  - matcher `PreToolUse` guard-а `Bash` → `Bash|apply_patch`; у Claude tool-а `apply_patch` нет.
- `harness/hooks/codex-input.mjs` (новый): признак Codex во входе — `turn_id` (поле, которое schema Codex помечает
  «Codex extension»), а у `SessionStart` / `SessionEnd` — transcript `rollout-*.jsonl`; список read-only агентов.
- `stop.mjs`: под Codex в зарегистрированном проекте сначала `gate.mjs fast` с входом hook-а на stdin, потом прежняя
  логика по маркерам: красный — exit 2 с причиной на stderr (Codex продолжает ход с причиной). Сообщение модели без
  блока под Codex — `{"decision":"block","reason":…}`: Stop-вывод Codex не принимает `hookSpecificOutput`. Вне реестра
  gate не запускается и ничего не говорится — как у Claude, где gate идёт только на `TaskCompleted`.
- `guard.mjs`: под Codex `apply_patch` от `worfy-reviewer` и `worfy-scout` — deny с причиной, от остальных — разрешено;
  shell-команды всех агентов идут через прежние правила; агенту `worfy-*` запрещён старт интерактивного `sh`/`bash`/
  `zsh`/…/`pwsh`/`cmd`, `node`/`python3`/… и `tmux`/`screen`/`script` без script-а, `-c` или перенаправленного ввода.
- `session-end.mjs`: под Codex у вызова `bin/profile` (единственного шага, который ждёт; обычно ~0.1 s) — 2 s, так что
  hook укладывается в 3 s Codex и при зависшем `bin/profile`. Снятие lock-а — отдельный hook, как было.
- `harness/README.md`: раздел «On Codex» — как держится каждая гарантия.
- Test-ы: новый `test/contract/harness-codex-hooks.test.ts` (12) ставит Harness во временный `CODEX_HOME` и гоняет его
  hook-и движком фейка: Stop и SubagentStop с красным gate — block с причиной, с зелёным — без; gate запускает сам hook
  (файл verdict-а); вне реестра — ничего; `apply_patch` от reviewer и scout — deny, от implementer и главного агента —
  нет; записанный `apply_patch` Subagent-а с `agent_type` reviewer — deny; shell reviewer-а — по правилам Bash Claude;
  интерактивный shell агента Harness — deny; `SessionEnd` с зависшим `bin/profile` — в пределах 3 s; под Claude Stop
  gate не запускает, SubagentStop ничего не делает. На старых hook-ах красные 7 из 12.
- `harness/hooks/tests/rules-hooks.test.sh`: в снимке `hooks.json` три строки (timeout `Stop`, `SubagentStop`, matcher).
  Это ожидание формы файла, не поведения Claude; иначе Codex не получил бы ни gate, ни guard на `apply_patch`, потому
  что файл у них общий. Решено без владельца, подтвердить.

Решено без владельца, подтвердить:
- счётчик блоков `stop.mjs` (не больше 2 на Session) общий для `Stop` и `SubagentStop` одной Session Codex;
- для `worfy-*` запрещён любой интерактивный старт, не только тот, в который потом пишут: hook не видит, будет ли
  `write_stdin`; список программ — частый, в коде помечен `shortcut:`.

Не проверено до первого живого запуска: что Codex называет свой агент `worfy-reviewer` в `agent_type` именем из TOML
агента. В записи Ticket-а 30 есть только встроенный `default`; если имя придёт другим, deny по `agent_type` не сработает.

Фейк Ticket-а 44 читает только `hooks/hooks.json`; если Harness когда-нибудь даст Codex свой файл через `hooks` в
manifest-е, фейк надо научить (его `shortcut:` в шапке это и называет).

## Раунд 1

По review PR #1308 (`/tmp/worfy-mv-w13/review-36-refute.md`), после rebase на `origin/main` 93808b4b0:

- `stop.mjs`: счётчик блоков и файлы «один раз» под Codex — по `agent_id`, если он есть во входе, иначе по Session, как
  было. Subagent (вход несёт `session_id` родителя) больше не тратит блоки и заметки главного агента. `worfy-reviewer` и
  `worfy-scout` на красном gate по-прежнему держатся (ADR-0094, п. 6), но причина говорит им сообщить о красном gate, а
  не чинить. У вызова resolver-а — 10 s: под Claude зависание стоит столько же, сколько до 900 s в `hooks.json`.
- `guard.mjs`: для shell «команда дана» — только `-c` (у PowerShell и cmd — `-Command`, `-File`, `/c`), `-e`, `-p`, `-m`
  — только у интерпретаторов; `-v`, `-V`, `--version`, `-h`, `--help`, `--test`, `bash -n` пропускаются. В шапке и в
  README честно: запрет интерактивного shell — best effort и лексический, программу, которая читает ввод, всё ещё можно
  вести (`cat | bash`, `sh /dev/stdin`); закрыть полностью может только сам Codex.
- **`GH_TOKEN` (п. 5) сделан:** `src/main/vendors/codex/session.ts` берёт токен `github.account` Profile-а папки Session-а
  (`gh auth token -u <account>`, как PR tracker и как hook `gh-token-env.mjs` у Claude) и кладёт его в env процесса
  app-server; оттуда он идёт в каждый shell Session-а. Без account-а или без входа gh под ним — env worfy как раньше
  (свой `GH_TOKEN` worfy, если он есть, проходит). Токен не пишется в log; причина отказа называет только account.
  Решено без владельца, подтвердить: без account-а `GH_TOKEN` worfy не убирается (у Claude `agentEnv` его убирает).
- Страницы `docs/features/skills-agents-and-hooks.md` (matcher `Bash|apply_patch`, 900 s у `Stop`, строка
  `SubagentStop`) и `docs/features/gate-and-github.md` (на Codex gate запускают `Stop` и `SubagentStop`) — только
  английские.
- Test-ы: в `harness-codex-hooks.test.ts` +5 (два красных SubagentStop reviewer-а, потом Stop главного агента всё ещё
  блокирует; заметка give-up и заметка «not verified» в форме `{"decision":"block","reason":…}` с exit 0, каждая — и
  Subagent-у, и главному агенту; `SessionEnd` с быстрым profile пишет строку `pending-retro.log`; зависший resolver
  отпускает Stop Claude примерно через 10 s) и новые случаи guard-а (`node -v`, `node --test`, `bash --version`,
  `bash -n`, `python3 -V` проходят; `bash -e`, `sh -m` — нет). Новый `test/contract/codex-session-gh-token.test.ts` (5)
  на фейке app-server: токен account-а в env процесса, он сильнее `GH_TOKEN` worfy, без account-а — env как был, ошибка
  получения — строка log-а без токена. Mutant-ы каждой правки раунда (ключ по Session, формулировка reviewer-а, флаги
  без prompt-а, `-e` у shell, timeout resolver-а, токен не передан) — test-ы красные.
