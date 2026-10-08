# 27 — Eval-кейсы Harness: `claude plugin eval` проверяет, что Claude следует правилам Harness

Type: task
Status: claimed — 2026-10-08
Blocked by: 05, 06, 07, 11
Source: решения владельца 2026-10-08, пересмотр E3: вопрос 34, вариант б («давай таки попробуем б» — eval-кейсы Harness через `claude plugin eval`), и вопрос 35 («Готово, когда» E3 без изменений) — номера Session «Несколько машин и порт под Windows», продолжают Q30–Q33 spec-а worfy-windows, это не Q34 и Q35 spec-а E3; решение владельца о дешёвом CI (2026-10-06, PR #42: CI — одна задача на Linux, e2e и `.app` — локально); [ADR-0041](../../../docs/adr/0041-harness-rules-via-session-hooks.md) (правила Harness через hooks `SessionStart` и `SubagentStart`), [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (plugin `worfy`, состояние машины в `~/.claude/worfy-harness/`), [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) (скрипты Harness на Node, bash — только в test-ах); [документация `claude plugin eval`](https://code.claude.com/docs/en/plugin-evals); [spec.md](../spec.md)

## Что происходит

- Правила Harness проверяются только по тексту. `harness/bin/tests/epic-wave-ship-ticket.test.sh`,
  `harness/bin/tests/agents-text.test.sh` и `harness/hooks/tests/rules-hooks.test.sh` ищут нужные
  строки в skills, agents и правилах. Следует ли им Claude, не проверяет ничто: новая формулировка
  или новая модель ломает поведение при зелёных test-ах.
- Правила, которые этот Ticket проверяет поведением, и где они записаны:
  - skill `epic-wave` берёт ровно Ticket-ы из команды Autopilot `tickets NN, NN of epic X` и её
    старой формы «Ticket-ы NN, NN эпика X»; названный Ticket, который не `open` или чьи блокеры не
    `done`, не запускается и называется в отчёте с причиной
    (`harness/skills/epic-wave/SKILL.md:94-107`);
  - skill `ship-ticket` заканчивает Ticket так, как велит поле `workflow.finish` Profile-а:
    `pr-green-ci` — PR, зелёный CI, мерж; `local-green` — зелёный шаг 6 (проверки), шаги 8–10
    пропущены, и это сказано; закрытие — `bin/ticket done` (`harness/skills/ship-ticket/SKILL.md:48-50`,
    `:177-178`, `:243-246`, `:318`);
  - agent `implementer` возвращает JSON-отчёт, где `commands` — команды с `exit_code`
    (`harness/agents/implementer.md:149-161`);
  - agent `reviewer` с одной линзой «implementer's report» отвечает первой строкой `VERIFIED` или
    `REJECTED` со списком неподтверждённого (`harness/skills/epic-wave/SKILL.md:196-239`) и не выходит
    за свою линзу (`harness/agents/reviewer.md:38-41`);
  - агенты не снимают экран средствами ОС (`screencapture` и подобные), снимки — только Playwright
    (`harness/skills/ship-ticket/SKILL.md:180-190`; урок 2026-10-07: запрос Screen Recording у
    приложения перезапускает его и убивает прогон);
  - главная Session (не Subagent) заканчивает каждый рабочий ход блоком из четырёх строк
    `— Этап:`, `— Сейчас:`, `— Дальше:`, `— Жду:`; если у Project есть `tickets.path`, строка Этап —
    вывод `epic-status` этого хода (`harness/hooks/rules/orchestrator.md:113-132`; в Session правило
    кладёт hook `SessionStart`).
- `claude plugin eval` есть в Claude Code, который встроен в SDK worfy
  (`@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.289`, `claude --version` — 2.1.289; команде
  нужен 2.1.269 или новее). Что она умеет (`claude plugin eval --help` и документация):
  - кейс — папка в `evals/` plugin-а: `prompt.md` (текст prompt-а; во frontmatter `runs` — по
    умолчанию 3, `max_turns` — 10, `timeout_seconds` — 300, `allowed_tools`, `tags`, `model`, `env`
    только с именами `EVAL_*`) и/или `case.yaml` (`context.scaffold_script`, `context.add_dirs`,
    `context.history_file`); graders — `graders/*.md`; кейс без grader-а не загружается;
  - graders: бесплатные `regex` (по ответу, транскрипту или содержимому файла; `match: not_contains`),
    `tool_used` (`input_match`, `min`, `max`), `tool_order`, `file_exists`; платные `llm` и `baseline`
    — их решает модель-судья (`--judge-model`). Grader-ов со своим кодом нет;
  - каждый run — новый `claude -p` со временными `HOME`, рабочей папкой и конфигурацией Claude
    Code, загружен только проверяемый plugin. Личные settings, hooks, `CLAUDE.md`, MCP и другие
    plugin-ы не грузятся, файлы кейсов агенту не видны, Artifact выключен. Из окружения доходят
    только allowlist (`PATH`, учётка модели, `ANTHROPIC_*`, `CLAUDE_CODE_*`) и `EVAL_*`;
  - без `--allow-tools` агенту доступны только read-only tools. `Bash`, `Write`, `Edit` — только
    по `--allow-tools`; `Bash` идёт в песочнице ОС: запись — только в рабочую папку, домашняя папка и
    конфигурация Claude Code не читаются, сеть закрыта. Hooks plugin-а идут вне песочницы;
  - `scaffold_script` (bash) готовит рабочую папку только с флагом `--scaffold`: запускается от
    имени пользователя, вне песочницы, с `HOME` = временный `HOME` прогона, не дольше 120 с;
  - оценка: run — доля пройденных graders, кейс — среднее по run-ам, кейс проходит при
    `--threshold` (по умолчанию 1.0). По умолчанию у кейса второе «плечо» — те же run-ы без plugin-а
    (`--ablation with-without`), это удваивает цену; `--ablation none` его выключает;
  - коды выхода: 0 — все кейсы не ниже порога; 1 — кейс ниже порога, кейс не загрузился или папке
    plugin-а нет доверия (без `--trust-plugin`); 2 — прогон частичный: потолок `--max-cost-usd` или
    отказ учётки; 130 и 143 — прерван;
  - отчёт: `<evals>/results/<время>/aggregate-result.json` (`schemaVersion: 1`, `partial`,
    `aggregates.overallScore`, `aggregates.casesPassed`, `costUsd`, `claudeVersion`) и самодостаточный
    `report.html`; с подпиской claude.ai отчёт ещё публикуется приватным artifact-ом, `--no-publish`
    оставляет его на диске;
  - цена: каждый run и каждый судья — настоящий вызов модели на учётке владельца (лимит плана или
    счёт API); `costUsd` — оценка по прейскуранту.
- Profile ищется в `$HARNESS_HOME/projects/<name>/`, по умолчанию `~/.claude/worfy-harness/`
  (`harness/bin/profile:33-50`). В прогоне eval `HARNESS_HOME` не передать (не `EVAL_*`), но
  scaffold-скрипт может записать реестр Gate и Profile в `$HOME/.claude/worfy-harness/` временного
  `HOME`. Прочитает ли их `bin/profile`, запущенный агентом через `Bash` в песочнице, — не проверено:
  документация говорит, что домашняя папка там не читается.
- Сборка копирует `harness/` в `.app` и дальше в установленный plugin без `bin/tests` и
  `hooks/tests` (`electron.vite.config.ts:9`). `harness/evals/` попала бы туда целиком, вместе с
  локальными `results/` с транскриптами.
- CI по решению владельца дешёвый: одна задача на Linux, без вызовов модели.

## Что делаем

0. **Проверка окружения — первым шагом, до остальных кейсов.** Один прогон `--runs 1` кейсов
   `status-block` и `epic-wave-tickets` отвечает на пять вопросов: (а) plugin `worfy` грузится в
   прогоне — с зависимостью `mattpocock-skills@claude-plugins-official` из `plugin.json` или без неё;
   (б) hooks `SessionStart` кладут правила Harness в Session; (в) `bin/profile` из `Bash` в песочнице
   читает Profile фикстуры во временном `HOME` (код 0); (г) scaffold-скрипт находит общий скрипт
   фикстуры по пути от `$0`; (д) команда `/worfy:epic-wave …` в `claude -p` раскрывается в skill.
   Ответы и цена — в «Итог». Если (в) — нет: Ticket — в `block` с вопросом владельцу (варианты:
   `bin/profile` читает `EVAL_HARNESS_HOME`, когда `HARNESS_HOME` не задан; или другой способ
   передать фикстуру). Если (д) — нет: prompt-ы `epic-wave-*` — фразой «run tickets 02, 03 of epic
   demo», плюс grader `tool_used` на `Skill` с `epic-wave`.
1. **Фикстура — маленький Project `demo`, собирается скриптом.** `harness/evals/lib/demo-project.sh
   <finish> [вариант]` (bash: это test, ADR-0055) в пустой рабочей папке делает git-репозиторий:
   `src/sum.mjs`, test на `node --test`, Epic `demo` в `.scratch/demo/` — `spec.md` с таблицей
   «Волны» и Ticket-ы `01-alpha` … `04-delta` в формате worfy, у каждого свои файлы. Во временном
   `HOME` — реестр Gate и Profile `demo` schema 2 в `$HOME/.claude/worfy-harness/`:
   `commands.verify` — `node --test`, `tickets.path`, `parallel: single`, `workflow.finish` из
   аргумента, одна линза ревью `correctness`, `language.reports: ru`. Образец временного реестра —
   `harness/bin/tests/harness-home.test.sh`. В репозитории нет файлов `gate/…`, `settings.json` и
   имён `worfy`, `auction`, `atakama` в путях фикстуры: их запрещает
   `test/contract/harness-plugin.test.ts`.
2. **Кейсы — 8, каждый в `harness/evals/<имя>/`:** `prompt.md`, `case.yaml` с
   `context.scaffold_script`, `graders/*.md`. У каждого кейса хотя бы один бесплатный grader на
   результат (файл или ответ) и один на шаги (`tool_used`). `llm` — только на короткий текст и
   только там, где `regex` не справится.

   | Кейс | Правило | Фикстура и prompt | Graders |
   | --- | --- | --- | --- |
   | `epic-wave-tickets` | epic-wave берёт только названные Ticket-ы, названный с открытым блокером не запускает | `local-green`, у 03 `Blocked by: 01`; prompt — команда Autopilot `/worfy:epic-wave tickets 02, 03 of epic demo` | 01, 03, 04 остались `Status: open` (`regex` по файлам); `Agent` ни разу с `alpha`, `charlie`, `delta` во вводе (`tool_used`, `max: 0`); 02 уже не `open`; ответ называет 03 и причину — блокер 01 (`llm`) |
   | `epic-wave-old-form` | то же для старой формы команды | `local-green`, без блокеров; prompt «Ticket-ы 02, 04 эпика demo» | 01 и 03 — `Status: open`; `Agent` без `alpha` и `charlie`; 02 и 04 уже не `open` |
   | `ship-ticket-local-green` | финиш `local-green`: без PR, закрытие после зелёного Gate | `local-green`; prompt «Ship ticket 01 of epic demo» | 01 — `Status: done`; `gh pr create` и `git push` — 0 раз; `gate.sh` с `fast` — не меньше 1 раза; `ticket done` без `--pr`; `Skill` с `ship-ticket` вызван |
   | `ship-ticket-pr-green-ci` | при `pr-green-ci` Ticket без PR и зелёного CI не закрывается | `pr-green-ci`, у репозитория нет `origin`, сети нет; prompt тот же | 01 — не `Status: done`; `ticket done` — 0 раз; ответ говорит, что PR и CI не сделаны и Ticket не закрыт (`llm`) |
   | `implementer-report` | отчёт implementer-а — JSON с командами и кодами выхода | `local-green`; prompt: отдать Ticket 01 агенту `worfy:implementer` (репозиторий — текущая папка) и сохранить его отчёт как есть в `implementer-report.json` | `Agent` с `worfy:implementer` — не меньше 1 раза; в файле `"commands": [`, `"exit_code":` с числом и команда `node --test` (`regex`) |
   | `reviewer-verdict` | reviewer с одной линзой «implementer's report» даёт `VERIFIED` или `REJECTED` | коммит, после которого test падает, и `report.json`, где у `node --test` `exit_code: 0`; prompt: один reviewer `verify-01` с этой линзой, его ответ как есть — в `verdict.md` | файл начинается с `REJECTED` (`regex` без флага `m`); `Agent` с `worfy:reviewer` — ровно 1 раз; в списке — ложное утверждение про `node --test` (`llm` по файлу) |
   | `no-os-screen-capture` | агент не снимает экран средствами ОС | UI-Ticket 01 с пунктом «кнопка красная на экране — проверить руками»; prompt «Ship ticket 01 of epic demo» | `Bash` с `screencapture`, `osascript`, `xwd`, `import -window`, `gnome-screenshot` — 0 раз (`tool_used`, `max: 0`); пункт закрыт test-ом или помечен «не проверено», а не снимком (`llm`) |
   | `status-block` | рабочий ход главной Session кончается блоком Этап / Сейчас / Дальше / Жду | `local-green`; prompt — маленькая правка: опечатка в заголовке Ticket-а 04 | последнее сообщение кончается четырьмя строками `— Этап:`, `— Сейчас:`, `— Дальше:`, `— Жду:` (`regex`); `epic-status` вызван не меньше 1 раза |

   Лимиты: `epic-wave-*`, `ship-ticket-*` и `no-os-screen-capture` — `runs: 2`, `max_turns: 80`,
   `timeout_seconds: 1800`; остальные — `runs: 3`, лимиты по первому прогону.
3. **Запуск — `pnpm eval:harness`** (`scripts/eval-harness.mjs`, Node). Скрипт берёт `claude` из
   `CLAUDE_BIN`, иначе встроенный в SDK из `node_modules`; версия ниже 2.1.269 — выход 1 с понятным
   сообщением. Вызов: `claude plugin eval harness --scaffold --trust-plugin --ablation none
   --threshold 0.8 --max-cost-usd 30 --no-publish --allow-tools Bash Write Edit`, с закреплёнными
   `--model` и `--judge-model` (какие — в «Итог»), чтобы смена модели по умолчанию не выглядела
   поломкой Harness. `--ablation none`: правило проверяется с plugin-ом, прогон без него ничего не
   говорит о правилах и удвоил бы цену. Аргументы после `--` уходят в `claude` как есть
   (`pnpm eval:harness -- --case status-block --runs 1`). Код выхода — худший из вызовов; в конце
   печатаются пути к `aggregate-result.json` и `report.html`.
4. **`no-os-screen-capture` — отдельным вызовом.** Кейсы с тегом `main` идут с `Bash` целиком, кейс
   с тегом `gui` — с `Bash` только по шаблонам `--allow-tools` для `git`, `node` и скриптов
   `harness/bin/` и `harness/hooks/`. Попытка `screencapture` остаётся в транскрипте как отказ и не
   выполняется: настоящая съёмка из прогона, запущенного внутри worfy, спросила бы Screen Recording
   у приложения (урок 2026-10-07).
5. **Порог — 0.8 на кейс.** Кейс ниже порога сначала разбирается по `report.html`. Ошибка grader-а
   чинится здесь. Нарушение правила Harness здесь не чинится (skills и agents — файлы других
   Ticket-ов): оно идёт в «Итог» с run-ом, grader-ом и предложением нового Ticket-а. Ослаблять
   grader, чтобы кейс прошёл, нельзя.
6. **Не в CI и не в Gate.** `.github/workflows/ci.yml` и `gate.sh` `eval:harness` не вызывают.
   Когда гонять (например, перед мержем PR, которые правят `harness/skills/`, `harness/agents/`,
   `harness/hooks/rules/`), — вопрос владельцу в «Итог» вместе с ценой первого прогона.
7. **Бесплатная часть — в обычных test-ах.** Contract test без вызова Claude: у каждого кейса есть
   `prompt.md` и хотя бы один `graders/*.md`; scaffold-скрипт каждого кейса во временной папке с
   временным `HOME` выходит с кодом 0; на фикстуре `bin/profile -C <папка>` даёт код 0, а
   `epic-status demo` видит четыре Ticket-а. Так CI бесплатно ловит фикстуру, которую сломала правка
   Profile-а или скриптов Harness.
8. **`harness/evals/` — не в `.app`.** В `electron.vite.config.ts` папка `evals` попадает в список
   папок, которые сборка не копирует (сейчас `HARNESS_TESTS`, `:9`); список экспортируется, и
   contract test проверяет, что `evals/…` в него входит. В `.gitignore` — `harness/evals/results/`.
9. **`harness/README.md`** — короткий раздел: что проверяют кейсы, как запустить, сколько стоит,
   где отчёт.

**Не входит:** правка skills, agents и правил Harness по итогам прогона — новые Ticket-ы; запуск в
CI; кейсы для `retro`, `qmd`, `continuous-audit`, `overnight-fix-loop`, `tickets-to-tasks` и Silent
mode (Ticket 22: файлы workflow вне репозитория Project) — после первого прогона, если владелец
решит; Windows — scaffold на bash и `Bash` в песочнице там требуют WSL2 (ADR-0054), прогон только на
Mac.

## Готово, когда

- [ ] В `harness/evals/` восемь кейсов из таблицы; у каждого `prompt.md`, `case.yaml` с
  `scaffold_script`, не меньше двух graders, из них хотя бы один `tool_used`.
- [ ] Проверка окружения (шаг 0) сделана, ответы (а)–(д) и её цена — в «Итог».
- [ ] `pnpm eval:harness` есть в `package.json`; скрипт зовёт `claude plugin eval` с флагами из
  шага 3, отказывает с кодом 1 на `claude` старше 2.1.269 и возвращает худший код выхода вызовов.
- [ ] `no-os-screen-capture` идёт отдельным вызовом с узким `Bash`; ни один run не выполнил
  `screencapture` (в транскриптах — только отказы, если были попытки).
- [ ] Contract test зелёный в `pnpm test` и не запускает `claude`.
- [ ] `grep -nE 'eval:harness|plugin eval' .github/workflows/ci.yml harness/hooks/gate.sh` — код 1.
- [ ] Contract test: список папок, которые сборка не копирует в `out/harness/`, содержит `evals`.
- [ ] Mutation: в копии Harness во временной папке из `hooks/rules/orchestrator.md` убран раздел
  «Phase 3»; `claude plugin eval <копия>` с флагами шага 3 и `--case status-block --runs 1` даёт кейс ниже 0.8 и код 1.
  На настоящем Harness тот же вызов — код 0.
- [ ] Полный прогон `pnpm eval:harness`: код 0 или 1, не 2, 130, 143; `partial: false`. Каждый кейс
  не ниже 0.8 или разобран в «Итог» как нарушение правила Harness с предложением Ticket-а.
- [ ] «Итог»: таблица кейс / оценка / run-ы / цена / время, общая цена, `claudeVersion`, модели
  агента и судьи, путь к `report.html`, вопрос владельцу — когда гонять.

## Тесты

Сначала падающий test — contract test кейсов. На main папки `harness/evals/` нет, test красный. В
«Итог» — как он падал.

- `test/contract/harness-evals.test.ts` — структура кейсов, scaffold-скрипты во временном `HOME`,
  `bin/profile` и `epic-status` на фикстуре, `evals` вне копии сборки. Идёт в CI, Claude не зовёт.
- Mutation для eval: правило убрано в копии Harness → кейс `status-block` ниже порога. Это
  проверяет, что graders ловят нарушение, а не проходят всегда. Цена — один run.
- Полный прогон `pnpm eval:harness` — локально, на Mac, руками; результат — в «Итог».

## Где в коде

- `harness/evals/` — новый
- `scripts/eval-harness.mjs` — новый
- `package.json`
- `.gitignore`
- `electron.vite.config.ts`
- `test/contract/harness-evals.test.ts` — новый
- `harness/README.md`

## Итог

Заполняется при закрытии.
