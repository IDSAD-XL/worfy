# 05 — Next command: после команды Sonnet предлагает следующую серым текстом на пустой строке

Type: task
Status: claimed — 2026-10-14
Branch: worfy-terminal-ai/05
Blocked by: 02, 03
Source: решения владельца 2026-10-09: пункт 1(b) (после конца команды Sonnet с `effort: 'low'` предлагает следующую; переключатель в Settings даёт выбрать Haiku), пункт 2 (автоматическая функция — в фоне и только после паузы, выключается сама по Limits), пункт 3 (контекст: строка, папка, ~20 команд, ветка, код выхода; без вывода; redaction) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункты 3–6

## Что происходит

- После Ticket-а 01 main знает, когда команда кончилась (OSC 633 D с кодом выхода) и когда shell
  снова показал prompt (B). События — у registry Terminal Node-ов, функция доступа — в «Итог»
  Ticket-а 01.
- После Ticket-а 03 main шлёт в shell `show <id> <текст>` без запроса shell-а (`push` в
  `src/main/terminal-ai/shell-link.ts`), а widget показывает серый текст.
- После Ticket-а 02 у main есть `request('next', …)`: Sonnet с `effort: 'low'` или Haiku без thinking
  по Settings, тайм-аут 8 с, отказ по Limits.
- Spike 2026-10-09: тёплый Sonnet — первый токен 795–2768 ms, медиана 830; ответ 1364–3802 ms.
- Warp делает так же: Next command из истории, ветки, кода выхода и папки
  (https://docs.warp.dev/agents/active-ai). В отличие от Warp, вывод команды сюда не уходит
  (решение 3).

## Что делаем

1. **Когда спрашивать** — `src/main/terminal-ai/features/next-command.ts` (новый).
   - Команда кончилась, shell показал prompt, строка пустая, 800 ms нет ввода (spec, «Решено без
     владельца», пункт 2) — `request('next', …)`.
   - Не больше одного запроса на prompt. Не после команды с пробелом в начале: её текста у main нет.
   - Ввод до ответа — запрос отменяется: widget при первом нажатии после prompt-а шлёт `cancel`
     для Next command этого prompt-а.
   - Контекст: последняя команда и её код выхода, папка, ветка, последние 20 команд. Вывода нет.
2. **Показ** — `src/main/terminal/zsh/rc.d/30-next-command.zsh` (новый).
   - `show` от Next command — только на пустой строке.
   - Пользователь печатает начало предложенной команды — серым остаётся остаток. Иное — серый текст
     скрыт.
   - → принимает, Esc скрывает — общие функции Ticket-а 03.
   - Enter на пустой строке с серым текстом ничего не запускает: серый текст — не часть строки.
3. **Отказ молча.** Limits, Settings, тайм-аут — серого текста нет, в Terminal ничего не печатается.

**Не входит:** вывод команды в контексте (решение 3: только для Fix); предложение после ошибки —
это Fix (Ticket 07), Next command при этом работает как обычно.

## Готово, когда

- [ ] Contract `test/contract/terminal-ai-next-command.test.ts` (новый), настоящий zsh, assist — поддельный: в временном git-репозитории `git status` — через паузу на пустой строке серый ответ fake; в журнале — `git status`, код 0, ветка, папка, функция `next`, модель `sonnet`; вывода `git status` в журнале нет.
- [ ] Тот же contract: Enter на пустой строке с серым текстом — команда не запущена (вывода ответа fake нет); ввод `x` — серый текст скрыт; ввод до ответа — запрос отменён, ответ не показан.
- [ ] Тот же contract: модель Next command в Settings — Haiku — в журнале `haiku`; Next command выключен — запросов нет; Limits со статусом `allowed_warning` — запросов нет; команда с пробелом в начале — запроса нет.
- [ ] e2e `test/e2e/terminal-ai-next-command.spec.ts` (новый), fake с ответом: после `echo` с уникальной меткой на пустой строке виден серый ответ; → вставляет его в строку; запуска нет, пока test не нажал Enter.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «после `git status` на пустой строке серый ответ»: обработчика ещё
нет. Assist поддельный, подписка не тратится. В «Итог» — итоговая пауза и как падал первый test.

## Где в коде

- `src/main/terminal-ai/features/next-command.ts` (новый)
- `src/main/terminal/zsh/rc.d/30-next-command.zsh` (новый)
- `test/contract/terminal-ai-next-command.test.ts` (новый)
- `test/e2e/terminal-ai-next-command.spec.ts` (новый)

## Итог

Заполняется при закрытии.
