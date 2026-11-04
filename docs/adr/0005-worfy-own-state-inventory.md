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
