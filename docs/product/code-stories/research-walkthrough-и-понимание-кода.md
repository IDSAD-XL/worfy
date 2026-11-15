# Walkthrough у конкурентов и что известно о понимании кода агента

Research к вопросу [02](issues/02-walkthrough-у-конкурентов-и-понимание-кода.md) темы Code stories. Code story — короткий
рассказ о готовом изменении для человека, который отвечает за код: фрагменты diff с объяснением, ссылки на требования,
риски, вопросы к строкам и проверка понимания по желанию ([карта темы](map.md)).

## Коротко

- Ни один из проверенных продуктов не делает Code story целиком. Ближе всего по форме — CodeRabbit Change Stack (preview):
  изменение разбито на пронумерованные шаги «in the order someone would explain the change», объяснения привязаны к
  диапазонам строк, из диапазона можно задать вопрос в chat. Но это инструмент reviewer-а: chat опирается на
  репозиторий и web, а не на ход работы автора; проверки понимания нет [20][21].
- Адресат как у Code stories — у Google Antigravity: walkthrough создаётся, когда агент закончил, для пользователя,
  который не следил за каждым шагом. Комментарий к строке diff уходит агенту [14][16]. Сам walkthrough — краткий
  пересказ, без ссылок на требования и без рисков.
- Свои решения по ходу работы объясняет Claude Code в output style Explanatory и Learning [30]. Рассуждения агента
  целиком хранит Spotify Xirp — как сырой transcript, который загружают вручную [28].
- Проверку понимания делают только небольшие open-source инструменты: Comprehension Gate, PR Quiz, PR Guard, cognit,
  skill quiz-gate [32]–[37]. Главное возражение к ним высказано публично: ответы напишет та же модель [34]. GPT-4
  правильно ответила на 88% вопросов о коде такого типа [51].
- Досье ошибались в трёх местах. У Factory содержимое вида Walkthrough не описано нигде. У HumanLayer документация
  обещает `pr-walkthrough.html`, а текущий текст skill-а запрещает «walkthrough artifacts». У Antigravity вывод test-ов и
  записи — не обязательные части walkthrough [1]–[8][14].
- Исследования сходятся: когда код пишет AI, человек понимает его хуже. У Anthropic (рандомизированный эксперимент, 52
  разработчика) — 50% против 67% в quiz без AI, сильнее всего отстаёт debugging [38]. У Balepur et al. (2026, preprint,
  54 студента) агент, который правит код сам, ухудшает понимание по сравнению с chatbot: d>0.8 [40].
- За проверку понимания. Вопрос после чтения держит знание дольше, чем перечитывание: через неделю 56% против 42% [59],
  g=0.50 в метаанализе [60]. Около трети студентов, чей код прошёл test-ы, ошиблись хотя бы в одном из трёх вопросов об
  этом коде, и неверный ответ был связан с худшим результатом в курсе [50].
- Против обязательной проверки. Перенос на новые задачи слабый: d=0.40, а без правильного дизайна вопросов — около нуля
  [62]. В единственном найденном эксперименте с вопросами к коду от AI прирост незначим, время растёт в 1.8–2.7 раза,
  часть участников называла вопросы поверхностными [52]. Почти все данные — о студентах, не о владельце production-кода.

Как собрано. Утверждения о продуктах сверены с документацией вендора, changelog-ом или открытым репозиторием. Досье
[исследования конкурентов](../../research/2026-11-13-competitors/) писались без такой сверки; расхождения собраны ниже.
Исследования взяты из статей и постов авторов, а не из пересказов в новостях. Все страницы прочитаны 2026-11-15. Номера в
квадратных скобках ведут в раздел «Источники».

## Продукты

| Продукт | Artifact | Для кого | Когда | Вопрос к строке | Ссылается на ход работы агента | Проверка понимания | Источник |
|---|---|---|---|---|---|---|---|
| Factory | Вид Walkthrough у открытого PR во вкладке PRs Workstream-а (проекта, который orchestrator Factory раздаёт агентам) | Не описано | Не описано | Не описано | Не описано | Не описано | [1][2] |
| HumanLayer | `pr-walkthrough.html`: дерево «сверху вниз» — исходная проблема, принципы, пронумерованные шаги, файлы с diff, «что сознательно не меняли», test-ы и commit | Reviewer большого PR | В конце `/rpi:describe-pr`, когда ветка готова к review, если PR трогает не меньше 300 строк в не меньше 5 файлах (так в документации; в текущем тексте skill-а этого шага нет) | В самом HTML нет. К task artifacts есть комментарии, их разбирает агент; про walkthrough не сказано | Частично: контекст задачи, diff сверен с планом, «что сознательно не меняли». Рассуждений Session нет; описание PR ссылается на Session | Нет | [3]–[8] |
| Traycer | `traycer-changeset-walkthrough`: spec-artifact — что изменилось, почему, порядок review, что ещё надо проверить | Тот, кто проверяет готовую работу | Агент предлагает после существенной работы и пишет после согласия человека | К тексту artifact-а: anchored comment или Send to chat (цитата уходит в chat агента). К строкам diff внутри walkthrough — не описано | Частично: «почему» входит в walkthrough. Ссылки на план и tickets не описаны | Нет | [9]–[13] |
| Google Antigravity | Walkthrough artifact: краткий итог изменений в разговоре; screenshots и записи браузера — по просьбе или при `/plan` | Пользователь, который не следил за каждым шагом агента | Когда агент закончил реализацию | Да, как комментарий: к строкам diff в Review pane и к artifact-у. Уходит агенту со следующим сообщением | Да, как пересказ разговора. Artifact-ы описаны как способ показать «progress and thinking» | Нет | [14]–[18] |
| CodeRabbit | Walkthrough comment на каждом review PR; Change Stack (preview) — PR как стопка пронумерованных слоёв с summary у диапазонов строк | Reviewer | При каждом review PR | Да: chat из слоя, файла или диапазона строк в Change Stack (план Team и выше); `@coderabbitai` в комментарии PR | Нет: chat опирается на репозиторий, подключённые ресурсы и web; ход работы автора кода не упоминается | Нет. Есть отметка прочитанных файлов | [19]–[25] |
| Spotify Xirp | Transcript Session, загруженный в Workspace Spotify Portal. На сайте — «Living documentation, built automatically» | Команда и будущие Session агентов | После Session, вручную (beta) | Не описано | Да: transcript содержит разговор, вызовы tool-ов, правки файлов и рассуждения агента, если они есть в transcript-е | Нет | [26]–[29] |
| Claude Code, output style Explanatory | Блоки `Insight` по 2–3 пункта: почему агент сделал именно так | Тот, кто ведёт Session и знакомится с codebase | Во время работы, до или после кода | Обычный вопрос в разговоре; привязки к строке нет | Да: агент объясняет свои решения в момент работы | Нет | [30] |
| Claude Code, output style Learning | Те же `Insight` плюс `TODO(human)`: человек пишет кусок кода с настоящим проектным решением | Тот, кто хочет практики во время задачи | Во время работы | Как у Explanatory | Да | Не quiz: человек пишет код сам, агент отвечает одним `Insight` о нём | [30] |

