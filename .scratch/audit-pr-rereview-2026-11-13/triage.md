# Разбор medium-находок повторного review, 2026-11-14

Проверены все medium-находки из `spec.md` этой папки, всего 212. Пять агентов, по одному на группу областей, сверили каждую находку с main на commit `dccb87380`. Агенты только читали код. Tests, CI и приложение не запускались. Поэтому «подтверждено» значит «видно в коде», а не «воспроизведено».

После слияния дублей: **чинить сейчас — 46**, **в Ticket-ы — 27**, **не делать — 134**. Ещё 5 находок слиты как дубли с другими: 142 с 141, 59, 78 и 80 с 58, 108 со 107.

Стоимость: S — правка в несколько строк плюс test, M — правка в нескольких местах или с решением по поведению.

## Чинить сейчас

Порядок: сначала то, что ведёт к неверному действию или потере данных, потом сломанные шаги skills, потом UI, flaky tests и docs. Внутри группы S раньше M.

### Неверное действие или потеря данных

1. **203. Неудачный `git worktree list` делает claimed Ticket готовым.** `src/main/workflow/reader.ts:440`, `.catch(() => '')`. При сбое git занятый Ticket читается как open и Ready, и Autopilot может отправить его в работу второй раз. Нужно держать последнее удачное значение. Cost S.
2. **205. Проверка конца Wave не видит unreadBranch.** `src/shared/autopilot/cycle.ts:262-263`. Один сбой чтения branch завершает Wave раньше времени. Нужно считать unreadBranch как «в работе», как уже делает `waves.ts:64`. Cost S.
3. **204. Возобновлённый run теряет прерванный Ticket.** `src/shared/actions/render-template.ts:98-100`. Ticket с нечитаемой branch не попадает ни в resumed, ни в ready. Нужно учесть unreadBranch. Cost S.
4. **47. Повторное чтение лимитов Codex ждёт до weekly reset.** `src/main/vendors/codex/limits.ts:55,67`. Если исчерпано только 5-часовое окно, оба окна помечаются reached, и Autopilot ждёт до 3 дней. Нужно судить по usedPercent каждого окна. Cost S.
5. **110. `done --pr web3#17` пишет `PR: #317`.** `harness/bin/ticket:633`. Из строки выбрасываются все нецифры, и в ticket попадает чужой номер PR. Нужно разбирать `REPO#PR` целиком, как в ветке нескольких repository. Cost S.
6. **111. `profile-set --field` внутри read-only поля ломает profile.** `harness/bin/profile-set:136,205`. Путь глубже read-only поля, например `workflow.pipeline.x`, не отклоняется. Нужна проверка в обе стороны и test. Cost S.
7. **167. Rewrite не различает два ответа в одном месте.** `src/renderer/pr-inbox/DraftThread.tsx:48-50`. Ответ назван только путём и строкой, и Session может переписать не тот draft. Нужно передать threadId. Cost S.
8. **162. На PR коллеги все нерешённые threads ждут пользователя.** `harness/skills/pr-reply/SKILL.md:65`. Skill пишет drafts в threads, где ответ должен дать не пользователь. Нужно правило owesAnswer в тексте skill. Cost S.
9. **3. Личный deny list срабатывает на имя самого project.** `harness/bin/review-draft-lint:72`. Имя project всегда даёт finding, и цикл «исправить и проверить снова» не заканчивается. Нужно исключить имя project из списка в lint. Cost S.
10. **45. Перетаскивание вниз ставит строку ниже линии.** `src/renderer/autopilot/QueueList.tsx:25-31,85`. Линия показывает вставку над строкой, а строка встаёт на одно место ниже, и порядок Epic-ов в очереди выходит не тот. Правка в одну строку плюс test на перетаскивание вниз. Cost S.
11. **160. snapshot() падает во время первого чтения.** `src/main/github/inbox.ts:397,445`. `nextAt` равен `-Infinity`, и `toISOString()` бросает RangeError. Нужно возвращать null, пока значение не конечно. Cost S.
12. **166. После сна digest строится по вчерашним данным.** `src/main/github/inbox-digest.ts:94-100`. Свежесть snapshot не проверяется, день сразу помечается, и верный digest в этот день уже не придёт. Нужно ждать, пока `readAt` старше интервала. Cost S.
13. **185. Focus mode расщепляет draft.** `src/renderer/session/drafts.ts:128`. Canvas и Focus mode держат две копии текста, набранное может пропасть, отправленное остаться в поле. Нужно общее хранилище через `useSyncExternalStore`. Cost M.
14. **159. Давно не менявшийся PR больше не перечитывается.** `src/main/github/inbox.ts:512-518`. Конфликт после merge другого PR не меняет `updatedAt`, и PR остаётся в неверной группе. Нужно редкое периодическое перечитывание. Cost M.
15. **129. «Remove project…» на Demo project оставляет demo застрявшим.** `src/renderer/shell/ProjectsSection.tsx:600`. Пункт обходит отдельное удаление demo (`getting-started/remove.ts`), и запись demo остаётся. Нужно скрыть пункт или вызвать удаление demo. Cost M.

