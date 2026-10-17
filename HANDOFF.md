# Передача контекста — снимок на 2026-10-16 (UTC), main @ af4bf07

## Сейчас в работе

- `worfy-harness` (E3: Harness владельца — plugin worfy; [spec](.scratch/worfy-harness/spec.md)): влиты 01–26, 30, 32, 35, 37, `epic-status` — 30/48; 26 (приёмка E3) закрыт 2026-10-15, версия `0.3.0` (PR #323); 27 (платная часть eval) ждёт 28; 29 — после 27 и 28; открыты 31, 33, 34, 36, 38–48.
- `worfy-week` (неделя работы владельца из worfy; [spec](.scratch/worfy-week/spec.md)): влиты 20 из 20 (20 — PR #345; 14, перетаскивание без фризов, — PR #429). Проверка 14 на Stable copy и судьба ветки `wip/worfy-week-14` — за владельцем.
- Stable copy и plugin `worfy` — `0.3.0+e8784a2f` (2026-10-15). Откат машины на plugin — «Итог» `worfy-harness` 16.
- `worfy-link` (Project ведётся с другой Machine по LAN; [spec](.scratch/worfy-link/spec.md)): влиты 01–15, 17–26, `epic-status` — 25/26. Осталась приёмка 16.
- `worfy-windows` (полный порт под Windows; spec, ADR 0054–0057, 0062, 0063): влиты 01–03, 08–12, 18–28, 35, 44 (PR #172–#298) и срезы 05a–05c (#420, #434, #437), `epic-status` — 25/55; на ПК — 05d (stand-in `gh` для `wave-gate.test.sh`) и 14; 46 закрыт — `gate.sh` остаётся. Очередь ПК — в «Дальше».
- `worfy-terminal-ai` ([spec](.scratch/worfy-terminal-ai/spec.md), ADR-0058): влиты 01–08, 10–13 (11 — связь shell-а закрыта на время команды, `bye`; 12 — `transcript-date` у полуночи; 13 — панель ⌘I шлёт строку shell-а); 09 — приёмка. Долги — «Итог» 11–13.
- `worfy-ui` ([spec](.scratch/worfy-ui/spec.md)): влиты 01–11, 13 (11 — [PR #328](https://github.com/IDSAD-XL/worfy/pull/328)); открыт 15 (подписи Model и Permissions в composer-е скрываются, когда значение не помещается); 12 — приёмка.
- `worfy-review` (приёмы ponytail, pstack и Thermos в ревью и implementer Harness; [spec](.scratch/worfy-review/spec.md)) — 8/8, влиты все; вопросы владельцу — «Итог» 07, 08.
- `worfy-polish`: 30/31 — 01–29 и 31 (иконка у уведомлений, #425) влиты (12 — отчёт; 20, 26 — узкий круг; 19 — после `pnpm test` на Windows-ПК). Открыт 30 (flaky contract test-ы).
- `worfy-throughput` ([spec](.scratch/worfy-throughput/spec.md)): 4/9, влиты 01–03 (`wave-gate`, ADR-0065) и 08 (#433, ADR-0068): batch CI на `main` включён; 06 — stub-ы для Windows, 07 — дерево `wave-gate`, 09 — `UNKNOWN` в текстах batch; 04, 05 — Session Orchestrator-а.
- `worfy-pipeline` (Stage и «кого ждёт» у Ticket-ов; [spec](.scratch/worfy-pipeline/spec.md), ADR-0067): 2/8, влиты 01 (#421, новая шапка, `ticket migrate`) и 02 (#428, отметки на SHA); `rules.md:46` (замок e2e) — слово владельца, «Итог» 02.

## Ждёт владельца

- `wave-gate` на Mac краснит typecheck в своём дереве: до `worfy-throughput` 07 — merge-once.
- Приёмка E3 («Итог» `worfy-harness` 26) закрыта 2026-10-15: пункты 1–5 приняты, версия `0.3.0`. Ошибка в окне без `gate/config.json` принята.
- Вход в песочнице приёмки открывает `claude plugin validate` и живые проверки `worfy-harness` 05–08.
- Песочница приёмки лежит в `$TMPDIR`: macOS каждую ночь в 03:35 удаляет файлы без обращений три дня; 2026-10-13 пропала метка. Исправление — `worfy-harness` 36.
- Приёмка `worfy-link` 16 (Bonjour, запрос Local Network из 02) — код готов; до связи вне LAN — ревьюер-человек SPAKE2 (решения 2026-10-16 — в 16–20).
- `worfy-link` — решено без владельца, подтвердить: «Итог» Ticket-ов 21 (протокол 2), 22, 24, 25, 26.
- `worfy-polish` — решено без владельца, подтвердить («Итог»): `inTurn`, `messageOf` и цикл импорта (27); окно автокомпакта, 1–4 (29).
- `worfy-terminal-ai` 11: связь с main у программ widget-ов и `zle -F` на prompt-е (fzf, atuin) — нужен ли отдельный Ticket («Итог» 11).
- Одной сессией после `worfy-terminal-ai` 09 — проверки только для владельца: знак worfy в Dock и Finder (`worfy-daily` 31), щелчок по баннеру с выключенным Focus (`worfy-mvp` 21), запрос разрешения на уведомления (`worfy-daily` 03), трекпад в Terminal (`worfy-daily` 13), fish (`worfy-mvp` 06).
- На экране висят неотвеченные системные окна: Automation «"claude" wants access to control "Finder"» и `universalAccessAuthWarn` о Screen Recording (`worfy-daily` 03 и 31, «Ручная проверка 2026-10-07»).
- `worfy-windows` 12 (влит, PR #237): SmartScreen у скачанного установщика не проверен — его диалог закрывает человек: [Ticket 12](.scratch/worfy-windows/issues/12-сборка-nsis-и-stable-copy-на-windows.md).
- `worfy-windows` 35 (влит, PR #287): пробный том на ПК отключает владелец, шаги — в «Итог» Ticket-а; test на настоящих папках (Ticket 45, пункт 1) ждёт его слова в чате Windows Session.
- `worfy-ui`: вручную — раздел Health (06) и ⌘B (10); AltGr на Windows-ПК (03) — пока владелец не скажет в чате ПК; gate full на Windows для 03 и 10 — после e2e Windows (`worfy-windows` 14); долги — «Итог» 03–06, 09, 10, 13; 11 — gate full на Windows-ПК и решения в PR #328.

## Риски и долги

- Test-ы наблюдателя файлов красные и на main — перегружен `fseventsd`: признак и лечение — урок в `docs/lessons/agents.md`.
- Удаление вне Windows больше не стирает том, примонтированный в папку Card-а: отказ с `EXDEV` (PR #293). Не видна точка монтирования с `dev` её папки (Ticket 47). На Windows junction по GUID закрыт PR #287; junction отключённого тома `purge` не удаляет (45, замер 6).
- Каждый мерж, который трогает `harness/`, кончается `pnpm install:stable` вне прогона Autopilot (ADR-0047): без пересборки Stable copy влитый урок не действует.
- Atakama пойдёт через полный предполёт Harness с `git fetch`. На живых репозиториях Atakama это не проверено, только на клонах (`worfy-harness` 11).
- [med] С plugin-ом оживают долги про `gh`: Stop hook зовёт `gh` по имени, и `bin/gh` plugin-а подменит учётную запись (`worfy-harness` 01); `preflight` советует `gh auth switch` вместо `GH_TOKEN` (`worfy-week` 01).
- [med] `harness/bin/tests/preflight.test.sh` не изолирует `HOME` и пишет замки в настоящий `~/.claude/worfy-harness/` (`worfy-harness` 11). Запускать его только с `HOME` и `HARNESS_HOME` во временном каталоге.
- [med] Contract test-ы читают настоящий `~/.claude/settings.json`: если там `model: haiku`, падают 10 test-ов (`worfy-daily` 07 и 23).
- Нестабильные e2e роняют `gate full`: `binding.spec.ts:272` (узел Ticket-а 12 не виден за 5 s), `autopilot.spec.ts:485` (app не закрылся за quit timeout; gate PR #201), `edges.spec.ts:166` (толщина Edge пустая вместо `1px`; gate PR #269, повтор зелёный). Сводка — «Итог» `worfy-week` 06.
- Пока не сделан пункт о реестре Gate и Profile, Gate `fast` и CI не проверяют PR, где изменён только `HANDOFF.md`: перед его push — `node scripts/check-handoff.mjs`. PR только в `harness/` гоняют Gate с `GATE_SCOPE=all`.
- Gate `fast` с сужением по диффу не видит `scripts/` и `test/fixtures/` (`worfy-mvp` 01). Перед мержем — `GATE_SCOPE=all gate.sh full` на ветке: e2e и `.app` идут только локально ([ci-merge.md](docs/lessons/ci-merge.md)).
- Contract test-ы с дочерними процессами (`github-prs`, `harness-qmd`, `workflow-reader`, `docs`) при load 6–8 не укладываются в 15 s: gate fast параллельных исполнителей краснел.
- Ложный таймаут первого окна в e2e: заблокированный экран, сеанс macOS владельца в фоне, параллельные e2e, окно macOS «восстановить окна?» (с PR #179 test-ы его отключают; на Mac владельца ещё и `defaults` для `com.github.Electron`) — [agents.md](docs/lessons/agents.md).
- Замок e2e держащий обновляет `touch -c` раз в 5 минут (`rules.md` Profile-а worfy, 2026-10-10): без этого соседняя очередь снимала живой замок.
- Долги low — в «Итог» Ticket-ов (абзацы «Долг» и подраздел «Долги из HANDOFF (2026-10-08)»), разбор — шаг документов при закрытии Epic-а.

## Дальше

- `worfy-harness` 28 (git и `HARNESS_HOME` в прогонах eval) открывает платную часть 27; 29 — карта «кейс eval → файлы правил» и правило частоты eval.
- `worfy-windows`, очередь ПК (владелец, 2026-10-13): проверки 03 на ПК → 14 (прогон test-ов на Windows) → 05 → 04 → 13 → 30 → 06, 07 → 15; затем остатки 29, 32, 33, 36, 42, 43, 45, 49, 50 и 31, 34, 37, 40, 41; 38, 39, 47, 48 — Mac.
- `worfy-windows` 54 (шесть файлов `test/contract` ищут zsh через `/bin/sh` при загрузке модуля; на Windows падают с 0 test-ов) — после 53 (PR #387), тем же способом.
- Приёмки `worfy-harness` 26 и `worfy-link` 16 (связь dev-сборки со Stable copy) — вместе с владельцем, не в Autopilot.
- Ручные проверки на Stable copy одним блоком, пока владельца нет за Mac-ом: `worfy-week` 02, 05, 08–12, 15–18, `worfy-harness` 18 (две Session после `pnpm install:stable`), 19, 21, 24, 25 (проверка 08 закрывает и 03, проверка 10 — и `worfy-daily` 11). Шаги — пункты «(вручную)» Ticket-ов.
- После `pnpm install:stable` — первый `retro` на настоящем сбое (`worfy-reliability` 09, пункт «(вручную)»).
- Ждут условия (проверит агент): упор в Limits (`worfy-daily` 05), наблюдатель касаний (`worfy-daily` 04), workflow-скрипт в Autopilot (`worfy-daily` 29, 17), бейджи у Ticket-а с открытым PR (`worfy-mvp` 17, `worfy-week` 01).
- Неделя работы владельца из Stable copy (условие 4 E2 и цель `worfy-week`): каждый дефект и каждое вмешательство человека — Ticket `worfy-week`, следующий номер 21.
- `worfy-harness` 31: `$0` и `$1` в shell-блоках skills подменяются аргументами вызова.
- Кандидаты Harness: изоляция `preflight.test.sh` (`worfy-harness` 11), абсолютный путь к `gh` (`worfy-harness` 01), PATH с node в hook-е `gh-token-env.sh` (`worfy-harness` 18); прочие — `worfy-polish`.
- После E3 — `worfy-link` (ведёт Session на Mac) и `worfy-windows` (Session на Windows-ПК) параллельно. PR Windows с общим кодом получают метку `needs-mac-gate`, их вливает Session на Mac (spec `worfy-windows`, Q30–Q33).
- E4 (подпись Developer ID и нотаризация) — после `worfy-link` и `worfy-windows` и только при первом внешнем пользователе ([roadmap](docs/roadmap.md)).

## Где остальное

- `worfy-mvp` (первая версия, 33/33) закрыт — [spec](.scratch/worfy-mvp/spec.md); где что в коде и долги — «Итог» его Ticket-ов.
- `worfy-daily` (E2, Autopilot, 32/32) закрыт — [spec](.scratch/worfy-daily/spec.md); условия 3 и 4 готовности E2 ещё не выполнены (`docs/roadmap.md`, E2).
- `worfy-week` (20/20) — [spec](.scratch/worfy-week/spec.md); условия готовности на 2026-10-08 — «Итог» Ticket-а 12.
- `worfy-reliability` (9/9) закрыт — [spec](.scratch/worfy-reliability/spec.md); долги — «Итог» Ticket-ов 05, 07, 08, 09.
- Spec-и: [worfy-harness](.scratch/worfy-harness/spec.md), [worfy-link](.scratch/worfy-link/spec.md), [worfy-windows](.scratch/worfy-windows/spec.md), [worfy-review](.scratch/worfy-review/spec.md), [worfy-terminal-ai](.scratch/worfy-terminal-ai/spec.md), [worfy-ui](.scratch/worfy-ui/spec.md).
- Этапы E1–E4 — [roadmap](docs/roadmap.md).
- Исследования внешних проектов — [docs/research/](docs/research/).
- Решения — [docs/adr/](docs/adr/): 0001–0024 и 0029–0067, номера 0025–0028 не используются.
- Уроки — [docs/lessons/](docs/lessons/): `process.md`, `agents.md`, `ci-merge.md`, `testing.md`. Словарь терминов — [CONTEXT.md](CONTEXT.md). Дизайн — [F-SPEC](docs/design/F-SPEC.md).
- Реестр Gate живёт вне репозитория (`~/.claude/gate/config.json`, после переноса — `$HARNESS_HOME/gate/`); что в нём для worfy — «Итог» `worfy-mvp` 32.
- Прошлые снимки — `git log -p -- HANDOFF.md`; последний подробный, до сжатия 2026-10-08, — `git show 84684b5:HANDOFF.md`.
