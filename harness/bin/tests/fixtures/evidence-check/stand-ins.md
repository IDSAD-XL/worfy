# Stand-in forms the privacy check lets through

Read by harness/bin/tests/evidence-check.test.sh: `evidence-check` on this file exits 0. Each line is a
form a ticket may use instead of a real value (harness/lib/privacy.cjs, "Stand-ins").

- Home folders: /Users/test/project, /Users/someone/x, /home/user/x, /home/you/x, /home/runner/work,
  C:\Users\runneradmin\work, C:\Users\RUNNER~1\AppData\Local\Temp, C:/Users/Shared/x, /Users/Shared/x,
  /Users/<name>/project, C:\Users\<name>\AppData, /c/Users/<name>/x, /Users/$USER/x, C:\Users\%USERNAME%\x, C:\Users\…
- Home folders without a name: ~/.claude/worfy-harness, %USERPROFILE%\.claude, %LOCALAPPDATA%\worfy-stable, <home>/x
- Hosts: localhost, http://localhost:5173, 127.0.0.1, <host>.local, <host>.ts.net, .env.local, ~/.local/share,
  .claude/settings.local.json, https://example.com/home/page/, pc.example.ts.net, <tmp>/home/.gitconfig
- Addresses: 100.63.255.255 and 100.128.0.1 (outside 100.64.0.0/10), 192.168.1.10
- UUIDs: 00000000-0000-0000-0000-000000000000, 44444444-4444-4444-8444-444444444444, <uuid>
- Email: noreply@anthropic.com, 12345+jdoe@users.noreply.github.com, git@github.com, jdoe@example.com,
  jdoe@mail.example.org, react@18.3.1, icon_16x16@2x.png
- Tokens: ghp_…, github_pat_…, sk-ant-…, sk-…, AKIA…, xoxb-…, Bearer <token>, -----BEGIN PUBLIC KEY-----,
  feature/sk-learn-upgrade-for-models
