# NVIDIA SkillEvaluator: годится ли он для eval всего Harness — research

Прочитано 2026-11-24. Источники: блог NVIDIA от 2026-08-19 (https://developer.nvidia.com/blog/evaluating-ai-agent-skill-performance-with-nvidia-skillevaluator/, дальше «блог»), репозиторий https://github.com/NVIDIA/SkillEvaluator на коммите `aa401c794bf1` (2026-11-24, версия 1.2.0), GitHub API, PyPI, docs Claude Code. Ссылка вида `docs/x.mdx:12` или `src/.../y.py:12` — файл и строка репозитория на этом коммите. Из репозитория ничего не запускалось и не устанавливалось. Где блог и код расходятся, верным считается код.

## Выводы

- SkillEvaluator оценивает один skill за раз. Tier 1 — статические проверки без модели и ключа. Tier 2 — поиск повторов между skill через embeddings. Tier 3 — настоящий CLI агента (Claude Code, Codex, OpenCode) в Docker решает одни и те же задачи с skill и без него (`README.md:229-234`).
- Весь Harness целиком он сейчас не проверит. Публичный Tier 3 кладёт в sandbox только папку skill. Код, который грузит Claude Code plugin через `--plugin-dir` вместе с hooks, subagents, commands и MCP, в репозитории есть, но помечен private и из CLI не вызывается (`src/skillevaluator/tier3/plugin_native.py:1350-1371`, `CHANGELOG.md:107-111`).
- Главный блокер на машине владельца: подписка Claude не поддерживается. Агент и judge получают только API keys — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NVIDIA_API_KEY`, Bedrock, Vertex или gateway (`docs/configuration.mdx:237-251`, `src/skillevaluator/tier3/harbor/runner.py:2967-2980`).
- Бесплатный ключ NVIDIA Build (hosted API моделей NVIDIA) не решает задачу. С ним Claude Code работает на модели NVIDIA Nemotron через bridge — локальный прокси SkillEvaluator, — и bridge убирает у него tools `Agent` и `Task`, то есть subagents (`src/skillevaluator/tier3/harbor/nvidia_build_bridge.py:56-76`).
- Ещё ограничения: один prompt на case, без продолжения диалога. Claude Code в Docker закреплён на 2.1.292, у владельца 2.1.323. Формат case несовместим с нашими 30 case.
- Чего нет у `claude plugin eval`: Tier 1 без ключа, включая harness-check (загрузят ли Claude Code и ещё пять агентов каждый skill), Tier 2 (пересечения 34 skill) и статистика Tier 3 — Wilson interval, McNemar, paired bootstrap, метка «мало case».
- Рекомендация: eval поведения Harness оставить на `claude plugin eval`. Из SkillEvaluator имеет смысл попробовать только Tier 1 и harness-check на 34 skill (без ключа), а идеи статистики перенести в наш отчёт.

## 1. Что измеряет и как ставит оценку

Три уровня (`README.md:229-234`):
- Tier 1 — статика: schema, качество `SKILL.md`, PII, license, Unicode, lint скриптов, сканеры безопасности SkillSpector (сканер skill от NVIDIA), Gitleaks, Bandit, опционально Semgrep, и harness-check (`README.md:133-138`). Ключ не нужен (`docs/configuration.mdx:56`).
- Tier 2 — повторы и пересечения внутри skill и между skill через embeddings (`README.md:233`).
- Tier 3 — live eval: одни и те же case идут в двух arm (ветвях сравнения) — с skill и без него, это baseline (`docs/tier3-live-evaluation.mdx:7-8`).

На каждый trial (один запуск агента на один case в одном arm) Tier 3 считает шесть сигналов (`docs/metrics-reference.mdx:32-40`, `docs/tier3-grading.mdx:10-16`):
- детерминированные, по trajectory агента: `security` (опасные команды, утечка секретов), `skill_execution` (активация skill, запуск ожидаемого скрипта, порядок «прочитал `SKILL.md`, потом действовал», восстановление после ошибок), `skill_efficiency` (routing и доля полезных tool calls) (`docs/metrics-reference.mdx:68-169`);
- LLM judge: `accuracy` (5 фиксированных boolean-критериев, оценка — доля true) и `goal_accuracy` (цель достигнута: да или нет);
- смешанный `behavior_check`: judge отмечает каждое ожидаемое поведение из `assertions`, к этому добавляются детерминированные `checks` (`docs/metrics-reference.mdx:219-248`).
- Judge возвращает только вердикты, числа считает verifier (`docs/tier3-grading.mdx:33-34`).

Из сигналов складываются пять измерений: Security, Correctness, Discoverability, Effectiveness, Efficiency. Overall — их среднее с равным весом. Skill Lift — Overall с skill минус Overall без skill на общих case (`docs/metrics-reference.mdx:278-311`, `:385-396`).

По пунктам вопроса:
- Срабатывание skill: да. Case задаёт `expected_skill` или `should_trigger: false`. Activation = 1.0, если агент вызвал tool `Skill` с нужным skill или прочитал `SKILL.md` (`docs/metrics-reference.mdx:109-125`). Можно положить рядом decoys — похожие соседние skill, чтобы проверить выбор (`docs/agents-and-sandboxes.mdx:783-794`). Docs советуют матрицу explicit / implicit / negative / edge (`docs/tier3-experiments.mdx:96-107`).
- Успех с skill и без: да, это главная метрика — Skill Lift и разница pass rate двух arm (`docs/metrics-reference.mdx:331-363`, `:381-400`).
- Следование правилам: отдельной метрики нет. Ближе всего `behavior_check` (ожидаемые шаги) и `workflow_order` (`docs/metrics-reference.mdx:124`, `:219-248`).
- Tokens и время: да. Отчёт показывает tokens, секунды агента, LLM и tools по каждому arm и разницу (`docs/reports.mdx:1335-1345`). `token_efficiency` в Overall не входит (`docs/metrics-reference.mdx:252-269`). Деньги — только по прайсу, который даёт пользователь, и только за инференс агента (`docs/tier3-run-reference.mdx:562-600`).
- Повторы: `--n-attempts`, по умолчанию 1 (`docs/tier3-run-reference.mdx:268`). Case проходит, если прошла хотя бы одна из k попыток (pass@k) (`docs/metrics-reference.mdx:336-355`).
- Статистика: 95% Wilson interval на pass rate каждого arm, точный тест McNemar по парам case, paired bootstrap interval для Skill Lift (`docs/metrics-reference.mdx:364-379`, `:408-416`). Результат помечается «provisional», если case меньше 10, нет negative case, полуширина Wilson interval больше 0.20 или пар case меньше 10 (`docs/eval-datasets.mdx:17-24`).

Надёжность judge, по словам самого проекта. Во встроенном наборе для проверки judge (16 case, 14 для оценки) оба проверенных judge засчитали все известные провалы как успех по порогу Overall — 15 из 15. Исследования согласия judge с людьми нет (`docs/metrics-reference.mdx:603-613`, `:651-656`). Run с одной попыткой и несколькими case docs называют smoke test, не benchmark (`docs/metrics-reference.mdx:681-689`).

Расхождения блога и кода:
- Блог определяет Discoverability как «загрузился ли нужный skill, когда он нужен» (блог, Table 1). В коде это `skill_execution` — среднее из activation, script_execution, workflow_order и error_recovery. Туда входят и запуск скрипта, и восстановление после ошибок (`docs/metrics-reference.mdx:98-103`, `:282`). Docs сами пишут, что это не проверенная конструкция (`docs/metrics-reference.mdx:657-662`).
- Блог показывает `create-eval-dataset ./my-skill --full` без подготовки. Текущий код для `--full` требует `evals/EVAL.md`, файл `--prompt` или сохранённые trajectory. Генерация только из `SKILL.md` — лишь с явным `--grounding skill` (`src/skillevaluator/tier3/generate_dataset.py:14-16`, `README.md:265-269`).
- Блог: большинство skill оценены одной попыткой на задачу (85% — одна, 15% — две), confidence intervals в посте нет. Docs называют такой run smoke test (`docs/metrics-reference.mdx:681-689`).

## 2. Кто выполняет задачи и что загружается

- Задачи решает настоящий CLI агента, своего agent loop нет: «Tier 3 runs real agent CLIs against your eval cases» (`docs/agents-and-sandboxes.mdx:6`). Каждый trial запускает Harbor — open-source фреймворк для eval агентов (`docs/agents-and-sandboxes.mdx:13-15`).
- Агенты: `claude-code`, `codex`, `opencode` и экспериментальный `hermes`. В Docker Harbor ставит Claude Code 2.1.292, Codex 0.161.0, OpenCode 1.19.5 (`docs/agents-and-sandboxes.mdx:24-29`, `src/skillevaluator/tier3/harbor/local_runtime.py:65-67`). Агент по умолчанию зависит от провайдера: Anthropic — claude-code, OpenAI — codex, NVIDIA Build — opencode (`src/skillevaluator/tier3/commands.py:92-98`).
- Claude Code запускается headless: `claude --verbose --output-format=stream-json ... --print` (`src/skillevaluator/tier3/harbor/native_agents.py:219`). Фоновые задачи и переход на другую модель после отказа выключены (`docs/agents-and-sandboxes.mdx:111-141`).
- Local mode запускает CLI, уже установленный на машине, внутри OS sandbox. Режим экспериментальный (`docs/agents-and-sandboxes.mdx:710-732`).
- С ключом NVIDIA Build Claude Code и Codex ходят к моделям NVIDIA через bridge SkillEvaluator — локальный прокси, который переводит их API в Chat Completions (`docs/agents-and-sandboxes.mdx:182-199`). Bridge выбрасывает tools `Agent`, `Task`, `WebFetch`, `WebSearch`, `Workflow` и ещё 14 (`src/skillevaluator/tier3/harbor/nvidia_build_bridge.py:56-76`).
- Части skill: копируется вся папка skill, кроме служебной `evals/`, то есть `SKILL.md`, references и scripts (`src/skillevaluator/tier3/harbor/adapter.py:4488-4497`, `docs/agents-and-sandboxes.mdx:831-835`). Зависимости скриптов ставятся из `scripts/requirements.txt` и `scripts/apt-packages.txt` (`docs/agents-and-sandboxes.mdx:611-613`). Skill лежит в папке skills агента, и агент находит его сам; текст skill в prompt не вставляется (`adapter.py:2294`, `src/skillevaluator/tier3/harbor/local_environment.py:1513-1522`).

Claude Code plugins:
- Tier 1 распознаёт plugin по `.claude-plugin/plugin.json` и проверяет его по публичному контракту; quality, lint и version для plugin пропускаются (`docs/tier1-reference.mdx:129`, `src/skillevaluator/cli.py:2812-2815`). Hooks из `hooks/hooks.json` разбирает SkillSpector. Обычный command hook он разобрать не может, и тогда manifest получает Critical-находку `skillspector_hook_payload_unverified`, пока hook не одобрен в файле waiver (`docs/tier1-reference.mdx:362`, `CHANGELOG.md:27-30`). Открытый issue #495 от 2026-11-13 пишет иное: у plugin Tier 1 security сканирует только bundled skills, а hooks и `bin/` — нет (https://github.com/NVIDIA/SkillEvaluator/issues/495).
- У Tier 3 для plugin два пути. Путь по умолчанию (`wrapper`) собирает один сгенерированный `SKILL.md` с правилами plugin и кладёт рядом member skills и MCP servers; hooks, agents и commands в нём «unsupported» (`src/skillevaluator/tier3/plugin_native.py:4-11`, `:88-91`). Путь `native` для Claude Code грузит plugin через `--plugin-dir`: skills, rules, MCP, hooks, agents, commands, output styles, LSP, settings (`plugin_native.py:1350-1371`). Отчёт считает запуски hook (`plugin_native.py:1004-1005`).
- Native путь не публичный. Design doc называет его «private workflow», публичные команды отложены до пункта 25 их плана (`docs/superpowers/specs/2026-11-05-private-runtime-reports-design.md:3-6`). CHANGELOG 1.2.0: блок `plugin` с `load` и `lift_mode` в `evals/config.yml` «reserved for prepared runtime packages» (`CHANGELOG.md:107-111`). Функция `evaluate_plugin` (`src/skillevaluator/tier3/plugin_workflow.py:83`) нигде в `src/` не вызывается, флага `--plugin-load` в `docs/cli-reference.mdx` нет. Native путь к тому же не работает в local mode (`plugin_native.py:1063-1065`).
- Диалог из нескольких реплик: нет. Case — один prompt, Harbor пишет его в `instruction.md` (`src/skillevaluator/tier3/harbor/adapter.py:1950`); полей для следующих реплик в формате нет (`docs/eval-datasets.mdx:159-169`). У собственных Harbor task бывают шаги и записанная прошлая trajectory, но парный baseline их отвергает (`docs/custom-graders.mdx:278-284`).

## 3. Формат case и генерация

- Всё для Tier 3 лежит в `evals/` внутри папки skill; обязателен только `evals/evals.json` (`docs/eval-datasets.mdx:9-10`, `:62-73`).
- Формат agentskills.io: `skill_name` и массив `evals`. Поля case: `id`, `prompt`, `expected_output`, необязательные `assertions`, `expected_skill` (`null` для negative case), `expected_script`, `acceptable_skills` (`docs/eval-datasets.mdx:83-98`, `:159-169`). JSONL и YAML тоже принимаются (`:176-177`).
- Детерминированные `checks`: `script_invoked`, `command_succeeded`, `file_exists`, `output_matches`, `output_contains` (`docs/eval-datasets.mdx:185-211`). Свой grader — `evals/grader.py` или `grader.sh`; свои Harbor task — `evals/harbor/` (`docs/eval-datasets.mdx:71-72`).
- Prompt и ожидания пишут про результат. Проверку «агент прочитал `SKILL.md`» baseline выполнить не может, и Skill Lift завышается; `tier3 validate --strict` такие формулировки ловит (`docs/eval-datasets.mdx:100-106`, `:142-152`).
- Генерация есть: `create-eval-dataset`. LLM-режим делает 4 case: explicit (skill назван), implicit (задача без имени skill), contextual (реальный сценарий), negative (`src/skillevaluator/tier3/generate_dataset.py:758-768`). Модель получает name, description, список скриптов, до 4000 символов `SKILL.md`, затем `EVAL.md` и trajectory (`generate_dataset.py:24-28`).
- Только из `SKILL.md` — с явным `--grounding skill`; по умолчанию нужен `EVAL.md`, `--prompt` или сохранённые trajectory (`docs/eval-datasets.mdx:387-419`). Без ключа работают шаблоны `--no-llm` (`:352`). Autopilot создаёт ровно один case, если источника нет (`:368-376`). Docs просят человека просмотреть case перед запуском (`docs/tier3-live-evaluation.mdx:97-106`).
- Case можно получить из trace production-агента с ручным отбором (`docs/eval-datasets.mdx:31-36`).

## 4. Что нужно для запуска

- Python 3.12–3.14 (`pyproject.toml:44`). Установка: `pip install "skillevaluator[all]"` или `uv tool install` (`README.md:35-45`, `:168`). Tier 3 тянет `harbor[gke]==0.25.0` (`pyproject.toml:94`). На PyPI последняя версия — 1.2.0 от 2026-11-24 (https://pypi.org/pypi/skillevaluator/json).
- Tier 1 нужны внешние сканеры. Без них проверка получает `INCOMPLETE` и ненулевой exit code (`README.md:236-238`).
- Tier 3: Docker Engine и Docker Compose v2, по умолчанию `--env-mode docker`. Каждый trial — в своём контейнере, образ baseline отличается только отсутствием skill (`docs/agents-and-sandboxes.mdx:254-262`, `:560-564`). Есть ещё Kata (microVM на Linux), облачные backend через Harbor и local mode (`:254-288`). Local mode на macOS использует Seatbelt — sandbox macOS, который docs называют слабее Bubblewrap на Linux. На native Windows local mode не работает (`:718-732`).
- Сеть: task запускаются с `network_mode = "public"` (`src/skillevaluator/tier3/harbor/adapter.py:2293`). В Docker агент устанавливается в контейнер на каждый trial (`docs/tier3-live-evaluation.mdx:114-115`).
- Ключи по уровням (`docs/configuration.mdx:54-61`):
  - Tier 1 — без ключа; `--llm` добавляет проверки моделью.
  - Tier 2 — embeddings и chat. Anthropic и Bedrock embeddings не дают, нужен второй провайдер (`:190-197`). Подойдёт локальный OpenAI-compatible server, например Ollama (`:199-235`).
  - Tier 3 — две роли: ключ evaluator (генерация case и judge) и credential агента (`:237-251`). Провайдеры: `openai`, `anthropic`, `nv_build`, `bedrock`, `openai-compatible`. Без явного выбора берётся единственный из `NVIDIA_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (`:92`, `:166-172`).
  - Для Anthropic обязателен `ANTHROPIC_API_KEY` (`src/skillevaluator/provider_config.py:582-591`). Judge по умолчанию — `claude-opus-5-5` (`docs/configuration.mdx:109`).
  - NVIDIA Build (build.nvidia.com, hosted API моделей NVIDIA): один ключ на judge и всех трёх агентов в docker, kata и local. Бесплатно для участников NVIDIA Developer Program, с лимитами (`docs/agents-and-sandboxes.mdx:182-199`, `README.md:158-161`). Модель по умолчанию — `nvidia/nemotron-3.5-lightning-30b-a3b` (`docs/configuration.mdx:121`).
- Подписка Claude без `ANTHROPIC_API_KEY`: нет. Ни в docs, ни в коде такого пути я не нашёл.
  - Credential для Claude Code собирается только из `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, Vertex или Bedrock (`src/skillevaluator/tier3/harbor/runner.py:2967-2980`, `:3184-3194`). `CLAUDE_CODE_OAUTH_TOKEN` в этом списке нет. Имена с префиксом `CLAUDE_CODE_` считаются секретами оператора, и skill не может задать их через `runtime_env` (`runner.py:1304-1319`, `:2840-2849`).
  - В Docker Claude Code ставится в чистый контейнер (`docs/agents-and-sandboxes.mdx:172-173`), логина хоста там нет.
  - В local mode у каждого trial свой `HOME` (`src/skillevaluator/tier3/harbor/local_environment.py:1505-1511`), а Seatbelt запрещает чтение настоящего `HOME` (`src/skillevaluator/tier3/harbor/local_sandbox.py:118-122`).
  - Judge в любом случае вызывает API провайдера по ключу (`docs/tier3-grading.mdx:12-13`).

## 5. Стоимость

- Число trial = case × агенты × попытки × arm, arm два (`docs/tier3-run-reference.mdx:202-206`). Trial — несколько запросов агента к модели плюс вызовы judge. Сумму в долларах SkillEvaluator не оценивает (`:206-211`).
- Judge на trial: до трёх вызовов (`accuracy`, `goal_accuracy`, `behavior_check`) и по одному повтору на невалидный ответ. Case только с `checks` не вызывает judge для `behavior_check` (`docs/tier3-grading.mdx:10-16`, `:213-218`). Сверху — текст Insights, который пишет LLM (`docs/metrics-reference.mdx:299-301`), и генерация case.
- Пример, мой расчёт: 30 case, один агент, одна попытка — 60 run агента и до 180 вызовов judge, не считая повторов. С тремя попытками — 180 run и до 540 вызовов.
- `--max-agent-tokens`, `--max-judge-calls`, `--max-attempts-total`, `--max-cost-usd` только запрещают запуск новых trial; жёстким потолком трат они не являются. Стоимость считается только за инференс агента по прайсу пользователя, judge не учитывается (`docs/tier3-run-reference.mdx:296-300`, `:562-600`).
- Цифры блога (раздел «Token savings are not automatic»): `jetson-optimize-memory` — 617 306 → 142 540 tokens (−76.9%) и 474.9 → 220.0 s; `cuopt-install` — 25 227 → 55 582 tokens (+120.3%) и 34.0 → 41.1 s. Долларов нет ни в блоге, ни в docs, ни в аннотации статьи (https://arxiv.org/abs/2608.20614).

## 6. Зрелость

- License Apache-2.0 (GitHub API `repos/NVIDIA/SkillEvaluator`, `README.md:328-331`). Support level «Experimental»: поддержка сообщества, без SLA (`README.md:312-315`).
- Репозиторий создан 2026-06-24. Первый коммит в истории `main` — 2026-07-26, «Initial SkillEvaluator repository snapshot». Последний — 2026-11-24. В `main` 751 коммит (GitHub API `/commits`).
- Releases на GitHub — 14, от v0.1.0 (2026-08-05) до v1.2.0 (2026-11-24). v1.0.0 вышла 2026-11-17 и в тот же день помечена «superseded» (API `/releases`). На PyPI первая релизная версия 0.6.0 — 2026-11-02, до неё был только 0.0.0a0 (PyPI JSON). `CHANGELOG.md` — 380 KB.
- 4 485 stars, 566 forks. 40 contributors с учётом анонимных, у двух главных 302 и 300 коммитов (API `/contributors`).
- Issues: 13 открытых, 114 закрытых. Pull requests: 24 открытых, 684 merged (GitHub search API).
- Tests: 565 файлов `test_*.py`, около 13 400 функций `test_` (подсчёт по клону). CI на Ubuntu с Python 3.12, 3.13, 3.14 и на macOS (`.github/workflows/ci.yml`).
- Статья arXiv 2608.20614 от 2026-08-20: 145 skill, 947 оценённых пар case, средний Skill Lift 0.2134, 95% CI [0.1967, 0.2301] (https://arxiv.org/abs/2608.20614).

## 7. Сравнение с `claude plugin eval`

Источники правого столбца: [H] — `claude plugin eval --help` и `claude plugin eval init --help`, Claude Code 2.1.323, 2026-11-24; [D: раздел] — https://code.claude.com/docs/en/plugin-evals. Левый столбец — пути в репозитории SkillEvaluator; `tier3/...` — сокращение от `src/skillevaluator/tier3/...`.

| Возможность | SkillEvaluator | `claude plugin eval` |
| --- | --- | --- |
| Что проверяется | Один skill; plugin целиком — только в непубличном native пути (`tier3/plugin_native.py:1350-1371`, `CHANGELOG.md:107-111`) | Plugin целиком: skills, hooks, agents [D: What a run can access] |
| Кто выполняет | Настоящий CLI: Claude Code 2.1.292, Codex, OpenCode в Docker; local mode — CLI с машины (`docs/agents-and-sandboxes.mdx:24-29`, `:718-732`) | `claude -p` установленного Claude Code, загружен только этот plugin [D: How runs are isolated] |
| Логин | Только API keys, Bedrock, Vertex или gateway (`docs/configuration.mdx:237-251`) | Тот же, что у обычной сессии, подписка тоже [D: Requirements] |
| Baseline | Тот же case без skill (`docs/tier3-live-evaluation.mdx:7-8`) | `--ablation with-without`, run без plugin [H] |
| Повторы | `--n-attempts`, по умолчанию 1 (`docs/tier3-run-reference.mdx:268`) | `runs` от 1 до 50, по умолчанию 3 [D: prompt.md frontmatter] |
| Grader | 3 детерминированных сигнала, 3 judge, `checks` пяти типов, свой `grader.py` (`docs/metrics-reference.mdx:32-40`, `docs/eval-datasets.mdx:185-211`) | `regex`, `tool_used`, `tool_order`, `file_exists`, `llm`, `baseline`; своего кода нет [D: Choose and weight graders] |
| Judge | Модель провайдера, для Anthropic `claude-opus-5-5` (`docs/configuration.mdx:109`) | По умолчанию haiku, меняется `--judge-model`; `llm` — 2 голоса из 3 [H], [D: Grader types] |
| Срабатывание skill | `expected_skill`, `should_trigger`, activation, decoys (`docs/metrics-reference.mdx:109-125`, `docs/agents-and-sandboxes.mdx:783-794`) | `tool_used: Skill` как индикатор вне score; запрет вызова — `min: 0`, `max: 0`, `arm: both` [D: Score against the no-plugin baseline] |
| Статистика | pass@k, Wilson 95%, McNemar, paired bootstrap для Lift, метка «provisional» (`docs/metrics-reference.mdx:364-416`) | Среднее по run и Δ; интервалов docs не упоминают [D: How a case is scored] |
| Несколько реплик | Нет, один prompt (`tier3/harbor/adapter.py:1950`) | Продолжение записанного диалога: `context.history_file`, prompt — следующая реплика [D: Seed the workspace or conversation] |
| Hooks, subagents, commands | В публичном пути нет; через bridge NVIDIA Build `Agent` и `Task` убраны (`tier3/harbor/nvidia_build_bridge.py:56-76`) | Hooks грузятся; agents plugin вызываются через `Agent`; commands в docs не описаны [D: What a run can access], [D: "Agent type '...' not found"] |
| MCP | Servers из `evals/environment/` (`docs/eval-datasets.mdx:70`) | Mock из `evals/mocks/` или настоящие servers по флагу [H], [D: Mock MCP servers] |
| Sandbox | Контейнер Docker на trial, облачные backend, local mode (`docs/agents-and-sandboxes.mdx:254-288`) | На машине: временный `HOME`, OS sandbox для shell; hooks и MCP вне sandbox [D: How runs are isolated] |
| Генерация case | `create-eval-dataset`: 4 case по типам, autopilot — 1 case (`tier3/generate_dataset.py:758-768`) | `init`: Claude читает plugin, расспрашивает, предлагает prompt и grader, пробует их [D: Create your first eval suite] |
| Статика | Tier 1 (500+ правил, harness-check) и Tier 2 (`README.md:59-60`, `:229-234`) | В eval нет; отдельная команда `claude plugin validate` [D: вводная часть] |
| Лимит цены | Ограничение запуска trial, judge не учитывается (`docs/tier3-run-reference.mdx:562-600`) | `--max-cost-usd` по list price, проверка перед каждым run [H] |
| Отчёт | `report.html` и `result.json` (`docs/tier3-live-evaluation.mdx:160-162`) | `report.html`, `aggregate-result.json`, публикация на claude.ai [D: Read the results] |

## 8. Подходит ли для Harness

Что SkillEvaluator мог бы добавить:
- harness-check без ключа и модели: загрузят ли Claude Code, Codex и ещё четыре агента каждый из 34 skill и не обрежут ли description (`docs/harness-check.mdx:7-9`, `:33-34`). `claude plugin eval` этого не проверяет.
- Tier 1 security и schema по plugin и каждому skill, с готовым шаблоном GitHub CI без ключа (`README.md:186-219`).
- Tier 2: пересечения между 34 skill. Пересекающиеся description мешают агенту выбрать skill. Embeddings можно взять у локальной модели (`docs/configuration.mdx:199-235`).
- Идеи для нашего отчёта: Wilson interval, McNemar, paired bootstrap и метка «мало case» (`docs/metrics-reference.mdx:364-416`, `:615-624`). Детерминированные сигналы по trajectory: порядок «прочитал, потом сделал», восстановление после ошибок, доля полезных tool calls (`:93-169`).
- Те же case на Codex и OpenCode, если понадобится сравнить агентов (`docs/agents-and-sandboxes.mdx:17-29`).

Чего он у Harness не проверит:
- Hooks, 4 subagents и commands Harness: в публичный Tier 3 попадает только папка одного skill. Native путь, где они есть, не опубликован и работает только в контейнере (раздел 2).
- Диалог из нескольких реплик и продолжение записанной сессии.
- Claude Code той версии, что стоит у владельца: Docker закрепляет 2.1.292; local mode экспериментальный, и native plugin в нём запрещён.
- Работу на подписке: только API keys (раздел 4).

Блокеры:
1. Нет `ANTHROPIC_API_KEY`. Tier 3 на моделях Claude требует платного API. С бесплатным ключом NVIDIA Build агент работает на Nemotron и без `Agent`/`Task`, поэтому результат будет не про Harness.
2. Весь plugin публично не проверить. Нужно ждать публикации native пути; срок не назван.
3. Нужны Docker и отдельный набор инструментов: Python 3.12–3.14 и сканеры Tier 1.
4. Все 20 hook handlers Harness — `type: command` (`harness/hooks/hooks.json`). По docs такой hook даёт Critical-находку на Tier 1, пока для него нет одобренного waiver (`docs/tier1-reference.mdx:362`). На нашем plugin это не проверялось.
5. Case придётся переписать. Формат — `evals/evals.json` внутри папки каждого skill (`docs/eval-datasets.mdx:9-10`). Grader вроде `tool_used` и `tool_order` в нём нет. Импорта из формата `claude plugin eval` в репозитории нет (поиск по `case.yaml`, `tool_order`, `plugin eval`).
6. Надёжность judge Tier 3 проект сам называет непроверенной (раздел 1).

## Что не удалось установить

- Что делает публичный Tier 3 (`validate --tier3`) с папкой plugin, у которой нет `SKILL.md` в корне. Docs этого не описывают, код я не трассировал до конца, запускать нельзя.
- Подхватит ли Claude Code в local mode логин подписки из macOS Keychain под Seatbelt. Код такой путь не предусматривает, проверка требует запуска.
- Когда native путь для plugin станет публичным: в design doc есть только «пункт 25» без даты.
- Какой из источников про сканирование hooks у plugin верен сейчас: `docs/tier1-reference.mdx:362` или открытый issue #495.
- Цена одного case в долларах: цифр нет ни в блоге, ни в docs, ни в аннотации статьи; полный текст статьи не читал.
- Работает ли Harness на Claude Code 2.1.292, который ставит Docker: не проверялось.
- Есть ли у `claude plugin eval` интервалы или разброс по run: docs их не упоминают, отчёт я не запускал.
