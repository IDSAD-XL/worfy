# Как скрыть конфиденциальный текст до того, как он дойдёт до модели: hooks агентов, хранение у vendor-ов, detectors и prior art

Дата: 2026-11-28, все источники прочитаны в этот день. Статус: исследование для решения по теме `prompt-privacy`, не решение и не
юридическая консультация. Контекст: desktop-приложение запускает Claude Code и Codex CLI как child processes и само пишет prompt агенту.

## Главное

- **Ни Claude Code, ни Codex не дают hook-у переписать prompt.** В Claude Code `UserPromptSubmit` только блокирует prompt или добавляет
  `additionalContext`: «can't replace the prompt» — https://code.claude.com/docs/en/hooks#decision-control. В Codex то же: block или
  «extra developer context» — https://learn.chatgpt.com/docs/hooks#userpromptsubmit. Вставленный текст может замаскировать только само
  приложение, до записи prompt в агент.
- **Вывод tools подменить можно, но по-разному.** Claude Code: `PostToolUse` → `updatedToolOutput` для любых tools (с v2.1.121); если
  значение не совпало со schema встроенного tool, молча уходит оригинал, а telemetry получает оригинал всегда —
  https://code.claude.com/docs/en/hooks#posttooluse-decision-control. Codex: только `decision: "block"`, результат заменяется текстом hook-а;
  `updatedMCPToolOutput` «parsed but not supported yet»; hosted tools вроде `WebSearch` hooks не видят — https://learn.chatgpt.com/docs/hooks.
- **Hooks обходятся.** Файлы, упомянутые через `@`, Claude Code вставляет без tool call, и `PreToolUse` не срабатывает; `Read` deny rules
  «best-effort» и не действуют на Python- и Node-скрипты — https://code.claude.com/docs/en/hooks#pretooluse. Codex: «Treat tool hooks as a
  useful guardrail, not a complete enforcement boundary». Proxy через `ANTHROPIC_BASE_URL` видит запросы и при входе по subscription —
  https://code.claude.com/docs/en/llm-gateway#subscriptions-and-gateways
