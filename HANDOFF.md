# Передача контекста — снимок на 2026-10-12 (UTC), main @ d0c3d30

## Сейчас в работе

- `worfy-harness` (E3: Harness — правила, skills, agents и скрипты владельца — становится plugin-ом worfy; [spec](.scratch/worfy-harness/spec.md)): влиты 01–25, 30 и 32, `epic-status` — 27/34; 26 — приёмка E3, `blocked`; 27 (платная часть eval) ждёт 28; 29 — после 27 и 28; 31 и 33 — открыты.
- `worfy-week` (неделя работы владельца из worfy; [spec](.scratch/worfy-week/spec.md)): влиты 17 из 19; 19 (старая неудача в окне First run, low) открыт. Ticket 14 (перетаскивание без фризов) отложен владельцем, `blocked`; работа — только в локальной ветке `wip/worfy-week-14` («Итог» Ticket-а 14).
- Stable copy и plugin `worfy` — сборка `4d3d60c` (2026-10-10). Откат машины на plugin — «Итог» `worfy-harness` 16.
- `worfy-link` (Project одной Machine ведётся с другой по локальной сети; [spec](.scratch/worfy-link/spec.md)) начат, пока E3 ждёт: влиты 01–15, `epic-status` — 15/19; 11 — «Add project» на Linked machine (PR #196), вход в gh — только `local`. Осталась приёмка 16; 17 и 18 — до связи с чужой машиной.
- `worfy-windows` (полный порт под Windows; spec, ADR 0054–0057): влиты 01, 02, 08–12, 18, 19 (PR #172, #177, #200, #194, #239, #215, #237, #228, #233), ответы — PR #192. Windows-ПК: 23, затем 26 (test-ы оставляют папки в `%TEMP%`), 20–22; на Mac — 24, 25 и gate full. 03–07 ждут закрытия E3.
- `worfy-terminal-ai` (Terminal AI в Terminal-ах на подписке; [spec](.scratch/worfy-terminal-ai/spec.md), ADR-0058) 01, 02 влиты (PR #204, #205); следом 03. 08 ждёт `worfy-ui` 02 и 08 (окно Settings, Select), 09 — шаги владельца (`blocked`).
- `worfy-ui` (Settings, масштаб, боковая панель, режим фокуса, палитра, Select, сочетания; [spec](.scratch/worfy-ui/spec.md)) 13 Ticket-ов: влиты 01, 02, 07, 08 (PR #207, #209, #210, #208) — Wave 1. До 09 — долг Select из «Итог» 08. 13 («Settings…» в режиме фокуса) — после 10.
- `worfy-review` (приёмы ponytail, pstack и Thermos в ревью и implementer Harness; [spec](.scratch/worfy-review/spec.md)) — 5/8: влиты 01, 03, 05 (Wave 1), 02 и 06 (PR #231, #232) — Wave 2. Следом 04 и 07; 08 (глубина ревью) ждёт ответов владельца.

## Ждёт владельца

- `worfy-harness` 26 (приёмка E3): код приёмки влит (PR #211, узкий круг — `NARROW: VERIFIED`); остались шаги ниже.
- Приёмка E3 («Итог» 26): пункты 1, 3 и 4 приняты; пункт 5 владелец делает сам (`/Users/Shared/worfy-item5/`); пункт 2 — строкой ниже; вход в песочнице открывает `claude plugin validate` и живые проверки `worfy-harness` 05–08.
- Приёмка E3, пункт 2: Wave в Silent Project прошла 2026-10-12, упало ожидание самого test-а (PR #252); следы по этому запуску проверены отдельно — код 0. Засчитать или повторить на третьем пустом репозитории — решает владелец.
- `worfy-link` 02: вручную — dev-сборка и Stable copy находят друг друга по Bonjour и связываются по коду; появился ли запрос Local Network и на каком шаге — [Ticket 02](.scratch/worfy-link/issues/02-link-a-machine-код-список-и-отзыв.md), «Итог».
- Мусор на машине: удалить ли 13 папок транскриптов spike-а `~/.claude/projects/*worfy-harness-probe*` (`worfy-harness` 01) `~/.claude/worfy-harness/worktree-sessions/` (`worfy-harness` 11).
- Мусор от проб `worfy-harness` 22: `~/.claude/projects/-private-tmp-worfy-harness-w10-impl-22-{probe-t0,p7-repo}/` и пустые `~/.claude/session-env/*` — удалить ли.
- Реестр Gate и Profile worfy вне репозитория: в `root_if` записи `worfy` дописать `|^harness/|(^|/)HANDOFF\.md$` («Итог» `worfy-harness` 02); в `rules.md` убрать «скрипта проверки … пока нет».
- Проверки только для владельца: знак worfy в Dock и Finder (`worfy-daily` 31), щелчок по баннеру с выключенным Focus (`worfy-mvp` 21), запрос разрешения на уведомления (`worfy-daily` 03), трекпад в Terminal (`worfy-daily` 13), fish (`worfy-mvp` 06).
- На экране висят неотвеченные системные окна: Automation «"claude" wants access to control "Finder"» и `universalAccessAuthWarn` о Screen Recording (`worfy-daily` 03 и 31, «Ручная проверка 2026-10-07»).
- `worfy-windows` 12 (влит, PR #237), вручную на ПК: установщик из `dist\` и значок; `pnpm install:stable`; установщик при копии, запущенной из старой папки — [Ticket 12](.scratch/worfy-windows/issues/12-сборка-nsis-и-stable-copy-на-windows.md), «Готово, когда».
- Windows-ПК: поставить Node 24 (после этого вливается `worfy-windows` 24); решить, удалять ли 9510 папок `worfy-*` в `%TEMP%` от test-ов (`worfy-windows` 14).
- Mac: перезапустить `fseventsd` (`sudo launchctl kickstart -k system/com.apple.fseventsd`) или перезагрузить Mac — до этого `gate full` красный и на main; PR #254, #256 и #257 ждут. Замеры — строка в «Риски и долги».
- `worfy-link` 19: нужна ли строка-подсказка под переключателем доступа о том, что без него «Keep awake» не действует, — вопрос в Ticket-е.

## Риски и долги

- `gate full` на Mac красный с 2026-10-12 23:04, и на main: во время `pnpm test` служба macOS `fseventsd` держит 102–116 % CPU, уведомление о файле опаздывает до 2,5 s, test-ы наблюдателей (`docs.test.ts`, `claude-home-registry.test.ts`) падают. Замеры — `worfy-windows` 26, «Что происходит».
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
- Замок e2e держащий обновляет `touch -c` раз в 5 минут (`rules.md` Profile-а worfy, 2026-10-10): без этого соседняя очередь снимала живой замок.
- Долги low — в «Итог» Ticket-ов (абзацы «Долг» и подраздел «Долги из HANDOFF (2026-10-08)»), разбор — шаг документов при закрытии Epic-а.

## Дальше

- `worfy-harness` 28 (git и `HARNESS_HOME` в прогонах eval) открывает платную часть 27; 29 — карта «кейс eval → файлы правил» и правило частоты eval. `worfy-windows`: Windows Session — 23 (удаление и junction; в нём же остатки ревью PR #237), затем 20, 21, 22; на Mac — 24 и 25.
- Приёмки `worfy-harness` 26 и `worfy-link` 16 (связь dev-сборки со Stable copy) — вместе с владельцем, не в Autopilot.
- Ручные проверки на Stable copy одним блоком, пока владельца нет за Mac-ом: `worfy-week` 02, 05, 08–12, 15–18, `worfy-harness` 18 (две Session после `pnpm install:stable`), 19, 21, 24, 25 (проверка 08 закрывает и 03, проверка 10 — и `worfy-daily` 11). Шаги — пункты «(вручную)» Ticket-ов.
- Ждут условия (проверит агент): упор в Limits (`worfy-daily` 05), наблюдатель касаний (`worfy-daily` 04), workflow-скрипт в Autopilot (`worfy-daily` 29, 17), бейджи у Ticket-а с открытым PR (`worfy-mvp` 17, `worfy-week` 01).
- Неделя работы владельца из Stable copy (условие 4 E2 и цель `worfy-week`): каждый дефект и каждое вмешательство человека — Ticket `worfy-week`, следующий номер 20.
- `worfy-harness` 31: `$0` и `$1` в shell-блоках skills подменяются аргументами вызова. 32 (черновик «Add project») влит — нужен `pnpm install:stable`.
- Кандидаты в Ticket-ы: `done` с невлитой ветки, `reader.ts:329` (`worfy-harness` 22); [med] Project по первому совпадению пути в `checks.ts:69` и ещё два долга `worfy-harness` 23 — его «Итог».
- Ещё кандидаты: изоляция `preflight.test.sh` (`worfy-harness` 11), абсолютный путь к `gh` (`worfy-harness` 01), PATH с node в hook-е `gh-token-env.sh` (`worfy-harness` 18), панель выделения поверх шапки рамки (`worfy-week` 10).
- После E3 — `worfy-link` (ведёт Session на Mac) и `worfy-windows` (Session на Windows-ПК) параллельно. PR Windows с общим кодом получают метку `needs-mac-gate`, их вливает Session на Mac (spec `worfy-windows`, Q30–Q33).
- E4 (подпись Developer ID и нотаризация) — после `worfy-link` и `worfy-windows` и только при первом внешнем пользователе ([roadmap](docs/roadmap.md)).

## Где остальное

- `worfy-mvp` (первая версия, 33/33) закрыт — [spec](.scratch/worfy-mvp/spec.md); где что в коде и долги — «Итог» его Ticket-ов.
- `worfy-daily` (E2, Autopilot, 32/32) закрыт — [spec](.scratch/worfy-daily/spec.md); условия 3 и 4 готовности E2 ещё не выполнены (`docs/roadmap.md`, E2).
- `worfy-week` (17/20, Ticket 14 отложен; 20 — relaunch ждёт выхода старого процесса, низкий приоритет) — [spec](.scratch/worfy-week/spec.md); условия готовности на 2026-10-08 — «Итог» Ticket-а 12.
- Spec-и: [worfy-harness](.scratch/worfy-harness/spec.md), [worfy-link](.scratch/worfy-link/spec.md), [worfy-windows](.scratch/worfy-windows/spec.md), [worfy-review](.scratch/worfy-review/spec.md), [worfy-terminal-ai](.scratch/worfy-terminal-ai/spec.md), [worfy-ui](.scratch/worfy-ui/spec.md).
- Этапы E1–E4 — [roadmap](docs/roadmap.md).
- Исследования внешних проектов — [docs/research/](docs/research/).
- Решения — [docs/adr/](docs/adr/): 0001–0024 и 0029–0059, номера 0025–0028 не используются. Следующий свободный — 0060.
- Уроки — [docs/lessons/](docs/lessons/): `process.md`, `agents.md`, `ci-merge.md`, `testing.md`. Словарь терминов — [CONTEXT.md](CONTEXT.md). Дизайн — [F-SPEC](docs/design/F-SPEC.md).
- Реестр Gate живёт вне репозитория (`~/.claude/gate/config.json`, после переноса — `$HARNESS_HOME/gate/`); что в нём для worfy — «Итог» `worfy-mvp` 32.
- Прошлые снимки — `git log -p -- HANDOFF.md`; последний подробный, до сжатия 2026-10-08, — `git show 84684b5:HANDOFF.md`.
