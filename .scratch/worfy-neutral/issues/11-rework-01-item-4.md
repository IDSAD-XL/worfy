# 11: Rework of worfy-neutral 01, item 4

Type: task
Status: open
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
