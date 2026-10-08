# 18 — `GH_TOKEN` аккаунта Project-а выдаёт hook `SessionStart`, skills без ручного `export`

Type: task
Status: done — 2026-10-08, [PR #147](https://github.com/IDSAD-XL/worfy/pull/147)
Blocked by: 01, 16
Source: решение владельца 2026-10-07, вопрос Q21 ([spec.md](../spec.md)); ADR-0048 (будет `docs/adr/0048-harness-plugin-spike-results.md`) — итог spike Ticket-а 01 (работает ли `GH_TOKEN` через `CLAUDE_ENV_FILE`; файл заводит Ticket 01); [ADR-0041](../../../docs/adr/0041-harness-rules-via-session-hooks.md) — hooks plugin `SessionStart`

## Что происходит

- **Ручной префикс в skills и agents.** Если глобальный аккаунт `gh` чужой, каждая команда `gh` и
  `git` по `origin` должна идти с `GH_TOKEN=$(gh auth token -u <github.account>)`. Это правило
  повторено в шести местах (исходник — `~/.claude/`; в `harness/` после Ticket-ов 06–08 — те же
  абзацы на английском):
  - `skills/epic-wave/SKILL.md:66-70` и строка брифа «GitHub:» — `:152`;
  - `skills/ship-ticket/SKILL.md:89-91`;
  - `agents/implementer.md:77-79`;
  - `agents/reviewer.md:99-100`;
  - `skills/overnight-fix-loop/SKILL.md:239` — там `export GH_TOKEN=…` перед `git push` и
    `gh pr create`.
- **Аккаунты на машине владельца.** Глобальный аккаунт `gh` — Oleksii-O-Atakama. Profile-ы worfy и
  Auction: `github.account: IDSAD-XL`. Агент забыл префикс — `gh` отвечает «Could not resolve to a
  Repository» (Ticket 01 `worfy-week`, «Что происходит»).
- **Свой `gh` worfy** токен уже получает: `accountAuth` (`src/main/github/prs.ts:95-112`) берёт его
  командой `gh auth token -u <account>` на каждое чтение. Аккаунт он читает через
  `readGithubAccount` (`src/main/workflow/profile.ts:163`).
- **Session-ы агентов токена не получают.** Окружение Claude Code — это env login shell
  (`src/main/agent/env.ts`, ADR-0007). `sessionOptions` кладёт его как есть (`src/main/agent/options.ts:96`).
  Собирается вызов в `src/main/agent/app-registry.ts:46-62`.
- **Hooks `SessionStart` сейчас:** `~/.claude/settings.json` → `hooks/session-start.sh` и
  `bin/worktree-lock claim`. После Ticket-а 05 они в `harness/hooks/hooks.json`.
  `session-start.sh` находит Project по `cwd` из JSON hook-а, иначе по `$PWD` (`:40-41`), через
  `bin/profile`.
- **`CLAUDE_ENV_FILE`.** Claude Code даёт hook-у `SessionStart` путь к файлу. Строки `export` из
  него действуют на команды Bash этой Session.
  - Решение Q21 опирается на то, что строка с подстановкой `$(gh auth token -u …)` вычисляется на
    каждой команде. Тогда токен не лежит на диске.
  - Так ли это, доходит ли переменная до Subagent-ов (и до Subagent-ов Workflow-скриптов) и
    работает ли это в Session-ах worfy через SDK — проверяет Ticket 01. Итог — в ADR-0048.

## Что делаем

Сначала прочитать ADR-0048.

- **Вариант А.** ADR-0048 говорит, что `CLAUDE_ENV_FILE` так работает. Делаем пункты 1–4.
- **Вариант Б.** ADR-0048 говорит, что не работает. Делаем запасной путь Q21 — пункт 5. Пункт 3 —
  в его форме для варианта Б.

Какой вариант сделан и почему — в «Итог».

1. **Hook `harness/hooks/gh-token-env.sh`** — новый, в `hooks.json` под `SessionStart` (Q21).
   - **Project и аккаунт.** Project — по `cwd` из JSON hook-а, иначе `$PWD`, как в
     `session-start.sh`. Аккаунт — `profile --field github.account`.
   - **Когда пишет строку.** Аккаунт есть, похож на логин GitHub (та же проверка, что `GITHUB_LOGIN`
     в `src/main/workflow/profile.ts:149`), и `gh auth token -u <аккаунт>` проходит (вывод
     выбрасывается). Тогда в `$CLAUDE_ENV_FILE` дописывается одна строка:
     `export GH_TOKEN="$(gh auth token -u <аккаунт> 2>/dev/null)"`.
   - **Токен не пишется никуда:** ни в файл, ни в stdout, ни в stderr, ни в `additionalContext`.
   - **Нечего делать — тихий выход с кодом 0.** Это случаи: нет аккаунта (коды 3, 4, `null`, пусто),
     нет `$CLAUDE_ENV_FILE`, нет `profile`.
   - **Аккаунт есть, входа в `gh` под ним нет.** Строка не пишется. В `additionalContext` — одна
     строка: аккаунт, «нет входа в gh», `gh auth login`. Код 0: Session не останавливаем.
   - Аккаунт Project-а в его Project-е важнее `GH_TOKEN`, который пользователь задал сам.
   - **`gh` не меняется.** Hook не зовёт `gh auth switch` и `gh auth login` и не пишет конфиг `gh`.
2. **Subagent-ы — по ADR-0048.**
   - Если переменная из `CLAUDE_ENV_FILE` доходит до Subagent-ов, ничего больше не нужно.
   - Если до какого-то вида не доходит (например, до Subagent-ов Workflow-скриптов), строка
     «GitHub:» брифа в epic-wave остаётся только для этого вида. Какой вид — в «Итог».
3. **Skills и agents без ручного `export`** (Q21). Абзацы из «Что происходит» заменяются одной фразой:
   - `GH_TOKEN` аккаунта Project-а ставит hook plugin `SessionStart`;
   - глобальный аккаунт `gh` не переключать;
   - `gh` ответил «Could not resolve to a Repository» — сверить `gh auth status` с `github.account`
     и сказать об этом в отчёте.

   В варианте Б абзац остаётся только для терминала без worfy, в форме «в терминале — `export
   GH_TOKEN=…` один раз».
4. **Токен не попадает в журнал, транскрипт и логи** (Q21). Это проверяют test-ы hook-а: в файле
   окружения, в stdout и stderr нет значения токена.
5. **Только вариант Б — запасной путь** (Q21).
   - worfy кладёт `GH_TOKEN` в env Session-а в Project-е с `github.account`. Место —
     `src/main/agent/app-registry.ts` до `sessionOptions`. Токен берут `readGithubAccount` и
     `accountAuth` — тот же путь, что у бейджей PR (Ticket 01 `worfy-week`).
   - Сбой — Session без `GH_TOKEN` и одна строка в лог, без токена.
   - Hook из пункта 1 не делается. В терминале остаётся ручной `export`.

ADR не нужен: выбор между А и Б записан в ADR-0048.

**Не входит:** выбор и запись аккаунта Project-а (Ticket 25); `gh` самого worfy (Ticket 01
`worfy-week`, уже сделано); git credential helper — правило о `git` по `origin` остаётся как есть.

## Готово, когда

- [x] `harness/hooks/tests/gh-token-env.test.sh`. Подменены `gh` (на `auth token -u` печатает метку `gho_TESTSENTINEL`) и `profile`. С аккаунтом `IDSAD-XL`:
  - код 0;
  - в `$CLAUDE_ENV_FILE` ровно одна новая строка `export GH_TOKEN="$(gh auth token -u IDSAD-XL 2>/dev/null)"`;
  - `bash -c 'source "$F"; printf %s "$GH_TOKEN"'` печатает метку.
- [x] Тот же test, тихие случаи — файл окружения не изменился, код 0: `profile` с кодом 3, с кодом 4, `null`, нет `$CLAUDE_ENV_FILE`, нет `profile`.
- [x] Тот же test: аккаунт без входа в `gh`. Файл не изменился. В stdout JSON с `additionalContext`, где названы аккаунт и `gh auth login`. Код 0.
- [x] Тот же test: аккаунт `x; touch pwned` (не логин GitHub). Ничего не записано, файла `pwned` нет, код 0.
- [x] Тот же test, во всех случаях:
  - метки нет ни в файле окружения, ни в stdout, ни в stderr;
  - в журнале подменённого `gh` нет `auth switch` и `auth login`.
- [x] `jq` по `harness/hooks/hooks.json` находит под `SessionStart` команду `${CLAUDE_PLUGIN_ROOT}/hooks/gh-token-env.sh`, код 0. Проверка — в том же test-е.
- [x] Вариант А: `grep -rnE 'gh auth token -u' harness/skills harness/agents` — код 1. В варианте Б — совпадения только в абзацах для терминала, их список — в «Итог».
- [ ] Только вариант Б: `test/unit/agent-query-factory.test.ts`:
  - Session в Project-е с аккаунтом получает в env `GH_TOKEN` от подменённого `gh auth token`;
  - без аккаунта — без `GH_TOKEN`;
  - при сбое — без `GH_TOKEN`, строка лога без значения токена.
- [x] test-ы hooks идут в CI worfy на Linux вместе с остальными (Ticket 02). CI PR-а зелёный.
- [ ] (вручную, после влития и `pnpm install:stable`, машина владельца уже на plugin) `gh auth status` показывает активным Oleksii-O-Atakama. При этом `gh api user --jq .login` даёт `IDSAD-XL` в двух местах:
  - в Session `claude` из терминала в `/Users/alexey/Stuff/CanvasForAI`;
  - в Session worfy Project-а worfy.

  Команды и ответы (без токена) — в «Итог».

Ручной пункт агент закрывает, только если может запустить обе Session. Если не может — «не
проверено: …» в «Итог» и пункт в HANDOFF, раздел «Ждёт владельца».

## Тесты

Сначала падающий test — `harness/hooks/tests/gh-token-env.test.sh`, случай «аккаунт есть»: на main
hook-а нет, файл окружения пуст, test красный. Как он падал — в «Итог».

- `harness/hooks/tests/gh-token-env.test.sh` — новый: все случаи hook-а. Написан на bash, `gh` и
  `profile` подменены. Сеть и macOS не нужны — идёт в CI на Linux.
- `test/unit/agent-query-factory.test.ts` — только в варианте Б.
- Правку текста skills и agents проверяет reviewer с линзой «смысл сохранён»: остальные правила
  абзацев не потерялись.

## Где в коде

- `harness/hooks/gh-token-env.sh` — новый
- `harness/hooks/hooks.json` (завёл Ticket 05; исходник записей — `hooks` в `~/.claude/settings.json`)
- `harness/hooks/tests/gh-token-env.test.sh` — новый
- `harness/skills/epic-wave/SKILL.md` (исходник — `~/.claude/skills/epic-wave/SKILL.md`)
- `harness/skills/ship-ticket/SKILL.md` (исходник — `~/.claude/skills/ship-ticket/SKILL.md`)
- `harness/skills/overnight-fix-loop/SKILL.md` (исходник — `~/.claude/skills/overnight-fix-loop/SKILL.md`)
- `harness/agents/implementer.md` (исходник — `~/.claude/agents/implementer.md`)
- `harness/agents/reviewer.md` (исходник — `~/.claude/agents/reviewer.md`)
- `harness/profiles/README.md`, строка `github.account` (исходник — `~/.claude/profiles/README.md:129`;
  если Ticket 11 положил контракт в другое место — там)
- `src/main/agent/app-registry.ts` — только вариант Б
- `test/unit/agent-query-factory.test.ts` — только вариант Б

Общие файлы с соседями после Ticket-а 16:
- `harness/skills/epic-wave/SKILL.md` — Ticket-ы 20 и 22;
- `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md` — Ticket 22;
- `harness/agents/reviewer.md` — Ticket 17;
- `harness/hooks/hooks.json` — Ticket 17 (и Ticket 22, только если он добавит hook `WorktreeCreate`);
- `harness/profiles/README.md` — Ticket-ы 17 и 22.

В одной Wave такие Ticket-ы идут последовательно.

## Итог

**Сделан вариант А.** ADR-0048, вопрос 2: строка `export GH_TOKEN="$(gh auth token -u <account>)"` в
`CLAUDE_ENV_FILE` исполняется перед каждой командой Bash — в главной Session, у Subagent-а
`general-purpose` и у агента workflow-скрипта, в SDK и в терминале. Запасной путь (пункт 5) не нужен,
`src/main/agent/app-registry.ts` и `test/unit/agent-query-factory.test.ts` не тронуты; пункт «Только
вариант Б» не относится.

- **Hook** `harness/hooks/gh-token-env.sh`, в `harness/hooks/hooks.json` под `SessionStart` (timeout 10).
  - Project — по `cwd` из JSON hook-а, иначе `$PWD`; аккаунт — `profile --field github.account`.
  - Проверка логина — то же правило, что `GITHUB_LOGIN` в `src/main/workflow/profile.ts`.
  - `gh auth token -u` в hook-е — только ради кода выхода, вывод выброшен; `GH_TOKEN`/`GITHUB_TOKEN`
    окружения hook-а на проверку не влияют (`env -u`).
  - Сверх тикета: строка не дописывается второй раз (повторный `SessionStart` при resume и `/clear`);
    файл без перевода строки в конце не склеивает `export` с последней строкой.
  - `gh` не установлен — как «нет входа»: строки нет, одна строка `additionalContext`, код 0.
- **Пункт 2 (Subagent-ы).** По ADR-0048 переменная доходит до всех видов Subagent-ов, поэтому
  строка «GitHub:» убрана из брифа epic-wave совсем (и из брифа verifier-а); исключений нет.
- **Пункт 3.** Абзацы в `harness/skills/epic-wave/SKILL.md`, `ship-ticket/SKILL.md`,
  `overnight-fix-loop/SKILL.md` (`export GH_TOKEN=…` перед `git push` убран), `harness/agents/implementer.md`,
  `reviewer.md` заменены одной фразой: `GH_TOKEN` ставит hook `SessionStart`; глобальный аккаунт не
  переключать (в skills — с прежним «без разрешения владельца: им пользуются другие Session-ы»); ответ
  «Could not resolve to a Repository» — сверить `gh auth status` с `github.account` и сказать в отчёте.
  Строка `github.account` в `harness/profiles/README.md` описывает hook.
  `grep -rnE 'gh auth token -u' harness/skills harness/agents` — код 1.
- **Text test-ы** поправлены под новый текст: `harness/bin/tests/agents-text.test.sh` (вместо метки
  «GitHub:» — правило про hook и про «Could not resolve…», нет `gh auth token -u`),
  `harness/bin/tests/epic-wave-ship-ticket.test.sh` (метки «GitHub:» в брифе нет),
  `harness/hooks/tests/rules-hooks.test.sh` (ожидаемый список hooks).
- **Как падал первый test.** `bash harness/hooks/tests/gh-token-env.test.sh` до hook-а: exit 1,
  `passed 73, failed 30` — «hook missing», «account with login: exit 127», «new lines: []».
  После — exit 0, `passed 103, failed 0`. Мутанты hook-а (без проверки логина; вывод
  `gh auth token` не выброшен; без защиты от второй строки; без `additionalContext` при отсутствии
  входа) — каждый краснит test.
- **Проверка с настоящим `gh` без Claude Code** (машина владельца, активный аккаунт
  Oleksii-O-Atakama): hook с `CLAUDE_ENV_FILE` во временном файле и `cwd` репозитория worfy — код 0, в
  файле одна строка `export GH_TOKEN="$(gh auth token -u IDSAD-XL 2>/dev/null)"`;
  `bash -c 'source <файл>; gh api user --jq .login'` — `IDSAD-XL`, в том числе при заданном
  `GH_TOKEN=dummy-user-token`.
- **Не проверено: ручной пункт** (после влития и `pnpm install:stable`, две Session — `claude` из
  терминала и Session worfy). Агент не пересобирает Stable copy и не запускает настоящий Claude Code;
  пункт ждёт владельца.

Гейт волны 9: `VERIFIED` с первого круга (PR #147, влит `650e054`) — два ревьюера: отчёт исполнителя и смысл
текстов skills и agents. Урок `docs/lessons/ci-merge.md` («Чужой глобальный аккаунт `gh`») переписан в
документном PR волны. Долги ревьюеров (не блокируют):
- [low] `harness/hooks/gh-token-env.sh:23-37` — нет блока PATH (nvm, `/opt/homebrew/bin`), как в
  `session-start.sh:28-34`. С голым PATH `bin/profile` без node не стартует, hook выходит с кодом 0 молча:
  ни `GH_TOKEN`, ни `additionalContext`, а ручного запасного пути в agents больше нет. На машине владельца
  у hooks PATH с node, поэтому сейчас не проявляется.
- [low] `harness/hooks/tests/gh-token-env.test.sh:109-114` — случай 1c не ловит удаление
  `env -u GH_TOKEN -u GITHUB_TOKEN` (`gh-token-env.sh:56`): подменённый `gh` не смотрит на `GH_TOKEN`.
- [low] `harness/bin/preflight:205` — подсказка `GH_WARN` советует `gh auth switch` (было и до Ticket-а).
- [low] `harness/skills/overnight-fix-loop/SKILL.md:246-248` — пропал случай «в Profile нет `github.account`»
  (теперь он только в `profiles/README.md:150`).
- [low] implementer.md, reviewer.md и три skills — подсказка про чужой аккаунт названа только для ошибки `gh`,
  не для `git push` с `Repository not found` / `Permission denied`.