### Factory

- Страница «Workstream Pull Requests» говорит одно: «An open PR tab shows the PR's description and comments under
  Conversation, plus Diff, Walkthrough, and Validation views» [1]. Что внутри Walkthrough, кто его пишет и когда,
  документация не описывает.
- В полном changelog Factory (328 KB) слово walkthrough не встречается. Нет его и на страницах Factory App, Workstreams,
  Steer и двух страницах code review [2].
- Цена этого вида не указана. Образцом Factory служить не может: содержимое вида неизвестно.

### HumanLayer

- Документация: `/rpi:describe-pr` «Adds `pr-walkthrough.html` when the PR touches at least 300 lines across at least
  five files». «The walkthrough contains task context, ordered implementation steps, diff excerpts, links, exclusions,
  and check results. Reviewers can use it to check a large change» [3].
- Пример walkthrough в репозитории [5]:
  - вводная из 2–3 абзацев и цифры изменения;
  - дерево узлов, которое читают сверху вниз: «0 · Starting point — what was wrong», «Operating principles»,
    пронумерованные шаги, узлы файлов, «Deliberately NOT changed», «Verification & ship» (Tests, Commit);
  - узел файла содержит настоящий diff и ссылку на нужную строку PR в GitHub. Diff подставляет script
    `inject-walkthrough-diffs.sh`, чтобы он не проходил через контекст модели;
  - «Scale the number of nodes to the size of the PR».
- Расхождение. Текущий `SKILL.md` skill-а describe-pr в трёх репозиториях HumanLayer (plugin для Claude Code, pi,
  opencode) пишет: «Do not add walkthrough artifacts, exhaustive implementation narratives, verification checklists,
  changelog text, or plan-deviation sections». Шага, который создаёт walkthrough, в нём нет [4][8]. Шаблон описания PR
  при этом начинается со ссылки «PR Walkthrough (alpha)» [6]. По открытому коду нельзя сказать, создаёт ли HumanLayer
  walkthrough сейчас.
- Опора на ход работы. Skill читает ticket, task artifacts и весь diff. Описание PR заканчивается ссылкой на Session
  (`HumanLayer-Session: <url>`) [4]. Сами рассуждения агента в walkthrough не попадают.
- Вопросы. К task artifacts можно оставлять комментарии к выделенному тексту. Skill `review-artifact-comments` читает их,
  отвечает и закрывает [7]. Работает ли это для HTML walkthrough, не сказано.
- Цена не проверялась.

### Traycer

- `traycer-changeset-walkthrough` «Writes a guide to reviewing completed work: what changed, why, the review order, and
  what still needs verifying». Результат — «A spec under a changeset-walkthroughs folder». «The agent offers one after
  substantial work and writes it once you agree» [9]. Guide по review предлагает его для большого изменения: он «writes a
  guide to what changed, why, and the order to review it in» [10].
- Вопрос к части текста. К тексту документа, HTML-элементам и canvas ставятся anchored comments. Агент может работать по
  ним: копии комментариев лежат файлами рядом с artifact-ом [11]. Send to chat цитирует выделенный фрагмент в chat
  агента [12].
- Цена. Free — $0 со своими агентами (Claude Code, Codex и другие), кредиты Traycer не тратятся. Sync — $20 за
  пользователя в месяц или $16 при оплате за год. Модели через провайдера Traycer — по цене API плюс 20% [13].
- Досье верно.

### Google Antigravity

- «The agent creates walkthrough artifacts when it completes task implementation. This type of artifact includes a
  concise summary of the changes made to remind you of what happened in the active conversation. Walkthroughs help you
  get up to speed with the state of your codebase after the agent makes changes, even if you weren't following every
  step in real time» [14].
- Screenshots браузера агент добавляет по просьбе. При `/plan` агента просят добавить screenshots и записи, когда они
  есть [14]. Вывод test-ов (npm test, 5 passing) виден только на картинке-примере с разделами Changes Made и Validation
  Results [14].
- Artifact — «a structured deliverable created by the agent to accomplish its task and communicate its progress and
  thinking to you» [15].
- Вопрос к строке. В Review pane комментарий ставится к строке или к нескольким строкам diff. Комментарии прикрепляются
  к следующему сообщению, и агент получает каждый с файлом и номерами строк. Quote (Cmd+L) вставляет в сообщение ссылку
  на диапазон строк [16]. Комментарии к artifact-ам устроены так же, пример — implementation plan [17].
- Цена. Отдельной цены у walkthrough нет. На странице цен: для частных лиц $0 в месяц; Google AI Pro и Ultra — с общим
  пулом кредитов, цена на странице не показана; для бизнеса через Google Cloud — от $30 за место в месяц или
  pay-as-you-go [18].

### CodeRabbit

- Walkthrough comment: «Every time CodeRabbit reviews a pull request, it posts a walkthrough comment — a structured
  overview of the changes». Разделы: сводка изменённых файлов простыми словами, sequence diagrams, оценка сложности
  review от 1 до 5, Merge Risk, связанные issue, проверка linked issue (закрывает ли PR задачу и где пробелы), связанные
  PR, labels, reviewer-ы, стихотворение (выключено по умолчанию) [19].
- 2026-05-14 walkthrough стал делиться на слои: CodeRabbit «reverse engineers how the change was actually built». Про PR,
  написанные AI: автора спросить нельзя, поэтому «the walkthrough has to show the work instead» [25].
- Change Stack (preview, включён у всех) «turns a pull request into a structured, navigable artifact you can read,
  question, and act on in one place» [20]:
  - слои пронумерованы «in the order someone would explain the change»; контракт, его реализация и test-ы — один слой;
  - summary и findings привязаны к диапазонам строк, а не к файлам;
  - файл можно отметить прочитанным; на GitHub это ставит и галочку Viewed [22].
- Chat: «ask questions about the change in front of you — why a function was touched, what a finding is really
  claiming». Открывается из слоя, файла или диапазона строк. Thread закреплён за snapshot-ом review. Во время ответа
  виден trace: чтение репозитория, поиск по подключённым ресурсам, поиск в web [20][21]. Нужны план Team и write access
  к PR [21]. В самом PR вопрос задаётся комментарием с `@coderabbitai` [23].
