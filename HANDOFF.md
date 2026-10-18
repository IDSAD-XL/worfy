# Передача контекста — снимок на 2026-10-16 (UTC), main @ af4bf07

## Сейчас в работе

- `worfy-harness` (E3, plugin worfy; [spec](.scratch/worfy-harness/spec.md)): `epic-status` — 31/49; версия `0.3.0` (26, PR #323); 28 влит #476; 27 (платная часть eval) blocked, PR #496 (run отказан, 0 USD) — влить или сложить с повторным run; 29 — после 27; открыты 31, 33, 34, 36, 38–49.
- `worfy-week` (неделя работы владельца из worfy; [spec](.scratch/worfy-week/spec.md)): влиты 20 из 20 (20 — PR #345; 14, перетаскивание без фризов, — PR #429). Проверка 14 на Stable copy и судьба ветки `wip/worfy-week-14` — за владельцем.
- Stable copy и plugin `worfy` — `0.3.0+e8784a2f` (2026-10-15). Откат машины на plugin — «Итог» `worfy-harness` 16.
- `worfy-link` (Project ведётся с другой Machine по LAN; [spec](.scratch/worfy-link/spec.md)): влиты 01–15, 17–26; осталась приёмка 16. Вне LAN через Tailscale (ADR-0070) — 27–31, код после очереди `worfy-windows`.
- `worfy-windows` (порт под Windows; spec, ADR 0054–0057, 0062, 0063, 0069): `epic-status` — 44/61; 2026-10-18 влиты 13, 17, 29–34, 36–38, 49, 52, 58; 06 (#456) ждёт живой `preflight` на ПК, 07 — Q31 и запуск worfy на ПК.
- `worfy-windows`, ПК: gate fast — lint и typecheck до закрытия 14; worktree-ы — в `C:/Users/Alexey/worfy-wt`, вне `%TEMP%` (Q25, 52); новые 61 (low, предупреждение о Project-е в `%TEMP%`) и 62 (остатки ревью).
- #498 (`worfy-windows` 40, node-pty beta.15) вливается до 39; Stable copy на Windows между ними не ставить: OpenConsole beta.15 кладёт ~10 `ESC[6n` (запрос позиции курсора) на resize в вывод, re-mount view Terminal шлёт их ответы shell-у как ввод.
- Решено без владельца (2026-10-18, ночь): ответ main на `ESC[6n` без смонтированной view — в PR 39, без него 39 не вливать (и две открытые view на beta.15); #498 — первым.
- `worfy-terminal-ai` ([spec](.scratch/worfy-terminal-ai/spec.md), ADR-0058): влиты 01–08, 10–14 (11 — связь shell-а закрыта на время команды, `bye`; 12 — `transcript-date` у полуночи; 13 — ⌘I шлёт строку; 14 — zle на Linux); 09 — приёмка; 15 (low) — связь у программ prompt-а. Долги — «Итог» 11–13.
- `worfy-terminal-ssh` (Terminal AI в SSH session; [spec](.scratch/worfy-terminal-ssh/spec.md), подтверждён владельцем 2026-10-18): 0/10; spike 01 blocked — ждёт сервер.
- `worfy-ui` ([spec](.scratch/worfy-ui/spec.md)): влиты 01–11, 13–15 (11 — [PR #328](https://github.com/IDSAD-XL/worfy/pull/328); 14 — ⌘[ в реестре сочетаний, #449; 15 — подписи composer-а, #450); остался 12 — приёмка.
- `worfy-review` (приёмы ponytail, pstack и Thermos в ревью и implementer Harness; [spec](.scratch/worfy-review/spec.md)) — 8/8, влиты все; вопросы владельцу — «Итог» 07, 08.
- `worfy-polish`: 30/32 — 01–29, 31 влиты (12 — отчёт; 20, 26 — узкий круг; 19 — после `pnpm test` на ПК). 32: PR #497 влит, до закрытия — замер 30 (N ≥ 6) Orchestrator-ом; 30 (#401) ждёт 32.
- `worfy-throughput` ([spec](.scratch/worfy-throughput/spec.md)): 4/9, влиты 01–03 (`wave-gate`, ADR-0065) и 08 (#433, ADR-0068): batch CI на `main` включён; 06 — stub-ы для Windows, 07 — дерево `wave-gate`, 09 — `UNKNOWN` в текстах batch; 04, 05 — Session Orchestrator-а.
- `worfy-pipeline` (Stage и «кого ждёт» у Ticket-ов; [spec](.scratch/worfy-pipeline/spec.md), ADR-0067): 6/8, влиты 01–05, 07; 06 — PR #501; 08 открыт; блок Pipeline (Q8) — в Profile Mac и ПК; `rules.md:46` (замок e2e) — слово владельца, «Итог» 02.

## Ждёт владельца

- `wave-gate` на Mac краснит typecheck в своём дереве: до `worfy-throughput` 07 — merge-once.
- Приёмка E3 («Итог» `worfy-harness` 26) закрыта 2026-10-15: пункты 1–5 приняты, версия `0.3.0`. Ошибка в окне без `gate/config.json` принята.
- Вход в песочнице приёмки открывает `claude plugin validate` и живые проверки `worfy-harness` 05–08.
- Песочница приёмки лежит в `$TMPDIR`: macOS каждую ночь в 03:35 удаляет файлы без обращений три дня; 2026-10-13 пропала метка. Исправление — `worfy-harness` 36.
- Приёмка `worfy-link` 16 (Bonjour, запрос Local Network из 02) — код готов. Tailscale на Mac и ПК ставит владелец (ADR-0070, Ticket 31).
- Одной сессией после `worfy-terminal-ai` 09 — проверки только для владельца: знак worfy в Dock и Finder (`worfy-daily` 31), щелчок по баннеру с выключенным Focus (`worfy-mvp` 21), запрос разрешения на уведомления (`worfy-daily` 03), трекпад в Terminal (`worfy-daily` 13), fish (`worfy-mvp` 06).
- На экране висят неотвеченные системные окна: Automation «"claude" wants access to control "Finder"» и `universalAccessAuthWarn` о Screen Recording (`worfy-daily` 03 и 31, «Ручная проверка 2026-10-07»).
- `worfy-windows`, ПК: на C: нет места (Фото iCloud); 12 — SmartScreen установщика; 07 — Q31 и `Get-Process` установленного worfy.
- `worfy-harness` 27: как дать прогонам eval `Bash` — варианты (а), (б), (в) в «Итог» 27 (ссылки в `~/.docker/bin/lib`).
- Утром: после eval `worfy-harness` 27 — `mv ~/docker-bin.off ~/.docker/bin`; job «Windows tests» для #499 (`worfy-windows` 45) — слово владельца или снять пункт; приёмки (Q14).
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
- Замок e2e: heartbeat `touch -c` раз в 5 мин (`rules.md`, `epic-wave/SKILL.md`); `touch -c` без папки — exit 0, и heartbeat shell-а, убитого без trap, вечен (`worfy-harness` 49).
- Долги low — в «Итог» Ticket-ов (абзацы «Долг» и подраздел «Долги из HANDOFF (2026-10-08)»), разбор — шаг документов при закрытии Epic-а.

## Дальше

- `worfy-harness` 27 — после решения владельца: первый платный run `epic-wave-tickets` и пересчёт цены; 29 — карта «кейс eval → файлы правил».
- `worfy-windows`, очередь (2026-10-18, ночь): #498, затем 39; #499 — после job; 57, 15, 42, 43, 59, 62; 47, 48 — Mac; 14, 16 — итог на ПК; 61 — low; 56, 60 — в своих PR.
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
- Spec-и: [worfy-harness](.scratch/worfy-harness/spec.md), [worfy-link](.scratch/worfy-link/spec.md), [worfy-windows](.scratch/worfy-windows/spec.md), [worfy-review](.scratch/worfy-review/spec.md), [worfy-terminal-ai](.scratch/worfy-terminal-ai/spec.md), [worfy-ui](.scratch/worfy-ui/spec.md).
- Этапы E1–E4 — [roadmap](docs/roadmap.md).
- Исследования внешних проектов — [docs/research/](docs/research/).
- Решения — [docs/adr/](docs/adr/): 0001–0024 и 0029–0070, номера 0025–0028 не используются.
- Уроки — [docs/lessons/](docs/lessons/): `process.md`, `agents.md`, `ci-merge.md`, `testing.md`. Словарь терминов — [CONTEXT.md](CONTEXT.md). Дизайн — [F-SPEC](docs/design/F-SPEC.md).
- Реестр Gate живёт вне репозитория (`~/.claude/gate/config.json`, после переноса — `$HARNESS_HOME/gate/`); что в нём для worfy — «Итог» `worfy-mvp` 32.
- Прошлые снимки — `git log -p -- HANDOFF.md`; последний подробный, до сжатия 2026-10-08, — `git show 84684b5:HANDOFF.md`.
