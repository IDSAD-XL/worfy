# 10 — Английские подстановки Profile и имена lens без русских слов в plugin

Type: task
Status: done 2026-10-21T03:27Z
PR: #649
Blocked by: 07
Source: ревью PR [#625](https://github.com/IDSAD-XL/worfy/pull/625) (Ticket 07, правило lint против
кириллицы), круг 1, lens «границы модулей», находка med; [ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md),
пункт 5; решения владельца 2026-10-19 ([spec.md](../spec.md), «Решения владельца»).

## Что происходит

Ticket 07 нашёл русские слова, которые не уходят с Ticket-ом 08: это не старая форма на один release, а
действующий контракт Profile. Правило lint 07 пропускает их по временному списку на стороне repo
(`profileWords`, «Итог» 07). У этого исключения нет срока, и ADR-0074 (plugin только английский) его не
предусматривает.

- **Подстановки в значениях Profile** — `<эпик>`, `<ветка>`, `<имя-тикета>`, `<что-ревьюишь>`, `<файл>`,
  `<пакет>`, `<имя>`, `<каталог модуля>`. Их подставляют `harness/hooks/worktree-create.sh:77`,
  `harness/bin/profile:342` (`preflight --epic <эпик>`) и skill-ы по описанию
  (`harness/skills/epic-wave/SKILL.md:20-22,208`, `harness/agents/implementer.md:23`,
  `harness/agents/reviewer.md:23`); контракт — `harness/profiles/README.md:156-176,225,459-472`.
- **Заголовки `rules.md` проекта** — `## Обязательное чтение исполнителя`, `## Ночной прогон и аудит`
  (`harness/agents/implementer.md:77`, `harness/profiles/README.md:485`).
- **Имена lens** «корректность», «упрощение» — значения `review.lenses` в Profile-е владельца, а plugin их
  называет (`harness/agents/reviewer.md:192`, `harness/skills/max-review/SKILL.md:55,57`,
  `harness/profiles/README.md:214`). Это настройка владельца, plugin не должен их знать.
- Тот же список дублируется в `harness/bin/tests/agents-text.test.sh:122-125`.

## Что делаем

1. Английские подстановки: `<epic>`, `<branch>`, `<ticket-name>`, `<review-target>`, `<file>`, `<package>`,
   `<name>`, `<module dir>` (точные имена — в Ticket-е). Подстановщики (`worktree-create.sh`, `bin/profile`,
   skill-ы) принимают и старое русское слово один release, с пометкой
   `shortcut: accepts the old Russian token, remove after the next release`. Их убирает 08, если 10 влит до
   release, которого ждёт 08; иначе — следующий release.
2. Заголовки `rules.md` проекта — английские, старые читаются один release (по образцу `## Sources` и
   `## Источники` из Ticket-а 04).
3. Имена lens: plugin не называет конкретных lens — текст говорит о «lens из `review.lenses`». Переименовать
   lens в Profile-е worfy или оставить русскими — шаг владельца, diff — в «Итог».
4. Временный список `profileWords` правила lint 07 удаляется; `agents-text.test.sh:122-125` — тоже.
5. **(вручную, Orchestrator после мержа)** Profile-ы worfy, auction и atakama: подстановки в значениях
   (`worktree.*`, `tickets.branch`, `commands.test_one`, `tests.new_file`, `workflow.preflight`) — на
   английские до 08. Diff — в «Итог».

## Готово, когда

- [x] `harness/hooks/tests/*`, `harness/bin/tests/profile.test.sh` — exit 0: новые и старые подстановки дают
      тот же результат; красный до правки на новом слове.
- [x] `pnpm lint` — exit 0 без списка `profileWords`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge; вердикт
      Windows с ПК (меняет скрипты Harness).

## Тесты

Сначала test-ы подстановщиков на английское слово и на старое русское.

## Где в коде

