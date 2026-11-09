# Передача контекста — снимок на 2026-11-08 (UTC), main @ 4a9b6c75b

## Сейчас в работе

- `worfy-harness` (E3, plugin worfy; [spec](.scratch/worfy-harness/spec.md)): 70/71; влиты 62, 64, 65 (#719), 66 (#949), 67 (#1011), 68 (#945), 69 (#1015), 70 (#778), 71 (#829), 52, 63 (#713); задачи 52 — у владельца; 31, 36, 47, 48, 50, 51 — шаг владельца.
- `worfy-week` (неделя работы владельца из worfy; [spec](.scratch/worfy-week/spec.md)): влиты 20 из 20 (20 — PR #345; 14, перетаскивание без фризов, — PR #429). Проверка 14 на Stable copy и судьба ветки `wip/worfy-week-14` — за владельцем.
- Stable copy и plugin `worfy` на Mac и ПК — `0.3.0+bacbbcef` (2026-11-03). Откат машины на plugin — «Итог» `worfy-harness` 16.
- `worfy-link` ([spec](.scratch/worfy-link/spec.md)): закрыт, 42/42, принят владельцем 2026-11-02; 31 (Tailscale) принят 2026-10-31; 41 (дубль сообщения, #1114) и 42 (поток строк смены сети, #1119) — проверка после Stable.
- `worfy-windows` (ADR 0054–0057, 0062, 0063, 0069, 0071; прошлое — «Итог» 39, 60, 66, 67): 119/120; влиты 118–120; 15 и 118 вместе прошли зелёный gate full на ПК (`5557f744`). Осталась приёмка 16; красный только на Windows — fix или Windows exception (Q1/Q9).
- `worfy-terminal-ai` ([spec](.scratch/worfy-terminal-ai/spec.md), ADR-0058) — **добиваем, владелец 2026-10-23**: закрыт, 17/17, принят владельцем 2026-11-02 (17 — #1056, ветка git из файлов).
- `worfy-terminal-ssh` (Terminal AI в SSH session; [spec](.scratch/worfy-terminal-ssh/spec.md), подтверждён владельцем 2026-10-18) — **отложен владельцем 2026-10-21**: 0/10; spike 01 blocked — ждёт сервер.
- `worfy-ui` ([spec](.scratch/worfy-ui/spec.md)): закрыт, 28/28, принят владельцем 2026-11-02; долги — «Итог» 03–06, 09, 10, 13–15.
- `worfy-review` (приёмы ponytail, pstack и Thermos в ревью и implementer Harness; [spec](.scratch/worfy-review/spec.md)) — 8/8, влиты все; вопросы владельцу — «Итог» 07, 08.
- `worfy-polish`: 47 (flaky Windows) ждёт 20 зелёных `windows-e2e`. Влиты 73 (#1663: hook `UserPromptSubmit` со строками Stage, cwd на Windows), 74 (#1668: Electron из `actions/cache`, 3 попытки).
- `worfy-throughput` ([spec](.scratch/worfy-throughput/spec.md)): 59/61; открыты 05, 43; 31 закрыт 11-09. 43: eco у друга.
- `worfy-pipeline` (Stage и «кого ждёт»; [spec](.scratch/worfy-pipeline/spec.md), ADR-0067): 10/10, влиты 01–10 (08 — #552, 09 — #550, 10 — #577); решения владельца (Q1–Q16) в Ticket-ах; `rules.md:46` (замок e2e) — слово владельца, «Итог» 02.
- `worfy-neutral` (Harness нейтрален по языку и проекту; [spec](.scratch/worfy-neutral/spec.md), ADR-0074): 9/10 (01–07, 09, 10 влиты; 10 — #649); 08 — после следующего release; до 08 — шаги владельца из «Итог» 04, 06, 07 и 10 (10 — после Stable с #649).
- `worfy-canvas` ([spec](.scratch/worfy-canvas/spec.md), ADR 0075–0077, 0082): 24/24; 24 — картинки на Linked machine (#1018), три решения — подтвердить владельцу.
- `worfy-browser` ([spec](.scratch/worfy-browser/spec.md)): 18/19; 18 — #1008, ADR-0087. 19 (эмуляция устройств) — ждёт владельца, не брать.
- `worfy-update` ([spec](.scratch/worfy-update/spec.md), ADR-0089): закрыт, 16/16, принят владельцем 2026-11-02 (Mac). `worfy-guide`: закрыт, 21/21.
- `worfy-flight-recorder` (ADR-0091, 28/28) и `worfy-resource-planner` (12/12): закрыты, приняты владельцем 2026-11-01; Windows-часть FR 25 не проводилась.
- `worfy-autopilot-queue` (очередь Epic-ов и старт Autopilot при занятом Orchestrator-е; [spec](.scratch/worfy-autopilot-queue/spec.md)): приёмка 20 принята владельцем 2026-11-07 («по всем +»; «Итог» 20). Открыт 21 — «Start anyway» в окне очереди и последний Epic, ждущий владельца (Q1, Q2 приёмки).
- `worfy-work-track` (Work track во вкладке Runs; [spec](.scratch/worfy-work-track/spec.md)): закрыт, 13/13, принят владельцем 2026-11-07 («принимаю трек»); «Итог» 12.
- `worfy-multi-vendor`: 45/46, код в main; осталась 43 (приёмка владельца). Подтвердить: «Итог» 16, 17, 21–23, 25–29, 31, 33–42, 44, 45 (`additionalContextLimit`), 46, ADR-0095; `high` 19–21. Должен: gate full ПК на `c4eb4117`.
- `worfy-retry` закрыт 14/14, принят владельцем 2026-11-07 («Итог» `worfy-retry` 11). Spec `worfy-auto-approve` принят 11-04; `worfy-faults` 8/8 принят 11-06; `worfy-failures` закрыт 10/10, подтвердить его «Итог» 09.
- `worfy-evidence` закрыт 13/13, принят владельцем 11-07 на Mac и ПК («Итог» `worfy-evidence` 09).
- `worfy-product-session`: 14/18; 11-08 влиты 09 (#1659), 11 (#1654), 14 (#1672), 18 (#1680), 13 (#1675). 08 blocked: экран Mind map. Дальше 15, 16; 17 после 15.
- `worfy-scrub`: guard `scripts/check-personal.mjs` блокирует `pnpm lint` (06); слова — только `<Harness home>/user/privacy.json` владельца, хэши — `--hash-from`.
- `worfy-human-review`: 11/12; 11-08 влиты 05, 07–10 (10 — #1662), 11 (#1673), 12 (#1679; blocked: живой прогон и приёмка).

## Ждёт владельца

- Приёмки, старшие первыми: `worfy-multi-vendor` 43 (Mac Stable, затем ПК) → `worfy-windows` 16 → по готовности кода `worfy-auto-approve` 11; и ручные проверки (Mac и ПК, ~30 мин) — [пошаговые гайды](.scratch/owner-acceptance-guides.md).
- `worfy-windows` 07 закрыт (#1127, отступления Q31 подтвердить).
- Владелец в Mac Stable: экран Mind map (`worfy-product-session` 08), приёмка `worfy-human-review` 12.

## Риски и долги

- Test-ы наблюдателя файлов красные и на main — перегружен `fseventsd`: признак и лечение — урок в `docs/lessons/agents.md`.
- Удаление вне Windows больше не стирает том, примонтированный в папку Card-а: отказ с `EXDEV` (PR #293). Не видна точка монтирования с `dev` её папки (Ticket 47). На Windows junction по GUID закрыт PR #287; junction отключённого тома `purge` не удаляет (45, замер 6).
- Каждый мерж, который трогает `harness/`, кончается `pnpm install:stable` вне прогона Autopilot (ADR-0047): без пересборки Stable copy влитый урок не действует.
- Рабочий проект владельца пойдёт через полный предполёт Harness с `git fetch`. На его живых репозиториях это не проверено, только на клонах (`worfy-harness` 11).
- [med] С plugin-ом оживают долги про `gh`: Stop hook зовёт `gh` по имени, и `bin/gh` plugin-а подменит учётную запись (`worfy-harness` 01); `preflight` советует `gh auth switch` вместо `GH_TOKEN` (`worfy-week` 01).
- [med] `harness/bin/tests/preflight.test.sh` не изолирует `HOME` и пишет замки в настоящий `~/.claude/worfy-harness/` (`worfy-harness` 11). Запускать его только с `HOME` и `HARNESS_HOME` во временном каталоге.
- [med] Contract test-ы читают настоящий `~/.claude/settings.json`: если там `model: haiku`, падают 10 test-ов (`worfy-daily` 07 и 23).
- Нестабильные e2e роняют `gate full`: `binding.spec.ts:272` (узел Ticket-а 12 не виден за 5 s), `autopilot.spec.ts:485` (app не закрылся за quit timeout; gate PR #201), `edges.spec.ts:166` (толщина Edge пустая вместо `1px`; gate PR #269, повтор зелёный). Сводка — «Итог» `worfy-week` 06.
- Пока не сделан пункт о реестре Gate и Profile, Gate `fast` и CI не проверяют PR, где изменён только `HANDOFF.md`: перед его push — `node scripts/check-handoff.mjs`. PR только в `harness/` гоняют Gate с `GATE_SCOPE=all`.
- Gate `fast` с сужением по диффу не видит `scripts/` и `test/fixtures/` (`worfy-mvp` 01); условие merge — `ci-ok` (ADR-0083).
- Contract test-ы с дочерними процессами (`github-prs`, `harness-qmd`, `workflow-reader`, `docs`) при load 6–8 не укладываются в 15 s: gate fast параллельных исполнителей краснел.
- Ложный таймаут первого окна в e2e: причины — в [agents.md](docs/lessons/agents.md).
- CI: 5xx GitHub releases на zip Electron (11-08) закрыт polish 74. Один `gh run rerun --failed` на head при сбое GitHub, затем rebase.
- Замок e2e: в `rules.md` Profile владельца heartbeat ещё старый (без выхода при снятом замке); новая строка — в PR `worfy-harness` 49, вносит владелец.
- Windows exception-ы `terminal-windows-close-no-console-host` и `workflow-branches-gone-worktree-then-repository` (`test/quarantine/`) до 2026-12-15 — решает Orchestrator.
- Решение владельца не принято (`worfy-terminal-ai` 09, «Итог»): ответ Terminal AI появляется через ~0,6 s после готовности, потому что `attempt()` в `src/main/terminal-ai/assist.ts` ждёт выхода процесса `claude`, а не сообщения `result`.
- [low] `worfy-flight-recorder` — «Долг» в «Итог» 11–16, 21–23: `spans.ts:335`, `:613-620`, `:742`; helper `transcripts.ts`, account `githubFacts` — в 17.
- [low] `worfy-windows` — «Долг» в «Итог» 119, 120: test-ы порядка папок, `UCRT64` и skip под `WIN=1`.
- Долги low — в «Итог» Ticket-ов (абзацы «Долг» и подраздел «Долги из HANDOFF (2026-10-08)»), разбор — шаг документов при закрытии Epic-а.

## Дальше

- Очередь мержа (владелец, Q7, Q10) пройдена: #517, #496, #508 влиты; `worfy-pipeline` 08 влит (#552).
- `worfy-harness` 50, 51 — платный повтор кейса eval (`~/.docker/bin` вынести на время run-а); 52 — Session без plugin-а для задач и платные шаги 2б, 4, 5.
- `worfy-onboarding` ([spec](.scratch/worfy-onboarding/spec.md)): закрыт, 14/14, принят владельцем 2026-11-02; «Итог» ПК записан в 12.
- Ручные проверки на Stable copy одним блоком, пока владельца нет за Mac-ом: `worfy-week` 05, 08–12, 15, 17, 18, `worfy-harness` 18 (две Session после `pnpm install:stable`), 19, 21, 24, 25 (проверка 08 закрывает и 03, проверка 10 — и `worfy-daily` 11). Шаги — пункты «(вручную)» Ticket-ов.
- Ждут условия (проверит агент): упор в Limits (`worfy-daily` 05), наблюдатель касаний (`worfy-daily` 04), workflow-скрипт в Autopilot (`worfy-daily` 29, 17), бейджи у Ticket-а с открытым PR (`worfy-mvp` 17, `worfy-week` 01).
- Неделя работы владельца из Stable copy (условие 4 E2 и цель `worfy-week`): каждый дефект и каждое вмешательство человека — Ticket `worfy-week`, следующий номер 21.
- `worfy-harness` 31: `$0` и `$1` в shell-блоках skills подменяются аргументами вызова.
- Кандидаты Harness (`worfy-harness`): изоляция `preflight.test.sh` (11), абсолютный путь к `gh` (01), PATH с node в hook-е `gh-token-env` (18); прочие — `worfy-polish`.
- `worfy-link` ведёт Session на Mac, `worfy-windows` — Session на ПК; PR с ПК вливает Session на Mac по `ci-ok` и `review`; метки `needs-mac-gate` нет (ADR-0083).
- ПК должен gate full на свежем `main` за #878 (влит с `check/windows` skipped, решение 2026-10-28): ПК без питания с 2026-11-05 ~20:15Z; последний, `9731f583a`, — только flaky.
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
