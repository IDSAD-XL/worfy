# 01 — Skills Matt Pocock в plugin worfy: копия 1.3.1, лицензия, ссылки `worfy:`

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 1, 3, 5, 6; «Какие skills берём»; «Как работает» → «Копия и авторство», «Перекрёстные ссылки», «Где skills находят tracker»; «Вопросы владельцу», Q1–Q4, Q6

Не платформенный: только текст skills и документ `TICKETS.md`, без путей ОС и без скриптов. Глубина ревью — `medium`.

## Что происходит

- Plugin `worfy` объявляет зависимость `mattpocock-skills@claude-plugins-official` (`harness/.claude-plugin/plugin.json:7`);
  skills Matt Pocock приходят из неё и называются `/mattpocock-skills:<имя>`.
- Skills Matt Pocock зовут друг друга по голому имени (Skill tool с `"grilling"`) и отправляют пользователя к
  `/setup-matt-pocock-skills`, который пишет `CLAUDE.md` и `docs/agents/` в репозиторий проекта. Места — в spec,
  «Перекрёстные ссылки».
- Операции wayfinder для локальных Ticket-ов (`issue-tracker-local.md` из `setup-matt-pocock-skills`) говорят
  `Status: resolved` и метки `wayfinder:<type>`; у worfy — `bin/ticket done`, слово `done` и строка `Type:`
  (`harness/bin/TICKETS.md`).
- `harness/skills/tickets-to-tasks/SKILL.md:3`, `:8`, `:129` называют `/mattpocock-skills:to-tickets` и
  `/mattpocock-skills:wayfinder`.
- `harness/evals/lib/coverage.json` перечисляет каждый файл правил Harness: случай eval или запись в `uncovered`;
  `scripts/eval-harness.mjs --changed` выходит с exit 1, если карта не совпадает с `harness/`.

## Что делаем

1. **Копия.** 19 skills из таблицы «Берём» spec-а, кроме `retro` (Ticket 02), — в `harness/skills/<имя>/`, со всеми
   файлами папки (`SKILL.md`, соседние `.md`, `agents/openai.yaml`, `scripts/`, `template.sh`). Источник —
   установленная копия 1.3.1 или upstream на commit-е `49dd158d1076134a641b33efb035946536778336`; копия только
   читается. `pr`, `wizard`, `triage`, `implement`, `implement-spec` не копируются (Q1–Q4, подтверждено владельцем
   2026-11-07).
2. **Авторство.** `harness/skills/THIRD_PARTY.md` (английский): upstream, версия, commit, MIT, автор, список skills,
   список правок ссылок по файлам, правило «синхронизации нет, новая версия — отдельный PR по слову владельца».
   `harness/skills/LICENSE.mattpocock-skills` — текст `LICENSE` копии без изменений.
3. **Ссылки.** Каждый вызов Skill tool по имени — `worfy:<имя>`; `/setup-matt-pocock-skills` →
   `/worfy:connect-project`; `/codebase-design`, `/teach` и подобные — `/worfy:<имя>`. Строка «The issue tracker should
   have been provided to you…» — на текст из spec, «Где skills находят tracker» (Q6, подтверждено владельцем 2026-11-07).
4. **`harness/bin/TICKETS.md`** — раздел `## Wayfinding operations`: map, Ticket карты, `Type:`, `Blocked by`,
   frontier, claim и resolve через `bin/ticket`, нет меток триажа, glossary — `docs.context` Profile-а.
5. **`connect-project`** — шаг, который называет в отчёте tracker (`tickets.root`) и glossary (`docs.context`), и
   строка о найденном `docs/agents/issue-tracker.md` с GitHub или GitLab. Файлов в репозиторий проекта не пишет.
6. **`tickets-to-tasks`** — `/worfy:to-tickets` и `/worfy:wayfinder` вместо имён `mattpocock-skills:`.
7. **`coverage.json`** — новые файлы правил в `uncovered` с причиной «No case yet: worfy-skills 05 adds cases»; случаи
   добавит Ticket 05.
8. Зависимость в `plugin.json` этот Ticket **не трогает** (Ticket 03): пока у пользователя обе копии, обе работают.

## Готово, когда

