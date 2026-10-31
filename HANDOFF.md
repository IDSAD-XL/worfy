# Передача контекста — снимок на 2026-10-19 (UTC), main @ 502b95e

## Сейчас в работе

- `worfy-harness` (E3, plugin worfy; [spec](.scratch/worfy-harness/spec.md)): 70/71; влиты 62, 64, 65 (#719), 66 (#949), 67 (#1011), 68 (#945), 69 (#1015), 70 (#778), 71 (#829), 52, 63 (#713); задачи 52 — у владельца; 31, 36, 47, 48, 50, 51 — шаг владельца.
- `worfy-week` (неделя работы владельца из worfy; [spec](.scratch/worfy-week/spec.md)): влиты 20 из 20 (20 — PR #345; 14, перетаскивание без фризов, — PR #429). Проверка 14 на Stable copy и судьба ветки `wip/worfy-week-14` — за владельцем.
- Stable copy и plugin `worfy` — `0.3.0+e8784a2f` (2026-10-15). Откат машины на plugin — «Итог» `worfy-harness` 16.
- `worfy-link` (Project ведётся с другой Machine по LAN; [spec](.scratch/worfy-link/spec.md)): 35/37, влиты 01–15, 17–30, 32–37 (30 — машины tailnet, #866). Остались проверка Tailscale 31 и приёмка 16 — с владельцем.
- `worfy-windows` (порт под Windows; ADR 0054–0057, 0062, 0063, 0069, 0071): 111/114. Отсечка владельца 2026-10-23 после пересчёта e2e на ПК: повторяющиеся красные — в Epic-е (113; 106, 109–112 влиты), flaky — `worfy-polish` 41; планка 16 — gate full на Windows полностью зелёный.
- `worfy-windows`: 60 не нужен — остаёмся на `node-pty@1.2.0-beta.15`; 90 и 92 вынесены из Epic-а (upstream, приёмку не блокируют) — владелец 2026-10-23.
- `worfy-windows` 39 влит (#512): main отвечает на `ESC[6n`, ответы view — не ввод. Цена — скорость flood-а (один worker разбора), владелец принял; 67 (#1020) — пул worker-ов, 2–8 shell-ов в 1.4–4.2 раза быстрее (ПК и Mac).
- `worfy-windows` 66, ADR-0071: полный `pnpm test` на Windows-runner-е; его зелёный run — `check/windows` для платформенных PR без Terminal, окон, e2e и упаковки. Baseline runner-а починил 108 (#802).
- `worfy-terminal-ai` ([spec](.scratch/worfy-terminal-ai/spec.md), ADR-0058) — **добиваем, владелец 2026-10-23**: влиты 01–08, 10–17 (17 — #1056, ветка git из файлов); осталась приёмка 09 (ждёт владельца).
- `worfy-terminal-ssh` (Terminal AI в SSH session; [spec](.scratch/worfy-terminal-ssh/spec.md), подтверждён владельцем 2026-10-18) — **отложен владельцем 2026-10-21**: 0/10; spike 01 blocked — ждёт сервер.
- `worfy-ui` ([spec](.scratch/worfy-ui/spec.md)): влиты 01–11, 13–26; 12 — приёмка; открыты 27 (pointer, hover), 28 (drop, превью в чате).
- `worfy-review` (приёмы ponytail, pstack и Thermos в ревью и implementer Harness; [spec](.scratch/worfy-review/spec.md)) — 8/8, влиты все; вопросы владельцу — «Итог» 07, 08.
- `worfy-polish`: 45/45, Epic закрыт; 41 — #1028 и #1052 (flaky Windows починены по причине).
- `worfy-throughput` ([spec](.scratch/worfy-throughput/spec.md)): 56/60; открыты 05, 30, 31, 43; 60 — Eco mode в чате (#1057). 43: eco проверяет друг. 31: замер 2026-11-06.
- `worfy-pipeline` (Stage и «кого ждёт»; [spec](.scratch/worfy-pipeline/spec.md), ADR-0067): 10/10, влиты 01–10 (08 — #552, 09 — #550, 10 — #577); решения владельца (Q1–Q16) в Ticket-ах; `rules.md:46` (замок e2e) — слово владельца, «Итог» 02.
- `worfy-neutral` (Harness нейтрален по языку и проекту; [spec](.scratch/worfy-neutral/spec.md), ADR-0074): 9/10 (01–07, 09, 10 влиты; 10 — #649); 08 — после следующего release; до 08 — шаги владельца из «Итог» 04, 06, 07 и 10 (10 — после Stable с #649).
- `worfy-canvas` ([spec](.scratch/worfy-canvas/spec.md), ADR 0075–0077, 0082): 24/24; 24 — картинки на Linked machine (#1018), три решения — подтвердить владельцу.
- `worfy-browser` ([spec](.scratch/worfy-browser/spec.md)): 18/19; 18 — #1008, ADR-0087. 19 (эмуляция устройств) — ждёт владельца, не брать.
- `worfy-feature-docs`: 18/19; 19 ждёт: Profile на ПК.
- `worfy-update` ([spec](.scratch/worfy-update/spec.md), ADR-0089): после onboarding 13/14.

## Ждёт владельца

- `worfy-onboarding`: 12 — Mac принят 2026-10-31, ПК — с link 31; 13, 14 — по снимкам.
- С `check/windows` skipped, пока ПК на паузе, влит #878 — его покрывает полный run Windows e2e ПК на свежем `main` (решение 2026-10-28).
- Вход в песочнице приёмки открывает `claude plugin validate` и живые проверки `worfy-harness` 05–08.
- Песочница приёмки в `$TMPDIR`: macOS чистит файлы через три дня без обращений. Исправление — `worfy-harness` 36; после merge владелец запускает `move` (команды — в PR).
- Приёмка `worfy-link` 16 (Bonjour, запрос Local Network из 02) — код готов. Tailscale на Mac и ПК ставит владелец (ADR-0070, Ticket 31 — с Windows-частью onboarding 12).
- Одной сессией после `worfy-terminal-ai` 09 — проверки только для владельца: знак worfy в Dock и Finder (`worfy-daily` 31), щелчок по баннеру с выключенным Focus (`worfy-mvp` 21), запрос разрешения на уведомления (`worfy-daily` 03), трекпад в Terminal (`worfy-daily` 13), fish (`worfy-mvp` 06).
- На экране висят неотвеченные системные окна: Automation «"claude" wants access to control "Finder"» и `universalAccessAuthWarn` о Screen Recording (`worfy-daily` 03 и 31, «Ручная проверка 2026-10-07»).
- `worfy-windows`, ПК: 12 — SmartScreen установщика; 07 — Q31 и `Get-Process` установленного worfy.
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
- Gate `fast` с сужением по диффу не видит `scripts/` и `test/fixtures/` (`worfy-mvp` 01); условие merge — `ci-ok` (ADR-0083).
- Contract test-ы с дочерними процессами (`github-prs`, `harness-qmd`, `workflow-reader`, `docs`) при load 6–8 не укладываются в 15 s: gate fast параллельных исполнителей краснел.
- Ложный таймаут первого окна в e2e: заблокированный экран, сеанс macOS владельца в фоне, параллельные e2e, окно macOS «восстановить окна?» (с PR #179 test-ы его отключают; на Mac владельца ещё и `defaults` для `com.github.Electron`) — [agents.md](docs/lessons/agents.md).
- Замок e2e: в `rules.md` Profile владельца heartbeat ещё старый (без выхода при снятом замке); новая строка — в PR `worfy-harness` 49, вносит владелец.
- Долги low — в «Итог» Ticket-ов (абзацы «Долг» и подраздел «Долги из HANDOFF (2026-10-08)»), разбор — шаг документов при закрытии Epic-а.

## Дальше

- Очередь мержа (владелец, Q7, Q10) пройдена: #517, #496, #508 влиты; `worfy-pipeline` 08 влит (#552).
- `worfy-harness` 50, 51 — платный повтор кейса eval (`~/.docker/bin` вынести на время run-а); 52 — Session без plugin-а для задач и платные шаги 2б, 4, 5.
- `worfy-windows`, очередь ПК (2026-10-24): 113 (замер на worfy, запущенной вручную) → 07 (первая настоящая Wave на ПК) → 15 (краш qmd — `better-sqlite3` на node < 22.14, «Итог» 15), 67, 68 → приёмка 16; 61 — low; 73 — правка на ПК (`worfy-windows/70-lows`).
- `worfy-onboarding` ([spec](.scratch/worfy-onboarding/spec.md)): 11/14; 12 — Mac принят 2026-10-31, осталась ПК-часть; 13 (панель) и 14 (подсветка) открыты.
- Приёмки `worfy-harness` 26 и `worfy-link` 16 (связь dev-сборки со Stable copy) — вместе с владельцем, не в Autopilot.
- Ручные проверки на Stable copy одним блоком, пока владельца нет за Mac-ом: `worfy-week` 02, 05, 08–12, 15–18, `worfy-harness` 18 (две Session после `pnpm install:stable`), 19, 21, 24, 25 (проверка 08 закрывает и 03, проверка 10 — и `worfy-daily` 11). Шаги — пункты «(вручную)» Ticket-ов.
- После `pnpm install:stable` — первый `retro` на настоящем сбое (`worfy-reliability` 09, пункт «(вручную)»).
- Ждут условия (проверит агент): упор в Limits (`worfy-daily` 05), наблюдатель касаний (`worfy-daily` 04), workflow-скрипт в Autopilot (`worfy-daily` 29, 17), бейджи у Ticket-а с открытым PR (`worfy-mvp` 17, `worfy-week` 01).
- Неделя работы владельца из Stable copy (условие 4 E2 и цель `worfy-week`): каждый дефект и каждое вмешательство человека — Ticket `worfy-week`, следующий номер 21.
- `worfy-harness` 31: `$0` и `$1` в shell-блоках skills подменяются аргументами вызова.
- Кандидаты Harness (`worfy-harness`): изоляция `preflight.test.sh` (11), абсолютный путь к `gh` (01), PATH с node в hook-е `gh-token-env` (18); прочие — `worfy-polish`.
- `worfy-link` ведёт Session на Mac, `worfy-windows` — Session на ПК; PR с ПК вливает Session на Mac по `ci-ok` и `review`; метки `needs-mac-gate` нет (ADR-0083).
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
