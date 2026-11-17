# 09 — Run history и Work track: Wait `restart` с причиной, продолженный Run — один Run

Type: task
Status: open
Blocked by: 02
Source: [spec.md](../spec.md), «Ticket-ы», 9; «Решения по реализации» → «Run history и Work track»; «Истории
пользователя», 6

Кто: агент.

Не платформенный Ticket (чистые модули и renderer). Глубина ревью — `medium`; снимок экрана Run history.

## Что происходит

- Причины Wait-а — `WAIT_CAUSES` (`src/shared/flight-recorder/facts.ts:31`); `restart` среди них нет.
- Run без `run-stopped` получает исход `cut-off` (`facts.ts:22`); Run history пишет «no stop in the Journal»
  (`src/renderer/flight-recorder/RunHistoryView.tsx:75`). `from-journal.ts` переводит `app-quit` в `stopped`
  (`src/shared/flight-recorder/from-journal.ts:159`).
- События `run-suspended` и `run-continued` вводит Ticket 02.

## Что делаем

1. Причина Wait-а `restart` в `WAIT_CAUSES`.
2. `from-journal.ts` строит её Span от `run-suspended` (после падения — от последнего события перед `run-continued`) до
   `run-continued`; причина — quit, update, shutdown или crash.
3. Продолженный Run — один Run с Wait-ом внутри. Исход `cut-off` и строка «no stop in the Journal» остаются за Run-ом,
   который так и не продолжили.
4. Подпись на дорожке Wait-ов: «restart (update) · 3 min». Work track показывает тот же Wait на дорожке Run-а.
5. Английские страницы `docs/features/flight-recorder.md` и `docs/features/work-track.md`; перевод — Ticket 14.

## Готово, когда

- [ ] Unit test `from-journal.ts`: Journal с `run-suspended {cause: update}` и `run-continued` — один Run, Span `restart`
      с причиной `update` и длительностью.
- [ ] Unit test: Journal после падения (без `run-suspended`, с `run-continued {after: crash}`) — Span от последнего
      события до `run-continued`.
- [ ] Unit test: `run-suspended` без `run-continued` — исход `cut-off`, как сейчас.
- [ ] Unit test подписи: «restart (update) · 3 min».
- [ ] Английские страницы `flight-recorder.md` и `work-track.md` называют Wait `restart`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- Unit рядом с test-ами `src/shared/flight-recorder/from-journal.ts`; fixture-Journal-ы Ticket-а 02. Каждый test сначала
  красный. Run history после SIGKILL в e2e проверяет Ticket 06 вместе со своим e2e.

## Где в коде

- `src/shared/flight-recorder/facts.ts`
- `src/shared/flight-recorder/from-journal.ts`
- `src/renderer/flight-recorder/span-words.ts`
- `src/renderer/flight-recorder/RunHistoryView.tsx`
- `src/renderer/work-track/Lanes.tsx`
- `docs/features/flight-recorder.md`, `docs/features/work-track.md`

## Вне скоупа

- Сама приостановка и продолжение — Ticket-ы 04 и 06.
