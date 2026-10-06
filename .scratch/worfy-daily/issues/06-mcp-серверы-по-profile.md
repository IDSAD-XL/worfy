# 06 — MCP-серверы Session по списку из Profile

Type: task
Status: blocked — blocked by 05
Blocked by: 05
Source: [spec.md](../spec.md), тема B, риски 8 и 13; [ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md); [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md); [ADR-0020](../../../docs/adr/0020-profile-shared-and-personal-parts.md)

## Что делаем

ADR-0021: Session-ы, которые запускает worfy, получают только MCP-серверы из списка в Profile. По
умолчанию в списке `qmd` и `worfy-canvas`.

**Что сейчас.** `settingSources: ['user', 'project', 'local']` зашит жёстко
(`src/main/agent/options.ts:72`). Свой сервер `worfy-canvas` добавляется к серверам пользователя,
когда Session запущена в Project (`options.ts:90-92`). В итоге каждая Session получает 634 tools. На
haiku от этого падает «Prompt too long». Profile worfy не читает: `git grep` по `bin/profile`,
`profile.json` и `.claude/profiles` даёт 0 совпадений.

**Где сейчас лежит Profile.** Вне репозитория: `~/.claude/profiles/<имя>/profile.json`. Читает его
скрипт `~/.claude/bin/profile -C <root> --field a.b`. Коды выхода: 0 — поле есть, 3 — Project не
зарегистрирован, 4 — поля нет. Profile из двух частей и plugin Harness появятся только в E3
(ADR-0019, ADR-0020).

**Первый шаг — проверка, итог в «Итог» до кода.** Надо найти, как в SDK оставить `settingSources`
пользователя и при этом не отдать Session серверы вне списка. От пользователя должны по-прежнему
приходить `CLAUDE.md`, hooks и skills (ADR-0002). Проверка — на живой Session и на fixture-е
`system/init`: список tools и `mcp_servers`. Записать версии Claude Code и SDK. Заменить
`mcpServers` целиком нельзя: пропадёт нужный `qmd`.

**`src/main/workflow/profile.ts`** — runner по образцу runner-а `epic-status`
(`src/main/workflow/reader.ts:62-77`):

- `execFile` с `cwd` = корень Project; путь — `<claudeHome>/bin/profile` (`claudeHome` уже есть в
  `WatchOptions`);
- подставной `run` для test-ов (параметр `run` есть в `src/main/workflow/watch.ts:32`);
- коды 3 и 4, отсутствие скрипта и сломанный JSON — мягкий отказ: список по умолчанию, причина в
  лог.

**Поле списка в Profile.** Имя предлагает Ticket, например `mcp.allowed`, и записывает его в
«Итог». Поле в свой Profile и в `~/.claude/profiles/README.md` владелец вносит вручную: worfy в
`~/.claude` не пишет.

**`options.ts`.** Набор серверов Session = список Profile ∩ (серверы пользователя ∪
`worfy-canvas`). Список передаётся при создании Session (`src/main/agent/app-registry.ts`). Session
вне Project работает как раньше. Subagent-ы Session и Subagent-ы workflow-скриптов получают тот же
набор — наследование проверяется вживую.

**Замер.** Число tools в `system/init` до и после на Project worfy — в «Итог».

## Готово, когда

- [ ] В «Итог» записан способ ограничить серверы в SDK при `settingSources` пользователя, с версиями Claude Code и SDK.
- [ ] `profile.ts` покрыт test-ами на каждый случай: код 0 со списком, код 3, код 4, нет скрипта, сломанный JSON. Во всех отказных случаях — список по умолчанию `qmd` и `worfy-canvas`.
- [ ] Session в Project получает только серверы из списка, `worfy-canvas` — если он в списке. Session вне Project работает как раньше.
- [ ] (вручную) Живая Session на Project worfy: в `system/init` только серверы из списка. Число tools до и после — в «Итог».
- [ ] (вручную) Subagent этой Session и Subagent workflow-скрипта видят тот же набор серверов — по tools в их транскриптах. Итог — в «Итог».
- [ ] worfy не пишет в `~/.claude` и в репозиторий Project: test сравнивает деревья временных папок до и после.

## Тесты

- `test/contract/workflow-profile.test.ts` (новый) — подставной `run`: коды 0, 3, 4, нет скрипта, сломанный JSON. Образец — `test/contract/workflow-reader.test.ts`.
- `test/unit/agent-options.test.ts` — набор серверов: со списком, по умолчанию, Session вне Project.
- Сначала падающий test: Session в Project со списком `[qmd]` получает и серверы пользователя вне списка.

## Где в коде

- `src/main/workflow/profile.ts` (новый)
- `src/main/agent/options.ts`
- `src/main/agent/app-registry.ts`
- `test/contract/workflow-profile.test.ts` (новый)
- `test/unit/agent-options.test.ts` (из 02: файл создаёт Ticket 02)