### Шаги skills и скриптов, которые падают или дают неверный результат

16. **10. Шаг 1 skill-а запускает gh и git не в repository.** `harness/skills/human-review-setup/template/SKILL.template.md:23-25`. В project из нескольких repository корень не repository, и шаг 1 падает. Нужно перейти в папку repository этого PR. Cost S.
17. **13. Brief Subagent-а черновика не называет папку checkout.** `harness/skills/human-review-setup/check.md:86-90`. В project из нескольких repository Subagent может читать не тот checkout. Нужно передавать путь в brief. Cost S.
18. **14. Комментарии обрезаются по последнему review, а не по следующему commit.** `harness/skills/human-review-setup/check.md:130-131`. Набор комментариев неверный, оценка совпадения искажена. Нужно обрезать по времени следующего commit. Cost S.
19. **11. Нет пути восстановления, когда GitHub отклоняет review.** `harness/skills/human-review-setup/template/SKILL.template.md:157-175`. После отказа skill не говорит, что делать. Нужен шаг: убрать или перенести комментарии вне diff, сменить событие, повторить. Cost S.
20. **4. Hold-out берёт PR, где команда только одобрила.** `harness/skills/human-review-setup/SKILL.md:125-131`. PR с одним «LGTM» попадает в hold-out и потом выпадает из check. Нужен тот же фильтр `isPlainApproval` при выборе. Cost S.
21. **5. Проверка login находит владельца repository в каждой ссылке.** `harness/skills/human-review-setup/analyse.md:193`, `write.md:80`. Если владелец repository сам reviewer, проверка падает на каждой ссылке PR. Нужно исключить URL из проверки. Cost S.
22. **8. Secondary rate limit ждёт до часа.** `harness/bin/review-history:306-322`. Скрипт ждёт reset основного окна, даже когда оно не исчерпано. Нужно ждать reset только при remaining=0, иначе 60 s. Cost S.
23. **102. Critic в Silent mode пишет review не туда.** `harness/agents/critic.md:17`. Папка плана в Silent mode вне repository, profile не находится. Нужно вызывать profile по папке repository. Cost S.
24. **99. Skills создают GLOSSARY.md в корне.** `harness/skills/domain-modeling/SKILL.md:40`. Путь из `docs.context` не читается. Нужно брать путь из profile. Cost S.
25. **98. В шаблоне to-tickets нет `## Done when`.** `harness/skills/to-tickets/SKILL.md:66-77`. Evidence привязывается к этому разделу, а шаблон его не создаёт. Правка в одну строку. Cost S.
26. **104. Шаблон branch `<epic>/<NN>-<slug>` не распознаётся.** `harness/hooks/stage-lines.mjs:119-123`. Форма из `profiles/README.md:181` не совпадает с regex, строка Epic не показывается. Нужно превращать `<slug>` в `.*`. Cost S.
27. **207. npm 11 отвечает E404 с exit code 1.** `src/main/workflow/release.ts:177-178`. Неопубликованная версия даёт «not checked» и событие `pipeline.changed` каждые 5 минут. E404 нужно считать waiting. Cost S.
28. **208. Tag с «@» отклоняется навсегда.** `src/main/workflow/release.ts:57`. Tag в формате changesets не проходит regex, хотя ticket release его принимает. Нужно расширить regex. Cost S.

### UI

