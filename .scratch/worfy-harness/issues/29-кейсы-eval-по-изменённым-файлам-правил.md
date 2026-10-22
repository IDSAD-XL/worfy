# 29 — Кейсы eval по изменённым файлам правил: карта «кейс → файлы правил», `pnpm eval:harness -- --changed <base>`, строка для описания PR

Type: task
Status: done 2026-10-21T16:33Z
PR: #690
Blocked by: 27, 28
Source: решение владельца 2026-10-10 по второму вопросу Ticket-а 27 (eval-кейсы Harness через `claude plugin eval`) — «когда гонять полный набор»: перед мержем PR, который правит правила Harness, — кейсы изменённых файлов; полный набор — при смене закреплённой модели, версии Claude Code и перед обновлением Stable copy; владелец попросил отдельный маленький Ticket на связь «кейс → файлы правил»; [Ticket 27](27-eval-кейсы-harness-через-plugin-eval.md); [Ticket 28](28-git-и-harness-home-в-прогонах-eval.md) (git и `HARNESS_HOME` в прогонах eval); решение владельца о дешёвом CI (2026-10-06, PR #42); [документация `claude plugin eval`](https://code.claude.com/docs/en/plugin-evals); [spec.md](../spec.md)

## Что происходит

- В `harness/evals/` восемь кейсов (влиты PR #142, `27-…md:207-209`, `:292`). Какое правило и какой
  файл проверяет кейс, сказано только прозой: в `description` его `prompt.md` и в списке Ticket-а 27
  (`27-…md:14-34`). Машинной связи «кейс → файлы правил» нет.
- Файлы правил Harness: `harness/skills/*/SKILL.md` (восемь skills: `connect-project`,
  `continuous-audit`, `epic-wave`, `overnight-fix-loop`, `qmd`, `retro`, `ship-ticket`,
  `tickets-to-tasks`), `harness/agents/{implementer,reviewer,scout}.md`,
  `harness/hooks/rules/{common,orchestrator}.md`, а также `harness/hooks/hooks.json` и
  `harness/hooks/inject-rules.sh`, которые кладут правила в Session и Subagent. Кейсы есть только на
  `epic-wave`, `ship-ticket`, `implementer.md`, `reviewer.md` и `orchestrator.md`; кейсы на `retro`,
  `qmd`, `continuous-audit`, `overnight-fix-loop`, `tickets-to-tasks` Ticket 27 отложил
  (`27-…md:148-150`); на `connect-project`, `scout.md` и `common.md` кейсов нет.
- `scripts/eval-harness.mjs` выбирать кейсы по изменённым файлам не умеет. Всё после `--` уходит в
  `claude` как есть (`:17-18`, `:180-181`); кейсы выбирают только `--case` и `--tag` самого `claude`,
  скрипт читает их, чтобы пропустить пустой вызов (`:123-157`). В конце он печатает пути к
  `aggregate-result.json` и `report.html` (`:216-218`), но не их содержимое.
- В `aggregate-result.json` есть `partial`, `aggregates.overallScore`, `aggregates.casesPassed`,
  `costUsd`, `claudeVersion` (`27-…md:60-61`). В описание PR их сейчас переносят руками.
- Правило «когда гонять» нигде не записано. `harness/README.md`, раздел «Evals» (`:72-115`), говорит
  только, как запустить (`:88-89`) и что цена полного прогона не измерена (`:100-102`).
- В текстах skills места, где описан PR, который правит правила Harness, нет: поиск по
  `harness/skills/`, `harness/agents/`, `harness/hooks/rules/` слов `eval:harness`, `plugin eval` и
  путей `harness/skills|agents|hooks/rules` ничего не находит. Шаг 8 skill-а `ship-ticket` («PR and
  green CI», `harness/skills/ship-ticket/SKILL.md:282-294`) общий для всех Project-ов; особые
  требования Project-а он велит брать из `rules.md` Profile-а (`SKILL.md:76-78`). У Profile-а worfy
  там уже есть похожее правило — полный Gate перед мержем PR с кодом
  (`~/.claude/worfy-harness/projects/worfy/rules.md:25`). Этот файл лежит на машине, вне репозитория.
- На неизменённом Harness кейс `status-block` в шаге 0 Ticket-а 27 набрал 0.5 при пороге 0.8
  (`27-…md:245-248`), разбор отложен до полного прогона. Пока полного прогона нет, по строке из PR
  нельзя понять, сломала ли кейс правка или он не проходил и до неё.

## Что делаем

1. **Карта — `harness/evals/lib/coverage.json`.** Папка `lib/` уже лежит в `evals/` без `prompt.md`,
   и `claude plugin eval` с ней кейсы загружает (шаг 0 Ticket-а 27); новый файл в корне `evals/` так
   не проверен. Пути — от `harness/`. Два поля:
   - `cases` — имя кейса → список файлов правил, которые он проверяет;
   - `uncovered` — файл правил → причина одной фразой, почему кейса нет.

   Начальное содержимое — по `description` кейсов и списку Ticket-а 27:

   | Кейс | Файлы правил |
   | --- | --- |
   | `epic-wave-tickets`, `epic-wave-old-form` | `skills/epic-wave/SKILL.md` |
   | `ship-ticket-local-green`, `ship-ticket-pr-green-ci`, `no-os-screen-capture` | `skills/ship-ticket/SKILL.md` |
   | `implementer-report` | `agents/implementer.md` |
   | `reviewer-verdict` | `skills/epic-wave/SKILL.md`, `agents/reviewer.md` |
   | `status-block` | `hooks/rules/orchestrator.md`, `hooks/hooks.json`, `hooks/inject-rules.sh` |

   `uncovered`: `skills/retro/SKILL.md`, `skills/qmd/SKILL.md`, `skills/continuous-audit/SKILL.md`,
   `skills/overnight-fix-loop/SKILL.md`, `skills/tickets-to-tasks/SKILL.md` — «кейсы отложены
   Ticket-ом 27 до решения владельца после первого полного прогона»; `skills/connect-project/SKILL.md`,
   `agents/scout.md`, `hooks/rules/common.md` — «кейса нет». `status-block` стоит за `hooks.json` и
   `inject-rules.sh`, потому что это самый дешёвый кейс, который падает, когда hook `SessionStart`
   перестал класть правила в Session.
2. **Чистые функции — `scripts/eval-harness-coverage.mjs`** (отдельный модуль: `eval-harness.mjs`
   при импорте сразу запускает прогон, test его функции взять не может):
   - `ruleFiles(harnessDir)` — файлы правил на диске: всё под `skills/`, `agents/*.md`,
     `hooks/rules/*.md`, `hooks/hooks.json`, `hooks/inject-rules.sh`;
   - `coverageProblems(harnessDir)` — что не так с картой: файл правил не в `cases` и не в
     `uncovered`; файл в обоих; путь из карты, которого нет на диске; кейс из карты без папки; папка
     кейса без записи в карте; пустая причина в `uncovered`;
   - `casesFor(changedPaths, coverage, caseNames)` — кейсы для списка изменённых путей (от корня
     репозитория) и список изменённых файлов правил без кейса с причинами.
3. **`pnpm eval:harness -- --changed <base>`.** Опцию забирает сам скрипт, в `claude` она не уходит.
   - Изменённые файлы — как в Gate (`harness/hooks/gate.sh:286-288`): `git diff --name-only` от
     merge-base `<base>` и `HEAD` до `HEAD` плюс незакоммиченные из `git status --porcelain`, в
     репозитории скрипта.
   - Выбор: файл правил из `cases` → его кейсы; файл в `harness/evals/<кейс>/` → этот кейс; файл в
     `harness/evals/lib/` → все кейсы (фикстура и карта общие); файл правил из `uncovered` → строка
     «no case: <файл> — <причина>»; остальные файлы не учитываются.
   - Перед вызовами скрипт печатает, какой файл какие кейсы выбрал, и передаёт `claude` список
     `--case <кейс> …`; дальше всё как сейчас (два вызова по тегам, пустой вызов пропущен).
   - Ни один кейс не выбран — сообщение, код 0, `claude` не вызывается.
   - Код 1 без вызова `claude`: `<base>` не найден или git отказал; `--changed` вместе с `--case`,
     `--tag` или `HARNESS_DIR`; `coverageProblems` не пуст.
4. **Строка для описания PR.** После вызовов скрипт читает `aggregate-result.json` каждого вызова и
   печатает по строке:
   `eval:harness <тег>: casesPassed <n> of <выбрано>, overallScore <x>, costUsd <y>, claudeVersion <v>, cases <a,b,c>`;
   при `partial: true` в конце `, partial`. Число выбранных кейсов скрипт считает сам (`selects`,
   `:150-157`), в файле отчёта его не ищет. Файла нет или он не JSON — строка
   `eval:harness <тег>: no aggregate-result.json`; код выхода скрипта от этого не меняется. Строки
   печатаются и без `--changed`.
5. **Правило в `harness/README.md`, раздел «Evals»** (по-английски, как весь файл):
   - PR меняет файлы правил (`harness/skills/`, `harness/agents/`, `harness/hooks/rules/`,
     `harness/hooks/hooks.json`, `harness/hooks/inject-rules.sh`) или `harness/evals/` — перед мержем
     `pnpm eval:harness -- --changed origin/main` на ветке после rebase; строки `eval:harness …` — в
     описание PR. Проверка: `gh pr view <N> --json body --jq .body | grep -c '^eval:harness '` — не 0.
   - Кейс ниже порога: сравнить с последним полным прогоном (таблица в «Итог» Ticket-а 27). Кейс,
     который не проходил и там, мерж не держит, но называется в описании PR; кейс, который проходил,
     — правка чинится до мержа.
   - Полный набор `pnpm eval:harness` — при смене `MODEL` или `JUDGE_MODEL`
     (`scripts/eval-harness.mjs:38-39`), при новой версии `@anthropic-ai/claude-agent-sdk` в
     `package.json` (с ней приходит новый Claude Code) и перед обновлением Stable copy; его строки —
     в PR, который меняет модель или версию, либо в `HANDOFF.md` для Stable copy.
   - Цена — по «Итог» Ticket-а 27; CI и Gate eval не запускают, как и раньше.
   - Новый файл правил — в `coverage.json`: либо кейс, либо строка в `uncovered` с причиной.
6. **Тексты skills не правим.** Места про PR с правками правил в них нет, а `ship-ticket` общий для
   всех Project-ов. Правило worfy — в `rules.md` Profile-а worfy на машине, рядом с правилом про
   полный Gate (`rules.md:25`): одна строка со ссылкой на `harness/README.md`. Файл вне репозитория,
   это ручной шаг (ниже).

**Не входит:** новые кейсы для файлов из `uncovered`; запуск eval в CI или в Gate; автоматический
отказ в мерже по строке из PR; выбор кейсов по правкам скриптов `harness/bin/` и `harness/hooks/*.sh`
(это не файлы правил; их держат бесплатные test-ы).

## Готово, когда

- [ ] `test/contract/harness-evals.test.ts`: `coverageProblems(<harness репозитория>)` — пустой
  список. Каждый файл из `ruleFiles` — ровно в одном из двух: в списке хотя бы одного кейса или в
  `uncovered` с непустой причиной; все восемь кейсов есть в `cases`.
- [ ] Тот же test на копии `harness/` во временной папке: добавлен `skills/новый/SKILL.md` —
  `coverageProblems` называет его; файл одновременно в `cases` и `uncovered` — назван; путь из карты
  удалён с диска — назван; папка кейса без записи в карте — названа.
- [ ] Тот же test, `casesFor`: `harness/skills/epic-wave/SKILL.md` → `epic-wave-old-form`,
  `epic-wave-tickets`, `reviewer-verdict`; `harness/hooks/rules/orchestrator.md` → `status-block`;
  `harness/evals/status-block/graders/x.md` → `status-block`; `harness/evals/lib/demo-project.sh` →
  все восемь; `harness/skills/qmd/SKILL.md` → кейсов нет, файл в списке «без кейса» с причиной;
  `src/main/index.ts` → ничего.
- [ ] Тот же test, скрипт целиком со stub-ом вместо `claude`, во временном git-репозитории с копиями
  `scripts/eval-harness.mjs`, `scripts/eval-harness-coverage.mjs` и `harness/`: после коммита правка
  `harness/agents/implementer.md` и `-- --changed HEAD` — код 0, в логе stub-а один вызов с
  `--case implementer-report` и тегом `main`, вызова `gui` нет; `--changed` в аргументах `claude` нет.
- [ ] Тот же test: правка только `README.md` репозитория и `--changed HEAD` — код 0, лог stub-а
  пуст, в выводе сказано, что кейсы не выбраны. `--changed нет-такой-ветки` — код 1, лог пуст.
  `--changed HEAD --case status-block` — код 1, лог пуст.
- [ ] Тот же test: stub пишет в `--output-dir` файл `aggregate-result.json` с известными числами —
  в выводе скрипта строка `eval:harness main: casesPassed 1 of 1, overallScore 1, costUsd 0.3,
  claudeVersion 2.1.289, cases implementer-report`; с `partial: true` — строка кончается на
  `, partial`; stub файла не написал — `eval:harness main: no aggregate-result.json`, код выхода —
  код stub-а.
- [ ] `grep -nE 'eval:harness|plugin eval' .github/workflows/ci.yml harness/hooks/gate.sh` — код 1.
- [ ] `grep -n -- '--changed' harness/README.md` — код 0; в разделе «Evals» есть три события полного
  набора и команда проверки описания PR.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0. Ни один test не запускает настоящий Claude
  Code, не обращается к модели и не пишет в `~/.claude`.
- [ ] `gate.sh fast` на ветке — код 0 и строка `[gate] зелено (…)`.
- [ ] (вручную, владелец или Orchestrator вне PR) В `~/.claude/worfy-harness/projects/worfy/rules.md`
  рядом со строкой про полный Gate — строка: PR, который правит файлы правил Harness, перед мержем
  проходит `pnpm eval:harness -- --changed origin/main`, строки `eval:harness …` — в описании PR;
  подробности — `harness/README.md`, раздел «Evals». Как проверить:
  `harness/bin/profile -C <репозиторий worfy> --rules | grep -c 'eval:harness'` — не 0.

## Тесты

Сначала падающий test — в `test/contract/harness-evals.test.ts`, случай «каждый файл правил покрыт
кейсом или записан в `uncovered`». На main нет ни `harness/evals/lib/coverage.json`, ни
`scripts/eval-harness-coverage.mjs` — test красный. В «Итог» — как он падал.

- `test/contract/harness-evals.test.ts` — карта против диска и её поломки на копии; `casesFor`;
  `--changed` со stub-ом во временном git-репозитории; строка из `aggregate-result.json`, который
  пишет stub. Идёт в CI, Claude не зовёт, подписку не тратит.
- Платных прогонов у этого Ticket-а нет. Первый настоящий `--changed` — на первом PR, который
  правит правила после его влития; его строки — в описании того PR.

## Где в коде

- `harness/evals/lib/coverage.json` — новый
- `scripts/eval-harness-coverage.mjs` — новый
- `scripts/eval-harness.mjs`
- `test/contract/harness-evals.test.ts`
- `harness/README.md`

## Итог

PR [#690](https://github.com/IDSAD-XL/worfy/pull/690), merge 3beb6ea1. Gate full на main 44b3e7ab зелёный (прогон на
30649627 был красным только на известном flaky test-е harness-scripts под нагрузкой). Не платформенный PR. Платных
run-ов не было.

- **Карта** `harness/evals/lib/coverage.json`: десять кейсов (не восемь, как писал Ticket: добавлены
  `reviewer-intended-breakage` и `reviewer-simplification` → `agents/reviewer.md`); каждый файл правил — под кейсом или
  в `uncovered` с причиной (в том числе skills `gate-queue` и `max-review`, которых Ticket не знал). `inject-rules.sh`
  теперь `hooks/inject-rules.mjs`.
- **`scripts/eval-harness-coverage.mjs`**: `ruleFiles`, `coverageProblems` (файл без записи, запись без файла, кейс без
  папки, папка без записи, пустая причина, форма карты, нечитаемая карта), `casesFor`.
- **`pnpm eval:harness -- --changed <base>`**: изменённые файлы — коммиты от merge-base и незакоммиченные, через
  `git diff`/`git status` с `--no-renames` и `-z` (перенос файла между папками кейсов выбирает оба кейса; пути с
  пробелами и кавычками). Ничего не выбрано — exit 0 без вызова `claude`.
- **Отступление от Ticket-а:** `claude plugin eval --case` берёт один glob (только `*` и `?`), список не передать. Поэтому
  один вызов на выбранный кейс; если выбраны все кейсы тега — один вызов на тег. Бюджет 30 USD — на весь запуск:
  каждый вызов получает остаток; вызов без отчёта засчитывает весь свой лимит; остаток 0 — стоп, exit 2.
- **Строка для PR:** `eval:harness <tag>: casesPassed …` из `aggregate-result.json` на каждый вызов (`, partial` у
  частичного; нет отчёта — так и пишет).
- **README** «Evals»: десять кейсов, карта, `--changed`, бюджет, когда гонять.
- **Test-ы** (`test/contract/harness-evals.test.ts`, stub `claude`, временный git): 28 красных до кода, 173 passed после.
  Мутанты (`casesFor` без карты, без проверки существования, без незакоммиченных, без `--no-renames`, `..HEAD`,
  `--version` до «ничего не выбрано», бюджет на вызов, partial как 0, `left < 0`, отчёт без цены как 0 и др.) — красные.
- **Ревью:** три круга. Круг 1 (high): correctness BLOCK — med (переименование теряло старый кейс); tests — PASS, 7
  выживших мутантов. Круги 2 и 3 (medium) — только low, исправлены.
- **Q-H29 решён владельцем 2026-10-22:** платный `eval --changed` перед мержем PR, который правит правила Harness,
  идёт только с одобрения владельца на этот PR. Бюджета на запуски без вопроса пока нет. Правило записано в
  `~/.claude/worfy-harness/projects/worfy/rules.md` (раздел о проверках): Orchestrator спрашивает, какой PR, какие
  файлы правил и примерную цену прогона; без ответа «да» eval не запускается, PR ждёт владельца.
- **Follow-up:** Ticket 62 — та же потеря старого пути при переименовании в `harness/hooks/gate.mjs`.
