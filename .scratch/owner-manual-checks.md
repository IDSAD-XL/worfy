# Ручные проверки владельца и порядок приёмок

Собрано 2026-11-06 по решению владельца 2026-11-05 (раунд 2): один список проверок, которые может сделать только
владелец, примерно на 30 мин (Mac ~20, ПК ~10). Время выбирает владелец. Результат — в чат Orchestrator-а: номер
пункта и что было на экране. Orchestrator отмечает пункт «(вручную)» в Ticket-е и убирает его отсюда.
Решено без владельца, подтвердить: состав списка, раздел «Убрано» и раздел «Не только владельцу».

## Порядок приёмок

Старшие первыми (решение владельца 2026-11-05). Шаги каждой приёмки — в её Ticket-е.

1. `worfy-multi-vendor` 43 — Mac Stable: п. 1 пройден, остался свежий Run Autopilot на Claude; затем ПК.
2. `worfy-windows` 16 — ПК.
3. По готовности кода: `worfy-faults` 08 (код готов; [чек-лист](worfy-faults/issues/08-приёмка-с-владельцем.md), раздел
   «Чек-лист приёмки», Mac без ПК), `worfy-evidence` 09 (код готов), `worfy-auto-approve` 11, `worfy-retry` 11.

## Mac

1. **Знак worfy в Dock и Finder** (`worfy-daily` 31, ~3 мин). Запустить Stable worfy; посмотреть Dock, папку
   Applications в Finder списком и баннер любого уведомления worfy. Ждём: везде знак worfy, в списке Finder —
   упрощённый знак. Старая иконка — кэш macOS: `killall Dock` и посмотреть снова.
2. **Щелчок по баннеру при выключенном Focus** (`worfy-mvp` 21, ~3 мин). Выключить Focus. В Session Stable worfy
   отправить ход вроде «sleep 20, then say done» и сразу перевести вперёд Finder. Когда придёт баннер (заголовок —
   имя Project-а), щёлкнуть его. Ждём: worfy выходит вперёд на Node этой Session, вторая копия worfy не запускается
   (в Dock один значок).
3. **Trackpad** (`worfy-daily` 13 и `worfy-week` 16, ~5 мин). В Terminal Node набрать `echo ABCDEFGHIJ`; выделить
   `ABCDEFGHIJ` касанием и перетаскиванием тремя пальцами при масштабе Canvas около 50 % и 150 % (⌘− / ⌘=), ⌘C.
   Ждём: в буфере ровно `ABCDEFGHIJ`; force click ничего не ломает. Затем свайп двумя пальцами над Orchestrator,
   HANDOFF, Card и Terminal: до клика двигает Canvas, после клика прокручивает содержимое (Orchestrator — двигает и
   после); pinch зумит Canvas над любым Node-ом, кроме активной Card.
4. **Описание задачи аудита в приложении Claude** (`worfy-guide` 20, п. 1, ~1 мин). Список запланированных задач в
   приложении Claude, задача после `feature-docs-lag`. Ждём: в описании — запуск `node scripts/guide-lag.mjs`.
   Старое описание — сказать Orchestrator-у, он пересоздаст задачу.
5. **fish — по желанию** (`worfy-mvp` 06, ~5 мин). fish на Mac нет; ставить его или нет — решение владельца. Без
   него ответ «закрыть как непроверяемый». С ним: `brew install fish`, сделать fish login shell, в Stable worfy —
   «New session» с запросом выполнить в Bash `echo $PATH; which gh jq; echo $SSH_AUTH_SOCK`. Ждём: `gh` и `jq`
   найдены, `SSH_AUTH_SOCK` не пуст. Потом вернуть прежний login shell.

## ПК

1. **AltGr** (`worfy-ui` 03, риск 4 spec-а `worfy-ui`, ~5 мин). Добавить в Windows раскладку с AltGr (например,
   German) — это изменение настроек Windows владельца. В worfy на этой раскладке: AltGr+Q в поле ввода Session и в
   поле Settings печатает `@`; AltGr+0 печатает `}` и не сбрасывает масштаб интерфейса. Раскладку потом можно убрать.
   Результат — в чат Session на ПК (решение владельца 2026-10-14, «Итог» `worfy-ui` 03).
2. **Add project на Windows** (`worfy-windows` 30, пункты 1–2 «Готово, когда», ~5 мин). «Add project» для новой
   папки с git-репозиторием: форма доходит до «Review» и пишет Profile, Project появляется в списке. Папка, которую
   Harness уже знает (например, worfy), на шаге «Folder» сразу попадает в список. Пункт 3 (ошибка при сбое скрипта
   Harness) руками не проверяется: его держит contract test `projects-connect`, он идёт в job-е `windows` каждого PR.

## Не только владельцу

- **Песочница приёмки** (`worfy-harness` 36): перенос `move` из `$TMPDIR`. PR #592 называет этот шаг «owner or
  orchestrator»; команды — в его описании, раздел «Manual step»; старая папка —
  `"$(getconf DARWIN_USER_TEMP_DIR)worfy-e3-sandbox"`. После него `claude plugin validate harness` и живые проверки
  `worfy-harness` 05–08 делает Orchestrator в этой песочнице (решение владельца 2026-10-12, «Итог» 05). Не
  одновременно с приёмкой и gate full.
- **Ручные проверки на Stable copy** из HANDOFF («Дальше»: `worfy-week`, `worfy-harness` 18–25) — Orchestrator через
  CDP (разрешение владельца 2026-11-04 проверять самому).

## Убрано (2026-11-06)

- Запрос разрешения на уведомления (`worfy-daily` 03): разрешение для `dev.worfy.app` уже выдано, запрос больше не
  появится; что уведомление видно с именем worfy, отмечено в `worfy-mvp` 21.
- Два неотвеченных системных окна (Automation «"claude" wants access to control "Finder"» и
  `universalAccessAuthWarn`, 2026-10-07): самих окон на экране больше нет (2026-11-06 CGWindowList не показывает ни
  одного), хотя процесс `universalAccessAuthWarn` жив с 2026-09-18 — Mac не перезагружался с 2026-09-10. Если macOS
  спросит снова при пункте 1 Mac — ответить.
- Gate full на Windows для `worfy-ui` 03, 10, 11: зелёный gate full ПК на `5557f7448` (2026-11-01), после merge
  `worfy-ui` 11; пункты отмечены в Ticket-ах.
- SmartScreen установщика (`worfy-windows` 12): пункт «(вручную)» отмечен, Ticket закрыт 2026-10-12; окно
  SmartScreen бывает только у скачанного установщика, подпись — этап E4.
