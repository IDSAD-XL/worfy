# 60 — Test «does not see a root that is removed and made again under the same name» в `tickets-chokidar.test.ts` красный под нагрузкой

Type: bug
Status: claimed 2026-10-20T20:50Z
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

Заполняется при закрытии.
