# Передача контекста — снимок на 2026-10-19 (UTC), main @ 502b95e

## Сейчас в работе

- `worfy-harness` (E3, plugin worfy; [spec](.scratch/worfy-harness/spec.md)): `epic-status` — 50/61; в работе 36, 46, 50, 58, 59, 61; 31, 48 — шаг владельца («Итог»); 29, 52 — платные eval, только владелец.
- `worfy-week` (неделя работы владельца из worfy; [spec](.scratch/worfy-week/spec.md)): влиты 20 из 20 (20 — PR #345; 14, перетаскивание без фризов, — PR #429). Проверка 14 на Stable copy и судьба ветки `wip/worfy-week-14` — за владельцем.
- Stable copy и plugin `worfy` — `0.3.0+e8784a2f` (2026-10-15). Откат машины на plugin — «Итог» `worfy-harness` 16.
- `worfy-link` (Project ведётся с другой Machine по LAN; [spec](.scratch/worfy-link/spec.md)): влиты 01–15, 17–26; приёмка 16; 32 закрыт (#508). Вне LAN через Tailscale (ADR-0070) — 27–31, код после очереди `worfy-windows`.
- `worfy-windows` (порт под Windows; spec, ADR 0054–0057, 0062, 0063, 0069, 0071): `epic-status` — 55/74; 2026-10-20 влиты 70 (#562) и 71 (#555); дальше 43 (#557); 73 открыт; 06 (#456) ждёт живой `preflight` на ПК, 07 — Q31 и запуск worfy на ПК.
- `worfy-windows`, ПК: gate fast — lint и typecheck до закрытия 14; worktree-ы — в `C:/Users/Alexey/worfy-wt`, вне `%TEMP%` (Q25, 52). Новые 67–69 — follow-up-ы 39 и 64.
- `worfy-windows` 39 влит (#512): main отвечает на `ESC[6n`, ответы view — не ввод. Цена — скорость flood-а (один worker разбора), владелец принял; ускорить — 67.
- `worfy-windows` 65, 66, ADR-0071 (2026-10-19): сначала main зелёный на Windows (65, 14), затем 66 — полный `pnpm test` на Windows-runner-е; его зелёный run — `check/windows` для платформенных PR без Terminal, окон, e2e и упаковки.
- `worfy-terminal-ai` ([spec](.scratch/worfy-terminal-ai/spec.md), ADR-0058): влиты 01–08, 10–14 (11 — связь shell-а закрыта на время команды, `bye`; 12 — `transcript-date` у полуночи; 13 — ⌘I шлёт строку; 14 — zle на Linux); 09 — приёмка; 15 (low) — связь у программ prompt-а. Долги — «Итог» 11–13.
- `worfy-terminal-ssh` (Terminal AI в SSH session; [spec](.scratch/worfy-terminal-ssh/spec.md), подтверждён владельцем 2026-10-18): 0/10; spike 01 blocked — ждёт сервер.
- `worfy-ui` ([spec](.scratch/worfy-ui/spec.md)): влиты 01–11, 13–15, 18 (11 — #328, 14 — #449, 15 — #450, 18 — #543); остался 12 — приёмка; 19 — долг после review #543.
- `worfy-review` (приёмы ponytail, pstack и Thermos в ревью и implementer Harness; [spec](.scratch/worfy-review/spec.md)) — 8/8, влиты все; вопросы владельцу — «Итог» 07, 08.
- `worfy-polish`: 31/36 — 01–29, 31, 33 влиты (12 — отчёт; 20, 26 — узкий круг; 19 — после `pnpm test` на ПК). 32: PR #497 влит, до закрытия — замер 30 (N ≥ 6) Orchestrator-ом; 30 (#401) ждёт 32. 34–36 — flaky, security ссылок, долг #530.
- `worfy-throughput` ([spec](.scratch/worfy-throughput/spec.md)): 7/17, влиты 01–03, 06, 08, 10 (#620), 16 (#626: gate full 18,5 → 12,9 min); 07, 09 — `wave-gate`; 04, 05 — Orchestrator; 11–15, 17 — скорость test-ов (ADR-0081), узкое место — e2e (17).
- `worfy-pipeline` (Stage и «кого ждёт»; [spec](.scratch/worfy-pipeline/spec.md), ADR-0067): 9/10, влиты 01–09 (08 — #552, 09 — #550); 10 (ADR-0079) — в работе; решения владельца (Q1–Q16) в Ticket-ах; `rules.md:46` (замок e2e) — слово владельца, «Итог» 02.
- `worfy-neutral` (Harness нейтрален по языку и проекту; [spec](.scratch/worfy-neutral/spec.md), ADR-0074): 8/10 (03–07, 09 влиты; 07 — #625); 10 (подстановки Profile) в работе; 08 — после release; до 08 — шаги владельца из «Итог» 04, 06 и 07.
- `worfy-canvas` ([spec](.scratch/worfy-canvas/spec.md), ADR 0075–0077): 4/16; влиты 01 (#539), 03, 04, 07 — Wave 1 закрыта; Wave 2 — 02 и 11 в работе; новые 14–16 (14 — до 10).
- `worfy-browser` ([spec](.scratch/worfy-browser/spec.md)): 6/13; 03 ждёт ответов владельца; 13 — после 03.

## Ждёт владельца

- `wave-gate` на Mac краснит typecheck в своём дереве: до `worfy-throughput` 07 — merge-once.
- Вход в песочнице приёмки открывает `claude plugin validate` и живые проверки `worfy-harness` 05–08.
- Песочница приёмки в `$TMPDIR`: macOS чистит файлы через три дня без обращений. Исправление — `worfy-harness` 36; после merge владелец запускает `move` (команды — в PR).
- Приёмка `worfy-link` 16 (Bonjour, запрос Local Network из 02) — код готов. Tailscale на Mac и ПК ставит владелец (ADR-0070, Ticket 31).
- Одной сессией после `worfy-terminal-ai` 09 — проверки только для владельца: знак worfy в Dock и Finder (`worfy-daily` 31), щелчок по баннеру с выключенным Focus (`worfy-mvp` 21), запрос разрешения на уведомления (`worfy-daily` 03), трекпад в Terminal (`worfy-daily` 13), fish (`worfy-mvp` 06).
- На экране висят неотвеченные системные окна: Automation «"claude" wants access to control "Finder"» и `universalAccessAuthWarn` о Screen Recording (`worfy-daily` 03 и 31, «Ручная проверка 2026-10-07»).
- `worfy-windows`, ПК: на C: нет места (Фото iCloud); 12 — SmartScreen установщика; 07 — Q31 и `Get-Process` установленного worfy.
- Приёмки (Q14).
- `worfy-ui`: вручную — раздел Health (06) и ⌘B (10); AltGr на Windows-ПК (03) — пока владелец не скажет в чате ПК; gate full на Windows для 03 и 10 — после e2e Windows (`worfy-windows` 14); долги — «Итог» 03–06, 09, 10, 13–15; 11 — gate full на Windows-ПК и решения в PR #328.

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
- Замок e2e: в `rules.md` Profile владельца heartbeat ещё старый (без выхода при снятом замке); новая строка — в PR `worfy-harness` 49, вносит владелец.
- Долги low — в «Итог» Ticket-ов (абзацы «Долг» и подраздел «Долги из HANDOFF (2026-10-08)»), разбор — шаг документов при закрытии Epic-а.

## Дальше

- Очередь мержа (владелец, Q7, Q10) пройдена: #517, #496, #508 влиты; `worfy-pipeline` 08 влит (#552).
- `worfy-harness` 50, 51 — правка правил и платный повтор кейса (eval с `Bash`: `~/.docker/bin` вынести на время run-а); 29 — карта «кейс eval → файлы правил».
- `worfy-windows`, очередь ПК (2026-10-20): 43 (#557) → 14 (часть unit/contract) → 47; потом 66; 15, 42, 62; 16 — итог на ПК; 61 — low; 60 — в своём PR; 73 — правка на ПК (`worfy-windows/70-lows`).
- `worfy-link` 27–31 (вне LAN через Tailscale, ADR-0070) — после очереди `worfy-windows`: 27 и 28, затем 29 и 31; 30 — позже.
- Приёмки `worfy-harness` 26 и `worfy-link` 16 (связь dev-сборки со Stable copy) — вместе с владельцем, не в Autopilot.
- Ручные проверки на Stable copy одним блоком, пока владельца нет за Mac-ом: `worfy-week` 02, 05, 08–12, 15–18, `worfy-harness` 18 (две Session после `pnpm install:stable`), 19, 21, 24, 25 (проверка 08 закрывает и 03, проверка 10 — и `worfy-daily` 11). Шаги — пункты «(вручную)» Ticket-ов.
- После `pnpm install:stable` — первый `retro` на настоящем сбое (`worfy-reliability` 09, пункт «(вручную)»).
- Ждут условия (проверит агент): упор в Limits (`worfy-daily` 05), наблюдатель касаний (`worfy-daily` 04), workflow-скрипт в Autopilot (`worfy-daily` 29, 17), бейджи у Ticket-а с открытым PR (`worfy-mvp` 17, `worfy-week` 01).
- Неделя работы владельца из Stable copy (условие 4 E2 и цель `worfy-week`): каждый дефект и каждое вмешательство человека — Ticket `worfy-week`, следующий номер 21.
- `worfy-harness` 31: `$0` и `$1` в shell-блоках skills подменяются аргументами вызова.
- Кандидаты Harness (`worfy-harness`): изоляция `preflight.test.sh` (11), абсолютный путь к `gh` (01), PATH с node в hook-е `gh-token-env` (18); прочие — `worfy-polish`.
- `worfy-link` ведёт Session на Mac, `worfy-windows` — Session на ПК; PR Windows с общим кодом — метка `needs-mac-gate`, вливает Session на Mac (spec `worfy-windows`, Q30–Q33).
- E4 (подпись Developer ID и нотаризация) — после `worfy-link` и `worfy-windows` и только при первом внешнем пользователе ([roadmap](docs/roadmap.md)).

## Где остальное

- `worfy-mvp` (первая версия, 33/33) закрыт — [spec](.scratch/worfy-mvp/spec.md); где что в коде и долги — «Итог» его Ticket-ов.
- `worfy-daily` (E2, Autopilot, 32/32) закрыт — [spec](.scratch/worfy-daily/spec.md); условия 3 и 4 готовности E2 ещё не выполнены (`docs/roadmap.md`, E2).
- `worfy-week` (20/20) — [spec](.scratch/worfy-week/spec.md); условия готовности на 2026-10-08 — «Итог» Ticket-а 12.
- `worfy-reliability` (9/9) закрыт — [spec](.scratch/worfy-reliability/spec.md); долги — «Итог» Ticket-ов 05, 07, 08, 09.
- Spec-и всех Epic-ов — `.scratch/<epic>/spec.md`.
- Этапы E1–E4 — [roadmap](docs/roadmap.md).
- Исследования внешних проектов — [docs/research/](docs/research/).
- Решения — [docs/adr/](docs/adr/): 0001–0024 и 0029–0078, номера 0025–0028 не используются.
- Уроки — [docs/lessons/](docs/lessons/): `process.md`, `agents.md`, `ci-merge.md`, `testing.md`. Словарь терминов — [CONTEXT.md](CONTEXT.md). Дизайн — [F-SPEC](docs/design/F-SPEC.md).
- Реестр Gate живёт вне репозитория (`~/.claude/gate/config.json`, после переноса — `$HARNESS_HOME/gate/`); что в нём для worfy — «Итог» `worfy-mvp` 32.
- Прошлые снимки — `git log -p -- HANDOFF.md`; последний подробный, до сжатия 2026-10-08, — `git show 84684b5:HANDOFF.md`.