- [ ] 19 skills лежат в `harness/skills/`; для каждого файла хэш совпадает с 1.3.1, кроме файлов из списка правок
      `THIRD_PARTY.md` — таблица хэшей в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-third-party-skills.test.ts` exit 0 · mac - · ba437868580e603364f9b13007e0d5a9a3e1310d
- [ ] `THIRD_PARTY.md` и `LICENSE.mattpocock-skills` есть; текст `LICENSE` совпадает с копией 1.3.1 байт в байт.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-third-party-skills.test.ts` exit 0 · mac - · ba437868580e603364f9b13007e0d5a9a3e1310d
- [ ] Contract test: в `harness/` нет `mattpocock-skills`, `setup-matt-pocock-skills`, `ask-matt` (кроме
      `THIRD_PARTY.md`); каждый вызов Skill tool по имени в `harness/skills/` — `worfy:<имя>` существующего skill-а.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-third-party-skills.test.ts` exit 0 · mac - · ba437868580e603364f9b13007e0d5a9a3e1310d
- [ ] Contract test: у каждого `SKILL.md` из копии `name` в frontmatter совпадает с именем папки; `disable-model-invocation`
      такой же, как у 1.3.1.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-third-party-skills.test.ts` exit 0 · mac - · ba437868580e603364f9b13007e0d5a9a3e1310d
- [ ] Раздел `## Wayfinding operations` в `TICKETS.md`; `bash harness/bin/tests/skill-blocks.test.sh` и
      `node scripts/eval-harness.mjs --dry-run --changed origin/main` — exit 0.
  - evidence: test-run pass · `bash harness/bin/tests/skill-blocks.test.sh` exit 0, `node scripts/eval-harness.mjs --dry-run --changed origin/main` exit 0 · mac - · ba437868580e603364f9b13007e0d5a9a3e1310d
- [ ] `node scripts/check-cyrillic.mjs` — exit 0 (тексты plugin-а английские).
  - evidence: test-run pass · `node scripts/check-cyrillic.mjs` exit 0 · mac - · ba437868580e603364f9b13007e0d5a9a3e1310d
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0, `gate fast` exit 0 · mac - · ba437868580e603364f9b13007e0d5a9a3e1310d

## Тесты

- Contract `test/contract/harness-third-party-skills.test.ts` (новый): ссылки, имена, frontmatter, `LICENSE`.
- Сначала падающий: test на голое имя Skill tool — красный на первой копии без правок ссылок.
- Существующие: `test/contract/harness-plugin.test.ts`, `test/contract/harness-evals.test.ts`,
  `harness/bin/tests/skill-blocks.test.sh`, `harness/bin/tests/epic-wave-ship-ticket.test.sh`.

## Где в коде

- `harness/skills/code-review/**`, `harness/skills/codebase-design/**`, `harness/skills/diagnosing-bugs/**`,
  `harness/skills/domain-modeling/**`, `harness/skills/grill-with-docs/**`,
  `harness/skills/improve-codebase-architecture/**`, `harness/skills/prototype/**`, `harness/skills/research/**`,
  `harness/skills/tdd/**`, `harness/skills/to-spec/**`, `harness/skills/to-tickets/**`, `harness/skills/wayfinder/**`,
  `harness/skills/grill-me/**`, `harness/skills/grilling/**`, `harness/skills/handoff/**`, `harness/skills/teach/**`,
  `harness/skills/to-questionnaire/**`, `harness/skills/wait-what/**`, `harness/skills/writing-for-agents/**` (новые)
- `harness/skills/THIRD_PARTY.md` (новый)
- `harness/skills/LICENSE.mattpocock-skills` (новый)
- `harness/skills/connect-project/SKILL.md`
- `harness/skills/tickets-to-tasks/SKILL.md`
- `harness/bin/TICKETS.md`
- `harness/evals/lib/coverage.json`
- `test/contract/harness-third-party-skills.test.ts` (новый)

Только читать: копия `mattpocock-skills` 1.3.1, `harness/.claude-plugin/plugin.json`, `scripts/eval-harness-coverage.mjs`.

## Итог

Ветка `worfy-skills/01` (по шаблону `tickets.branch` Profile-а, без slug).

### Что скопировано

19 skills из установленной копии `mattpocock-skills` 1.3.1 (кэш plugin-ов Claude Code; upstream commit
`49dd158d1076134a641b33efb035946536778336`), папка целиком, 53 файла: `code-review`, `codebase-design`,
`diagnosing-bugs`, `domain-modeling`, `grill-with-docs`, `improve-codebase-architecture`, `prototype`, `research`, `tdd`,
`to-spec`, `to-tickets`, `wayfinder`, `grill-me`, `grilling`, `handoff`, `teach`, `to-questionnaire`, `wait-what`,
`writing-for-agents`. `retro` не тронут (Ticket 02). Копия только читалась (`cp`, затем `cmp`/sha256).
`harness/skills/LICENSE.mattpocock-skills` — `cmp` с `LICENSE` копии: exit 0, sha256 `0e7ac423bf2c…`.