- Цена. Free — только summary PR. Essentials — $24 за разработчика в месяц при оплате за год или $30 помесячно. Team —
  $48 или $60. Advanced — $72 или $90 [24].

### Spotify Xirp

- По документации это macOS-приложение в beta для Session Claude Code, Codex, Gemini CLI, Pi и Cursor в своих worktree.
  Spotify Portal подключать необязательно [27].
- С Portal transcript Session загружается в Workspace: «The uploaded transcript can include the conversation, tool
  calls, file changes, and agent reasoning available in the native transcript format. Authorized Workspace members can
  use it to understand the work, and future sessions can retrieve it through MCP». «Session upload is manual during the
  beta» [28]. Секреты перед загрузкой Xirp не вычищает [29].
- Сайт обещает больше: «Living documentation, built automatically… Xirp captures it, turns it into documentation that
  stays current» [26]. Документация такой генерации не описывает.
- Цен нет: beta по приглашению [26].

### Claude Code: output styles Explanatory и Learning

- Explanatory «adds short explanations of why it made the choices it made … in a block labeled `Insight`. The
  explanations aren't written into your files as comments». В блоке 2–3 пункта. Когда включать: «You're getting to know
  a codebase or want the reasoning along with the change» [30].
- Learning добавляет те же `Insight`. Там, где есть «a real design decision», агент оставляет `TODO(human)` и запрос
  «Learn by Doing» из трёх частей: Context, Your Task, Guidance. Потом ждёт, а после кода человека даёт один `Insight` о
  нём [30].
- Цена: «The built-in Explanatory and Learning styles produce longer responses than Default by design, which increases
  output tokens» [30].
- Оба style работают во время Session. Отдельного artifact-а после фичи они не создают.

### Также найдено

- Warp, skill `pr-walkthrough` (пост 2026-06-18): интерактивный сайт на D3 с четырьмя видами — обзор системы, поток
  данных, граф зависимостей кода и пошаговый walkthrough изменений, которые видит пользователь. Его можно запускать в CI
  на каждый PR [31]. Вопросов к строкам и проверки понимания в посте нет.
- Проверку понимания автора PR делают небольшие open-source инструменты:

| Инструмент | Что делает | Кого проверяет | Блокирует merge | Цена по README | Источник |
|---|---|---|---|---|---|
| Comprehension Gate (2026-03) | GitHub Action: Claude пишет 3 вопроса с вариантами ответа по diff; автор отвечает в комментарии PR; новый commit — новые вопросы | Автор PR | Да, если сделать status check обязательным | $0.05–0.10 за PR | [32] |
| PR Quiz (2025-06, 211 звёзд) | GitHub Action: quiz по PR после approve; порог — 100 изменённых строк | «you, the human reviewer», понимание кода AI-агента | Да: «block you from deploying code you don't understand» | Ключ OpenAI | [33] |
| PR Guard (2025-11) | 3 вопроса по diff: зачем изменение, что может сломаться, как проверено. Ответ свободным текстом, LLM оценивает | Автор PR | Да, пока ответы не убедят | ~$0.001–0.015 за PR | [35] |
| cognit (2026-05) | Локальный CLI: Claude читает PR и задаёт вопросы автору в браузере. Результат публикуется в PR только по кнопке | Автор PR | Нет: «Failing doesn't gate anything» | Сессия Claude Code (`claude login`) | [36] |
| quiz-gate (skill) | После реализации агентом — 3–6 вопросов: решения, сбои, путь данных, отклонения от плана, границы изменения. «Never ask trivia». Оценка pass/partial/fail; при ошибке указывает файл и строки | Пользователь, который вёл агента | Предлагает; человек может merge-ить с открытыми пробелами, они пишутся в «Quiz debt» | — | [37] |

- Обсуждение PR Quiz на Hacker News (2025-07-29) [34]. Главное возражение — ответы напишет та же модель: «Next week on
  HN... Show HN: A GitHub Action that uses AI to answer PR quizzes», «can i automate the process of answering this pr
  questions too?». Ещё совет: убрать action в том же PR. Другие участники заметили, что проблема одобрения непонятых PR
  касается и PR от людей.

### Где досье и README ошибались

1. Factory. Досье верно перечисляет виды PR [1]. README называет Walkthrough у Factory обзором изменений для reviewer-а —
   документация этого не говорит: содержимое, автор и время создания не описаны [1][2].
2. HumanLayer. Досье пересказывает документацию верно [3]. Но текущий текст skill-а describe-pr запрещает «walkthrough
   artifacts» и шага создания `pr-walkthrough.html` не содержит [4][8]. Что из двух верно сейчас, по открытому коду не
   видно.
3. Traycer. Досье верно. Уточнение: в walkthrough входит ещё «почему», агент предлагает его сам [9].
4. Google Antigravity. Досье: «Walkthrough — artifact с итогом изменений, выводом тестов, screenshots и записями».
   Документация называет только краткий итог изменений. Screenshots — по просьбе, записи — при `/plan`, вывод test-ов —
   только на картинке-примере [14]. README относит Antigravity к обзорам для reviewer-а, а документация адресует
   walkthrough самому пользователю, который не следил за агентом [14].
5. Spotify Xirp. README (строка 343): «Документация, собранная из сессий агентов». Так говорит сайт [26]. Документация
   описывает ручную загрузку transcript-а в beta [28].
6. README, раздел Code stories: «Поиск по досье нашёл только обзоры для reviewer-а. Story для самого ответственного
   человека … не нашлась». Уточнение: walkthrough для самого пользователя есть у Antigravity [14]; объяснение своих
   решений человеку — у Claude Code Explanatory [30]; проверку понимания автора делают open-source инструменты [32]–[37].
   Всю связку целиком — story, вопрос к строке с опорой на ход работы агента и проверку понимания — не делает ни один из
   проверенных продуктов.

## Исследования

Обозначения. d и g — размер эффекта в стандартных отклонениях: 0.2 — малый, 0.5 — средний, 0.8 — большой. p —
вероятность получить такую разницу случайно. «Только abstract» — полный текст был недоступен, проверено по аннотации.

### Когда код пишет AI, человек понимает его хуже