29. **70. Метка «not sent» невидима.** `src/renderer/session/session.css:834`. Цвет взят из токена текста на кнопке danger, белый на светлом фоне. Нужен токен `--danger`. Cost S.
30. **141 (и 142). Focus теряется при смене kit-окон; Command palette забирает focus у Getting started.** `src/renderer/ui-kit/Dialog.tsx:91-101`. Закрывающееся окно всегда возвращает focus на старый элемент, даже если новое окно уже взяло focus. Нужно возвращать focus, только если он потерян. Cost S.
31. **189. Список Queued сам открывается и забирает focus.** `src/renderer/session/Queue.tsx:29-31`. Состояние open не сбрасывается при пустой очереди. Нужно сбрасывать его. Cost S.
32. **187. «Show all» не появляется после замены цитаты.** `src/renderer/session/QuotedPrompt.tsx:44`. Высота не перемеряется после замены цитаты на полную. Нужно добавить `sent?.quote` в зависимости. Cost S.
33. **133. Точка на rail горит для каждого Ticket в работе.** `src/renderer/shell/PipelineSection.tsx:52`. Точка горит и когда Ticket ждёт агента или команду. Нужно условие `waitsForPerson`. Cost S.
34. **169. «Answer N open threads» считает все нерешённые threads.** `src/renderer/pr-inbox/usePrInbox.ts:331-342`. Число в кнопке завышено. Нужно поле `waitingThreads` из main. Cost S.
35. **168. Скрытый вид каждые 5 s читает drafts и запускает bin/profile.** `src/renderer/pr-inbox/DraftThread.tsx:155`. Опрос идёт, пока вид скрыт. Нужно останавливать его. Cost S.
36. **171. Markdown комментариев разбирается на каждый опрос и каждое нажатие.** `src/renderer/pr-inbox/CommentBody.tsx:7-12`. Ввод в PR pane тормозит. Нужен `React.memo`. Cost S.

### Flaky tests

37. **214. E2e test кликает по закрытой mark.** `test/e2e/work-track.spec.ts:391`. В некоторые даты test красный весь день и блокирует CI. Нужно выбирать mark, которую ничто не закрывает. Cost S.
38. **49. Test читает state раньше, чем он записан.** `test/contract/autopilot-retry.test.ts:620`. Строка journal пишется раньше state (`run.ts:2397`). Нужно ждать нужный state. Cost S.
39. **116. Test heartbeat считает до перезаписи holder.json.** `harness/bin/tests/wave-gate-heartbeat.test.sh:227`. Счётчик читается до записи файла, test иногда падает. Нужно считать после записи. Cost S.

### Docs и подсказки

40. **39. Ввод имени connector обещан, но не работает.** `src/renderer/session/McpChip.tsx:87-89`, `docs/features/mcp-servers.md:111-113`. Hint обещает действие, которое Claude Code отбрасывает. Нужно убрать обещание из hint и docs. Cost S.
41. **38. Русская страница MCP устарела.** `docs/features/ru/mcp-servers.md:56`. Нет статуса not started и ошибки в строке. Нужно обновить перевод. Cost S.
42. **118. Русская страница skills описывает удалённые hooks.** `docs/features/ru/skills-agents-and-hooks.md:185,188,205`. Описаны `session-end.mjs` и напоминание `/retro`, которых нет. Нужно обновить по английской версии. Cost S.
43. **119. Пауза land при красном main не описана.** `docs/features/gate-and-github.md:186-190`. Нужен абзац про условие паузы и её снятие. Cost S.
44. **120. Правила hostNeedles изменились, а docs нет.** `docs/features/gate-and-github.md:365`, `docs/features/evidence.md:174`. Не сказано, что общее слово в имени host не считается секретом. Править вместе со 119. Cost S.
45. **127. Docs обещают gate на каждом turn Codex.** `docs/features/vendors.md:56`. Не упомянут пропуск gate в main checkout. Нужна одна оговорка. Cost S.
46. **192. Docs говорят про markdown, а Canvas рисует `<pre>`.** `docs/features/projects.md:553-563`, `SessionNode.tsx:497`. Дешевле поправить страницу. Cost S.

## В Ticket-ы

### Human review
- 21. Дочитывание страниц threads и comments не проверено — нужен test с двумя страницами, срочности нет.

### Autopilot и Orchestrator
- 52. Предел в 5 retry ручного продолжения не проверен — нужен contract test с подряд идущими 529.
- 53. Запись вызовов при возврате Session человеку не проверена — guard от продолжения после незавершённого git push.
- 55. Остановка waits-owner в середине очереди не проверена — один contract test.
- 56. Флаг `paused` для waiting-сообщений не проверен — без test удержанная очередь может уйти сама.

### Product Session и Mind map
- 58 (и 59, 78, 80). Symlink в папке темы ведёт к утечке NTLM на Windows — нужна проверка каждого файла, не только папки; tests вместе с исправлением.
- 63. Chip темы, которой нет на карте, не работает — нужно переключать тему, затрагивает родительский экран.
- 65. После Resume пропадают ответы на AskUserQuestion — нужно рисовать строку из tools файла Session.
- 69. Панель Idea generator всегда пуста — нужно решить, брать ответ после Skill или запускать как fork.
- 79. Нечитаемый mind-map.json не проверен — guard от перезаписи карты одним узлом.
- 93. Связка productWrites не проверена — без test все записи вне папки могут молча отклоняться.

