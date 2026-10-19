# 01 — User personalization: язык отчётов в `user.json`, личные правила в `user/rules.md`

Type: task
Status: claimed 2026-10-19T11:48Z
Branch: worfy-neutral/01
Blocked by: —
Source: решения владельца 2026-10-19, Q2, Q3 ([spec.md](../spec.md), «Решения владельца», пункты 2, 3);
[ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md), пункт 2; дополняет ADR-0044, пункт 2.

## Что происходит

- Язык отчётов — поле Profile `language.reports` (`harness/profiles/README.md:120`); агенты читают его через
  `bin/profile --field language.reports`. Старую строку `"language": "ru"` `bin/profile` раскрывает в
  `{reports, team}` (`harness/bin/profile:267-269`).
- Правило «Writing in Russian: the term stays in Latin» — в `harness/hooks/rules/common.md:12-20`; раздел
  `## Terms` с русскими метафорами — `harness/agents/implementer.md:274-283`, `harness/agents/reviewer.md:258-267`,
  `harness/agents/scout.md:68-77`. Их получает каждая Session и каждый Subagent любого пользователя.
- `harness/hooks/inject-rules.mjs` подмешивает часть правил (`rules/<part>.md`) в `SessionStart` и
  `SubagentStart` (`harness/hooks/hooks.json`); предел части — 10 000 символов (ADR-0041).
- **Платформенный PR** (ADR-0056, пункт 2): Ticket меняет скрипты Harness (`bin/profile`, `inject-rules.mjs`).
  Владелец в Q15 этот Ticket не назвал; правило ADR-0056 его включает — вердикт Windows по ADR-0071.

## Что делаем

1. **`$HARNESS_HOME/user.json`** (по умолчанию `~/.claude/worfy-harness/user.json`): поле `language.reports`
   (`"ru"` | `"en"` | другой код языка). Формат и место — в `harness/profiles/README.md`, новый раздел
   «User personalization».
2. **`bin/profile`** выдаёт `language.reports` из `user.json`, так что читатели (`--field language.reports`)
   не меняются. Порядок: `user.json` → поле Profile-а (один релиз; место помечено
   `shortcut: reads the profile's language.reports, remove after the next release (worfy-neutral 08)`) →
   `en`. `language.team` и `language.docs` без значения — `en`. Битый `user.json` — одна строка в stderr и
   значения по умолчанию, не падение.
3. **Личные правила.** `inject-rules.mjs common` дописывает к части `common` содержимое
   `$HARNESS_HOME/user/rules.md`, если файл есть, под заголовком `## User rules`, — и в `SessionStart`, и в
   `SubagentStart`, чтобы правила получали и Subagent-ы (бриф называл только `SessionStart`; без
   `SubagentStart` implementer и reviewer потеряли бы правило о терминах). Plugin не читает и не проверяет
   содержание. Общий предел части — как у ADR-0041; длиннее — обрезка по строке и путь к файлу.
4. **Из plugin уходят языковые правила:** абзац «Writing in Russian…» из `common.md` и разделы `## Terms` из
   трёх agents. Вместо них — одна нейтральная фраза: «Personal language rules, if any, come from the user's
   rules file.»
5. **(вручную, Orchestrator после мержа)** Файлы владельца: `~/.claude/worfy-harness/user.json` с
   `{"language": {"reports": "ru"}}` и `~/.claude/worfy-harness/user/rules.md` с перенесёнными абзацем
   «Writing in Russian…» и разделом `## Terms` (текст — как в main до этого PR). Поле `language.reports` в
   Profile worfy остаётся до 08. Diff — в «Итог».

## Готово, когда

- [ ] `harness/bin/tests/profile.test.sh` во временной `HARNESS_HOME`: `user.json` с `ru` и Profile с `en` →
      `--field language.reports` печатает `ru`; без `user.json` — значение Profile-а; без обоих — `en`; битый
      `user.json` — `en` и строка в stderr, exit 0. Красный до правки.
- [ ] `harness/hooks/tests/rules-hooks.test.sh`: с `user/rules.md` вывод `inject-rules.mjs common` содержит его
      текст в `SessionStart` и `SubagentStart`; без файла — вывод как раньше; файл длиннее предела обрезан с
      путём. Красный до правки.
- [ ] `grep -n 'Writing in Russian\|## Terms' harness/hooks/rules/common.md harness/agents/*.md` — пусто.
- [ ] (вручную) После `pnpm install:stable` новая Session владельца отвечает по-русски, а её Subagent получает
      правило о терминах (виден в `SubagentStart` hook output).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.

## Тесты

Shell test-ы Harness во временных `HOME` и `HARNESS_HOME`; ни один не пишет в настоящий `~/.claude`.

## Где в коде

- `harness/hooks/inject-rules.mjs`
- `harness/hooks/rules/common.md`
- `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/agents/scout.md`
- `harness/bin/profile`
- `harness/profiles/README.md`, `harness/profiles/draft.schema.json`
- `harness/hooks/tests/rules-hooks.test.sh`, `harness/bin/tests/profile.test.sh`, `harness/bin/tests/agents-text.test.sh`

## Итог

Заполняется при закрытии.
