# 31 — 1 h prompt cache только тем агентам, у которых простой 5–60 min остался после Ticket-ов 25 и 26

Type: task
Status: open
Blocked by: 19, 25, 26
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 2, решение 10, раздел
«Prompt cache на 1 h»;
https://code.claude.com/docs/en/prompt-caching.md («Cache lifetime», «Subagents and the cache»).

## Что происходит

- Subagent-ы Claude Code получают cache на 5 min даже на подписке: «Subagents fall outside the main-conversation
  TTL bucket, so they get five minutes even on a subscription until you choose a longer one». Main conversation
  на подписке в пределах плана — 1 h.
- Запись в cache: 5 min — 1,25 × цены входа, 1 h — 2 ×; чтение — 0,1 × (Opus 5.5 — 0,05 ×)
  (https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
- Способы: `cacheTtl` в поле `experimental` frontmatter-а агента (Claude Code v2.1.248+; на Mac — 2.1.306),
  setting `subagentPromptCacheTtl` или env `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` — для всех subagent-ов.
  Порядок по документации (первое совпадение): `FORCE_PROMPT_CACHING_5M=1` → env bucket-а → setting bucket-а →
  `cacheTtl` frontmatter-а агента → `ENABLE_PROMPT_CACHING_1H=1` → умолчание. Значит, `cacheTtl` агента работает,
  только пока `subagentPromptCacheTtl` и его env не заданы; `1h` там игнорируется, пока подписка тратит usage
  credits. В `~/.claude/settings.json` и в env Session на Mac TTL сейчас не задан (проверено 2026-10-28).

## Что делаем

1. После Ticket-ов 25 и 26 и одной-двух Wave — `scripts/agent-cost.mjs` (Ticket 19): по каждой роли — медиана
   числа простоев 5–60 min на агента и сумма перезаписи после них.
2. Роль, у которой медиана ≥ 1 простоя, получает `experimental: { cacheTtl: 1h }` в своём `.md`; остальные — нет.
   Таблица расчёта (запись 2 × против перезаписи 1,25 ×) — в «Итог».
3. Если ни у одной роли нет таких простоев — Ticket закрывается с этим ответом, frontmatter не меняется.

Нужен ПК: нет. **Трогает Harness: да** — frontmatter агентов в `harness/agents/`; слово владельца дано
2026-10-28 (решение 1). Вердикт Windows: не платформенный PR.

## Готово, когда

- [ ] «Итог»: таблица по ролям — простои, перезапись в $, ожидаемая разница с 1 h; решение по каждой роли.
- [ ] Для каждой роли с `cacheTtl: 1h` — `agents-text.test.sh` проверяет поле; в транскрипте первого такого
      агента после обновления Stable copy `usage.cache_creation.ephemeral_1h_input_tokens` > 0 (вручную, в
      «Итог»).
- [ ] Shell test-ы Harness — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
- [ ] Через неделю — перезапись после простоя по Ticket-у 19 против базы, в «Итог».

## Где в коде

- `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/agents/scout.md` — frontmatter
- `harness/bin/tests/agents-text.test.sh`

## Вне скоупа

- `ENABLE_PROMPT_CACHING_1H` и `subagentPromptCacheTtl` для всех — нет: дороже на коротких агентах (решение 10).
- Настройки `~/.claude/settings.json` владельца — только его шагом.

## Итог
