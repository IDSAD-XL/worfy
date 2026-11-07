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
- [ ] `THIRD_PARTY.md` и `LICENSE.mattpocock-skills` есть; текст `LICENSE` совпадает с копией 1.3.1 байт в байт.
- [ ] Contract test: в `harness/` нет `mattpocock-skills`, `setup-matt-pocock-skills`, `ask-matt` (кроме
      `THIRD_PARTY.md`); каждый вызов Skill tool по имени в `harness/skills/` — `worfy:<имя>` существующего skill-а.
- [ ] Contract test: у каждого `SKILL.md` из копии `name` в frontmatter совпадает с именем папки; `disable-model-invocation`
      такой же, как у 1.3.1.
- [ ] Раздел `## Wayfinding operations` в `TICKETS.md`; `bash harness/bin/tests/skill-blocks.test.sh` и
      `node scripts/eval-harness.mjs --dry-run --changed origin/main` — exit 0.
- [ ] `node scripts/check-cyrillic.mjs` — exit 0 (тексты plugin-а английские).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

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
