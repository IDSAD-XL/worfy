# 0084 — plugin-ы и skills пользователя в Session Project-а — по списку в Profile
Дата: 2026-10-28. Статус: принят.

**Контекст.** ADR-0002 решил, что агенты worfy работают с настоящей конфигурацией пользователя: skills,
plugin-ы, hooks и `CLAUDE.md` действуют так же, как в терминале. Для MCP-серверов это уже сужено списком
Profile (ADR-0021). Ticket `worfy-throughput` 38 измерил цену skills: в первом запросе Session worfy на Mac
владельца список skills (`skill_listing`) — 74 skills и 29 787 символов; из них 20 999 символов — skills и
plugin-ы пользователя, не plugin worfy и не skills, встроенные в Claude Code. Это около 7 тыс. token-ов
(6–7,9 тыс. при 2,65–3,5 символа на token) на каждый старт Session. Subagent-ы с tool `Skill` (implementer,
general-purpose) получают такой же список: у implementer-а 18 971 символ пользователя, около 6,3 тыс.
token-ов, 22 % медианного стартового контекста (29 251 token). Порог из рекомендации Q-L4 — 5 тыс.
token-ов; владелец ответил «да» на поле Profile (Q-L4, 2026-10-28).

**Решение.**

1. В Profile есть поле `skills.allowed` — список plugin-ов и skills пользователя, которые получает Session
   Project-а (Orchestrator, новые Session-ы, Autopilot) и её Subagent-ы. Запись — имя plugin-а (`figma`)
   или его id (`figma@claude-plugins-official`), имя skill из `~/.claude/skills` (`wrangler`) или
   `claude.ai` для skills и plugin-ов, синхронизированных с claude.ai. Контракт поля —
   `harness/profiles/README.md`, схема — `harness/profiles/draft.schema.json`.
2. Нет поля, или Session вне Project-а — всё как раньше: все plugin-ы и skills пользователя.
3. Всегда остаются: plugin worfy (Harness), skills самого Project-а (`.claude/skills` репозитория) и skills,
   встроенные в Claude Code. `[]` оставляет только их.
4. Способ отбора: worfy читает (только читает) `enabledPlugins` из `~/.claude/settings.json`,
   `<cwd>/.claude/settings.json` и `settings.local.json` и папки `~/.claude/skills/*` с `SKILL.md`, и
   передаёт Claude Code flag settings (`--settings`, опция SDK `settings`): `enabledPlugins: {id: false}`
   для plugin-а вне списка, `skillOverrides: {имя: 'off'}` для skill вне списка, и
   `syncClaudeAiSkills: false`, `syncClaudeAiPlugins: false`, если список не называет `claude.ai`.
   Flag settings старше настроек пользователя, Project-а и local и действуют на весь процесс Claude Code,
   Subagent-ы тоже. `settingSources` не меняются: `CLAUDE.md` и hooks пользователя остаются (ADR-0002).
5. Ключи синхронизации — никогда не в policy tier (`managedSettings`): там `syncClaudeAiSkills: false`
   переносит синхронизированные skills в `~/.claude/skills/.trash`, а в flag settings только скрывает их
   для этого процесса (документация SDK 0.3.289, тип `Settings`).

**Следствия.** Меняется следствие ADR-0002 о skills: в Project-е с полем Session видит не все skills
пользователя. plugin вне списка выключается целиком — вместе со своими agents, hooks и MCP-серверами.
Проверено по документации SDK 0.3.289 и fixture `system/init` (id plugin-ов в виде `имя@marketplace`);
что Claude Code 2.1.289 действительно убирает их из списка Subagent-а, проверяет живая Session — ручной
пункт Ticket-а с «да» владельца.

## Considered Options

- **Опция SDK `skills: string[]`.** Отвергнута: по документации она фильтрует список только основной
  Session; Subagent-ы берут skills из своего определения, и у implementer-а осталось бы ~6 тыс. token-ов.
- **`strictPluginOnlyCustomization: ['skills']` в policy tier.** Отвергнута: закрывает и skills самого
  Project-а (`.claude/skills`), а plugin-ы пользователя не трогает.
- **Ключи в policy tier (`managedSettings`), как для MCP.** Отвергнута для синхронизации: удаляет skills
  пользователя в корзину. Для `enabledPlugins` и `skillOverrides` flag tier хватает: он старше всех
  файлов настроек, которые пишет пользователь.
- **`settingSources` без `user`.** Отвергнута: пропали бы `CLAUDE.md` и hooks пользователя (ADR-0002).
- **Ничего не делать.** Отвергнута: замер выше порога 5 тыс. token-ов, владелец ответил «да» (Q-L4).