### Правки ссылок — 28 ссылок в 24 строках 10 файлов

- Вызов Skill tool по имени → `worfy:<имя>`: 17 (`grill-me` 1, `grill-with-docs` 2, `improve-codebase-architecture`
  4, `tdd` 1, `wayfinder` 9).
- `/setup-matt-pocock-skills` → текст про tracker из spec (Q6) или `/worfy:connect-project`: 5 (`code-review:13`,
  `to-spec:9`, `to-tickets:11`, `to-tickets:60`, `wayfinder:25`).
- `/codebase-design` → `/worfy:codebase-design`: 4 (`improve-codebase-architecture/SKILL.md:54`, `HTML-REPORT.md:42`,
  `:108`, `:123`); `/teach` → `/worfy:teach`: 1 (`teach/SKILL.md:12`).
- «the `code-review` skill» → «the `worfy:code-review` skill»: 1 (`tdd/SKILL.md:38`). В spec этой строки нет; правило
  п. 6 решений владельца («каждая ссылка skill-а на другой skill называет имя `worfy:`») её покрывает.

Полный список по файлам и строкам — `harness/skills/THIRD_PARTY.md`, раздел «Reference edits».
Вне копии: `tickets-to-tasks/SKILL.md` — 4 ссылки `/mattpocock-skills:…` → `/worfy:to-tickets`, `/worfy:wayfinder`.

### Хэши (sha256, первые 12 знаков)

43 файла совпадают с 1.3.1 байт в байт, 10 — правки из `THIRD_PARTY.md`; хэши этих 10 файлов в копии закреплены в
`EDITED` того же test-а. Полные хэши 1.3.1 закреплены в
`test/contract/harness-third-party-skills.test.ts` (`UPSTREAM`).

