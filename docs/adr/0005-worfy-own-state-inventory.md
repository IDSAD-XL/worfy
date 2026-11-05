# Собственное состояние worfy шире Layout и Card-ов

Дата: 2026-10-05. Статус: принят.

ADR 0002 называет собственным состоянием worfy только Layout и Card-ы. При нарезке Epic-а `worfy-mvp` выяснилось, что приложению нужно хранить ещё: список Project-ов, ручные Binding-и (автоматические вычисляются заново), вложения к сообщениям, последние известные Limits, корзину удалённых Node-ов. Всё это — состояние самого приложения, а не workflow: оно живёт в `~/Library/Application Support/worfy/`, не попадает в репозитории Project-ов и не дублирует ничего, что уже хранят Ticket-ы, `HANDOFF.md`, транскрипты или Gate. Правило ADR 0002 остаётся в силе: если факт о работе где-то уже записан workflow, worfy его читает, а не копирует.

worfy ничего не пишет в репозитории Project-ов — ни Card-ы, ни Layout, ни свои настройки: для остальных участников репозитория worfy невидим. Единственная запись вне `Application Support` — регистрация Project в общем конфиге Gate (`~/.claude/gate/config.json`). Синхронизация состояния worfy между машинами или с облаком — отдельное будущее решение.

## Considered Options

- Кнопка «вынести Card в репозиторий» (`<repo>/.worfy/cards/`). Отвергнуто владельцем: worfy не оставляет следов в репозиториях.

## Amendments

- 2026-11-04 — в `app-settings.json` папки данных worfy (`WORFY_DATA_DIR`) появилось поле `autoApproval`: режим
  Auto-approval (Off / Shadow / On) по id Project-а, нет записи — Off (worfy-auto-approve, Ticket 06). Режим —
  настройка Machine, а не Profile и не файл репозитория: Profile и репозиторий агент меняет обычной командой, а режим
  решает, отвечает ли worfy на запросы разрешения агента. Пишет его только переключатель под полем ввода
  Orchestrator-а через IPC `autoApproval.set` (канал `local`, с Linked machine не доступен). Пока worfy запущен с
  открытым debugging port или pipe (`--remote-debugging-port`, `--remote-debugging-pipe`) или с Node inspector
  (`--inspect`), окно worfy может вести любой процесс Machine, в том числе Bash агента, поэтому debugging port —
  это Auto-approval Off: `autoApprovalMode()` отвечает Off, `autoApproval.set` отказывает в Shadow и On, сохранённый
  режим действует снова после запуска без них. `app-settings.json` читается один раз при первом обращении; правка
  файла извне видна только после рестарта worfy, а следующая запись любой настройки Machine кладёт поверх неё
  состояние из памяти.
- 2026-11-05 — в том же `app-settings.json` появилось поле `autoContinue`: `{<id Project-а>: true}` для Project-ов, где
  worfy сам продолжает Run после ошибки API или Limits; нет записи или мусор в поле — Off (worfy-retry, Ticket 02).
  Как и `autoApproval`, это настройка Machine: пишет её только пункт Auto-continue в меню Modes Orchestrator-а через
  IPC `autoContinue.set` (каналы `local`, с Linked machine не доступны); Off удаляет запись Project-а.
- 2026-11-05 — поля `autoApproval` и `autoContinue` в `app-settings.json` и Eco mode в Profile теперь доступны Linked
  machine (worfy-retry, Ticket 13; решение владельца Q15–Q18 спеки worfy-retry: «полный доступ — значит действительно
  полный»). Каналы `autoApproval.*`, `autoContinue.*` и `ecoMode.*` помечены `project`: чтение и события смены — `read`,
  запись — `write`. Linked machine с Full access меняет все три режима, и запись идёт на Machine Project-а — в её
  `app-settings.json` и её Profile; на вызывающей Machine ничего не пишется. С Read only она видит режимы, а запись
  отклоняется на Machine Project-а до handler-а. Смена рассылается всем клиентам Machine Project-а (`autoApproval.changed`,
  `autoContinue.changed`, `ecoMode.changed`), так что открытое меню на обеих Machine обновляется сразу. Запрет debugging
  port остаётся и действует с обеих сторон: Machine Project-а по-прежнему отказывает в Shadow и On при своём debugging
  port; вызывающая Machine при своём debugging port или inspector-е пропускает через `linked.invoke` только Off (тот же
  текст отказа), потому что Machine Project-а не может знать, что окно вызывающей ведёт скрипт. Окно узнаёт причину по
  каналу `autoApproval.blockedHere` (`local`).