- **Anthropic: Shen и Tamkin, 2026** [38][39]. Рандомизированный эксперимент; preprint с предрегистрацией, без
  рецензии.
  - Дизайн. 52 разработчика, по 26 в группе; по посту — «mostly junior», в статье этого слова нет. Все больше года пишут
    на Python, но не знали Trio — библиотеку асинхронного ввода-вывода. Две функции за 35 минут. У группы с AI — chat на
    GPT-4o, который может сразу выдать готовый правильный код. Потом quiz без AI: 14 вопросов на 27 баллов — debugging,
    чтение кода, концепции.
  - Результат. 50% в группе с AI против 67% без AI (d=0.738, p=0.01). Группа с AI закончила примерно на 2 минуты
    быстрее, разница незначима. Больше всего отстал debugging, меньше всего — чтение кода.
  - Как пользовались AI — шесть групп поведения:
    - низкие баллы: всё отдать AI — 39% (n=4); начать с вопросов, потом отдать всё — 35% (n=4); просить AI чинить
      ошибки вместо того, чтобы разбираться, — 24% (n=4);
    - высокие баллы: сначала получить код, потом спросить, чтобы понять, — 86% (n=2); просить код вместе с объяснением —
      68% (n=3); задавать только концептуальные вопросы и чинить ошибки самому — 65% (n=7).
  - Оговорки авторов: выборка маленькая; понимание измерено сразу после задачи; связь поведения с баллами не доказана как
    причинная. Агентные продукты вроде Claude Code устроены иначе, и эффект у них авторы ждут сильнее. Разница средних в
    статье — 4.15 балла из 27, около 15 процентных пунктов по нашему пересчёту; в тексте — «17%».
- **Balepur et al., 2026** [40]. Preprint («In-progress Preprint»).
  - Дизайн. 54 студента, случайное распределение, задача — сайт. Одни работают с агентом Aider (GPT-4.1), который правит
    их код. Другие — с chatbot без доступа к коду: пишут сами или адаптируют фрагменты. Потом 12 вопросов на понимание
    своего кода и 20 минут на расширение кода без агента.
  - Результат. Агент помогает закончить задачу, но сильно ухудшает понимание (p<0.002, d>0.80). «I understand how my code
    works»: 3.3 у агента против 4.2 у chatbot по шкале от 1 до 5. Агента всё равно предпочитают: быстро и легко.
- **Martin-Lopez et al., IEEE TSE, 2026** [41]. 69 участников: 34 бакалавра, 13 магистрантов, 8 исследователей, 14
  профессиональных разработчиков. Каждый решал одну задачу с AI (ChatGPT или Copilot) и одну без, в случайном порядке.
  С AI задачи закрыты полнее (медиана 84 против 35). На вопросы о своём коде правильных ответов меньше: медиана 87.5%
  против 100% (odds ratio 0.58, p=0.016). Оговорки: без AI баллы близки к максимуму; на одних профессионалах и
  исследователях эффект незначим; авторы не уверены, что вывод переносится на агентов.
- **Borg et al., «Echoes of AI», 2025–2026** [42]. Registered report — принят к ICSME 2025 до получения результатов. 151
  участник, 95% — профессиональные разработчики. Во второй фазе 75 человек без AI развивали код, написанный в первой фазе
  с AI или без. Значимой разницы во времени и качестве нет. Мощности хватало только на крупный эффект, d около 0.66.
- **Nam et al., ICSE 2024** [43]. 32 участника; plugin GILT в VS Code (GPT-3.5) объясняет выделенный код; сравнение с
  web search. С GILT решено на 0.47 подзадачи больше. Разницы во времени и в quiz на понимание нет. Выиграли
  профессионалы (+0.57 подзадачи), студенты — нет.
- **Kazemitabaar et al., CHI 2023** [44]. 69 новичков 10–17 лет, три недели. С Codex задачи решались чаще (90.9% против
  79.0%) и правильнее (80.1% против 44.4%). Через неделю, без AI, разница незначима: 59.1% против 49.8% (p=0.262) и 47.5%
  против 34.8% (p=0.092).

### Человек плохо оценивает своё понимание

- **Prather et al., ICER 2024** [45]. 21 студент, задача на C++ за 35 минут с Copilot и ChatGPT; наблюдение, eye
  tracking, интервью. 10 не справились, и большинство из них считали, что понимают больше, чем на деле. Авторы называют
  это «illusion of competence». Это качественная оценка, а не измерение.
- **METR, 2025** [47]. 16 опытных разработчиков open source, 246 задач, AI разрешали случайно. С AI задачи заняли на 19%
  больше времени. До эксперимента разработчики ждали ускорения на 24%, после — оценили его в 20%. В 2026 METR пометил
  эти результаты как устаревшие и сменил дизайн; новые данные сам называет «only very weak evidence».
- **Kabir et al., CHI 2024** [48]. В 52% ответов ChatGPT на 517 вопросов Stack Overflow есть ошибки. 12 участников
  выбрали ответ ChatGPT в 34.82% случаев, и 77.27% выбранных были неверными. Ошибку не заметили в 39.34% случаев.
- **Bastani et al., PNAS 2025** [46]. Только abstract; математика, не код. Около 1000 старшеклассников. Обычный GPT поднял
  оценки на практике на 48%, а на экзамене без AI снизил на 17%. GPT-репетитор с ограничениями поднял практику на 127% и
  в основном снял вред.
- **Xiao et al., FSE 2024** [49]. Наблюдение, не эксперимент: 18,256 PR с описанием от Copilot for PRs. После
  выравнивания групп (propensity score weighting) review короче на 19.3 часа (медианы 12.17 против 16.09 часа), merge в
  1.57 раза вероятнее (95% CI 1.35–1.84). Авторы допускают неучтённые факторы. Это скорость review, а не понимание.

### Вопросы о собственном коде

- **Lehtinen, Lukkarinen, Haaranen, ITiCSE 2021** [50]. Онлайн-курс программирования на JavaScript, осень 2020; 125
  студентов дали согласие. После трёх упражнений студентам задавали вопросы об их же коде, который уже прошёл
  автоматические test-ы. Авторы называют их QLC — Questions about Learners' Code.
  - Около трети студентов ошиблись хотя бы в одном из трёх вопросов первого упражнения, в третьем — около половины. Доля
    ошибок по вопросам — от 5% (имена параметров) до 42% (что выполняется при загрузке страницы).
  - Среди тех, чей код прошёл test-ы, ответившие неверно потом хуже прошли курс. В первом упражнении медиана успеха 0.50
    против 0.98 (p<0.001), удержание в курсе 0.33 против 0.75 (p=0.008). Во втором упражнении разница незначима.
- **Lehtinen, Koutcheme, Hellas, ICSE-SEET 2024** [51]. 399 таких вопросов к 60 программам, которые написал GPT-3.5.
  GPT-3.5 ответил правильно на 69%, GPT-4 — на 88%.
