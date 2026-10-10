# Передача контекста — снимок на 2026-10-10 (UTC), main @ 88e5834

## Сейчас в работе

- `worfy-harness` (E3: Harness — правила, skills, agents и скрипты владельца — становится plugin-ом worfy; [spec](.scratch/worfy-harness/spec.md)): влиты 01–25 и 30, `epic-status` — 26/30; 26 — приёмка E3, `blocked`; 27 (платная часть eval) ждёт 28; 29 — после 27 и 28.
- `worfy-week` (неделя работы владельца из worfy; [spec](.scratch/worfy-week/spec.md)): влиты 17 из 18. Ticket 14 (перетаскивание без фризов) отложен владельцем, `blocked`; работа — только в локальной ветке `wip/worfy-week-14` («Итог» Ticket-а 14).
- Stable copy и plugin `worfy` — сборка `df8e870` (2026-10-09). Откат машины на plugin — «Итог» `worfy-harness` 16.
- `worfy-link` (Project одной Machine ведётся с другой по локальной сети; [spec](.scratch/worfy-link/spec.md)) начат, пока E3 ждёт: влиты 01–15, `epic-status` — 15/16; 11 — «Add project» на Linked machine (PR #196), вход в gh — только `local`. Осталась приёмка 16.
- `worfy-windows` (полный порт под Windows; spec, ADR 0054–0057): влиты 01, 02, 08 и 09 (PR #172, #177, #200 — пути и папки, #194 — окружение агента из реестра), ответы владельца — PR #192. Session на Windows-ПК ведёт 11; gate full — на Mac. 03–07 ждут закрытия E3.
- `worfy-terminal-ai` (Terminal AI в Terminal-ах на подписке; [spec](.scratch/worfy-terminal-ai/spec.md), ADR-0058) 01, 02 влиты (PR #204, #205); следом 03. 08 ждёт `worfy-ui` 02 и 08 (окно Settings, Select), 09 — шаги владельца (`blocked`).
- `worfy-ui` (Settings, масштаб, боковая панель, режим фокуса, палитра, Select, сочетания; [spec](.scratch/worfy-ui/spec.md)) 12 Ticket-ов: влиты 01, 02, 07, 08 (PR #207, #209, #210, #208) — Wave 1. До 09 — долг Select из «Итог» 08. 11 ждёт `worfy-windows` 11.
- `worfy-review` (приёмы ponytail, pstack и Thermos в ревью и implementer Harness; [spec](.scratch/worfy-review/spec.md)) — 1/7: 01 влит (PR #220). 03 (PR #221) и 05 (PR #222) — `VERIFIED`, `blocked`: 03 ждёт gate full на Windows-ПК, 05 — мержа PR #215, затем rebase и gate full на Mac и Windows-ПК.

## Ждёт владельца

- `worfy-harness` 26 (приёмка E3): код приёмки (PR #211) — второй `REJECTED` (гонка двух `lock-run`); узкий круг листовому Ticket-у — решение владельца.
- Приёмка E3, пункты 1 и 2 — прогон в песочнице после слова владельца (вход есть с 2026-10-10, Ticket 30 влит); тот же вход открывает `claude plugin validate` и живые проверки `worfy-harness` 05–08; пункт 5 (второй пользователь macOS) отложен владельцем 2026-10-10.
- Подтвердить решения, принятые без владельца (пометки «подтвердить» в «Итог» Ticket-ов): `worfy-week` 03–07, 09, 10, 12, 15, 17, 18; `worfy-harness` 01, 02, 04–09, 11–14, 17, 19, 20, 23, 27; `worfy-terminal-ai` 01, 02; `worfy-link` 01–06, 08–15.
- `worfy-review`: подтвердить три решения плана без владельца ([spec](.scratch/worfy-review/spec.md), «Решения владельца»): plugin-ы не ставим, источник с SHA, дословно — с MIT; без слов заглавными; max-review (07) — по просьбе или пометке риска. Ещё — «Итог» 01; gate full 03 и 05 на Windows-ПК.
- `worfy-link` 08: подтвердить, что с включённым доступом Linked machine может в Project-ах всё — Terminal, Session с `bypassPermissions`, ответы на разрешения (ADR-0052 п.6).
- `worfy-link` 08: должно ли выключение доступа останавливать Session-ы, Autopilot и очередь, запущенные Linked machine раньше (spec и ADR-0052 расходятся) — [Ticket 08](.scratch/worfy-link/issues/08-доступ-linked-machine-к-project-ам.md), «Итог».
- `worfy-link` 02: вручную — dev-сборка и Stable copy находят друг друга по Bonjour и связываются по коду; появился ли запрос Local Network и на каком шаге — [Ticket 02](.scratch/worfy-link/issues/02-link-a-machine-код-список-и-отзыв.md), «Итог».
- Вопросы: `worfy-harness` 05 — как давать «Standing authorization» и переводить ли подписи блока статуса; 08 — смысл фразы `continuous-audit/SKILL.md:228-229`; `worfy-daily` 25 — MCP prompt в slash-меню; `worfy-week` 17 — relaunch после таймаута `halt`.
- `worfy-harness` 17: включить qmd — обновить plugin, записать согласие на модели, `qmd-collections worfy` и `auction` (у `auction` путь `update:` ведёт в удалённый `~/.claude/bin`) — [Ticket 17](.scratch/worfy-harness/issues/17-qmd-модели-и-коллекции-в-harness.md), «Итог».
- Личное в истории: `worfy-harness` 01 — коммиты PR #106 с UUID аккаунта (чистит только поддержка GitHub); 02 — пути `/Users/alexey/Work/…` в `harness/` и в истории импорта. Ответ — в «Итог» Ticket-ов.
- Мусор на машине: удалить ли 13 папок транскриптов spike-а `~/.claude/projects/*worfy-harness-probe*` (`worfy-harness` 01) `~/.claude/worfy-harness/worktree-sessions/` (`worfy-harness` 11).
- Мусор от проб `worfy-harness` 22: `~/.claude/projects/-private-tmp-worfy-harness-w10-impl-22-{probe-t0,p7-repo}/` и пустые `~/.claude/session-env/*` — удалить ли.
- Реестр Gate и Profile worfy вне репозитория: в `root_if` записи `worfy` дописать `|^harness/|(^|/)HANDOFF\.md$` («Итог» `worfy-harness` 02); в Profile `docs.handoff.check` — `node scripts/check-handoff.mjs`, в `rules.md` убрать «скрипта проверки … пока нет».
- Проверки только для владельца: знак worfy в Dock и Finder (`worfy-daily` 31), щелчок по баннеру с выключенным Focus (`worfy-mvp` 21), запрос разрешения на уведомления (`worfy-daily` 03), трекпад в Terminal (`worfy-daily` 13), fish (`worfy-mvp` 06).
- На экране висят неотвеченные системные окна: Automation «"claude" wants access to control "Finder"» и `universalAccessAuthWarn` о Screen Recording (`worfy-daily` 03 и 31, «Ручная проверка 2026-10-07»).

## Риски и долги

- Каждый мерж, который трогает `harness/`, кончается `pnpm install:stable` вне прогона Autopilot (ADR-0047): без пересборки Stable copy влитый урок не действует.
- Atakama пойдёт через полный предполёт Harness с `git fetch`. На живых репозиториях Atakama это не проверено, только на клонах (`worfy-harness` 11).
- [med] С plugin-ом оживают долги про `gh`: Stop hook зовёт `gh` по имени, и `bin/gh` plugin-а подменит учётную запись (`worfy-harness` 01); `preflight` советует `gh auth switch` вместо `GH_TOKEN` (`worfy-week` 01).
- [med] `harness/bin/tests/preflight.test.sh` не изолирует `HOME` и пишет замки в настоящий `~/.claude/worfy-harness/` (`worfy-harness` 11). Запускать его только с `HOME` и `HARNESS_HOME` во временном каталоге.
- [med] Contract test-ы читают настоящий `~/.claude/settings.json`: если там `model: haiku`, падают 10 test-ов (`worfy-daily` 07 и 23).
- Нестабильные e2e роняют `gate full` (2026-10-09): `binding.spec.ts:272` (узел Ticket-а 12 не виден за 5 s под нагрузкой; отдельно 3 из 3), `autopilot.spec.ts:485` («Force stop during the Wave's turn»: app не закрылся за quit timeout; один раз в gate PR #201). Сводка — «Итог» `worfy-week` 06.
- Пока не сделан пункт о реестре Gate и Profile, Gate `fast` и CI не проверяют PR, где изменён только `HANDOFF.md`: перед его push — `node scripts/check-handoff.mjs`. PR только в `harness/` гоняют Gate с `GATE_SCOPE=all`.
- Gate `fast` с сужением по диффу не видит `scripts/` и `test/fixtures/` (`worfy-mvp` 01). Перед мержем — `GATE_SCOPE=all gate.sh full` на ветке: e2e и `.app` идут только локально ([ci-merge.md](docs/lessons/ci-merge.md)).
- Contract test-ы с дочерними процессами (`github-prs`, `harness-qmd`, `workflow-reader`, `docs`) при load 6–8 не укладываются в 15 s: gate fast параллельных исполнителей краснел.
- Ложный таймаут первого окна в e2e: заблокированный экран, параллельные e2e, окно macOS «восстановить окна?» (с PR #179 test-ы его отключают; на Mac владельца ещё и `defaults` для `com.github.Electron`) — [agents.md](docs/lessons/agents.md).
- Замок e2e держащий обновляет `touch`-ем раз в 5 минут (`rules.md` Profile-а worfy, 2026-10-09): без этого соседняя очередь снимала живой замок.
- Долги low — в «Итог» Ticket-ов (абзацы «Долг» и подраздел «Долги из HANDOFF (2026-10-08)»), разбор — шаг документов при закрытии Epic-а.

## Дальше

- `worfy-harness` 28 (git и `HARNESS_HOME` в прогонах eval) открывает платную часть 27; 29 — карта «кейс eval → файлы правил» и правило частоты eval. `worfy-windows` 18 — Windows Session после 11.
- Приёмки `worfy-harness` 26 и `worfy-link` 16 (связь dev-сборки со Stable copy) — вместе с владельцем, не в Autopilot.
- Ручные проверки на Stable copy одним блоком, пока владельца нет за Mac-ом: `worfy-week` 02, 05, 08–12, 15–18, `worfy-harness` 18 (две Session после `pnpm install:stable`), 19, 21, 24, 25 (проверка 08 закрывает и 03, проверка 10 — и `worfy-daily` 11). Шаги — пункты «(вручную)» Ticket-ов.
- Ждут условия (проверит агент): упор в Limits (`worfy-daily` 05), наблюдатель касаний (`worfy-daily` 04), workflow-скрипт в Autopilot (`worfy-daily` 29, 17), бейджи у Ticket-а с открытым PR (`worfy-mvp` 17, `worfy-week` 01).
- Неделя работы владельца из Stable copy (условие 4 E2 и цель `worfy-week`): каждый дефект и каждое вмешательство человека — Ticket `worfy-week`, следующий номер 19.
- Кандидаты в Ticket-ы: `done` с невлитой ветки, `reader.ts:329` (`worfy-harness` 22); [med] Project по первому совпадению пути в `checks.ts:69` и ещё два долга `worfy-harness` 23 — его «Итог».
- Ещё кандидаты: изоляция `preflight.test.sh` (`worfy-harness` 11), абсолютный путь к `gh` (`worfy-harness` 01), PATH с node в hook-е `gh-token-env.sh` (`worfy-harness` 18), панель выделения поверх шапки рамки (`worfy-week` 10).
- После E3 — `worfy-link` (ведёт Session на Mac) и `worfy-windows` (Session на Windows-ПК) параллельно. PR Windows с общим кодом получают метку `needs-mac-gate`, их вливает Session на Mac (spec `worfy-windows`, Q30–Q33).
- E4 (подпись Developer ID и нотаризация) — после `worfy-link` и `worfy-windows` и только при первом внешнем пользователе ([roadmap](docs/roadmap.md)).

## Где остальное

- `worfy-mvp` (первая версия, 33/33) закрыт — [spec](.scratch/worfy-mvp/spec.md); где что в коде и долги — «Итог» его Ticket-ов.
- `worfy-daily` (E2, Autopilot, 32/32) закрыт — [spec](.scratch/worfy-daily/spec.md); условия 3 и 4 готовности E2 ещё не выполнены (`docs/roadmap.md`, E2).
- `worfy-week` (17/18, Ticket 14 отложен) — [spec](.scratch/worfy-week/spec.md); условия готовности на 2026-10-08 — «Итог» Ticket-а 12.
- Spec-и: [worfy-harness](.scratch/worfy-harness/spec.md), [worfy-link](.scratch/worfy-link/spec.md), [worfy-windows](.scratch/worfy-windows/spec.md), [worfy-review](.scratch/worfy-review/spec.md), [worfy-terminal-ai](.scratch/worfy-terminal-ai/spec.md), [worfy-ui](.scratch/worfy-ui/spec.md).
- Этапы E1–E4 — [roadmap](docs/roadmap.md).
- Исследования внешних проектов — [docs/research/](docs/research/).
- Решения — [docs/adr/](docs/adr/): 0001–0024 и 0029–0059, номера 0025–0028 не используются. Следующий свободный — 0060.
- Уроки — [docs/lessons/](docs/lessons/): `process.md`, `agents.md`, `ci-merge.md`, `testing.md`. Словарь терминов — [CONTEXT.md](CONTEXT.md). Дизайн — [F-SPEC](docs/design/F-SPEC.md).
- Реестр Gate живёт вне репозитория (`~/.claude/gate/config.json`, после переноса — `$HARNESS_HOME/gate/`); что в нём для worfy — «Итог» `worfy-mvp` 32.
- Прошлые снимки — `git log -p -- HANDOFF.md`; последний подробный, до сжатия 2026-10-08, — `git show 84684b5:HANDOFF.md`.
