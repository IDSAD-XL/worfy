# 11: Rework of worfy-neutral 01, item 4

Type: task
Status: claimed 2026-11-24T23:39Z
Branch: worfy-neutral/11
Blocked by: None — can start immediately
Source: owner-check fail 2026-11-24 of worfy-neutral 01, item 4 — 01-user-personalization-язык-отчётов-и-личные-правила.md

**What to build:** the owner checked item 4 of worfy-neutral 01 on mac dev and it failed. In the words of the owner:

> Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); the Orchestrator saw on a dev build of 2e96e91ac: SubagentStart (inject-rules common) has Terms rule, profile reports=ru; but hook names language.reports without value, and two live English-prompt turns in the repo answered in English.

## Что происходит

Правила, которые получает новая Session (hook inject-rules), называют настройку `language.reports`, но не её значение: два живых хода с вопросом на английском в репозитории worfy (профиль: reports = ru) ответили по-английски. Правило Terms у subagent-ов есть.

## Где в коде

Hook inject-rules Harness (`harness/hooks/`), сборка текста правил для SessionStart; профиль `language.reports`.

## Готово, когда

- [ ] (вручную) После `pnpm install:stable` новая Session владельца отвечает по-русски, а её Subagent получает правило о терминах (виден в `SubagentStart` hook output).
- [ ] Часть `common` hook-а `inject-rules` в папке зарегистрированного проекта называет значение `language.reports`, а не только имя настройки (для worfy — `Russian (`ru`)`), и язык команды, в `SessionStart` и в `SubagentStart`. Значение — то, что резолвит `bin/profile`: сначала `user.json` пользователя, потом профиль. Текст Harness — английский (ADR-0074); правила пользователя идут после раздела о языке.
- [ ] В папке без профиля часть называет значение из `user.json` пользователя. Без профиля и без настройки, со сломанным `user.json`, с упавшим или зависшим `bin/profile` часть приходит как была, hook выходит с кодом 0.

## Итог

Причина: часть `common` (`harness/hooks/rules/common.md`) говорила «Reports to the user follow `language.reports`», но значения не называла, а SessionStart-hook `session-start.mjs` подмешивает `rules.md` профиля только при `session.inject_rules: true` — у worfy `false`. Session, которая не запустила `bin/profile` сама, языка отчётов не знала и отвечала на языке вопроса.

Исправление: `harness/hooks/inject-rules.mjs` для части `common` запускает `bin/profile -C <cwd сессии> --json` (ожидание до 5 s внутри 10 s hook-а) и дописывает раздел «Language of this session» перед правилами пользователя. Вне профиля — значение из `$HARNESS_HOME/user.json`. Test: раздел 3c в `harness/hooks/tests/rules-hooks.test.sh` — на origin/main 8 новых проверок красные, с исправлением 346 из 346 зелёные.

Текст для Session в репозитории worfy (`SessionStart`, часть `common`), до:

```
**Which language.** Reports to the user follow `language.reports` as `bin/profile` prints it (the
user's own setting comes first). Everything the team sees — commits, PRs, review comments, code
comments — follows `language.team`. With no profile: reports in the language the user writes in,
team-facing text in the language the repo already uses. Personal language rules, if any, come
from the user's rules file.
(раздела о языке нет)
```

После:

```
**Which language.** Reports to the user follow `language.reports` as `bin/profile` prints it (the
user's own setting comes first); when it is known, the section "Language of this session" of this
part names its value. Everything the team sees — commits, PRs, review comments, code comments —
follows `language.team`. With no profile and no such section: reports in the language the user
writes in, team-facing text in the language the repo already uses. Personal language rules, if
any, come from the user's rules file.
…
## Language of this session

Reports and messages to the user: Russian (`ru`), the `language.reports` that `bin/profile` resolves for project worfy (the user's own setting first, then the profile). Write them in this language even when the user writes in another one. Team-facing text — commits, PRs, review comments, code comments — follows `language.team`: English (`en`).
```

Живой ход модели не запускался (бриф: без настоящих ходов); ручной пункт 1 проверяется после merge и `pnpm install:stable`.