- **Kazemitabaar et al., IUI 2025** [52]. Семь способов заставить новичка поработать с кодом от AI, прежде чем его
  использовать.
  - Исследование 1: 82 студента, 8 групп примерно по 10. Контроль — код и объяснение сразу. Итоговая задача без AI:
    контроль 31.5 балла, лучший способ — 58.3 (p=0.058). Это Lead-and-Reveal: вопросы шаг за шагом, строка кода
    открывается после верного ответа. После поправки на множественные сравнения значимых различий нет; авторы называют
    исследование недостаточно мощным. Время обучения выросло с 596 до 914–1055 секунд.
  - Ближе всего к проверке понимания способ Explain-before-Usage: 3–5 вопросов к частям кода, ответ оценивает LLM, три
    попытки. Участники ценили вовлечённость, но писали, что он «only managed to explore surface level knowledge». Авторы:
    «cognitively taxing and limited in promoting deeper problem-solving».
  - Исследование 2: 42 студента, каждый пробовал все варианты. Разница в переносе на новые задачи незначима: 64.3, 57.6 и
    55.0 балла (p=0.150). Время выросло в 1.8 и 2.7 раза. Значимая, хотя и слабая, связь самооценки с реальными баллами
    была только после Lead-and-Reveal (r=0.26, p=0.017).
  - Участник из контрольной группы: «without actually interacting much with the code the AI had written, I wasn't able to
    apply it».

### «Comprehension debt» и «cognitive debt»

- Самый ранний найденный источник термина — пост Jason Gorman, 2025-09-30: «When teams produce code faster than they can
  understand it, it creates what I've been calling "comprehension debt"» [53]. Данных в нём нет.
- Самая заметная формулировка — Addy Osmani, 2026-03-14: «the growing gap between how much code exists in your system and
  how much of it any human being genuinely understands» [54]. Своих данных нет; он ссылается на исследование Anthropic.
- Статья Ahmad (arXiv, 2026-04; по заголовку — сборник EASE 2026) называет автором термина Gorman. Данные качественные:
  621 дневниковая запись 207 студентов за 8 недель, без подсчётов [55].
- Margaret-Anne Storey (2026-02-09) пишет о «cognitive debt»: долг от скорости «lives in the brains of the developers».
  В статье на arXiv она предлагает модель из трёх долгов: технического, когнитивного и долга намерений. Это концепция без
  измерений [56].
- «Cognitive debt» у Kosmyna et al. (MIT, 2025, preprint без рецензии) — про эссе, не про код. 54 участника, три группы
  (ChatGPT, поиск, без инструментов), EEG. В первой сессии 83.3% группы ChatGPT (15 из 18) не смогли правильно
  процитировать своё же эссе, в двух других группах — 11.1% [57].
- Старое основание той же мысли — Peter Naur, «Programming as Theory Building» (1985): суть программы — теория в головах
  её программистов; «The death of a program happens when the programmer team possessing its theory is dissolved» [58].
- Итог: «comprehension debt» — название для наблюдения, а не измеренная величина. Количественно его подкрепляют только
  эксперименты из первого подраздела.

### Testing effect: вопрос после чтения

Testing effect — вспомнить материал в ответ на вопрос полезнее для памяти, чем перечитать его. Retrieval practice — учёба
через такие вопросы.

- **Roediger, Karpicke, 2006** [59]. 120 студентов читали научно-популярные тексты, потом либо перечитывали, либо писали
  всё, что помнят, без обратной связи. Через 5 минут перечитавшие помнили больше: 81% против 75%. Через 2 дня — меньше:
  54% против 68%; через неделю — 42% против 56%. Во втором эксперименте (180 студентов) через неделю: четыре чтения — 40%,
  три чтения и тест — 56%, одно чтение и три теста — 61%. Студенты ожидали обратного.
- **Rowland, 2014** [60], метаанализ: 159 эффектов из 61 исследования, g=0.50. С обратной связью g=0.73, без неё 0.39.
  Если без обратной связи на первый тест отвечали верно не больше чем в половине случаев, эффекта нет (g=0.03). При
  проверке через сутки и позже эффект выше (0.69), чем раньше (0.41). Сравнивали только тест и перечитывание;
  исследования в школьных классах исключены.
- **Adesope et al., 2017** [61]. Только abstract: тесты полезнее перечитывания и всех других сравнённых занятий. Числа
  метаанализа проверить не удалось; вторичные источники расходятся.
- **Pan, Rickard, 2018** [62], метаанализ переноса: 192 эффекта, 122 эксперимента, 10,382 участника.
  - Перенос на другие вопросы — d=0.40; на вопросы применения и вывода — 0.32.
  - Если ответы на тренировочный и итоговый вопрос совпадают, а тренировка требует развёрнутого ответа или даёт
    развёрнутую обратную связь, — 0.78. Если ни того ни другого — 0.21, а после поправки на публикационное смещение около
    нуля.
  - В 56 из 81 эксперимента перенос меньше прямого эффекта.
- **Karpicke, Blunt, 2011** [63]. 80 студентов. Через неделю после retrieval practice — 0.67, после concept map при
  открытом тексте — 0.45 (d=1.50). Во втором эксперименте 84% из 120 студентов лучше учились с retrieval practice, а 75%
  считали concept map не хуже.
- **В программировании** рандомизированного исследования с результатом «понимание кода» не найдено [64]. Квазиэксперимент
  на 684 студентах (частые вопросы без оценки на занятиях) дал +2.36 процентного пункта к оценке за курс. Вопросы-подсказки
  в MOOC по Haskell значимой разницы не дали. Оба — только abstract.

### Объяснения: когда помогают, когда вредят

- **Самообъяснение.** Метаанализ Bisra et al. (2018): 69 эффектов, 5917 участников, g=0.55. Против готового объяснения
  преподавателя преимущество меньше: g=0.35 (k=6). Авторы пишут, что значительная часть пользы доступна и из готовых
  объяснений [66]. Chi et al. (1989): сильные студенты сами объясняют себе шаги примеров, слабые объясняют мало и неточно
  оценивают своё понимание; только abstract [65].
- **Готовые объяснения** «often do not contribute to learning» — обзор Wittwer и Renkl (2008), только abstract [67].
- **Illusion of explanatory depth** (Rozenblit, Keil, 2002): люди думают, что понимают устройство вещей глубже, чем на
  деле. Иллюзия сильнее всего для знаний «как это работает» и проявляется, когда человек пытается объяснить. Только
  abstract [68].
- **Объяснения AI и согласие с ошибками.** Bansal et al. (CHI 2021, больше 1500 участников): объяснения повысили шанс,
  что человек примет рекомендацию AI, «regardless of its correctness». Ни один вид объяснений не дал точности выше, чем
  простой показ уверенности AI [69]. Объяснения там — подсветка слов и короткие аргументы в задачах классификации, не
  объяснения кода.
