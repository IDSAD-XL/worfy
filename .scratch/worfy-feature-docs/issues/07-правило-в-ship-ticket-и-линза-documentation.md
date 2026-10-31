# 07 — Правило «обновить страницу в том же PR»: поле Profile, шаг `worfy:ship-ticket`, линза `documentation`

Type: task
Status: done 2026-10-31T00:08Z
PR: #1084
Blocked by: 06
Source: «Проверки», «Исключения» и «Решено без владельца», Р4, [spec.md](../spec.md); решения владельца 2026-10-30, Q4, Q19, Q21, Q23; [ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md)

## Что происходит

- `worfy:ship-ticket` общий для всех проектов и по ADR-0074 должен оставаться нейтральным. Прямо вписать туда правило
  worfy нельзя: нужно необязательное поле Profile.
- `review.ticket_lenses` по контракту — две или три линзы, которые ship-ticket запускает на каждом Ticket-е
  (`harness/profiles/README.md`), и у worfy их уже три. Поэтому линза `documentation` входит только в `review.lenses`.
  По умолчанию на каждом Ticket-е она не идёт: основное требование — условный шаг в skill-е, линзу назначают, когда
  нужна проверка.
- Линзу без описания reviewer читает только по имени. Описание живёт в `harness/agents/reviewer.md`, раздел «Lens
  descriptions».
- `worfy:continuous-audit` берёт линзы из отдельного поля `audit_lenses`. Его форма задана только таблицей
  `harness/profiles/README.md`: `[{id, title, where[], finding}]`, где `where` — пути (образец — Profile `auction`). В
  `draft.schema.json` этого поля нет. У worfy оно `null`, и без него аудит не запускается вообще (Р4 spec-а).
- Profile worfy лежит вне репозитория: `~/.claude/worfy-harness/projects/worfy/`. На Mac и на Windows-ПК у каждого
  свой `rules.md` (ADR-0042).
- `rules.md`, раздел «Язык», велит писать документы по-русски и об исключении ADR-0088 пока не знает.
- В `rules-merge.md` на Mac строку об исключении Q21 внёс Orchestrator 2026-10-30, на ПК её пока нет.

## Что делаем

Сначала падающий test.

1. Необязательное поле Profile `docs.feature_pages` (путь к папке страниц): контракт в `harness/profiles/README.md`,
   необязательное свойство в блоке `docs` файла `draft.schema.json`, чтение в `bin/profile`, если этого требует контракт.
   Поле не задано — поведение прежнее.
2. Условный шаг в `harness/skills/ship-ticket/SKILL.md` на английском, без упоминания языков и worfy: поле задано и PR
   меняет поведение, описанное страницей, — the page from `docs.feature_pages` обновляется в этом же PR. Поле не
   задано — шаг пропущен, и об этом сказано одной строкой.
3. `### Lens: documentation` в `harness/agents/reviewer.md`, раздел «Lens descriptions», нейтрально и на английском:
   вопрос линзы — меняет ли diff поведение, описанное страницей из `docs.feature_pages`, без правки этой страницы.
   Рефакторинг и test-ы без изменения поведения находкой не считаются.
4. Profile worfy (вне репозитория; на ПК правит Session на ПК):
   - `docs.feature_pages`: `docs/features`, на обеих машинах;
   - `documentation` в `review.lenses`, не в `review.ticket_lenses`;
   - `audit_lenses` с одной записью: `id` `documentation`; `where`: `docs/features`, `src/main`, `src/renderer`,
     `src/shared`, `src/card-runtime`, `harness`; `finding`: утверждение английской страницы `docs/features/*.md`, которое
     противоречит коду; русский перевод не считается;
   - `rules.md`, раздел «Язык», на обеих машинах: строка об исключении `docs/features/` (ADR-0088) и о том, что в PR
     правится только английская страница;
   - `rules-merge.md` на ПК: та же строка об исключении Q21, что на Mac. На Mac файл не трогать.

## Готово, когда

- [ ] Profile без поля: `ship-ticket` и его test-ы ведут себя как раньше; другие проекты не затронуты.
- [ ] `bin/profile --field docs.feature_pages` в worfy печатает путь на обеих машинах.
- [ ] Описание линзы есть в `harness/agents/reviewer.md`; `bin/profile --field review.lenses` содержит `documentation`,
      `review.ticket_lenses` не изменился.