- `harness/hooks/worktree-create.sh`, `harness/bin/profile`, `harness/bin/tests/profile.test.sh`
- `harness/profiles/README.md`, `harness/profiles/draft.schema.json`
- `harness/agents/implementer.md`, `harness/agents/reviewer.md`
- `harness/skills/epic-wave/SKILL.md`, `harness/skills/connect-project/SKILL.md`, `harness/skills/max-review/SKILL.md`
- `harness/bin/TICKETS.md`, `harness/evals/lib/demo-project.sh`
- `harness/bin/tests/agents-text.test.sh`
- `scripts/check-cyrillic.mjs` и его список `profileWords`

## Итог

Влит #649 (5dbe12c2), после #643. Проверки Orchestrator-а: gate full — зелено на `main` (+#643) + PR,
`plugin-neutral` 26/0; вердикт Windows с ПК — зелено (12 shell test-ов, 8 файлов vitest, 369 прошли).
Review: круг 1 — high, три lens (корректность — ничего; границы модулей — 4 low; тесты — 32 из 39 mutant-ов
убиты, low); круг 2 — medium, 1 low (static import в hook-е), исправлен; high и med не было.

- Подстановки: `<эпик>`→`<epic>`, `<ветка>`→`<branch>`, `<имя-тикета>`→`<ticket-name>`,
  `<что-ревьюишь>`→`<review-target>`, `<файл>`→`<file>`, `<пакет>`→`<package>`, `<имя>`→`<name>`,
  `<каталог модуля>`→`<module-dir>` (через дефис, без пробела внутри). Заголовки `rules.md`:
  `## Required reading for the implementer`, `## Overnight run and audit`.
- Совместимость на один release — одно место, `harness/lib/old-words.cjs` (пометка
  `shortcut: accepts the old Russian token`): `bin/profile` печатает старые подстановки во всех строковых
  значениях (`--field`, `--json`, сводка) и старые заголовки (`--rules`) в английской форме; hook
  `session-start.mjs` подмешивает правила через тот же файл (грузит его внутри hook-а: без файла — правила как
  написаны и одна строка в stderr). Файл Profile-а не меняется и остаётся источником: обратно вывод `bin/profile`
  никто не пишет (`profile-set`, `migrate` читают файл). `worktree-create.sh` и regex `epic-wave` знают только
  английские формы — значения к ним приходят через `bin/profile`.
- Plugin не называет конкретных lens: описание в `reviewer.md` относится к lens с тем же именем, назначает ли
  её skill или `review.lenses`. Временный список правила lint (`scripts/cyrillic-allow.json`, `--allow`)
  удалён; дубль в `agents-text.test.sh` — тоже (теперь строгое «в agents нет кириллицы»).
- В `src/` подстановщиков нет; `src/main/harness/migrate/profiles.ts` (schema 1 → 2) копирует русские
  подстановки в файл как есть — `bin/profile` печатает их английскими до 08.

Пункт 5 — шаг владельца (в утреннем списке Orchestrator-а), **после** установки Stable с этим PR: иначе
старый skill epic-wave увидит `<epic>`, а его текст говорит `<эпик>`. В файлах Profile-ов:

- worfy — `worktree.implementer`, `worktree.reviewer` (`<ветка>`, `<что-ревьюишь>`), `tickets.path`,
  `tickets.spec`, `tickets.branch`, `qmd.fallback_grep` (`<эпик>`).
- auction — `commands.test_one`, `commands.package.*` (`<файл>`, `<пакет>`), `tests.new_file.*` (`<имя>`,
  `<каталог модуля>`), `worktree.*` (`<ветка>`, `<имя-тикета>`, `<что-ревьюишь>`), `tickets.*`,
  `qmd.fallback_grep` (`<эпик>`); `rules.md:9` и `:85` — английские заголовки.
- atakama — `commands.package.test` (`<пакет>`), `tickets.*`, `qmd.fallback_grep` (`<эпик>`); `rules.md:108`.
  Свои подстановки проекта `<репозиторий>`, `<сервис>` остаются.
- По желанию — имена lens в `review.lenses` / `ticket_lenses` по-английски (worfy: `correctness`,
  `module boundaries`, `tests`; auction и atakama — так же по смыслу).

Долг (low): `\r?` в `englishHeadings` лишний (`$` с флагом `m` уже совпадает перед `\r`).