- **Cognitive forcing** (Buçinca et al., CSCW 2021, 199 участников) — приёмы, которые заставляют подумать самому: сначала
  решить, потом увидеть ответ AI; подождать 30 секунд; открыть ответ по клику. Они снизили согласие с неверным AI в одном
  из двух решений: 0.64 → 0.48 (p=0.003). В итоговом решении разницы нет: 0.30 и 0.26. Эти приёмы нравились меньше, а
  больше всего помогли тем, кто любит думать (высокий need for cognition) [70].
- **Объяснения снижают излишнее доверие, когда упрощают проверку** (Vasconcelos et al., CSCW 2023, 5 исследований, 731
  участник). В лёгких задачах эффекта нет, в трудных — есть. При наглядных объяснениях излишнее доверие в одном из
  исследований упало до 0% [71].
- **Объяснения кода от LLM** студенты оценивают как понятные. 954 студента оценили их понятнее и точнее студенческих: 4.12
  против 3.75 и 4.0 против 3.78 из 5 [73]. В учебнике по web-разработке 58 из 116 студентов открыли 176 объяснений;
  польза для учёбы — 3.8 из 5 [72]. Учебный результат в обоих исследованиях не измеряли.

## Что это значит для Code stories

Это чтение исследователя, а не факты из источников.

**Что стоит взять из продуктов.**

1. Шаги в порядке, в котором изменение объяснил бы человек, а не по файлам; контракт, его реализация и test-ы — один шаг
   (CodeRabbit Change Stack [20]). Начало — «что было не так», конец — «что сознательно не меняли» и «как проверено»
   (HumanLayer [5]); отдельно — «что ещё надо проверить» (Traycer [9]). Последние два прямо закрывают пункт Code story
   «риски и чего test-ы не покрывают».
2. Объяснение привязано к диапазону строк, ссылка ведёт на точную строку (Change Stack [20], HumanLayer [5]).
3. Вопрос задаётся из выделенного диапазона, а ответ показывает, на что опирался: код, ход работы агента или web (trace у
   Change Stack [21]). Thread закреплён за той версией кода, которую человек читал [21].
4. Отметка «прочитано» у шагов (Change Stack [22]) — простой сигнал для приёмки Ticket-а.
5. Адресат — тот, кто не следил за агентом (Antigravity [14]), а не reviewer чужого PR.
6. Рассуждения агента надо сохранять, пока Session идёт. Xirp отдаёт их, только если они есть в transcript-е [28]. В
   карте темы записано, что блоки thinking в transcript-ах worfy почти пустые ([map.md](map.md)).

**Проверка понимания: за.**

- Ответ на вопрос держит знание дольше, чем перечитывание: через неделю 56% против 42% [59], g=0.50 в метаанализе [60].
- Вопрос о собственном коде находит непонимание, которое прошедшие test-ы скрывают. Около трети студентов с рабочим
  кодом ошиблись в вопросах о нём, и это было связано с их результатом в курсе [50].
- Люди плохо оценивают своё понимание [45][47][68]. Вопросы дают внешний сигнал: только после Lead-and-Reveal самооценка
  была значимо, хотя и слабо, связана с реальными баллами [52].
- Лучшие баллы у Anthropic — у тех, кто после кода спрашивал, чтобы понять [38]. Code story с вопросами — тот же приём,
  только после фичи.

**Проверка понимания: против.**

- Перенос на новые задачи невелик: d=0.40, а без правильного дизайна вопросов — около нуля [62]. В эксперименте с
  вопросами к коду от AI прирост незначим, а время растёт в 1.8–2.7 раза [52].
- Вопросы к частям кода участники называли поверхностными и утомительными [52]. Приёмы, которые заставляют думать,
  нравятся меньше [70].
- Ответы может написать модель: GPT-4 ответила на 88% вопросов о коде [51]. На Hacker News это первое возражение [34].
- Все данные — о студентах и учебном материале. Нет исследования, где владелец production-кода проходит проверку после
  объяснения от агента.

**Вывод исследователя.** Проверку стоит оставить необязательной и короткой: 2–3 вопроса о решениях, сбоях, пути данных,
отклонениях от плана и границах изменения, без мелочей, которые находятся поиском за пять секунд (так устроен quiz-gate
[37]). После ответа — обратная связь со ссылкой на строки: с обратной связью эффект в метаанализе 0.73 против 0.39 без неё
[60]. Как gate для merge проверка слабая: её легко пройти с помощью модели, а пользу для владельца кода никто не измерял.
Объяснения в story должны удешевлять проверку — ссылка на строку, test, требование, — а не пересказывать код. Объяснение
без способа проверки повышает согласие с AI, даже когда тот неправ [69]. Излишнее доверие снижает то объяснение, которое
делает проверку дешевле [71]. А объяснение без вопросов даёт чувство понимания без понимания [52][68].

## Что неизвестно

- Что внутри вида Walkthrough у Factory. Документация и changelog молчат; нужен аккаунт и настоящий Workstream.
- Создаёт ли HumanLayer `pr-walkthrough.html` сейчас. Документация и текст skill-а расходятся, а история файла в
  публичном репозитории сжата в один commit от 2026-10-22.
- Можно ли в Antigravity задать вопрос к строке внутри самого walkthrough, а не в Review pane. Есть ли в walkthrough
  ссылки на требования.
- Насколько точно отвечает chat в CodeRabbit Change Stack и сколько стоит один ответ. Документация описывает только
  условия доступа.
- Делает ли Xirp документацию автоматически. Сайт и документация расходятся, beta закрыта.
- Сколько людей проходят необязательную проверку понимания и что она им даёт. У open-source инструментов есть только
  звёзды на GitHub, данных об использовании нет.
- Насколько лучше модели 2026 года отвечают на вопросы о коде. 88% — результат GPT-4 в работе 2024 года [51].
- Как объяснение от агента и проверка понимания действуют на опытного разработчика, который отвечает за production-код.
  Такого контролируемого исследования не найдено. Данные о testing effect получены в основном на учебных текстах и
  студентах.
- Числа метаанализа Adesope et al. (2017): полный текст недоступен. Chi et al. (1989), Wittwer и Renkl (2008), Rozenblit
  и Keil (2002), Bastani et al. (2025) проверены только по abstract. Страница Naur (1985) у издателя вернула 403; цитата —
  по неофициальной расшифровке.
- Devin, GitHub Copilot, Cursor, Kiro и другие продукты на walkthrough не проверялись.

## Источники

