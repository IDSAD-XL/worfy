# 06: Статика SkillEvaluator по 35 skill-ам

Type: task
Status: done 2026-11-28T07:53Z
PR: #2350
Branch: worfy-harness-eval/06
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 06; «Решения владельца», «SkillEvaluator» (Ticket 02 и 03 темы: бесплатная
статика один раз, «да»); «Решения по реализации» («SkillEvaluator»);
[бриф для Orchestrator-а](../../../docs/product/harness-eval/для-orchestrator-а-статика-skillevaluator.md);
[заметка SkillEvaluator](../../../docs/product/harness-eval/research-nvidia-skillevaluator.md); «Волны», Wave 1

Кто: агент. Глубина ревью — `low`: кода продукта нет, PR несёт отчёт в «Итог» этого Ticket-а.

Бесплатно: `harness-check` и Tier 1 моделей не зовут. Tier 2 и Tier 3 здесь не запускаются. Настоящий binary Codex не
запускается: `harness-check` предсказывает загрузку skill-а в Codex по файлам, сам Codex ему не нужен.

## Что происходит

- Ни один run наших eval-ов не проверяет, загружает ли Codex skill-ы Harness, хотя worfy ставит `harness/` plugin-ом и
  в Claude Code, и в Codex (`harness/README.md`, раздел «On Codex»).