### Harness
- 95. Файл для `--input` проверяется со старым содержимым — исправление нетривиально.
- 97. frontier показывает чужой claimed ticket — `claim` не отказывает при чужом claim, нужен test.
- 113. Проверка открытых PR идёт под глобальным аккаунтом gh — перенос редкий.
- 114. Папка Product Session не переносится между Full и Silent — перенос редкий.
- 121. Неявный POST только с `--input` не проверен — защита Silent mode без test.

### CI и tests
- 196. Кириллические deny-записи ловят только именительный падеж — нужен выбор способа сравнения.

### UI kit и shell; Sessions и chat
- 130. Вложенный repository со своим Profile считается частью удаляемого — случай редкий.
- 145. Tooltips частей карточки Projects не видны клавиатуре — доступность, видимый текст остаётся.
- 184. Запрос background task не виден в новом окне — случай редкий.

### GitHub и PR inbox
- 157. На GHES доступ на запись проверяется под активным аккаунтом — только GitHub Enterprise Server.
- 158. `gh auth token -u` вызывается без `--hostname` — только GHES, делать вместе со 157.
- 165. Первое чтение с упавшими details становится baseline — разовая пачка лишних уведомлений.
- 181. Сбой записи in-flight mark не проверен — защита от двойной публикации, нужен test.

### Workflow, Pipeline, Work track
- 206. Время на Stage прыгает назад у Ticket на нескольких repository — ложная пометка «stuck».
- 209. Цепочка из трёх repository скрывает красный CI — меняет правило ожидания.
- 212. Marks в строках CI и статусов не раздвигаются — группировка marks, отдельная задача UI.

## Не делать

### Уже исправлено
- 16. Дата начала refresh — уже есть поле `analysed_through`.
- 30. Сообщение во время restart — ждёт в очереди нового process (`session.ts:810-835`).
- 31. Без Profile все серверы «Not allowed» — без Profile строки не добавляются.
- 46. Правило I4 — уже принимает turn-retry, retry-refused, run-stopped.
- 61. Drag split-а — новый pointerdown завершает старый drag.
- 72. Строка статуса — уже обрезается с многоточием.
- 105. Форма ответов владельца — совпадает с тем, что читает `share.ts`.
- 131. Вариант «default» — передаётся как null.
- 135. Кнопка «Always allow in <folder>» — уже переносится (polish 82).
- 138. Shift+Tab в форме переноса — уже обрабатывается.
- 139. Клик по toast — уже не закрывает popovers.
- 140. Список Select — уже рисуется внутри окна.
- 148. Закрытие Session при Remove project — contract test уже есть.
- 151. processGoneNow — есть unit test.
- 154. Esc в Connect Project — tests уже есть.
- 191. Esc и карточка — поведение и docs согласованы.
- 200. Проверка drop в read-only — test теперь проверяет результат.

### Не подтверждено на main
- 6. Ответ в thread как отдельный review — запись не найдена.
- 9. «Delete» в состоянии «Not built» — состояние с raw/ не подтверждено.
- 17. Двойной счёт stats — вход отсекается по дате.
- 33. Chip после выхода process — действия просто вернут ошибку.
- 35. Chip MCP у Codex — чтение повторяется при следующих событиях.
- 36. Sign in с Linked machine — openExternal идёт в app пользователя.
- 41. Заметка «takes effect from the next Wave» — test-файл chip есть.
- 64. Ошибка после Resume — не подтверждено.
- 71. Старая очередь после Close и Resume — не подтверждено.
- 75. Описание restamp в docs — не сверено.
- 103. product-ideas и specs — отказ guard не подтверждён.
- 106. Rerun переносит вину — rerun сохраняет id run-а.
- 115. Profile схемы 1 — код пишет mode после переноса.
- 117. Префикс `[R] ` в ссылках — префикс задуман, поломка не подтверждена.
- 132. Колонка Harness при масштабе 120–150% — без запуска не проверить.
- 136. Enter в popup внутри Node — обработчик не найден.
- 137. Native title предка — нужен title у предка, случай надуманный.
- 143. Focus на body после «Run all accepted» — меню уже на kit Menu.
- 146. Общее действие и «Running…» — только расхождение описания.
- 147. Tooltip по focus для всех write-действий — полнота не подтверждена.
- 164. Badge «N sessions» — перенос не воспроизведён.
- 172. Verdict по repository в badges — не подтверждено.
- 186. Find в цитате — код подсветки не найден.
- 188. «New Orchestrator Session» — влияние не подтверждено.
- 190. Hover card под первой цитатой — anchor читает актуальный rect.
- 216. Run по очереди Epic-ов — частично учтено, остаток не подтверждён.