| Файл | 1.3.1 | копия | |
| --- | --- | --- | --- |
| `code-review/SKILL.md` | `09eb147f793e` | `37cce433b548` | правка ссылок |
| `code-review/agents/openai.yaml` | `8229ca854e11` | `8229ca854e11` | совпадает |
| `codebase-design/DEEPENING.md` | `f3dd099ce992` | `f3dd099ce992` | совпадает |
| `codebase-design/DESIGN-IT-TWICE.md` | `52b52e75655a` | `52b52e75655a` | совпадает |
| `codebase-design/SKILL.md` | `2c20617f87ec` | `2c20617f87ec` | совпадает |
| `codebase-design/agents/openai.yaml` | `edebc9e4fcfe` | `edebc9e4fcfe` | совпадает |
| `diagnosing-bugs/SKILL.md` | `849198df88cd` | `849198df88cd` | совпадает |
| `diagnosing-bugs/agents/openai.yaml` | `3e430dbe4334` | `3e430dbe4334` | совпадает |
| `diagnosing-bugs/scripts/hitl-loop.template.sh` | `35103539fc36` | `35103539fc36` | совпадает |
| `domain-modeling/ADR-FORMAT.md` | `944c92aa790e` | `944c92aa790e` | совпадает |
| `domain-modeling/GLOSSARY-FORMAT.md` | `21dcc40cdec8` | `21dcc40cdec8` | совпадает |
| `domain-modeling/SKILL.md` | `7b925d7b1e34` | `7b925d7b1e34` | совпадает |
| `domain-modeling/agents/openai.yaml` | `f6bf2aa996c6` | `f6bf2aa996c6` | совпадает |
| `grill-with-docs/SKILL.md` | `7de372c13488` | `55287c9fd1f0` | правка ссылок |
| `grill-with-docs/agents/openai.yaml` | `94cd0ab161fb` | `94cd0ab161fb` | совпадает |
| `improve-codebase-architecture/HTML-REPORT.md` | `581e8bb5a521` | `907a9abe4b54` | правка ссылок |
| `improve-codebase-architecture/SKILL.md` | `552240a5ab5c` | `dfd0ed01e99c` | правка ссылок |
| `improve-codebase-architecture/agents/openai.yaml` | `c8cb20f68ebf` | `c8cb20f68ebf` | совпадает |
| `prototype/LOGIC.md` | `f61c7d249e78` | `f61c7d249e78` | совпадает |
| `prototype/SKILL.md` | `714de632d116` | `714de632d116` | совпадает |
| `prototype/UI.md` | `723211e878ac` | `723211e878ac` | совпадает |
| `prototype/agents/openai.yaml` | `5af65e43ab41` | `5af65e43ab41` | совпадает |
| `research/SKILL.md` | `985569f15739` | `985569f15739` | совпадает |
| `research/agents/openai.yaml` | `9b4c470d6322` | `9b4c470d6322` | совпадает |
| `tdd/SKILL.md` | `5505d25bbaa8` | `6c5b6da52ffe` | правка ссылок |
| `tdd/agents/openai.yaml` | `ea6f01cf1b8c` | `ea6f01cf1b8c` | совпадает |
| `tdd/mocking.md` | `3ceb807fdf4a` | `3ceb807fdf4a` | совпадает |
| `tdd/tests.md` | `859f9e592c18` | `859f9e592c18` | совпадает |
| `to-spec/SKILL.md` | `43ad9cf318e5` | `8f9c899397af` | правка ссылок и метки (ревью 1) |
| `to-spec/agents/openai.yaml` | `1c5b4d1e3d8e` | `1c5b4d1e3d8e` | совпадает |
| `to-tickets/SKILL.md` | `56ec23c5b278` | `c32c365c660d` | правка ссылок, метки и шапки (ревью 1) |
| `to-tickets/agents/openai.yaml` | `21bc6215fffc` | `21bc6215fffc` | совпадает |
| `wayfinder/SKILL.md` | `9be7b478c389` | `e0bc29e39125` | правка ссылок |
| `wayfinder/agents/openai.yaml` | `88bc81a11a6d` | `88bc81a11a6d` | совпадает |
| `grill-me/SKILL.md` | `caaf8b8de168` | `310e9e01d9b1` | правка ссылок |
| `grill-me/agents/openai.yaml` | `c061e39c3e0f` | `c061e39c3e0f` | совпадает |
| `grilling/SKILL.md` | `befdff1e27a1` | `befdff1e27a1` | совпадает |
| `grilling/agents/openai.yaml` | `1411d7df7d99` | `1411d7df7d99` | совпадает |
| `handoff/SKILL.md` | `4cbb043950da` | `4cbb043950da` | совпадает |
| `handoff/agents/openai.yaml` | `5c479fd562c6` | `5c479fd562c6` | совпадает |
| `teach/GLOSSARY-FORMAT.md` | `9b99859ec284` | `9b99859ec284` | совпадает |
| `teach/LEARNING-RECORD-FORMAT.md` | `701fa34b6748` | `701fa34b6748` | совпадает |
| `teach/MISSION-FORMAT.md` | `8cacbb3c0644` | `8cacbb3c0644` | совпадает |
| `teach/RESOURCES-FORMAT.md` | `e9cacf34026e` | `e9cacf34026e` | совпадает |
| `teach/SKILL.md` | `550482c2d674` | `04c70a169b35` | правка ссылок |
| `teach/agents/openai.yaml` | `5856f3ae8aec` | `5856f3ae8aec` | совпадает |
| `to-questionnaire/SKILL.md` | `b5eb929842ee` | `b5eb929842ee` | совпадает |
| `to-questionnaire/agents/openai.yaml` | `9e8a06c38c88` | `9e8a06c38c88` | совпадает |
| `wait-what/SKILL.md` | `d961bb37defd` | `d961bb37defd` | совпадает |
| `wait-what/agents/openai.yaml` | `b41faadf741d` | `b41faadf741d` | совпадает |
| `writing-for-agents/SKILL-MECHANICS.md` | `c768e6307c7c` | `c768e6307c7c` | совпадает |
| `writing-for-agents/SKILL.md` | `551adca94222` | `551adca94222` | совпадает |
| `writing-for-agents/agents/openai.yaml` | `eacb24b2a618` | `eacb24b2a618` | совпадает |

### Ревью 1 (REJECTED) — что исправлено

- **Шаблон Ticket-а в `to-tickets`** писал `**Status:** ready-for-agent` и `**Blocked by:**` без `Type:`: `epic-status` читал
  это как «old header», а `ticket migrate` превратил бы `ready-for-agent` в `claimed`. Теперь шапка по `TICKETS.md`:
  `Type: task`, `Status: open`, `Blocked by: None — can start immediately`; строка 62 говорит, как писать номера
  (`Blocked by: 01, 03`).