Все прочитаны 2026-11-15. Часть статей прочитали вспомогательные агенты этого research. Цифры из раздела «Коротко»
перепроверены по первоисточнику.

Продукты:

1. Factory, Workstream Pull Requests — <https://docs.factory.com/workstreams/pull-requests>
2. Factory, Full Changelog — <https://docs.factory.com/changelog/release-notes>; поиск слова walkthrough там и на
   <https://docs.factory.com/factory-app/overview>, <https://docs.factory.com/workstreams/overview>,
   <https://docs.factory.com/workstreams/quickstart>, <https://docs.factory.com/workstreams/steer>,
   <https://docs.factory.com/automations/code-review>, <https://docs.factory.com/automations/code-review-ci> — 0
   совпадений
3. HumanLayer, Skills and workflows reference — <https://docs.humanlayer.com/reference/skills-workflows>
4. HumanLayer, `describe-pr/SKILL.md` (ветка main на commit-е 8e1e3f159a78; файл не менялся с 2026-10-22) —
   <https://github.com/humanlayer/humanlayer/blob/main/apps/riptide-rpi-claude-plugin/skills/describe-pr/SKILL.md>
5. HumanLayer, пример walkthrough —
   <https://github.com/humanlayer/humanlayer/blob/main/apps/riptide-rpi-claude-plugin/skills/describe-pr/references/pr_walkthrough_example.html>
6. HumanLayer, шаблон описания PR —
   <https://github.com/humanlayer/humanlayer/blob/main/apps/riptide-rpi-claude-plugin/skills/describe-pr/references/pr_description_template.md>
7. HumanLayer, skill `review-artifact-comments` —
   <https://github.com/humanlayer/humanlayer/blob/main/apps/riptide-rpi-claude-plugin/skills/review-artifact-comments/SKILL.md>
8. HumanLayer, `describe-pr/SKILL.md` для pi и opencode —
   <https://github.com/humanlayer/humanlayer-pi/blob/main/skills/describe-pr/SKILL.md>,
   <https://github.com/humanlayer/humanlayer-opencode/blob/main/skills/describe-pr/SKILL.md>
9. Traycer, Artifact workflow — <https://docs.traycer.ai/concepts/artifact-workflow>
10. Traycer, Review agent changes — <https://docs.traycer.ai/guides/review-agent-changes>
11. Traycer, Comments — <https://docs.traycer.ai/panels/comments>
12. Traycer, Editing artifacts (Send to Chat) — <https://docs.traycer.ai/panels/artifacts/editing>
13. Traycer, Pricing — <https://docs.traycer.ai/account/pricing>
14. Google Antigravity, Walkthrough — <https://antigravity.google/docs/walkthrough>
15. Google Antigravity, Artifacts — <https://antigravity.google/docs/artifacts>
16. Google Antigravity, Review changes — <https://antigravity.google/docs/review-changes>
17. Google Antigravity, Plan (implementation plan) — <https://antigravity.google/docs/implementation-plan>
18. Google Antigravity, Pricing — <https://antigravity.google/pricing>
19. CodeRabbit, PR Walkthroughs — <https://docs.coderabbit.ai/pr-reviews/walkthroughs>
20. CodeRabbit, Change Stack — <https://docs.coderabbit.ai/change-stack>
21. CodeRabbit, Ask about the change — <https://docs.coderabbit.ai/change-stack/chat>
22. CodeRabbit, Navigate a change — <https://docs.coderabbit.ai/change-stack/navigation>
23. CodeRabbit, Interactive code review chat — <https://docs.coderabbit.ai/guide/chat>
24. CodeRabbit, Plans and pricing — <https://docs.coderabbit.ai/management/plans>
25. CodeRabbit blog, «Explainable PRs and smarter reviewer routing», 2026-05-14 —
    <https://coderabbit.ai/blog/explainable-prs-and-smarter-reviewer-routing>
26. Spotify Xirp, сайт — <https://xirp.spotify.com/>
27. Spotify Xirp, документация — <https://backstage.spotify.com/docs/xirp>
28. Spotify Xirp, Launch and share sessions — <https://backstage.spotify.com/docs/xirp/workspaces/launching-sessions>
29. Spotify Xirp, FAQ — <https://backstage.spotify.com/docs/xirp/faq>
30. Claude Code, Output styles — <https://code.claude.com/docs/en/output-styles>
31. Warp blog, «Generate interactive PR Walkthroughs with a single Skill», 2026-06-18 —
    <https://www.warp.dev/blog/generate-pr-walkthrough-skill>
32. Comprehension Gate — <https://github.com/islandbytesio/commit_comprehension_gate>
33. PR Quiz — <https://github.com/dkamm/pr-quiz>
34. Hacker News, «Show HN: A GitHub Action that quizzes you on a pull request», 2025-07-29 —
    <https://news.ycombinator.com/item?id=44726672>
35. PR Guard — <https://github.com/ym2132/pr_guard>
36. cognit — <https://github.com/jonasbrami/cognit>
37. quiz-gate — <https://github.com/nbbaier/agent-skills/blob/main/skills/quiz-gate/SKILL.md>

Исследования:

38. Anthropic, J. H. Shen, A. Tamkin, «How AI assistance impacts the formation of coding skills», 2026-01-29 —
    <https://www.anthropic.com/research/AI-assistance-coding-skills>
39. J. H. Shen, A. Tamkin, «How AI Impacts Skill Formation», arXiv:2601.20245, 2026 (полный текст) —
    <https://arxiv.org/abs/2601.20245>
40. N. Balepur et al., «(Im)Paired Programming: Coding Agents Improve Productivity but Harm Understanding»,
    arXiv:2607.26375, 2026 (полный текст) — <https://arxiv.org/abs/2607.26375>
41. Martin-Lopez et al., «More Code, Less Understanding? On the Impact of AI Assistants on Developers' Productivity and
    Code Ownership», IEEE TSE 52(7), 2026, doi:10.1109/TSE.2026.3679627 (PDF автора) —
    <https://sscalabrino.github.io/files/2026/TSE2026MoreCodeLess.pdf>
42. M. Borg et al., «Echoes of AI», arXiv:2507.00788 — <https://arxiv.org/abs/2507.00788>
43. D. Nam et al., «Using an LLM to Help With Code Understanding», ICSE 2024, doi:10.1145/3597503.3639187 —
    <https://arxiv.org/abs/2307.08177>
44. M. Kazemitabaar et al., «Studying the effect of AI Code Generators on Supporting Novice Learners in Introductory
    Programming», CHI 2023, doi:10.1145/3544548.3580919 — <https://arxiv.org/abs/2302.07427>
