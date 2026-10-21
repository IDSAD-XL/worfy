# 10 — Английские подстановки Profile и имена lens без русских слов в plugin

Type: task
Status: claimed 2026-10-21T01:01Z
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

- [ ] `harness/hooks/tests/*`, `harness/bin/tests/profile.test.sh` — exit 0: новые и старые подстановки дают
      тот же результат; красный до правки на новом слове.
- [ ] `pnpm lint` — exit 0 без списка `profileWords`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge; вердикт
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

Заполняется при закрытии.
