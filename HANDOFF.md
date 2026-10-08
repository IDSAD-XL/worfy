# Передача контекста — снимок на 2026-10-08 (UTC), main @ 87b0723

## Сейчас в работе

- `worfy-harness` (E3: Harness — правила, skills, agents и скрипты владельца — становится plugin-ом worfy; [spec](.scratch/worfy-harness/spec.md)): влиты 01–21, `epic-status` — 21/27; 27 — бесплатная часть влита, Ticket `blocked`.
- Wave 9 `worfy-harness` закрыта: 18 — `GH_TOKEN` аккаунта Project-а ставит hook `SessionStart`, ручной префикс из skills и agents убран (PR #147); 19 — экран первого запуска, действия только после Confirm (PR #148). Wave 8: 17 — qmd в plugin-е (PR #145), 20 — узкий круг ревью в Autopilot (PR #144).
- `worfy-harness` 16 сделан 2026-10-08: машина владельца на plugin `worfy` 0.2.0+77e4490 ([Ticket 16](.scratch/worfy-harness/issues/16-переход-машины-владельца-на-plugin.md)): откат и резервная копия — в «Итог». qmd в Session-ах нет, пока владелец не сделает шаги Ticket-а 17.
- `worfy-week` (неделя работы владельца из worfy; [spec](.scratch/worfy-week/spec.md)): влиты 17 из 18. Ticket 14 (перетаскивание без фризов) отложен владельцем, `blocked`.
- Работа над `worfy-week` 14 лежит только в локальной ветке `wip/worfy-week-14`, на GitHub её нет. Как вернуть Ticket — «Итог» Ticket-а 14.
- `worfy-link` (Project одной Machine ведётся с другой по локальной сети, 0/16) и `worfy-windows` (полный порт под Windows, 0/17) спроектированы: spec-и, ADR 0052–0056. Ждут закрытия E3.

## Ждёт владельца

- `worfy-harness` 16: подтвердить `attribution: on` у Atakama (Silent mode); при первом `claude` в терминале — что Limits снова приходят в worfy — [Ticket 16](.scratch/worfy-harness/issues/16-переход-машины-владельца-на-plugin.md), «Не проверено».
- Подтвердить решения, принятые без владельца (пометки «подтвердить» в «Итог» Ticket-ов): `worfy-week` 03–07, 09, 10, 12, 15, 17, 18; `worfy-harness` 01, 02, 04–09, 11–14, 17, 19, 20, 27.
- Вопросы: `worfy-harness` 05 — как давать «Standing authorization» и переводить ли подписи блока статуса; 08 — смысл фразы `continuous-audit/SKILL.md:228-229`; `worfy-daily` 25 — MCP prompt в slash-меню; `worfy-week` 17 — relaunch после таймаута `halt`.
- `worfy-harness` 17: включить qmd — обновить plugin, записать согласие на модели, `qmd-collections worfy` и `auction` (у `auction` путь `update:` ведёт в удалённый `~/.claude/bin`) — [Ticket 17](.scratch/worfy-harness/issues/17-qmd-модели-и-коллекции-в-harness.md), «Итог».
- `worfy-harness` 27: как дать прогонам eval git (brew git, правка Harness или ждать Claude Code) и когда гонять полный набор — [Ticket 27](.scratch/worfy-harness/issues/27-eval-кейсы-harness-через-plugin-eval.md), «Итог».
- Личное в истории: `worfy-harness` 01 — коммиты PR #106 с UUID аккаунта (чистит только поддержка GitHub); 02 — пути `/Users/alexey/Work/…` в `harness/` и в истории импорта. Ответ — в «Итог» Ticket-ов.
- Мусор на машине: удалить ли 13 папок транскриптов spike-а `~/.claude/projects/*worfy-harness-probe*` (`worfy-harness` 01) и `~/.claude/worfy-harness/worktree-sessions/` (`worfy-harness` 11).
- Реестр Gate и Profile worfy вне репозитория: в `root_if` записи `worfy` дописать `|^harness/|(^|/)HANDOFF\.md$` («Итог» `worfy-harness` 02); в Profile `docs.handoff.check` — `node scripts/check-handoff.mjs`, в `rules.md` убрать «скрипта проверки … пока нет».
- Проверки только для владельца: знак worfy в Dock и Finder (`worfy-daily` 31), щелчок по баннеру с выключенным Focus (`worfy-mvp` 21), запрос разрешения на уведомления (`worfy-daily` 03), трекпад в Terminal (`worfy-daily` 13), fish (`worfy-mvp` 06).
- На экране висят неотвеченные системные окна: Automation «"claude" wants access to control "Finder"» и `universalAccessAuthWarn` о Screen Recording (`worfy-daily` 03 и 31, «Ручная проверка 2026-10-07»).
- `worfy-harness` 26 (приёмка E3): один `/login` в песочнице (он же откроет `claude plugin validate` и живые проверки 05–08) и второй пользователь macOS — [Ticket 26](.scratch/worfy-harness/issues/26-приёмка-e3.md).
- `worfy-windows`: Session на Windows-ПК владельца, когда закроется E3 (ADR-0054).

## Риски и долги

- Каждый мерж, который трогает `harness/`, кончается `pnpm install:stable` вне прогона Autopilot (ADR-0047): без пересборки Stable copy влитый урок не действует.
- Atakama пойдёт через полный предполёт Harness с `git fetch`. На живых репозиториях Atakama это не проверено, только на клонах (`worfy-harness` 11).
- [med] С plugin-ом оживают долги про `gh`: Stop hook зовёт `gh` по имени, и `bin/gh` plugin-а подменит учётную запись (`worfy-harness` 01); `preflight` советует `gh auth switch` вместо `GH_TOKEN` (`worfy-week` 01).
- [med] `harness/bin/tests/preflight.test.sh` не изолирует `HOME` и пишет замки в настоящий `~/.claude/worfy-harness/` (`worfy-harness` 11). Запускать его только с `HOME` и `HARNESS_HOME` во временном каталоге.
- [med] Contract test-ы читают настоящий `~/.claude/settings.json`: если там `model: haiku`, падают 10 test-ов (`worfy-daily` 07 и 23).
- Нестабильный `test/e2e/epic-frame.spec.ts:721` «long names» роняет `gate full` и уже останавливал мержи; причина известна. Сводка нестабильных test-ов — «Итог» `worfy-week` 06.
- Пока не сделан пункт о реестре Gate и Profile, Gate `fast` и CI не проверяют PR, где изменён только `HANDOFF.md`: перед его push — `node scripts/check-handoff.mjs`. PR только в `harness/` гоняют Gate с `GATE_SCOPE=all`.
- Gate `fast` с сужением по диффу не видит `scripts/` и `test/fixtures/` (`worfy-mvp` 01). Перед мержем — `GATE_SCOPE=all gate.sh full` на ветке: e2e и `.app` идут только локально ([ci-merge.md](docs/lessons/ci-merge.md)).
- Ночной прогон: заблокированный экран Mac и параллельные e2e дают ложный таймаут первого окна. На ночь Mac разблокирован, крышка открыта ([agents.md](docs/lessons/agents.md)).
- Долги low — в «Итог» Ticket-ов (абзацы «Долг» и подраздел «Долги из HANDOFF (2026-10-08)»), разбор — шаг документов при закрытии Epic-а.

## Дальше

- Wave-ы `worfy-harness` на plugin-е по блокерам: 22 и дальше; платная часть 27 — после ответа про git — spec, раздел «Волны». Если E3 встанет — `worfy-link` (владелец разрешил начать, пока E3 ждёт).
- Ручные проверки на Stable copy одним блоком, пока владельца нет за Mac-ом: `worfy-week` 02, 05, 08–12, 15–18, `worfy-harness` 18 (две Session после `pnpm install:stable`), 19, 21 (проверка 08 закрывает и 03, проверка 10 — и `worfy-daily` 11). Шаги — пункты «(вручную)» Ticket-ов.
- Ждут условия (проверит агент): упор в Limits (`worfy-daily` 05), наблюдатель касаний (`worfy-daily` 04), workflow-скрипт в Autopilot (`worfy-daily` 29, 17), бейджи у Ticket-а с открытым PR (`worfy-mvp` 17, `worfy-week` 01).
- Неделя работы владельца из Stable copy (условие 4 E2 и цель `worfy-week`): каждый дефект и каждое вмешательство человека — Ticket `worfy-week`, следующий номер 19.
- Кандидаты в Ticket-ы: починка `epic-frame.spec.ts:721` (`worfy-week` 06), изоляция `preflight.test.sh` (`worfy-harness` 11), абсолютный путь к `gh` (`worfy-harness` 01), PATH с node в hook-е `gh-token-env.sh` (`worfy-harness` 18), панель выделения поверх шапки рамки (`worfy-week` 10).
- После E3 — `worfy-link` (ведёт Session на Mac) и `worfy-windows` (Session на Windows-ПК) параллельно. PR Windows с общим кодом получают метку `needs-mac-gate`, их вливает Session на Mac (spec `worfy-windows`, Q30–Q33).
- E4 (подпись Developer ID и нотаризация) — после `worfy-link` и `worfy-windows` и только при первом внешнем пользователе ([roadmap](docs/roadmap.md)).

## Где остальное

- `worfy-mvp` (первая версия, 33/33) закрыт — [spec](.scratch/worfy-mvp/spec.md); где что в коде и долги — «Итог» его Ticket-ов.
- `worfy-daily` (E2, Autopilot, 32/32) закрыт — [spec](.scratch/worfy-daily/spec.md); условия 3 и 4 готовности E2 ещё не выполнены (`docs/roadmap.md`, E2).
- `worfy-week` (17/18, Ticket 14 отложен) — [spec](.scratch/worfy-week/spec.md); условия готовности на 2026-10-08 — «Итог» Ticket-а 12.
- Spec-и открытых Epic-ов: [worfy-harness](.scratch/worfy-harness/spec.md), [worfy-link](.scratch/worfy-link/spec.md), [worfy-windows](.scratch/worfy-windows/spec.md). Этапы E1–E4 — [roadmap](docs/roadmap.md).
- Решения — [docs/adr/](docs/adr/): 0001–0024 и 0029–0056, номера 0025–0028 не используются. Следующий свободный — 0057.
- Уроки — [docs/lessons/](docs/lessons/): `process.md`, `agents.md`, `ci-merge.md`, `testing.md`. Словарь терминов — [CONTEXT.md](CONTEXT.md). Дизайн — [F-SPEC](docs/design/F-SPEC.md).
- Реестр Gate живёт вне репозитория (`~/.claude/gate/config.json`, после переноса — `$HARNESS_HOME/gate/`); что в нём для worfy — «Итог» `worfy-mvp` 32.
- Прошлые снимки — `git log -p -- HANDOFF.md`; последний подробный, до сжатия 2026-10-08, — `git show 84684b5:HANDOFF.md`.