### Влияние на деле low
- 7. Одобрения не на английском — небольшой шум в выборке.
- 12. Правило одной трети — тонкость качества примеров.
- 15. Сегодняшние title и body PR — правка body после review редка.
- 18. Product Session получает /human-review — вызов просто упадёт.
- 19. Orchestrator без /human-review — skill появится в следующей Session.
- 20. `--changed` и eval-ы human-review-setup — только выбор eval-ов.
- 32. Второй Allow — остаётся узкое окно.
- 34. Esc и popover chip-а — закрывается кликом снаружи.
- 37. Reconnect у Codex в docs — редкий случай.
- 48. «no reset time reported» — только текст.
- 50. Поле `epic` в journal — уточнение docs.
- 51. «Окно запуска» в CONTEXT.md — одно слово в glossary.
- 60. New Product Session на старой сборке — редкое рассогласование версий.
- 62. «Show in the chat» без сообщения — клик ничего не делает.
- 66. Скрытый Subagent в виде Product — можно вернуть с Canvas.
- 67. Сдвиг на 1 px и refit — последствие мелкое.
- 68. Ring после смены темы — только обводка.
- 73. «Writing <file>» мелькает — косметика.
- 74. Причина выключенных Move nodes и Prettify — две кнопки, данных не теряет.
- 76. «not sent» после reload — неполнота docs.
- 96. Удаление mattpocock-skills — docs и UI уже называют команду.
- 100. worktree-lock на сетевом share — условия редкие.
- 101. Grader numbered-round — формат задан skill-ом.
- 107. Красный run docs-only commit — пропуск намеренный.
- 109. Голый `PR: #N` — редкий случай в multi-repo.
- 112. Правило строки base — продолжение с шага 7 редкое.
- 128. «Running…» до ответа в Confirm — только вид.
- 134. Обрезка короткой branch — задумано в polish 111.
- 144. Окна из menu и слой toast — сочетание надуманное.
- 161. Rewrite и отправленные ответы — send сверяет thread с GitHub.
- 163. Alert «not in the inbox» после merge — только текст.
- 170. Выбор PR при старте окна — сохраняется намеренно.
- 194. Quarantine quiet-windows — уже ведёт polish 112, срок 2026-11-26.
- 195. Имена папок в check-personal — имя уже в публичном repository.
- 199. TEMP на D: и 8.3 — покрыто unit tests.
- 202. Ветка Homebrew в CI — запасная, нужен отдельный CI job.
- 211. byWorktree и поздний Epic — основной случай закрыт отсечкой по времени.
- 213. critical-path CI→Gate — только внутренний скрипт замеров.
- 215. Заштрихованная lane в docs — редкий случай.
- 218. Settings новой версии выключают Tailscale — принятое решение.
- 219. Test с подменённым peer — только test, без эффекта на продукт.

Пробелы в tests с low-влиянием (поведение есть, test нет, регрессия маловероятна или косметическая): 22, 23, 24, 25, 26, 27, 40, 42, 43, 54, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 122, 123, 124, 125, 149, 150, 152, 153, 155, 156, 173, 174, 175, 176, 177, 178, 179, 180, 182, 183, 193, 197, 198, 201, 210, 217, 220.

### Нужны собственные права человека
- 77. «Always allow in <folder>» может разрешить корень repository или home — человек сам нажимает кнопку и видит папку на карточке. Достаточно поправить docs.

### Дубли
- 59, 78, 80 — слиты с 58 (проверка symlink внутри папки темы, Ticket).
- 108 — слит со 107 (пропуск run-а docs-only commit).
- 142 — слит со 141 (возврат focus в `Dialog.tsx`, «Чинить сейчас»).

## Как принять

Владелец отмечает в «Чинить сейчас» пункты, которые чинить сейчас. Остальные пункты этого раздела владелец переводит в Ticket-ы или закрывает. Раздел «В Ticket-ы» становится Ticket-ами, если владелец не скажет иначе. Раздел «Не делать» закрывается без работы.
