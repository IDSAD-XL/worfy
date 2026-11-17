# 01 — Spike: compaction в Claude Code и Codex, продолжение транскрипта, оборванного посреди вызова

Type: spike
Status: open
Blocked by: none
Source: [spec.md](../spec.md), «Ticket-ы», 1; «Решения по реализации» → «Compaction», пункт «Spike сначала (01)»;
«Риски», 8 и 13; [critic 2026-11-14](../../../docs/product/critic/worfy-continuity-2026-11-14.md), возражение 2;
«Решено без владельца», 4

Кто: агент.

Не платформенный Ticket (скрипт spike-а и отчёт, без кода продукта). Глубина ревью — `low`.

**Цена.** Spike зовёт реальную модель: каждый запуск стоит денег. Brief называет предел цены и велит брать самую
дешёвую модель, которая отвечает на вопрос (по умолчанию haiku; дороже — только если haiku не доходит до compaction
или не отвечает), запускать по одному вопросу за раз и записывать цену каждого запуска в «Итог».

## Что происходит

- worfy замечает compaction только по сообщению `compact_boundary`: после него он заново спрашивает заполнение
  контекста (`src/main/vendors/claude/session.ts:535–536`; `isCompactBoundary` — `src/shared/vendors/claude/events.ts:458–462`).
- В `harness/hooks/hooks.json` `SessionStart` стоит без matcher-а (`:4–7`); `PreCompact` и `PostCompact` нет. По типам
  SDK `SessionStartHookInput.source` бывает `'compact'`.
- Дописка к system prompt уже есть: поле `instructions` (`src/main/vendors/claude/options.ts:396`), уходит в конец
  system prompt (`:824`). Переживает ли она compaction, не проверено.
- Codex: worfy не знает, когда Codex сжимает контекст (`src/main/vendors/codex/items.ts:123`), хотя в протоколе есть
  элемент `contextCompaction` (`src/main/vendors/codex/protocol/ts/v2/ThreadItem.ts:144`) и настройка `compact_prompt`
  (`src/main/vendors/codex/protocol/ts/v2/Config.ts:25`). `config` уже уходит в `thread/start`
  (`src/main/vendors/codex/session.ts:961–967`).
- Как Claude Code продолжает транскрипт, оборванный посреди вызова (`tool_use` без `tool_result`), не известно. Ответ
  нужен Ticket-ам 05 и 06 до их начала: они ждут этот Ticket (возражение 2 critic-а).
- Версия SDK закреплена в `package.json:29` (`@anthropic-ai/claude-agent-sdk` 0.3.322).

## Что делаем

1. Скрипт в `scripts/spikes/compaction/` рядом с `scripts/spikes/harness-plugin/probe.ts`: запуск руками, вне CI, на
   версии SDK из `package.json`.
2. Ответы на шесть вопросов spec-а, каждый — с выводом запуска:
   1. приходит ли `SessionStart` с `source: 'compact'` в главной Session и в Subagent-е;
   2. чему следует модель, которая пишет summary: разделу в правилах, `custom_instructions` у `PreCompact`, тексту
      `/compact <text>` или дописке к system prompt;
   3. что лежит в `compact_summary` у `PostCompact`;
   4. переживает ли compaction дописка к system prompt (`instructions`);
   5. Codex: `compact_prompt` на thread через `config` и приходит ли элемент `contextCompaction`;
   6. как Claude Code продолжает транскрипт с `tool_use` без `tool_result`: отвечает ли resume, что видит модель, нужна
      ли worfy заглушка-результат перед сообщением-продолжением.
3. Отчёт — в раздел «Итог» этого Ticket-а: ответ, команда, вывод (без личных данных), цена запуска. По вопросу 2 —
   какой путь брать Ticket-у 10; по вопросу 4 — брать ли дописку Ticket-у 12; по вопросу 6 — что делать Ticket-ам
   05 и 06.

## Готово, когда

- [ ] Скрипт spike-а в `scripts/spikes/compaction/` влит; в CI он не запускается.
- [ ] «Итог» отвечает на все шесть вопросов, у каждого ответа — команда и вывод запуска.
- [ ] «Итог» называет модель и цену каждого запуска; общая цена — не выше предела из brief-а.
- [ ] «Итог» называет решение для Ticket-ов 05, 06 (вопрос 6), 10 (вопрос 2) и 12 (вопросы 4 и 5).
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `scripts/spikes/compaction/` (новый)

Только читать: `scripts/spikes/harness-plugin/probe.ts`, `harness/hooks/hooks.json`,
`src/main/vendors/claude/options.ts`, `src/main/vendors/claude/session.ts`, `src/main/vendors/codex/session.ts`,
`src/main/vendors/codex/items.ts`, `sdk.d.ts` пакета `@anthropic-ai/claude-agent-sdk`.

## Вне скоупа

- Код продукта и Harness — Ticket-ы 05, 06, 10, 11, 12.
