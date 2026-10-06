# 0033 — Autopilot называет Orchestrator-у Ticket-ы Wave; ветка worktree не отменяет `blocked` и `done` checkout-а
Дата: 2026-10-06. Статус: принят.

**Контекст.** Второй настоящий прогон Autopilot 2026-10-06 (Ticket 30 Epic worfy-daily) встал с
`no-progress` в 15:24Z по двум причинам.

1. В Wave попал Ticket 15 со Status `blocked`. Модель workflow накладывает Status ветки worktree на
   checkout (`applyBranches`, `src/main/workflow/reader.ts`): ветка брала верх, если её Status
   отличался от checkout-а и checkout не `done`. Ветка `worfy-daily/15` файл Ticket-а не меняла и
   несла Status своей базы — `open`; в checkout-е после решения Orchestrator-а стоял `blocked`.
   Модель отдала `open`, и `readyWave` взял Ticket в Wave. Тот же `open` видели Canvas и
   «Run wave».
2. Пункт 5 ADR-0024 оставил в тексте Orchestrator-у номер Wave плана (`{wave}`). worfy считает его
   сам, ставя всем Ticket-ам `open`, и берёт меньший номер среди готовых Ticket-ов. Номер зависит
   от версии таблицы «Волны» spec.md и от Ticket-ов, которых в Wave быть не должно. Ушло
   «волна 6» — закрытая Wave; Orchestrator ничего не запустил. В журнале прогона не было ни
   ушедшего текста, ни ответа: причину остановки показал только транскрипт.

**Решение.**

1. **Ветка worktree не отменяет решение, влитое в checkout.** Это правило модели workflow, а не
   фильтр Autopilot: его видят Canvas, «Ship ticket», «Run wave» и Autopilot. Status ветки
   перекрывает Status checkout-а, только когда в checkout-е не `blocked` и не `done`, а в ветке не
   `open` и не `none`. `open` и `none` ветки — Status её базы, ветка его не ставила; `blocked` и
   `done` checkout-а — решение, уже влитое в main, ветка его не отменяет. Ticket, взятый в
   worktree (`work` в ветке, `open` в checkout-е), остаётся `work`, как раньше.
2. **Текст Orchestrator-у называет Ticket-ы Wave.** Новый placeholder `{tickets}` — номера готовых
   Ticket-ов через запятую, двузначные (`11, 23, 25, 27`). Шаблон «Run wave» по умолчанию —
   `/epic-wave Ticket-ы {tickets} эпика {epic}`. Текст и список Ticket-ов в журнале прогона
   считаются из одного чтения модели. Этим пункт 5 ADR-0024 заменяется: номер Wave плана в тексте
   по умолчанию больше не стоит. Нумерация Wave-ов по прогону с 1 в журнале и строке состояния
   остаётся.
3. **Сохранённый старый default становится новым.** Шаблон «Run wave», равный старому default
   (`/epic-wave волна {wave} эпика {epic}`), при чтении настроек Project-а читается как новый
   default. Файл не переписывается: новый текст ляжет в него при следующем сохранении настроек.
   Свой шаблон владельца не трогается.
4. **Autopilot не стартует с шаблоном без `{tickets}`**: причина «The Run wave template does not
   name the Wave's tickets: add {tickets}» — на кнопке Autopilot, и main отказывает в старте с ней
   же. Кнопка «Run wave» с таким шаблоном работает: её жмёт человек. `{wave}` остаётся для своих
   шаблонов с прежним смыслом — номер Wave плана.
5. **Пропущенные Ticket-ы видны.** `readyWave` отдаёт третий список — Ticket-ы со state `blocked`
   или `none`, у которых все блокеры `done`. Autopilot пишет его в `wave-started` полем `skipped`
   (номер и state), вместе с `text` — текстом, ушедшим Orchestrator-у. Готовых `open` нет, а в
   третьем списке кто-то есть — прогон останавливается с новой причиной `blocked-tickets` и полем
   `tickets`, на старте и после Wave. Оба списка пусты — `no-ready-wave`, как раньше.
6. **Журнал объясняет остановку.** `run-stopped` с `no-progress`, `no-ready-wave` и
   `blocked-tickets` несёт `lastText` — первые 1000 символов последнего ответа Orchestrator-а в
   ходах Wave; без ходов (остановка на старте) поля нет.

**Последствия.** Список в тексте — ровно то, что Autopilot пишет в журнал, и его можно сверить с
ответом Orchestrator-а; номер Wave плана worfy больше не угадывает. Skill `epic-wave` должен
принимать явный список Ticket-ов; это одна фраза в `~/.claude/skills/epic-wave/SKILL.md`, её
вписывает владелец (вписана, commit 364070b). Чтение настроек меняет данные владельца:
`settings.json` Project-ов со старым default после первого сохранения хранит новый. Откат — вернуть
default и убрать правило чтения; свои шаблоны не затронуты. Сборка старше этого решения
(placeholder-а `{tickets}` она не знает) отложит такой `settings.json` в сторону как нечитаемый и
начнёт со своих default — поэтому стабильную копию обновляют из main вместе с этим решением. Ticket, который владелец вернул в
работу (`blocked` в checkout-е, `claimed` в ветке доработки), Canvas показывает `blocked`, пока
Status не влит в main.

## Considered Options

- **Список Ticket-ов `{tickets}`** (выбрано). Совпадает с журналом и не зависит от таблицы плана.
- **Номер Wave прогона (1, 2, 3).** Отвергнуто: skill читает таблицу плана, номер прогона ему
  ничего не говорит.
- **Номер Wave «как в таблице» (как сейчас).** Отвергнуто: worfy не разбирает spec.md (Ticket-ы
  читает только `epic-status`), а таблица отстаёт от решений по ходу Epic-а; оба прогона
  2026-10-06 это показали.
- **Фильтр `blocked` только в Autopilot.** Отвергнуто: Canvas и «Run wave» видели бы ту же
  ложную `open`, а дефект — в модели, которую читают все.
- **Ветка перекрывает checkout только при `open` или `none` в checkout-е.** Отвергнуто: Ticket,
  чей claim влит в main (`work` в checkout-е), а в ветке уже `blocked` или `done`, показывался бы
  `work`; правило «ветка не отменяет `blocked`/`done` checkout-а и не ставит `open`/`none`» даёт
  тот же итог в случаях Ticket-а 30 и сохраняет этот.
- **Переписать `settings.json` со старым default при чтении.** Отвергнуто: чтение не пишет, а
  стабильная копия со старым кодом читает тот же файл; правило чтения даёт тот же итог без записи.