- [ ] `bin/profile --field audit_lenses` в worfy не `null` и содержит запись `documentation` с настоящими путями.
- [ ] Строка в `rules.md` есть на обеих машинах; строка в `rules-merge.md` есть на ПК.
- [ ] Платформенный PR: вердикт Windows (ADR-0056, пункт 2; условие merge — ADR-0083). Текст plugin-а без кириллицы
      (`check-cyrillic` проверяет Markdown `harness/`).
- [ ] Gate и review как у PR с кодом.
- [ ] После merge — `pnpm install:stable` вне run-а Autopilot (ADR-0047), иначе правило не действует.

## Тесты

Test-ы `bin/profile` и контракта Profile: поле есть, поля нет, неверный тип. Тест skill-а на наличие условного шага —
если у skills есть такой образец, автор проверяет это при claim.

## Где в коде

- `harness/skills/ship-ticket/SKILL.md`, `harness/agents/reviewer.md`, `harness/profiles/README.md`,
  `harness/profiles/draft.schema.json`, `harness/bin/profile`, `harness/skills/continuous-audit/SKILL.md` (только чтение).
- Вне репозитория: `~/.claude/worfy-harness/projects/worfy/profile.json`, `rules.md`, `rules-merge.md` (только на ПК).

## Вне скоупа

- Первый проход аудита и расписание — Ticket 19.
- Блокировка CI «код изменён без правки страницы».
- `harness/skills/ship-ticket/review-of-another-pr.md`: исключение Q21 действует на уровне проекта, файл не меняется.

## Итог

Сделаны пункты 1–3 раздела «Что делаем»:

- Поле `docs.feature_pages`: контракт в `harness/profiles/README.md`, необязательное свойство в `draft.schema.json`
  (пустая строка и не строка отказаны), чтение в `harness/bin/profile`: путь печатается как записан, без поля — exit 4,
  неверный тип или пустая строка — одно предупреждение в stderr, и поле читается как отсутствующее. Исключение для
  Silent mode записано в README: страницы лежат в репозитории и правятся в том же PR.
- Условный шаг `**Feature pages**` в шаге 5 `harness/skills/ship-ticket/SKILL.md`: поле задано и PR меняет описанное
  поведение — страница правится в том же PR; поля нет — шаг пропущен, и об этом сказано одной строкой.
- `### Lens: documentation` в `harness/agents/reviewer.md`, раздел «Lens descriptions».
- Test-ы: `profile-schema2.test.sh` (поле есть, поля нет, `null`, неверный тип), `project-connect.test.sh` (схема),
  `agents-text.test.sh` (текст линзы целиком), `epic-wave-ship-ticket.test.sh` (шаг skill-а и строка контракта). На
  старом коде они падали: exit code 1 у всех четырёх файлов.

Доработка после `REJECTED on e4096865`:

- Страница из `docs.feature_pages` больше не противоречит другим правилам: о ней сказано в границах
  `harness/agents/implementer.md` (в том числе без skill-а), в двух файлах Silent mode (`implementer-silent-mode.md`,
  `silent-mode.md`) и в проверке списка файлов Ticket-а в `harness/skills/epic-wave/SKILL.md`.
- Линза `documentation` называет severity `[med]` и считает находкой новую фразу, которую код не подтверждает.
- `harness/profiles/README.md`: значение читается как записано, путь не проверяется. Поведение `bin/profile` не менялось;
  абсолютный путь и `..` закреплены test-ом. То же в описании поля в `draft.schema.json`.
- Сообщение Silent mode в `harness/hooks/session-start.mjs` называет оба исключения для `docs.feature_pages`, как
  `silent-mode.md` и `implementer-silent-mode.md`; проверка в `harness/hooks/tests/session-hooks.test.sh`.
- Test-ы: `""`, `false`, `0` и объект в `profile-schema2.test.sh`, подсчёт строк stderr вместо поиска подстроки; массив,
  объект и `false` в `project-connect.test.sh`; абзац шага и пункт границ сверяются целиком, новые фразы — по тексту.

Не сделано здесь:

- Пункт 4 — Profile worfy вне репозитория (`docs.feature_pages`, `documentation` в `review.lenses`, `audit_lenses`),
  `rules.md` на обеих машинах, `rules-merge.md` на ПК. Делает Orchestrator после merge. Поэтому пункты «Готово, когда» про
  `bin/profile --field` в worfy и про строки в правилах пока не закрыты.
- `pnpm install:stable` после merge и вердикт Windows по платформенному PR — тоже за Orchestrator-ом.