- Бриф темы писался под 34 skill-а. На main `c66e7215a` их 35: добавился `orchestrator-rules` (worfy-polish 160, #2289).

## Что строить

- Шаги брифа `docs/product/harness-eval/для-orchestrator-а-статика-skillevaluator.md`, «Что сделать», 1–5:
  - SkillEvaluator 1.2.0 в отдельном окружении Python в новой папке из `mktemp -d` — не в репозитории и не в main
    checkout;
  - копия `harness/` с main через `git archive`, не из Stable copy;
  - `skillevaluator harness-check <папка skill-а> -v` для каждого из 35 skill-ов `harness/skills/*/`;
  - Tier 1 по plugin-у целиком и по каждому skill-у. Без внешних сканеров (Gitleaks, Bandit) ответ `INCOMPLETE` —
    это «не проверено», а не «чисто».
- Отчёт — в «Итог» этого Ticket-а (папки тем `docs/product/` правит только Product Session):
  - по каждому skill-у: что `harness-check` сказал для Claude Code и для Codex — loads, degrades или drops — и почему;
  - находки Tier 1 уровня High и Critical, кроме BH1 «hook payload unmodeled» на command hook-ах (бриф называет её
    шумом);
  - версии SkillEvaluator и профилей агентов, commit main.
- Находка, которую надо чинить, — по правилу провала (spec, «Решения владельца», «Провал»): вопрос владельцу в «Итог»,
  Ticket-ы не заводятся сами.
- Временное окружение удаляется в конце; фоновых процессов не остаётся.

## Где в коде

- Только читать: `harness/skills/*/SKILL.md`, `harness/hooks/hooks.json`, `harness/.claude-plugin/`
- `docs/product/harness-eval/для-orchestrator-а-статика-skillevaluator.md` — бриф

## Test-ы

- Кода нет. Exit code каждого запуска SkillEvaluator — в «Итог».

## Готово, когда

- [ ] `harness-check` по 35 skill-ам для Claude Code и Codex — таблица в «Итог».
  - evidence: commit pass · worfy-harness-eval/06: one-off SkillEvaluator static check of the 35 Harness skills · - - · 8671e440572e36066da9b25b2a036d802aa12fe7
  - evidence: review pass · PR #2350 · - - · 3a184a515212e0112d42e66ee573c26c12f0a79f
- [ ] Tier 1 по plugin-у и по skill-ам — находки High и Critical в «Итог» или причина `INCOMPLETE`.
  - evidence: commit pass · worfy-harness-eval/06: one-off SkillEvaluator static check of the 35 Harness skills · - - · 8671e440572e36066da9b25b2a036d802aa12fe7
  - evidence: review pass · PR #2350 · - - · 3a184a515212e0112d42e66ee573c26c12f0a79f
- [ ] Версии и commit main в «Итог»; временное окружение удалено.
  - evidence: commit pass · worfy-harness-eval/06: one-off SkillEvaluator static check of the 35 Harness skills · - - · 8671e440572e36066da9b25b2a036d802aa12fe7
  - evidence: review pass · PR #2350 · - - · 3a184a515212e0112d42e66ee573c26c12f0a79f
- [ ] `pnpm lint` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint` exit 0 · mac - · 8671e440572e36066da9b25b2a036d802aa12fe7
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/46118787535/job/140899312864 · ci - · 3a184a515212e0112d42e66ee573c26c12f0a79f

## Итог

Прогон 2026-11-28, агент. Модель не вызывалась ни разу: пакет поставлен без extra `llm` (в окружении нет ни
`anthropic`, ни `openai`, ни `litellm`), каждая команда шла под `env -i` без ключей и с `--no-llm`, `HOME` — временная
папка. Codex не запускался: `harness-check` читает только файлы.

### Что и чем

- main `1f66f5994dc9de8de0b8f62289c2d9e492ca565b`; копия `harness/` — `git archive origin/main harness`.
- SkillEvaluator 1.2.0 (PyPI, `uv pip install skillevaluator==1.2.0`) в venv Python 3.12 в папке из `mktemp -d`.
- Сканеры Tier 1 (`skillevaluator doctor --tier 1`, exit 0): SkillSpector 2.13.6 (`uv tool run`), Bandit 1.9.4
  (зависимость пакета), Gitleaks 8.30.0 (скачан самим SkillEvaluator во временный `HOME`). Semgrep не ставился — по
  doctor он необязательный.
- Профили агентов (`harness-check -v`, все проверены авторами 2026-11-01): Claude Code 2.1.316, Codex 0.166.0,
  Copilot CLI 1.0.105, Hermes main @ c419cf7c864a, OpenClaw 2026.10.9, OpenCode 1.19.5.
- Skill-ов 35 (`harness/skills/*/`), с `orchestrator-rules`.

### harness-check: Claude Code и Codex

`skillevaluator harness-check <skill> -v --json …` — 35 запусков, у всех exit 0 (команда advisory, exit code у неё
всегда 0).

Для всех 35 skill-ов ответ одинаковый: **Claude Code — degraded, Codex — degraded**; drops нет ни у одного. Причина
общая для каталога, не для skill-а: у 35 skill-ов 9 668 символов description, а список skill-ов, когда окно модели
неизвестно, вмещает 8 000 (`CC-LIST-BUDGET`: Claude Code укорачивает description; `CX-LIST-BUDGET`: Codex укорачивает,
потом убирает description, потом выбрасывает skill-ы). Это зависит от окна: на `qmd` с `--context-tokens 200000` —
Claude Code degraded, Codex loads; с `--context-tokens 1000000` — оба loads (exit 0 у обоих запусков). Сколько
символов занимают skill-ы других plugin-ов в той же сессии, `harness-check` не знает: он считает только папку
`harness/skills/`.

Сверх этой общей причины — только у Codex:

| Skill | Claude Code | Codex | Что ещё сказал Codex |
|---|---|---|---|
| epic-wave | degraded | degraded | `CX-SHELL-READ`: `SKILL.md` — 162 984 байт (~40 746 tokens); если модель читает его через shell, Codex оставляет только начало и конец вывода сверх ~10K tokens. Совет: `SKILL.md` до ~40 000 байт, детали в `references/`. |
| human-review-setup | degraded | degraded | `CX-DMI-IGNORED`: Codex не знает `disable-model-invocation`, модель может вызвать skill сама. У skill-а нет `agents/openai.yaml` с `policy: {allow_implicit_invocation: false}`. |
| overnight-fix-loop | degraded | degraded | `CX-DMI-IGNORED`, то же: нет `agents/openai.yaml`. |
| handoff, owner-check, teach | degraded | degraded | `CX-CLAUDE-ONLY` (advisory): Codex игнорирует `argument-hint`. |
| остальные 29 | degraded | degraded | только `CX-LIST-BUDGET` |

Проверил по файлам: `disable-model-invocation: true` стоит у 13 skill-ов; у 11 из них `agents/openai.yaml` с
`allow_implicit_invocation: false` есть, у `human-review-setup` и `overnight-fix-loop` — нет.

### Tier 1 по plugin-у

`skillevaluator validate <harness> --tiers 1 --no-llm -r cli,json,markdown` — exit 1, `FAIL`: 5 из 8 проверок
прошли (License, Code Risk, Secrets, Code Integrity, Unicode), 3 упали (Plugin Schema, Security Scan, PII). Critical —
0; High — 30 вхождений, 11 разных находок. Publication eligibility — `incomplete`.

- **Security Scan — `INCOMPLETE` у SkillSpector, то есть «не проверено»:** у 25 из 35 skill-ов анализ не завершён.
  Статусы `complete_with_caveats` (ссылки на файлы вне папки skill-а, `reference_missing` — например на
  `CLAUDE_PLUGIN_ROOT/bin/…`) и `partial` (команда, известная только во время выполнения, `static_parse_limit`) у
  continuous-audit, epic-wave, human-review-setup, overnight-fix-loop, owner-check, ship-ticket, tickets-to-tasks.
  Полностью просканированы 10: codebase-design, grill-me, grill-with-docs, grilling, handoff, prototype, research,
  to-questionnaire, to-spec, to-tickets.
- **Hook-и и `bin/` Tier 1 не сканировал вовсе.** Ни одной находки по `hooks/hooks.json`, в выводе нет слова «hook»;
  ожидаемая по их docs находка BH1 «hook payload unmodeled» не пришла ни на один из 21 command hook-а. Это совпадает с
  открытым issue #495 их репозитория (у plugin-а сканируются только bundled skills), а не с `docs/tier1-reference.mdx:362`. Значит,
  hook-и и скрипты Harness этой статикой не проверены.

### Tier 1 по каждому skill-у

`skillevaluator tier1 <skill> --no-llm -r cli,json,markdown` — 35 запусков: exit 0 у `codebase-design` и `prototype`
(всё прошло), exit 1 у остальных 33. Из 33 у восьми (continuous-audit, domain-modeling, gate-queue,
improve-codebase-architecture, orchestrator-rules, product-ideas, qmd, tickets-to-tasks) находок High нет, только
`INCOMPLETE` Security Scan по той же причине. Critical — 0 во всех запусках.

Находки High (одни и те же в plugin-е и по skill-ам), с моей оценкой по тексту файла:

| Находка | Где | Оценка |
|---|---|---|
| SCHEMA `frontmatter_field` + QUALITY `quality_correctness`: «description must not contain XML tags» | connect-project, max-review, overnight-fix-loop, owner-check, pr-fix, pr-reply, ship-ticket | Настоящая: в description есть плейсхолдеры `<folder>`, `<branch>`, `<epic>` и т. п. Claude Code показывает их в списке skill-ов как `&lt;…&gt;`. Поломки вызова не видно. |
| SCHEMA `body_heading`: нет `# Заголовка` после frontmatter | code-review, grill-me, grill-with-docs, grilling, handoff, research, retro, teach, to-spec, wait-what, wayfinder, writing-for-agents | Настоящая, косметика: тело начинается сразу с текста. |
| SECURITY TM1 «git push --force» | epic-wave `SKILL.md:967`, pr-fix `SKILL.md:29` | Ложная: в epic-wave — `--force-with-lease=<branch>:<headRefOid>`, в pr-fix — запрет такого push-а. |
| SECURITY TM1/TM2 `rm -f "$L/holder.json"`, `&& rm -` | epic-wave `SKILL.md:1538`, `:1543` | Ложная: снятие брошенного замка e2e по литеральному имени файла. |
| SECURITY TM1 `rm -rf "<_resolved.dir>/state/human-review"` | human-review-setup `SKILL.md:188` | Ложная: удаление своей папки по литеральному пути, только на отказ человека. |
| SECURITY TM2 Chaining Abuse | to-tickets `SKILL.md:40` | Ложная: текст про порядок Ticket-ов широкого рефакторинга. |
| SECURITY AR1 «always answer» | to-questionnaire `SKILL.md:9` | Ложная: «вопросы, на которые пользователь всегда может ответить». |
| SECURITY AR2 «do not judge» | ship-ticket `implementer-browser-checks.md:16` | Ложная: «не судить о входе по тексту страницы». |
| SECURITY P6 «show instruction» | diagnosing-bugs `scripts/hitl-loop.template.sh:10` | Ложная: комментарий шаблона, шаг показывает инструкцию человеку. |
| PII `personal_paths` «/users/${userId}/» | tdd `mocking.md:45` | Ложная: путь URL в примере (`fetch(\`/users/${userId}/orders\`)`), не путь macOS. |

### Вопросы владельцу (по правилу провала Ticket-ы не заводятся)

1. Codex может сам вызвать `human-review-setup` и `overnight-fix-loop`: у них `disable-model-invocation: true`, но нет
   `agents/openai.yaml` с `allow_implicit_invocation: false`, как у остальных 11 таких skill-ов. Чинить?
2. `epic-wave/SKILL.md` — 163 KB. В Codex при чтении через shell середина файла теряется. Делить на файлы шагов, как
   `ship-ticket`?
3. Описания 35 skill-ов — 9 668 символов; при окне 200K tokens Claude Code их укорачивает. Сокращать description
   (триггер первым) или считать это приемлемым?
4. Hook-и и `bin/` Harness SkillEvaluator не проверяет (issue #495). Нужна ли им другая статика?

Решения владельца 2026-11-28: 1 — да, добавить `agents/openai.yaml` с `allow_implicit_invocation: false` обоим skill-ам; 2 — да, делить `epic-wave/SKILL.md` на файлы шагов, как `ship-ticket`; 3 — да, сократить description, триггер первым; 4 — нет, hook-и и `bin/` покрывают shell test-ы и contract set worfy-harness-guarantees 08. Ticket-ы на 1–3 заводит Orchestrator в worfy-polish.

Временная папка с окружением, копией `harness/` и отчётами удалена после прогона; фоновых процессов не осталось.