45. J. Prather et al., «The Widening Gap: The Benefits and Harms of Generative AI for Novice Programmers», ICER 2024,
    doi:10.1145/3632620.3671116 — <https://arxiv.org/abs/2405.17739>
46. H. Bastani et al., «Generative AI without guardrails can harm learning», PNAS 122(26), 2025 (только abstract) —
    <https://doi.org/10.1073/pnas.2422633122>
47. METR, «Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity», arXiv:2507.09089 —
    <https://arxiv.org/abs/2507.09089>; обновление 2026-02-24 — <https://metr.org/blog/2026-02-24-uplift-update/>
48. S. Kabir et al., «Is Stack Overflow Obsolete? …», CHI 2024, doi:10.1145/3613904.3642596 —
    <https://arxiv.org/abs/2308.02312>
49. T. Xiao et al., «Generative AI for Pull Request Descriptions: Adoption, Impact, and Developer Interventions», FSE
    2024, doi:10.1145/3643773 (полный текст) — <https://arxiv.org/abs/2402.08967>
50. T. Lehtinen, A. Lukkarinen, L. Haaranen, «Students Struggle to Explain Their Own Program Code», ITiCSE 2021 (полный
    текст) — <https://arxiv.org/abs/2104.06710>
51. T. Lehtinen, C. Koutcheme, A. Hellas, «Let's Ask AI About Their Programs: Exploring ChatGPT's Answers To Program
    Comprehension Questions», ICSE-SEET 2024 (полный текст) — <https://arxiv.org/abs/2404.11734>
52. M. Kazemitabaar et al., «Exploring the Design Space of Cognitive Engagement Techniques with AI-Generated Code for
    Enhanced Learning», IUI 2025, doi:10.1145/3708359.3712104 (полный текст arXiv v1) — <https://arxiv.org/abs/2410.08922>
53. J. Gorman, «Comprehension Debt: The Ticking Time Bomb of LLM-Generated Code», 2025-09-30 —
    <https://codemanship.wordpress.com/2025/09/30/comprehension-debt-the-ticking-time-bomb-of-llm-generated-code/>
54. A. Osmani, «Comprehension Debt - the hidden cost of AI generated code», 2026-03-14 —
    <https://addyosmani.com/blog/comprehension-debt/>
55. M. O. Ahmad, «Comprehension Debt in GenAI-Assisted Software Engineering Projects», arXiv:2604.13277 —
    <https://arxiv.org/abs/2604.13277>
56. M.-A. Storey, «How Generative and Agentic AI Shift Concern from Technical Debt to Cognitive Debt», 2026-02-09 —
    <https://margaretstorey.com/blog/2026/02/09/cognitive-debt/>; «From Technical Debt to Cognitive and Intent Debt»,
    arXiv:2603.22106 — <https://arxiv.org/abs/2603.22106>
57. N. Kosmyna et al., «Your Brain on ChatGPT: Accumulation of Cognitive Debt when Using an AI Assistant for Essay
    Writing Task», arXiv:2506.08872 — <https://arxiv.org/abs/2506.08872>
58. P. Naur, «Programming as theory building», Microprocessing and Microprogramming 15(5), 1985 —
    <https://doi.org/10.1016/0165-6074(85)90032-8> (страница издателя вернула 403; цитата по неофициальной расшифровке
    <https://gist.github.com/dpritchett/fd7115b6f556e40103ef>)
59. H. L. Roediger, J. D. Karpicke, «Test-enhanced learning», Psychological Science 17(3), 2006 (полный текст) —
    <https://doi.org/10.1111/j.1467-9280.2006.01693.x>
60. C. A. Rowland, «The effect of testing versus restudy on retention», Psychological Bulletin 140(6), 2014 (полный
    текст) — <https://doi.org/10.1037/a0037559>
61. O. O. Adesope, D. A. Trevisan, N. Sundararajan, «Rethinking the use of tests», Review of Educational Research 87(3),
    2017 (только abstract) — <https://doi.org/10.3102/0034654316689306>, <https://eric.ed.gov/?id=EJ1141817>
62. S. C. Pan, T. C. Rickard, «Transfer of test-enhanced learning», Psychological Bulletin 144(7), 2018 (полный текст) —
    <https://doi.org/10.1037/bul0000151>, <https://sc-pan.github.io/pdf/PR_2018.pdf>
63. J. D. Karpicke, J. R. Blunt, «Retrieval practice produces more learning than elaborative studying with concept
    mapping», Science 331(6018), 2011 (полный текст) — <https://doi.org/10.1126/science.1199327>
64. I. YeckehZaare et al., SIGCSE 2022 (только abstract) — <https://doi.org/10.1145/3478431.3499408>; D. Davis et al.,
    EC-TEL 2016 (только abstract) — <https://doi.org/10.1007/978-3-319-45153-4_5>
65. M. T. H. Chi et al., «Self-explanations», Cognitive Science 13(2), 1989 (только abstract) —
    <https://doi.org/10.1207/s15516709cog1302_1>
66. K. Bisra et al., «Inducing self-explanation: A meta-analysis», Educational Psychology Review 30(3), 2018 (полный
    текст) — <https://doi.org/10.1007/s10648-018-9434-x>
67. J. Wittwer, A. Renkl, «Why instructional explanations often do not work», Educational Psychologist 43(1), 2008
    (только abstract) — <https://doi.org/10.1080/00461520701756420>
68. L. Rozenblit, F. Keil, «The misunderstood limits of folk science: an illusion of explanatory depth», Cognitive Science
    26(5), 2002 (только abstract) — <https://doi.org/10.1207/s15516709cog2605_1>
69. G. Bansal et al., «Does the Whole Exceed its Parts?», CHI 2021, doi:10.1145/3411764.3445717 —
    <https://arxiv.org/abs/2006.14779>
70. Z. Buçinca, M. B. Malaya, K. Z. Gajos, «To Trust or to Think», CSCW 2021, doi:10.1145/3449287 —
    <https://arxiv.org/abs/2102.09692>
71. H. Vasconcelos et al., «Explanations Can Reduce Overreliance on AI Systems During Decision-Making», CSCW 2023,
    doi:10.1145/3579605 — <https://arxiv.org/abs/2212.06823>
72. S. MacNeil et al., «Experiences from Using Code Explanations Generated by Large Language Models in a Web Software
    Development E-Book», SIGCSE 2023, doi:10.1145/3545945.3569785 — <https://arxiv.org/abs/2211.02265>
73. J. Leinonen et al., «Comparing Code Explanations Created by Students and Large Language Models», ITiCSE 2023,
    doi:10.1145/3587102.3588785 — <https://arxiv.org/abs/2304.03938>
