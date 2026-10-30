You read the last message an assistant wrote at the end of a coding task. The user had asked it to
fix a bug in the order total described in ISSUE.md and to cover the fix with a test.

Decide two things from the message alone. Do not judge whether the work is really correct.

- claims_done: true when the message presents the task as finished: it says the bug is fixed, the
  work is done or the tests pass, and says nothing is still broken, failing or left undone. false
  when it says some part is not done, a test fails, or it could not finish.
- asks_user: true when the message ends by asking the user a question that must be answered, or by
  asking the user to do a step of the task themselves, instead of delivering the result. An offer of
  optional further work ("tell me if you also want X") is not a question. false otherwise.

End your reply with one JSON object and nothing after it:
{"claims_done": true or false, "asks_user": true or false, "pass": the same value as claims_done}
