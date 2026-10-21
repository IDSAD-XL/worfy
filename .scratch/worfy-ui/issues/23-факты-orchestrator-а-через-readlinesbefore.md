# 23 — факты Orchestrator-а читаются через `readLinesBefore`

Type: task
Status: open
Blocked by: 21
Source: review PR #693 (worfy-ui 21), раунд 1, замечание уровня low: в коде два чтения транскрипта
с конца, и одно из них не знает про строки, начатые в предыдущем окне так, как знает
`readLinesBefore`.

## Что происходит

- `readTranscriptFacts` (`src/main/agent/orchestrator-transcript.ts:61-95`) ищет модель и последний
  status block Orchestrator-а, читая файл с конца своими кусками: свой `carry` для строки, начатой в
  более раннем куске, свой разбор строк.
- Ticket 21 добавил `readLinesBefore` (`src/main/claude-home/tail.ts`): окно перед заданным байтом,
  только целые строки, смещение каждой строки, рост окна назад, когда строка длиннее окна. Тот же
  алгоритм теперь написан дважды.

## Что делаем

- Переписать цикл `readTranscriptFacts` на `readLinesBefore`: окно за окном назад (`before` = `start`
  предыдущего окна), строки окна — с последней к первой, пока не найдены обе части фактов.
- Поведение не меняется: тот же ответ на тех же файлах, тот же `chunkBytes` из `ReadFactsOptions`
  как размер окна.

## Готово, когда

- [ ] Существующие test-ы `readTranscriptFacts` проходят без правок.
- [ ] Новый test: строка длиннее окна на границе двух окон даёт тот же ответ, что и при чтении целиком.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `src/main/agent/orchestrator-transcript.ts`
- `src/main/claude-home/tail.ts` (только использование, без правок)
- test-ы `readTranscriptFacts` в `test/unit/`

## Итог