- **Локальные копии лежат plaintext.** Claude Code: `~/.claude/projects/<project>/<session>.jsonl` с tool results и system prompt, 30 дней по
  умолчанию; prompt, заблокированный hook-ом, всё равно остаётся там — https://code.claude.com/docs/en/claude-directory#plaintext-storage.
  Codex: `~/.codex/history.jsonl` и `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs
- **Vendor хранит дольше, чем длится сессия.** Claude Free/Pro/Max/Ultra: с «Help improve our AI models» — до 5 лет, без — 30 дней; API —
  30 дней, ZDR (zero data retention) — по договору. ChatGPT Free/Plus/Pro: «Improve the model for everyone» включён по умолчанию и действует
  на Codex. — https://code.claude.com/docs/en/data-usage, https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt
- **Prior art делится на три подхода.** Блокировать: GitGuardian ggshield в hooks агентов. Маскировать: Warp, LiteLLM + Presidio, Bedrock
  Guardrails, browser extensions. Исключать файлы: Copilot content exclusion, `.cursorignore`, `.aiignore`, `Read` deny. Настоящие значения в
  ответ возвращают только маскирующие: LiteLLM `output_parse_pii`, LLM Guard `Deanonymize`, Rescriber, Offsend, Velum. —
  https://docs.gitguardian.com/endpoint-protection/ai-hooks, https://docs.litellm.ai/docs/proxy/guardrails/pii_masking_v2, разделы 3 и 5
- **Для встраивания решает лицензия.** gitleaks и secretlint — MIT, detect-secrets — Apache-2.0, trufflehog — AGPL-3.0; Presidio и LLM Guard —
  MIT, но на Python. Имена в JS: transformers.js с ONNX models, например OpenAI Privacy Filter (Apache-2.0, 8 категорий, включая `secret`,
  ONNX q4 ≈ 0.9 GB) — https://huggingface.co/openai/privacy-filter. Часть NER models — только некоммерческие. Остальные ссылки — в разделе 4.
- **Готовый образец «уровня» — likelihood в Google Sensitive Data Protection (SDP):** пять уровней от `VERY_UNLIKELY` до `VERY_LIKELY`, по
  умолчанию `POSSIBLE`, порог можно задать отдельно для каждого типа — https://cloud.google.com/sensitive-data-protection/docs/likelihood.
  Похожие настройки: `score_threshold` в Presidio (по умолчанию 0), operating points в OpenAI Privacy Filter, «Detection sensitivity» в
  Velum. Вариант «по категориям» — `MASK` или `BLOCK` на каждый тип в LiteLLM и Bedrock Guardrails.
- **Точность скромная, особенно на чужих данных.** Сравнение 9 secret detectors: лучшая precision 75% (GitHub), у gitleaks 46%, лучший
  recall 88% (gitleaks); false positives дают generic regex и «ineffective entropy calculation» — https://arxiv.org/abs/2307.00714. PIIBench:
  у всех 8 готовых PII-систем span-level F1 ниже 0.14 — https://arxiv.org/abs/2604.15776. OpenAI Privacy Filter на секретах: precision
  0.747, recall 0.965; без подсказки в контексте recall по `secret` — 0.361 (model card, ссылка в разделе 6.4).
- **Placeholder или правдоподобная подмена.** Препринт SurrogateShield: с surrogate values BERTScore 94.85%, с placeholders 81.59% —
  https://arxiv.org/abs/2606.29567. Velum по умолчанию выключает surrogates: «a surrogate that reads as real is easy to forget to unmask» —
  https://addons.mozilla.org/firefox/addon/velumprivacy/. Одинаковый placeholder для одинакового значения даёт LLM Guard `Vault`; Presidio
  «does not store or maintain stateful sessions» — https://github.com/microsoft/presidio/blob/main/docs/anonymizer/index.md

Как проверено: страницы скачаны (docs — как Markdown, help center — как HTML, модели — через Hugging Face API, статьи — через arXiv API) и
цитаты сверены с текстом. «Мой подсчёт» — число, посчитанное по скачанному файлу. Модели и detectors не запускались.

## 1. Могут ли сами CLI переписать или скрыть текст

### 1.1 Claude Code

- `UserPromptSubmit` получает `prompt` (вставки `[Pasted text #N]` — развёрнутыми) и отвечает полями `decision: "block"`, `reason`,
  `additionalContext`, `sessionTitle`, `suppressOriginalPrompt`; поля для замены текста нет. «A blocking hook isn't a way to keep a secret off
  disk.» — https://code.claude.com/docs/en/hooks#userpromptsubmit-decision-control, https://code.claude.com/docs/en/hooks#what-a-blocked-prompt-leaves-behind
- Сбой или timeout hook-а (у `UserPromptSubmit` 30 s) на большинстве events пропускает действие; `"onFailure": "block"` (v2.1.295+) меняет
  это. Callback hook Agent SDK на `UserPromptSubmit` при timeout сам блокирует prompt. — https://code.claude.com/docs/en/hooks#userpromptsubmit,
  https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails
- `PreToolUse` → `updatedInput`: «Modifies the tool's input parameters before execution. Replaces the entire input object». Работает для
  `Bash`, `PowerShell`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Agent`, `WebFetch`, `WebSearch` и MCP tools; permission rules проверяются по
  новому input. В auto mode изменённый вызов без `permissionDecision` может быть отклонён: server-side classifier проверял исходный input.
  — https://code.claude.com/docs/en/hooks#pretooluse-decision-control
- `PostToolUse` → `updatedToolOutput`: «Replaces the tool's output with the provided value before it is sent to Claude», для встроенных и MCP
  tools; `updatedMCPToolOutput` — только MCP. Для встроенных tools «a value that doesn't match the tool's output schema is ignored and the
  original output is used»; «Telemetry such as OpenTelemetry tool spans and analytics events also captures the original output». —
  https://code.claude.com/docs/en/hooks#posttooluse-decision-control. Для всех tools — с 2.1.121 («previously MCP-only») —
  https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md; в Agent SDK — «in both SDKs» — https://code.claude.com/docs/en/agent-sdk/hooks
- `MessageDisplay` меняет только показ ответа: «The transcript and what Claude sees keep the original text». В Agent SDK и `claude -p`
  hook вызывается один раз на сообщение. — https://code.claude.com/docs/en/hooks#messagedisplay
- `@`-файлы: «Claude Code inserts their contents while building the prompt, so no PreToolUse hook fires for them, including hooks matching
  `Read`». Закрыть: `Read` deny rule или `CLAUDE_CODE_DISABLE_FILE_MENTIONS=1` (v2.1.299+). — https://code.claude.com/docs/en/hooks#pretooluse
- `Read(./.env)` и `Read(./secrets/**)` в `permissions.deny` закрывают встроенные file tools; Grep, Glob и `@`-упоминания — «best-effort»;
  распознанные Bash-команды (`cat`, `head`, `sed`) тоже. Не действуют на `grep -r pattern .` и на «arbitrary subprocesses … like a Python
  or Node script». `.claudeignore` «has no effect». — https://code.claude.com/docs/en/permissions#read-and-edit
- Маскировки того, что уходит модели, в документации нет. Redaction описан только для данных, которые уходят не модели, а в отчёты: transcript
  из опроса о сессии («Known API key and token patterns are redacted», код и файлы «uploaded as-is»), error reports, OpenTelemetry (prompt —
  `<REDACTED>`, пока не задан `OTEL_LOG_USER_PROMPTS=1`). — https://code.claude.com/docs/en/data-usage,
  https://code.claude.com/docs/en/monitoring-usage. Changelog упоминает «secret redaction in shared transcripts and debug logs» (2.1.296) —
  https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- LLM gateway: `ANTHROPIC_BASE_URL` направляет запросы через proxy. Без gateway credential «a saved claude.ai login remains the active
  credential»; gateway должен пересылать `Authorization` и OAuth capability в `anthropic-beta`. —
  https://code.claude.com/docs/en/llm-gateway#subscriptions-and-gateways. Незнакомые headers и поля body proxy не должен отбрасывать; если он
  меняет массив `system`, документация советует `CLAUDE_CODE_ATTRIBUTION_HEADER=0` — https://code.claude.com/docs/en/llm-gateway-protocol

### 1.2 Codex CLI

- Среди events — `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreModelRequest`, `PostModelRequest`. Пример в документации: «Scan your
  team's prompts to block accidentally pasting API keys». Hook не из managed-источника работает только после trust по hash (`/hooks`). —
  https://learn.chatgpt.com/docs/hooks
- `UserPromptSubmit`: stdout и `additionalContext` становятся «extra developer context»; `decision: "block"` или exit code 2 блокируют.
  Замены текста нет. — https://learn.chatgpt.com/docs/hooks#userpromptsubmit
- `PreToolUse`: `permissionDecision: "allow"` вместе с `updatedInput`; для `Bash` и `apply_patch` это строка `command`, для MCP и local
  function tools — новый объект аргументов. `"ask"` пока не поддержан. — https://learn.chatgpt.com/docs/hooks#pretooluse
- Hooks видят shell, `exec_command`, `apply_patch`, MCP и local function tools; «Hosted tools, such as `WebSearch`» не видят —
  https://learn.chatgpt.com/docs/hooks#tool-coverage. `PreModelRequest` и `PostModelRequest` — «diagnostic only. It can't change the model's
  context or block a request.»
- `PostToolUse`: при `decision: "block"` Codex «replaces the tool result with that feedback»; `continue: false` тоже подменяет результат.
  `updatedMCPToolOutput` и `suppressOutput` — «parsed but not supported yet». — https://learn.chatgpt.com/docs/hooks#posttooluse
- `shell_environment_policy`: `inherit` = `all | core | none`. `ignore_default_excludes` по умолчанию `true`, «so Codex doesn't
  automatically remove variable names containing `KEY`, `SECRET`, or `TOKEN`»; `false` включает это исключение, дальше работают `filters`
  (include/exclude с `*` и `?`) и `set`. — https://learn.chatgpt.com/docs/config-file/config-advanced#shell-environment-policy
- Redaction нашёл только в telemetry: `otel.log_user_prompt = false` — «redact prompt text unless policy allows» —
  https://learn.chatgpt.com/docs/agent-approvals-security. `openai_base_url` направляет встроенный provider на «an LLM proxy, router» —
  https://learn.chatgpt.com/docs/config-file/config-advanced

### 1.3 Сводка

| Возможность | Claude Code | Codex CLI |
| --- | --- | --- |
| Заменить текст prompt | нет | нет |
| Заблокировать prompt | да | да |
| Переписать вход tool | да, все tools, включая MCP | да: `Bash`, `apply_patch`, MCP, local function tools; hosted — нет |
| Заменить вывод tool | да, `updatedToolOutput` | только block: результат заменяется текстом `reason` |
| Заменить только показ ответа | `MessageDisplay` | не нашёл |
| Hook на каждый запрос к модели | нет (есть только `PreModelSwitch` и `PostModelSwitch`) | есть, только для диагностики |

## 2. Что хранят vendor-ы и что остаётся на диске

### 2.1 Claude, consumer plans (Free, Pro, Max, Ultra)

- «We will train new models using data from Free, Pro, Max, and Ultra accounts when this setting is on (including when you use Claude Code
  from these accounts)». Если обучение разрешено — хранение 5 лет, если нет — 30 дней. Transcripts из `/feedback`, `/bug`, `/share` — 5 лет;
  transcript из опроса о сессии — до 6 месяцев. — https://code.claude.com/docs/en/data-usage. Настройка: Settings → Privacy → «Help improve
  our AI models» — https://privacy.claude.com/en/articles/12109829-how-do-i-change-my-model-improvement-privacy-settings
- С включённой настройкой: «retain your data in a de-identified format for up to 5 years in our model training pipelines». Удалённый
  разговор стирается из back-end «within 30 days». Разговор, помеченный по Usage Policy: inputs и outputs до 2 лет, classification scores до 7
  лет. Feedback (thumbs up/down) — 5 лет. — https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data
- В обучение идёт «the entire related conversation»; raw content из connectors, «including remote and local MCP servers», не идёт, если его не
  скопировали в разговор. — https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training

### 2.2 Anthropic API и commercial plans

- «Anthropic does not train generative models using code or prompts sent to Claude Code under commercial terms», если клиент сам не
  согласился (например, Development Partner Program). На Claude for Enterprise ZDR для Claude Code включает account team после проверки. —
  https://code.claude.com/docs/en/data-usage
- API: «we automatically delete inputs and outputs on our backend within 30 days of receipt or generation»; исключения — Files API, договор о
  ZDR, нарушения Usage Policy, закон. Для помеченных разговоров — те же 2 года и 7 лет. —
  https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- Covered models (Mythos-class и будущие модели такого уровня): prompts и outputs хранятся 30 дней «on every platform», с 2026-06-09; правило
  касается организаций с ZDR. Claude Code через API подчиняется настройкам своего workspace. —
  https://privacy.claude.com/en/articles/15425996-data-retention-practices-for-covered-models

### 2.3 Codex со входом через ChatGPT

- «When you sign in with ChatGPT, Codex usage follows your ChatGPT workspace permissions, role-based access control (RBAC), and ChatGPT
  Enterprise retention and residency settings»; с API key — настройки API organization. — https://learn.chatgpt.com/docs/auth
- Personal Free/Plus/Pro: «data sharing is enabled by default»; отключается в Settings → Data controls → «Improve the model for everyone», и
  Codex на personal account подчиняется этой настройке. Если после opt-out поставить thumbs up/down, «the entire conversation associated with
  that feedback may be used to train». Business, Enterprise и Edu по умолчанию для обучения не используются. —
  https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt
- Чаты хранятся, пока их не удалят; удалённый — «permanent deletion from its systems within 30 days»; у temporary chat копия до 30 дней —
  https://help.openai.com/en/articles/8983778-chat-and-file-retention-policies-in-chatgpt. Для Codex chats в приложении ChatGPT то же: «saved
  in your account until you delete them», удаление в течение 30 дней — https://help.openai.com/en/articles/20001333-archiving-and-deleting-codex-chats-in-the-chatgpt-app

### 2.4 Локальные файлы

- Claude Code: «These files are plaintext. Anything that passes through a tool is written to a transcript on disk: file contents, command
  output, pasted text.» `projects/<project>/<session>.jsonl` содержит messages, tool calls, tool results, system prompt и tool definitions;
  `history.jsonl` — набранные prompts. «Transcripts and history are not encrypted at rest.» Срок — `cleanupPeriodDays`, по умолчанию 30,
  минимум 1. Не писать файлы: `CLAUDE_CODE_SKIP_PROMPT_HISTORY`, `--no-session-persistence` с `-p`, `persistSession: false` в TypeScript
  Agent SDK («the Python SDK has no equivalent»). — https://code.claude.com/docs/en/claude-directory#plaintext-storage
- Вставки в terminal хранятся в `~/.claude/paste-cache/` — https://code.claude.com/docs/en/terminal-config. При Remote Control «the session
  transcript is stored on Anthropic servers» — https://code.claude.com/docs/en/security
- Codex: `history.jsonl` (`history.persistence = "none"` отключает) — https://learn.chatgpt.com/docs/config-file/config-advanced#history-persistence.
  Rollout files — `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl` — https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs.
  У `codex exec` флаг `--ephemeral` — «Run without persisting session rollout files to disk» — https://learn.chatgpt.com/docs/cli/reference
- По словам GitGuardian, Claude Code пишет в transcript сообщение hook-а вместо подменённого вывода, а Codex «still write the raw output to
  their own session files … where no hook can reach it». В документации Anthropic и OpenAI этого нет. —
  https://docs.gitguardian.com/endpoint-protection/ai-hooks

## 3. Prior art: что делают другие инструменты

| Продукт | Что делает | Подход | Возвращает значения |
| --- | --- | --- | --- |
| Warp, Secret Redaction | 19 рекомендованных regex (IPv4/IPv6, MAC, телефон, AWS, Google, GitHub, Stripe, JWT, OpenAI `sk-`, Anthropic `sk-ant-api` и др.) плюс свои. «Any identified secret will be redacted instead of being sent to our servers or any LLM provider». По умолчанию выключено; на экране секрет зачёркнут или `********`; в Session Sharing не работает. — https://docs.warp.dev/support-and-community/privacy-and-security/secret-redaction | mask | раскрыть на экране по клику; про ответ модели не сказано |
| GitGuardian ggshield, AI hooks | Hooks в Claude Code, Codex, Cursor, Copilot CLI и VS Code, Kiro, Junie, Mistral Vibe. Секрет в prompt, command или file read — «Blocked». В выводе: Claude Code — «Withheld for shell commands and file reads, notification only for MCP and other tools»; Codex — «Withheld for every tool»; Cursor — только notification. 600+ типов; `ai_hook_failure_policy` allow или block; false positive снимает `ggshield secret ignore --last-found`. Сканирует через облако: «uses our public API … to scan». — https://docs.gitguardian.com/endpoint-protection/ai-hooks, https://github.com/GitGuardian/ggshield | block | нет |
| GitHub Copilot, content exclusion | Исключает файлы. «Not a filesystem security boundary»; агент «might not detect indirect file access»; IDE может передать types и hover-определения. — https://docs.github.com/en/copilot/concepts/context/content-exclusion | exclude | — |
| Cursor | `.cursorignore`; `.env`, `.git/` и lock files игнорируются по умолчанию; «Terminal commands and MCP tools run outside of Cursor's file access controls». Privacy Mode означает только «never used for training»; prompts и код всё равно уходят OpenAI, Anthropic, Google. — https://cursor.com/help/customization/ignore-files, https://cursor.com/help/security-and-privacy/privacy | exclude | — |
| JetBrains AI Assistant | `.aiignore` (синтаксис `.gitignore`; читает и `.cursorignore`, `.codeiumignore`, `.aiexclude`); `.noai` выключает AI в проекте. «Ignored files may still be processed due to unforeseen issues». — https://www.jetbrains.com/help/ai-assistant/disable-ai-assistant.html | exclude | — |
| LiteLLM proxy + Presidio | `MASK` или `BLOCK` на каждый тип; `presidio_score_thresholds` для всех или по типу; режимы `pre_call`, `post_call`, `pre_mcp_call`. `output_parse_pii: True` — «replace the masked token with the user-submitted values» (в примере `[PERSON]`). — https://docs.litellm.ai/docs/proxy/guardrails/pii_masking_v2 | mask или block на gateway | да |
| Amazon Bedrock Guardrails | Claude Code подключает Guardrail через `ANTHROPIC_CUSTOM_HEADERS` (https://code.claude.com/docs/en/amazon-bedrock#aws-guardrails). Block или Mask с заменой на `{NAME}`, `{EMAIL}`. Не проверяет «tool results your application returns to the model» и аргументы tool calls; в CloudWatch logs остаётся оригинал. — https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-sensitive-filters.html | mask или block | не сказано |

## 4. Detectors, которые можно запустить локально

### 4.1 Secrets

| Detector | Язык | Лицензия | Правила | Подход и заметки |
| --- | --- | --- | --- | --- |
| gitleaks | Go | MIT | 222 `[[rules]]` в `config/gitleaks.toml`, у 130 порог `entropy` (мой подсчёт) | regex, keywords, Shannon entropy, allowlists, конфиг TOML. У `generic-api-key` entropy 3.5 и около 1 400 stopwords (мой подсчёт). — https://github.com/gitleaks/gitleaks |
| secretlint | Node.js 22+ | MIT | 28 правил в recommend preset: AWS, GCP, GitHub, GitLab, OpenAI, Anthropic, private key, database connection string и др. | Правила под провайдеров, без общего entropy-правила; значения в выводе замаскированы по умолчанию; `--format=mask-result` маскирует файл на месте; Node API `createEngine`. — https://github.com/secretlint/secretlint |
| trufflehog | Go | AGPL-3.0 | «over 800 secret types» | Verification: «log in to confirm if that secret is live», то есть секрет уходит к его провайдеру. — https://github.com/trufflesecurity/trufflehog |
| detect-secrets | Python | Apache-2.0 | plugins и filters | `Base64HighEntropyString` с порогом 4.5, `HexHighEntropyString` с порогом 3.0 (диапазон 0.0–8.0). Filters по умолчанию: UUID, строки вида `abcdefg`, префикс `id`, шаблоны `${key}` и `{{key}}`, lock files. — https://github.com/Yelp/detect-secrets/blob/master/docs/filters.md |
| GitHub secret scanning | сервис | — | 532 provider patterns от 207 провайдеров, 10 generic, 1 AI-detected `password` (мой подсчёт) | Не библиотека, полезен как список. У generic patterns есть оценка precision: HTTP Basic и Bearer — Medium. — https://docs.github.com/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns |

### 4.2 Движки для персональных данных

- **Presidio** (MIT, Python). 14 общих типов, среди них `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `IBAN_CODE`, `IP_ADDRESS`,
  `URL`, `UUID`; наборов для отдельных стран много, для России нет —
  https://github.com/microsoft/presidio/blob/main/docs/supported_entities.md. Конфигурация по умолчанию — «recognizers and models for
  English» — https://github.com/microsoft/presidio/blob/main/docs/analyzer/languages.md. `default_score_threshold` = 0, у запроса есть свой
  `score_threshold` — https://github.com/microsoft/presidio/blob/main/presidio-analyzer/presidio_analyzer/analyzer_engine.py. Operators:
  `replace` (по умолчанию `<PHONE_NUMBER>`), `redact`, `hash` (sha256 или sha512; с 2.2.361 соль по умолчанию случайная), `mask`
  (`chars_to_mask`, `masking_char`, `from_end`), `encrypt` и обратный `decrypt`, `custom`, `keep` —
  https://github.com/microsoft/presidio/blob/main/docs/anonymizer/index.md
- **LLM Guard** (MIT, Python). `Anonymize` построен на Presidio плюс свои regex; заменяет на `[REDACTED_PERSON_1]` и хранит оригиналы в
  `Vault`; `use_faker` подставляет вымышленные данные; `threshold` по умолчанию 0; языки — English и Chinese. В их benchmark среднее время
  129–244 ms на CPU для prompt длиной 317. — https://github.com/protectai/llm-guard/blob/main/docs/input_scanners/anonymize.md
- **Google Cloud SDP** (облачный API). «Choosing a minimum likelihood level involves finding the right balance between recall and
  precision»; порог задаётся и для отдельного infoType — https://cloud.google.com/sensitive-data-protection/docs/likelihood. Встроенные
  detectors «are not a perfectly accurate detection method»; «Many infoType detectors require contextual clues» —
  https://cloud.google.com/sensitive-data-protection/docs/concepts-infotypes. Есть `AUTH_TOKEN`, `PASSWORD`, `JSON_WEB_TOKEN`, `GCP_API_KEY`,
  `AWS_CREDENTIALS`, `HTTP_COOKIE` и `RUSSIA_PASSPORT` — https://cloud.google.com/sensitive-data-protection/docs/infotypes-reference

### 4.3 NER models, которые работают в JS

transformers.js (Apache-2.0) поддерживает task `token-classification` (он же `ner`) на ONNX Runtime, есть руководства для Node.js и
Electron — https://github.com/huggingface/transformers.js, https://huggingface.co/docs/transformers.js/tutorials/node. GLiNER.js (Apache-2.0,
npm `gliner`) запускает GLiNER в ONNX — https://github.com/Ingvarstep/GLiNER.js. Данные ниже — из Hugging Face API и model cards
(`https://huggingface.co/<model>`).

| Model | Лицензия | Языки | Размер | Заметка |
| --- | --- | --- | --- | --- |
| `Xenova/bert-base-NER` (ONNX-версия `dslim/bert-base-NER`) | MIT | en | 108M params; ONNX int8 ≈ 109 MB | готова для transformers.js |
| `Xenova/bert-base-multilingual-cased-ner-hrl` | AFL-3.0 у оригинала (Davlan) | ar, de, en, es, fr, it, lv, nl, pt, zh; без ru | ONNX int8 ≈ 178 MB | — |
| `Babelscape/wikineural-multilingual-ner` | CC BY-NC-SA 4.0 | 9, включая ru | 177M | только некоммерческое использование |
| `urchade/gliner_multi_pii-v1` (ONNX у `onnx-community`) | Apache-2.0 | en, fr, de, es, pt, it | ONNX int8 ≈ 349 MB, fp32 ≈ 1.16 GB | типы задаются при запуске (zero-shot) |
| `openai/privacy-filter` | Apache-2.0 | «Primarily English» | 1.5B params, из них 50M активных; ONNX q4 ≈ 917 MB | 8 категорий: `account_number`, `private_address`, `private_email`, `private_person`, `private_phone`, `private_url`, `private_date`, `secret`; контекст 128k tokens; пример для transformers.js |
| `redmadrobot-rnd/rubert-base-pii-ner` | Apache-2.0 | ru | 178M | ФИО, адрес, паспорт, ИНН, СНИЛС, ОМС; ONNX не проверял |
| `Wismut/nym-pii-multilingual` | MIT | 22, включая ru | 308M; ONNX fp32 1.2 GB | 40 типов |
| `tabularisai/eu-pii-safeguard` | Apache-2.0 | 26, включая ru | 559M | 42 типа |
| `iiiorg/piiranha-v1-detect-personal-information` | CC BY-NC-ND 4.0 | 6, без ru | 278M | некоммерческое, без изменений |

## 5. Browser extensions, которые маскируют prompt для ChatGPT и Claude

- **Rescriber** (Chrome; код под MIT; по статье CHI '25 лаборатории PEACH, Northeastern). По умолчанию запускает `openai/privacy-filter` в
  браузере через Transformers.js: «no server, no API key, no data leaves the machine». Заменяет значение на `[NAME1]`; mapping хранится
  локально для каждого разговора, и в ответе оригинал показывается на месте. Только chatgpt.com. — https://github.com/PEACH-Research-Lab/Rescriber.
  В исследовании 12 участников; Llama3-8B на устройстве они оценили на уровне GPT-4o. — https://arxiv.org/abs/2410.11876
- **Offsend** (Firefox, Apache-2.0, v0.4.0 от 2026-11-03). Detection локально: API keys, tokens, private keys, passwords, PII. «Stable
  placeholders like {{API_KEY_1}}»; Restore через «encrypted, time-limited mappings»; при находке — Mask, Send anyway или Cancel, есть
  auto-mask. ChatGPT, Claude, Gemini, Perplexity, DeepSeek, Grok. — https://addons.mozilla.org/firefox/addon/offsend/
- **Velum Lite** (Firefox, all rights reserved, v0.11.0). «100% on-device», модель встроена. Около 50 шаблонов credentials; номера документов
  с проверкой checksum для 7 стран; имена, организации и места ищет локальная multilingual model. По умолчанию tokens, «format-valid
  surrogates» — по выбору. «Detection sensitivity: … Lower catches more and over-masks more.» Mapping живёт в памяти сессии и стирается при
  закрытии браузера; чтобы вернуть значения, ответ вставляют обратно и нажимают Unmask. — https://addons.mozilla.org/firefox/addon/velumprivacy/
- **Nightfall DLP for Browsers** (enterprise): «automatically redacts sensitive data before submission … or allows employees to make informed
  decisions about submission». Где идёт detection, листинг не говорит. — https://addons.mozilla.org/addon/nightfall-dlp-for-browsers/

## 6. Техники и известные сбои

### 6.1 Чем заменять найденное

- **Placeholder с типом:** Presidio `<PHONE_NUMBER>` (без номера), LLM Guard `[REDACTED_PERSON_1]`, LiteLLM `[PERSON]`, Rescriber `[NAME1]`,
  Offsend `{{API_KEY_1}}`, Bedrock `{NAME}`, Google `ReplaceWithInfoTypeConfig` (ссылки — в разделах 3–5).
- **Вымышленное значение:** LLM Guard `use_faker`; Google `ReplaceDictionaryConfig` — «useful if you want to use realistic surrogate
  values»; surrogates в Velum (по умолчанию выключены). — https://cloud.google.com/sensitive-data-protection/docs/transformations-reference
- **С сохранением формата:** Google `CryptoReplaceFfxFpeConfig` обратим, но «can run very slowly» (алфавит 2–95 символов);
  `CryptoDeterministicConfig` (AES-SIV) обратим и «generates identical tokens for each instance of an identical input value» — та же страница.
  Prεεmpt применяет format-preserving encryption к значениям, у которых для ответа важен только формат (SSN, номер карты) —
  https://arxiv.org/abs/2504.05147
- **Частичная маска и hash:** Presidio `mask` с `chars_to_mask` и `from_end`, Google `CharacterMaskConfig`. У `hash` в Presidio соль по
  умолчанию случайная, и одно значение получает разные hash; для «referential integrity» нужна своя постоянная соль. —
  https://github.com/microsoft/presidio/blob/main/docs/anonymizer/index.md
- **Замер:** SurrogateShield (препринт одного автора, свой корпус из 1 124 запросов): surrogates — BERTScore 94.85%, placeholders — 81.59%;
  F1 detection 98.87%. — https://arxiv.org/abs/2606.29567

### 6.2 Один и тот же placeholder и возврат значений (rehydration)

- LLM Guard ищет в `Vault` точное совпадение значения (`entity_vault_value == entity_value`) и берёт его прежний placeholder —
  https://github.com/protectai/llm-guard/blob/main/llm_guard/input_scanners/anonymize.py. Presidio состояния не хранит, mapping ведёт
  вызывающий код — https://github.com/microsoft/presidio/blob/main/docs/anonymizer/index.md
- `Deanonymize` ищет placeholders в ответе стратегиями `exact`, `case_insensitive`, `fuzzy` («Kaenu Reves → Keanu Reeves») и
  `combined_exact_fuzzy` — https://github.com/protectai/llm-guard/blob/main/llm_guard/output_scanners/deanonymize.py. LiteLLM
  `output_parse_pii` «only un-masks tokens … it does not run Presidio detection on outputs» — https://docs.litellm.ai/docs/proxy/guardrails/pii_masking_v2
- Мой вывод из описания hooks (готовой функции нет): `MessageDisplay` в Claude Code может показать настоящее значение только на экране, а
  `PreToolUse.updatedInput` — подставить его в аргументы `Write`, `Edit` или `Bash` до выполнения; модель при этом видит placeholder.

### 6.3 False positives в тексте разработчика

- OpenAI Privacy Filter: «over-redaction of benign high-entropy strings, placeholders, hashes, sample credentials, or synthetic examples that
  resemble secrets»; пропуски — «novel credential formats, project-specific token patterns, or secrets split across surrounding syntax». —
  https://huggingface.co/openai/privacy-filter
- Basak и соавторы: false positives — «generic regular expressions and ineffective entropy calculation»; false negatives — «faulty regular
  expressions, skipping specific file types, and insufficient rulesets». — https://arxiv.org/abs/2307.00714
- Авторы detectors сами собрали списки типичных false positives: filters detect-secrets (UUID, `abcdefg`, префикс `id`, шаблоны, lock files)
  и около 1 400 stopwords у `generic-api-key` в gitleaks, в том числе `hash`, `sha1`, `sha256` (раздел 4.1). Обратный случай: Presidio и LLM
  Guard считают UUID персональными данными, поэтому идентификаторы в логах и коде маскируются (раздел 4.2).
- GitHub push protection берёт только свежие форматы tokens, чтобы не блокировать commit, когда «a result may be a false positive, which is
  more likely to happen with legacy tokens». — https://docs.github.com/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns

### 6.4 Опубликованные цифры

| Источник | Что мерили | Цифры |
| --- | --- | --- |
| Basak et al., ESEM 2023 — https://arxiv.org/abs/2307.00714 | 5 open-source и 4 коммерческих secret detectors на benchmark | precision: GitHub 75%, Gitleaks 46%, «Commercial X» 25%; recall: Gitleaks 88%, SpectralOps 67%, TruffleHog 52% |
| PIIBench, 2026 — https://arxiv.org/abs/2604.15776 | 8 PII-систем, 48 типов | у всех span-level F1 < 0.14; лучший — Presidio, 0.1385 |
| OpenAI Privacy Filter, model card от 2026-04-22 — https://cdn.openai.com/pdf/c66281ed-b638-456a-8ce1-97e9f5264a90/OpenAI-Privacy-Filter-Model-Card.pdf | PII-Masking-300k; CredData; синтетика | все типы: precision 0.940, recall 0.980, F1 0.960 по tokens (0.926 по spans). `secret`: precision 0.747, recall 0.965, F1 по spans 0.617. Русский (синтетика): precision 0.900, recall 0.890, F1 0.895. Recall по `secret` без подсказки в контексте — 0.361, с подсказкой перед значением — 0.708 |
| `redmadrobot-rnd/rubert-base-pii-ner`, model card — https://huggingface.co/redmadrobot-rnd/rubert-base-pii-ner | свой русский benchmark, 14 категорий, точное совпадение | precision 0.819, recall 0.855, F1 0.836 (замер авторов) |
| GLiNER2-PII, 2026 — https://arxiv.org/abs/2605.09973 | benchmark SPY | «highest span-level F1 among five compared systems, including OpenAI Privacy Filter»; чисел в абстракте нет |

## Чего не нашёл

- Маскировки того, что уходит модели (prompt, вывод tools), нет ни в документации Anthropic, ни в документации OpenAI.
- Что Claude Code пишет в transcript после `updatedToolOutput`: Anthropic молчит, GitGuardian утверждает, что подменённый вывод.
- Output schema встроенных tools Claude Code, кроме `Bash` (например, `Read`): в hooks reference её нет.
- Работает ли `openai_base_url` в Codex при входе через ChatGPT. Разрешают ли условия Anthropic и OpenAI менять текст запросов на proxy
  (у Anthropic есть только требования к headers и полям body). Пропускает ли в Codex `"allow"` с `updatedInput` approval prompt и sandbox.
- Значение «Help improve our AI models» по умолчанию у новых consumer-аккаунтов Anthropic (у OpenAI: включено). Срок хранения сессий Codex
  CLI на серверах OpenAI и попадают ли они в историю аккаунта (есть только статья про Codex chats в ChatGPT).
- Независимых замеров precision и recall для русских имён в коде и логах: есть только цифры авторов моделей и синтетика.
- Цифр о том, как git SHA, base64 и UUID влияют на конкретный detector: источники пишут о hashes и high-entropy strings только в общем виде.
- Где идёт detection у Nightfall. Почему README Rescriber обещает загрузку «~30–50 MB», когда ONNX q4 у `openai/privacy-filter` ≈ 917 MB.
  Общего числа встроенных infoTypes у Google: справочник его не называет.
- Исследований с пользователями, где сравнивали бы «уровень» и переключатели по категориям.
