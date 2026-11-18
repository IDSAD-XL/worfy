# gh answers of worfy-auth-check ticket 01

Copies of `.scratch/worfy-auth-check/fixtures/local/`: what gh 2.97 printed on a Mac, three files per case —
`<case>.stdout`, `<case>.stderr`, `<case>.exit`. Scrubbed: the logins are `alice`, `bob` and `carol`, every token
is masked (`gho_****…`), the request and client ids are zeros, no organization is named.
`test/unit/auth-diagnosis.test.ts` and `test/unit/gh-auth-text.test.ts` read them.

| Case | What ran |
|---|---|
| `api-401` | `gh api -i repos/…` with a token GitHub never issued |
| `api-404` | `gh api -i repos/<no such repo>` with a working token |
| `api-jq-401` | `gh api user --jq .login` with a token GitHub never issued |
| `api-no-auth` | `gh api` with no token and no login (exit 4) |
| `auth-status-keyring` | `gh auth status`, two stored accounts, no `GH_TOKEN` |
| `auth-status-gh-token-valid` | the same with a working `GH_TOKEN` |
| `auth-status-gh-token-invalid` | the same with a `GH_TOKEN` that does not work (stderr, exit 1) |
| `auth-status-gh-token-invalid-no-login` | a `GH_TOKEN` that does not work and no stored account |
| `auth-status-no-login` | no token and no stored account |
| `auth-token-user-no-login` | `gh auth token -u carol`, an account gh has no login for |
