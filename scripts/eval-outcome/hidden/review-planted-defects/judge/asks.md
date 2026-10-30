You read the last message an assistant wrote at the end of a task. The user had asked it to review a
branch and write the findings to review.md.

Decide from the message alone:

- asks_user: true when the message ends by asking the user a question that must be answered, or by
  asking the user to do a step of the task themselves, instead of delivering the result. An offer of
  optional further work ("tell me if you want me to fix these") is not a question. false otherwise.

End your reply with one JSON object and nothing after it:
{"asks_user": true or false, "pass": the opposite of asks_user}
