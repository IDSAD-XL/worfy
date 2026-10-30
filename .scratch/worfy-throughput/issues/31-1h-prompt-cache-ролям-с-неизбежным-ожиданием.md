# 31 — 1 h prompt cache только тем агентам, у которых простой 5–60 min остался после Ticket-ов 25 и 26

Type: task
Status: blocked 2026-10-30T03:31Z
Blocked reason: merged in #1040 (implementer cacheTtl 1h, expected +$562 per 10 days); open: ephemeral_1h_input_tokens > 0 in the first implementer after the Stable update, and the re-measure with agent-cost --idle on 2026-11-06
Waits: owner
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

- [x] «Итог»: таблица по ролям — простои, перезапись в $, ожидаемая разница с 1 h; решение по каждой роли.
- [x] Для каждой роли с `cacheTtl: 1h` — `agents-text.test.sh` проверяет поле; в транскрипте первого такого
      агента после обновления Stable copy `usage.cache_creation.ephemeral_1h_input_tokens` > 0 (вручную, в
      «Итог»). *Проверено 2026-10-30 ~06:00Z, Stable 408b25c7, implementer onboarding 05: «Итог».*
- [x] Shell test-ы Harness — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
- [ ] Через неделю — перезапись после простоя по Ticket-у 19 против базы, в «Итог». *Не implementer-а: замер Orchestrator-а около
      2026-11-06, `node scripts/agent-cost.mjs --idle --since 2026-10-30`.*

## Где в коде

- `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/agents/scout.md` — frontmatter
- `harness/bin/tests/agents-text.test.sh`

## Вне скоупа

- `ENABLE_PROMPT_CACHING_1H` и `subagentPromptCacheTtl` для всех — нет: дороже на коротких агентах (решение 10).
- Настройки `~/.claude/settings.json` владельца — только его шагом.

## Итог

**Замер (2026-10-30).** `scripts/agent-cost.mjs` получил опцию `--idle`: по каждой роли — число агентов,
медиана числа простоев 5–60 min на агента, простои > 60 min, перезапись cache после простоев 5–60 min и
стоимость записи в cache сейчас против стоимости с 1 h. Модель «с 1 h»: каждая запись стоит 2 × цены входа
вместо 1,25 ×; после простоя 5–60 min та часть контекста, которая была у предыдущего ответа (контекст
предыдущего ответа минус прочитанное из cache и отправленное без cache, не больше записанного), читается
(0,05 × у Opus 5.5), а не пишется. Простой > 60 min перезаписывает контекст при любом TTL, только дороже
(2 × вместо 1,25 ×). «Экономия» = запись сейчас − запись с 1 h; плюс — 1 h дешевле. Цены — по таблице API
(list prices), транскрипты worfy этого Mac, только чтение `~/.claude/projects`.

Период A — после merge Ticket-а 25 (CI-ожидание implementer-а ушло из foreground): 2026-10-29T13:00Z ..
2026-10-30 ~03:00Z, всего $303.21.

| роль | агентов | с простоем | медиана простоев 5–60 | простоев 5–60 | > 60 min | перезапись после 5–60 | запись сейчас | запись с 1 h | экономия |
| - | - | - | - | - | - | - | - | - | - |
| implementer | 24 | 16 | 1 | 36 | 0 | 33, $31.71 | $52.44 | $35.08 | **+$17.36** |
| reviewer | 41 | 7 | 0 | 8 | 0 | 8, $3.07 | $20.26 | $27.80 | −$7.53 |
| scout | 0 | — | — | — | — | — | — | — | — |
| other | 5 | 0 | 0 | 0 | 0 | 0 | $1.80 | $2.87 | −$1.08 |

Агентов в A мало (scout — ни одного), поэтому период B для сравнения — 2026-10-20 .. 2026-10-29T13:00Z,
всего $3762.61:

| роль | агентов | с простоем | медиана простоев 5–60 | простоев 5–60 | > 60 min | перезапись после 5–60 | запись сейчас | запись с 1 h | экономия |
| - | - | - | - | - | - | - | - | - | - |
| implementer | 232 | 177 | 2 | 808 | 31 | 782, $771.79 | $1054.26 | $492.72 | **+$561.54** |
| reviewer | 572 | 65 | 0 | 129 | 1 | 125, $50.90 | $264.19 | $344.43 | −$80.24 |
| scout | 37 | 0 | 0 | 0 | 0 | 0 | $5.09 | $8.14 | −$3.05 |
| other | 60 | 3 | 0 | 5 | 0 | 5, $3.88 | $36.50 | $52.45 | −$15.95 |

Orchestrator (main conversation) уже на 1 h по умолчанию подписки и в решение не входит.

**Решение по ролям.**

- **implementer — `experimental: cacheTtl: 1h`** (`harness/agents/implementer.md`, map по форме документации
  sub-agents). Медиана ≥ 1 простоя 5–60 min в обоих периодах (1 и 2), экономия положительная (+$17.36 и
  +$561.54). После Ticket-а 25 простои стали реже (медиана 2 → 1), но остались: прогон проверок и gate fast
  длиннее 5 min.
- **reviewer — нет.** Медиана 0 в обоих периодах; 1 h дороже (−$7.53, −$80.24): короткие агенты платят
  2 × за каждую запись и редко простаивают.
- **scout — нет.** Ни одного простоя 5–60 min; 1 h только дороже (−$3.05 в B).
- **verifier и прочие (other)** — отдельного определения агента в `harness/agents/` нет: verifier запускается
  как `worfy:reviewer` и считается reviewer-ом; other — медиана 0, экономия отрицательная.

`agents-text.test.sh` (раздел 3a) проверяет: у implementer-а `experimental.cacheTtl` = `1h`, у reviewer-а и
scout-а поля нет, `cacheTtl` верхнего уровня нет (mutant-ы: поле удалено, `cacheTtl` на верхнем уровне,
`5m`, поле у reviewer-а — все красные). Поле работает, пока `subagentPromptCacheTtl` и
`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` не заданы, и игнорируется, пока подписка тратит usage credits
(документация prompt-caching, «Choose the TTL yourself»). Plugin-агенты не читают только `hooks`,
`mcpServers` и `permissionMode` (документация sub-agents), `experimental` не в этом списке.

Осталось: ручная проверка `ephemeral_1h_input_tokens` > 0 у первого implementer-а после обновления Stable
и повторный замер через неделю — пункты «Готово, когда» выше.

### Проверка после обновления Stable (2026-10-30)

Stable на Mac — 408b25c7 (#1040), `agents/implementer.md` — `experimental.cacheTtl: 1h`. Первый implementer после
обновления (onboarding 05), первые ~10 вызовов: `ephemeral_1h_input_tokens` — 403, 7629, 30842 (> 0),
`ephemeral_5m_input_tokens` — 0 во всех. Часовой cache включился, пятиминутный implementer не пишет. Merge #1040 был
по `ci-ok` success.