- **Метки триажа** убраны: `to-spec:19`, `to-tickets:63`, слова «triage label vocabulary» в `to-spec:9` и
  `to-tickets:11`. В «Wayfinding operations» сказано: у Ticket-ов worfy меток нет, указание поставить метку триажа
  не выполняется.
- **Новые проверки** в contract test: заголовок `## Wayfinding operations` есть в `TICKETS.md` (мутант с переименованным
  заголовком теперь падает: exit 1); каждый файл, который цитирует раздел, называет `bin/TICKETS.md`; в скопированных
  skills нет `ready-for-agent`, `needs-triage`, «triage label vocabulary» (кроме строк с «never»); шаблон
  `to-tickets`, записанный как Ticket, `epic-status --json` читает как `open`, `statusError: null`, `blockedParsed: true`;
  список «Copied skills» в `THIRD_PARTY.md` равен `COPIED`; хэши 10 правленых файлов закреплены.
- До правки: 2 failed | 47 passed (метки и шапка шаблона); после — 49 passed.

### Сначала падающий test

`node scripts/vitest-electron.mjs test/contract/harness-third-party-skills.test.ts` на копии без правок ссылок: exit 1,
6 failed | 38 passed. Красные: 17 голых имён Skill tool (`grill-me/SKILL.md:7 "grilling"` …), 11 ссылок
`/<skill>` и `/setup-matt-pocock-skills`, 5 файлов с `mattpocock-skills`, нет `THIRD_PARTY.md` и `LICENSE`. После правок —
exit 0.

### Отступления от Ticket-а

- **Contract test «в `harness/` нет `mattpocock-skills`»** пропускает, кроме `THIRD_PARTY.md`, ещё два файла:
  `harness/.claude-plugin/plugin.json` (зависимость убирает Ticket 03) и `harness/README.md` (описание зависимости
  правит Ticket 04). Без этого test красный до Ticket-ов 03 и 04; каждый из них убирает свою строку из
  `MAY_NAME_UPSTREAM`. Имя файла `LICENSE.mattpocock-skills` (его требует Ticket) из поиска вырезано.
- **Причина в `coverage.json`** — «No case yet: the cases of the copied skills come in a later change.», а не «No case
  yet: worfy-skills 05 adds cases»: `harness/bin/tests/plugin-neutral.test.sh` запрещает в plugin-е номера Ticket-ов
  эпиков worfy (ADR-0074). `THIRD_PARTY.md` и `LICENSE.mattpocock-skills` — тоже файлы правил для карты; их причина —
  «nothing for an agent to do».
- **Два Harness shell test-а вне «Где в коде»** правлены, иначе красные на копии:
  `harness/bin/tests/start-context.test.sh` (проверка «каждый файл рядом с `SKILL.md` назван через
  `${CLAUDE_PLUGIN_ROOT}/skills/…`» — правило worfy, upstream ссылается относительно; skills из раздела «Copied skills»
  `THIRD_PARTY.md` проверка пропускает) и `harness/bin/tests/plugin-neutral.test.sh` (4 исключения на текст upstream:
  URL `/users/` в примере `tdd/mocking.md`, пример `ADR-0007`, шаблон `scripts/hitl-loop.template.sh` и его ключ в
  `coverage.json`).
- **Список папок `harness/skills/` в `test/contract/harness-migrate.test.ts`** (Q19 формы миграции) дополнен 19
  skills, `THIRD_PARTY.md` и `LICENSE.mattpocock-skills`. План миграции берёт skills старого Harness из постоянного
  списка `HARNESS_SKILLS` (`src/main/harness/migrate/plan.ts:24`), не из папки: свой skill пользователя с тем же именем
  в `~/.claude/skills` миграция удалить не предложит.
- **Codex и имена `worfy:`** (риск 4 spec-а): записи `test/fixtures/codex-messages/skills.jsonl` и
  `test/contract/codex-compat.test.ts` дают имя skill-а plugin-а в Codex как `<plugin>:<skill>`
  (`capture-plugin-a:capture-skill-c`), то есть тот же префикс. Расхождения нет.
- Страницы Feature (`docs/features/skills-agents-and-hooks.md`) не правлены: их переписывает Ticket 04.
