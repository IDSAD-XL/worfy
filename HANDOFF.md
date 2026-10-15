# Передача контекста — снимок на 2026-10-15 (UTC), main @ af1286d

## Сейчас в работе

- `worfy-harness` (E3: Harness владельца — plugin worfy; [spec](.scratch/worfy-harness/spec.md)): влиты 01–26, 30, 32, 35, 37, `epic-status` — 30/46; 26 (приёмка E3) закрыт 2026-10-15, версия `0.3.0` (PR #323); 27 (платная часть eval) ждёт 28; 29 — после 27 и 28; открыты 31, 33, 34, 36, 38–46.
- `worfy-week` (неделя работы владельца из worfy; [spec](.scratch/worfy-week/spec.md)): влиты 17 из 19; 19 (старая неудача в окне First run, low) открыт. Ticket 14 (перетаскивание без фризов) отложен владельцем, `blocked`; работа — только в локальной ветке `wip/worfy-week-14` («Итог» Ticket-а 14).
- Stable copy и plugin `worfy` — `0.3.0+e8784a2f` (2026-10-15). Откат машины на plugin — «Итог» `worfy-harness` 16.
- `worfy-link` (Project одной Machine ведётся с другой по локальной сети; [spec](.scratch/worfy-link/spec.md)) начат, пока E3 ждёт: влиты 01–15, `epic-status` — 15/19; 11 — «Add project» на Linked machine (PR #196), вход в gh — только `local`. Осталась приёмка 16; 17 и 18 — до связи с чужой машиной.
- `worfy-windows` (полный порт под Windows; spec, ADR 0054–0057, 0062, 0063): влиты 01–03, 08–12, 18–28, 35, 44 (PR #172–#298), `epic-status` — 22/50; 46 закрыт — `gate.sh` остаётся (решение владельца 2026-10-14); на ПК — 14. Владелец, 2026-10-13: 03–07 не ждут закрытия E3; очередь ПК — в «Дальше».
- `worfy-terminal-ai` ([spec](.scratch/worfy-terminal-ai/spec.md), ADR-0058): влиты 01–08, 10; 09 (приёмка) — владелец.
- `worfy-ui` ([spec](.scratch/worfy-ui/spec.md)): влиты 01–10, 13; 11 — [PR #328](https://github.com/IDSAD-XL/worfy/pull/328) `VERIFIED` по Mac, ждёт Windows-ПК; 12 — приёмка.
- `worfy-review` (приёмы ponytail, pstack и Thermos в ревью и implementer Harness; [spec](.scratch/worfy-review/spec.md)) — 7/8: влиты 01–03, 05–08; 04 — [PR #332](https://github.com/IDSAD-XL/worfy/pull/332) `VERIFIED` по Mac, ждёт Windows-ПК; вопросы владельцу — «Итог» 07, 08.
- `worfy-reliability` (надёжность Autopilot и уроки из сбоев; [spec](.scratch/worfy-reliability/spec.md)): 0/4, по исследованию PR #325; первым 01.
- `worfy-polish` (мелкие исправления, стабильность test-ов, три фичи; [spec](.scratch/worfy-polish/spec.md)): 0/12 по ресерчу 2026-10-15; первыми 01–05, 12 — research.

## Ждёт владельца

- Приёмка E3 («Итог» `worfy-harness` 26) закрыта 2026-10-15: пункты 1–5 приняты, версия `0.3.0`. Ошибка в окне без `gate/config.json` принята.
- Вход в песочнице приёмки открывает `claude plugin validate` и живые проверки `worfy-harness` 05–08.
- Песочница приёмки лежит в `$TMPDIR`: macOS каждую ночь в 03:35 удаляет файлы без обращений три дня; 2026-10-13 пропала метка. Время обращения обновлено, хватит до 2026-10-16; исправление — `worfy-harness` 36.
- `worfy-link` 02: вручную — dev-сборка и Stable copy находят друг друга по Bonjour и связываются по коду; появился ли запрос Local Network и на каком шаге — [Ticket 02](.scratch/worfy-link/issues/02-link-a-machine-код-список-и-отзыв.md), «Итог».
- Мусор на машине: удалить ли 13 папок транскриптов spike-а `~/.claude/projects/*worfy-harness-probe*` (`worfy-harness` 01) `~/.claude/worfy-harness/worktree-sessions/` (`worfy-harness` 11).
- Мусор от проб `worfy-harness` 22: `~/.claude/projects/-private-tmp-worfy-harness-w10-impl-22-{probe-t0,p7-repo}/` и пустые `~/.claude/session-env/*` — удалить ли.
- Реестр Gate и Profile worfy вне репозитория: в `root_if` записи `worfy` дописать `|^harness/|(^|/)HANDOFF\.md$` («Итог» `worfy-harness` 02); в `rules.md` убрать «скрипта проверки … пока нет».
- Проверки только для владельца: знак worfy в Dock и Finder (`worfy-daily` 31), щелчок по баннеру с выключенным Focus (`worfy-mvp` 21), запрос разрешения на уведомления (`worfy-daily` 03), трекпад в Terminal (`worfy-daily` 13), fish (`worfy-mvp` 06).
- На экране висят неотвеченные системные окна: Automation «"claude" wants access to control "Finder"» и `universalAccessAuthWarn` о Screen Recording (`worfy-daily` 03 и 31, «Ручная проверка 2026-10-07»).
- `worfy-windows` 12 (влит, PR #237): SmartScreen у скачанного установщика не проверен — его диалог закрывает человек: [Ticket 12](.scratch/worfy-windows/issues/12-сборка-nsis-и-stable-copy-на-windows.md).
- `worfy-windows` 35 (влит, PR #287): пробный том на ПК отключает владелец, шаги — в «Итог» Ticket-а; test на настоящих папках (Ticket 45, пункт 1) ждёт его слова в чате Windows Session.
- `worfy-link` 19: нужна ли строка-подсказка под переключателем доступа о том, что без него «Keep awake» не действует, — вопрос в Ticket-е.
- `worfy-ui`: вручную — раздел Health (06) и ⌘B (10); AltGr на Windows-ПК (03) — пока владелец не скажет в чате ПК; gate full на Windows для 03 и 10 — после e2e Windows (`worfy-windows` 14); решения и долги — «Итог» 03–06, 09, 10, 13; 11 — gate full на Windows-ПК и решения в PR #328.
- `worfy-terminal-ai`: контраст Suggestion 2,30:1 и 2,71:1 — `worfy-polish` 02 (revert, если владелец против); решения без владельца — «Итог» 03–08, 10 (e2e `session-view` у полуночи).

## Риски и долги

- Gate full красный 2026-10-12 23:04 – 10-13 01:02 — `fseventsd` (102–116 % CPU, 4,2 ГБ, 32 дня); лечит `sudo killall fseventsd` (kickstart запрещён SIP) и перезапуск приложений с наблюдателями; признак — `docs.test.ts`, `claude-home-registry.test.ts` красные и на main; замеры — `worfy-windows` 26.
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
- Приёмки `worfy-harness` 26 и `worfy-link` 16 (связь dev-сборки со Stable copy) — вместе с владельцем, не в Autopilot.
- Ручные проверки на Stable copy одним блоком, пока владельца нет за Mac-ом: `worfy-week` 02, 05, 08–12, 15–18, `worfy-harness` 18 (две Session после `pnpm install:stable`), 19, 21, 24, 25 (проверка 08 закрывает и 03, проверка 10 — и `worfy-daily` 11). Шаги — пункты «(вручную)» Ticket-ов.
- Ждут условия (проверит агент): упор в Limits (`worfy-daily` 05), наблюдатель касаний (`worfy-daily` 04), workflow-скрипт в Autopilot (`worfy-daily` 29, 17), бейджи у Ticket-а с открытым PR (`worfy-mvp` 17, `worfy-week` 01).
- Неделя работы владельца из Stable copy (условие 4 E2 и цель `worfy-week`): каждый дефект и каждое вмешательство человека — Ticket `worfy-week`, следующий номер 20.
- `worfy-harness` 31: `$0` и `$1` в shell-блоках skills подменяются аргументами вызова.
- Кандидаты Harness: изоляция `preflight.test.sh` (`worfy-harness` 11), абсолютный путь к `gh` (`worfy-harness` 01), PATH с node в hook-е `gh-token-env.sh` (`worfy-harness` 18); прочие — `worfy-polish`.
- После E3 — `worfy-link` (ведёт Session на Mac) и `worfy-windows` (Session на Windows-ПК) параллельно. PR Windows с общим кодом получают метку `needs-mac-gate`, их вливает Session на Mac (spec `worfy-windows`, Q30–Q33).
- E4 (подпись Developer ID и нотаризация) — после `worfy-link` и `worfy-windows` и только при первом внешнем пользователе ([roadmap](docs/roadmap.md)).

## Где остальное

- `worfy-mvp` (первая версия, 33/33) закрыт — [spec](.scratch/worfy-mvp/spec.md); где что в коде и долги — «Итог» его Ticket-ов.
- `worfy-daily` (E2, Autopilot, 32/32) закрыт — [spec](.scratch/worfy-daily/spec.md); условия 3 и 4 готовности E2 ещё не выполнены (`docs/roadmap.md`, E2).
- `worfy-week` (17/20, Ticket 14 отложен; 20 — relaunch ждёт выхода старого процесса, низкий приоритет) — [spec](.scratch/worfy-week/spec.md); условия готовности на 2026-10-08 — «Итог» Ticket-а 12.
- Spec-и: [worfy-harness](.scratch/worfy-harness/spec.md), [worfy-link](.scratch/worfy-link/spec.md), [worfy-windows](.scratch/worfy-windows/spec.md), [worfy-review](.scratch/worfy-review/spec.md), [worfy-terminal-ai](.scratch/worfy-terminal-ai/spec.md), [worfy-ui](.scratch/worfy-ui/spec.md).
- Этапы E1–E4 — [roadmap](docs/roadmap.md).
- Исследования внешних проектов — [docs/research/](docs/research/).
- Решения — [docs/adr/](docs/adr/): 0001–0024 и 0029–0062, номера 0025–0028 не используются. Следующий свободный — 0063.
- Уроки — [docs/lessons/](docs/lessons/): `process.md`, `agents.md`, `ci-merge.md`, `testing.md`. Словарь терминов — [CONTEXT.md](CONTEXT.md). Дизайн — [F-SPEC](docs/design/F-SPEC.md).
- Реестр Gate живёт вне репозитория (`~/.claude/gate/config.json`, после переноса — `$HARNESS_HOME/gate/`); что в нём для worfy — «Итог» `worfy-mvp` 32.
- Прошлые снимки — `git log -p -- HANDOFF.md`; последний подробный, до сжатия 2026-10-08, — `git show 84684b5:HANDOFF.md`.
