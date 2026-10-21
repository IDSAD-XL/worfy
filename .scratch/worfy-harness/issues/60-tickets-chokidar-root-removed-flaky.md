# 60 — Test «does not see a root that is removed and made again under the same name» в `tickets-chokidar.test.ts` красный под нагрузкой

Type: bug
Status: done 2026-10-20T21:09Z
PR: #632
Blocked by: —
Source: gate full очереди Mac, 2026-10-20 — слово Session-оркестратора «Worfy продолжение»: test ждёт
событие удаления папки не дольше 5 s и под нагрузкой полного прогона его не получает.

## Что происходит

`test/unit/tickets-chokidar.test.ts`, случай «does not see a root that is removed and made again under the
same name»: test удаляет корень Tickets сразу после `ready` chokidar и ждёт `unlinkDir` до 5 s. На macOS
`fs.watch` работает через один поток FSEvents, который libuv пересобирает в своём потоке на каждую новую
папку. Изменение, сделанное до того, как пересборка закончилась, теряется насовсем, а не приходит позже.
Под нагрузкой пересборка длится дольше, и удаление не попадает в поток. Причина выведена из устройства
FSEvents и libuv, а не воспроизведена.

## Что делаем

Перед удалением корня test пишет пробный Ticket, пока chokidar о нём не сообщит, — тот же цикл «писать,
пока не придёт событие», что в первом test-е файла. Ожидание `unlinkDir` (5 s) и итоговая проверка не
меняются. Более длинный timeout не помогает: потерянное событие не придёт; `existsSync` ничего не
синхронизирует.

## Готово, когда

- [ ] Файл 10 прогонов подряд — exit 0.
- [ ] Мутант `watcher.add(root)` после пересоздания корня — красный.
- [ ] workflow-reader, no-rmsync, e2e-no-spawn-on-load, lint, typecheck — exit 0.
- [ ] Gate full очереди Mac зелёный.

## Где в коде

- `test/unit/tickets-chokidar.test.ts`.

## Риски

- Не платформенный PR (только test). Под нагрузкой полного прогона правку впервые проверяет gate full.

## Итог

PR [#632](https://github.com/IDSAD-XL/worfy/pull/632), merge be39619c. Gate full Mac зелёный — первый прогон правки под
нагрузкой полного прогона. Не платформенный PR.

- **Причина (выведена, не воспроизведена).** FSEvents на macOS теряет изменение, сделанное до того, как libuv
  пересобрал поток под новую папку; test удалял корень в том же такте, что `ready`.
- **Правка.** Перед удалением корня test пишет пробный Ticket, пока chokidar о нём не сообщит. Ожидание
  `unlinkDir` (5 s) и итоговая проверка прежние.
- **Проверки.** Файл 10 прогонов подряд — exit 0; мутант `watcher.add(root)` после пересоздания — красный;
  workflow-reader, no-rmsync, e2e-no-spawn-on-load, lint, typecheck — exit 0.
- **Ревью** не было: один test-файл, +15 строк (порог правила — один файл и около 20 строк).
