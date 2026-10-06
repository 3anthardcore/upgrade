# Root acceptance of current-runtime restore V2

Frozen runner `83439149bf74bd1c9563cea166d657636ca38658f88dd550b95b010aa0a17d62`; author tests `ca1d38a303d584c9e187f6292816a933fb732f4ce32c80c2866d649bb1b7f70f`. Author report `5989bbeb2c2233272a523254910221bfed17987398663af3b74427be90907624`. V1 rejection remains in `current-recovery-independent-20260930.md` and the Store's failed attempt.

Root independently inspected the narrow delta: all raw Set-Cookie headers are inspected before any dictionary conversion; zero or exactly one bounded PHPSESSID with the explicitly supported Path=/, HttpOnly, SameSite=Lax attributes is ignored. Unknown/own/duplicate/combined/malformed cookies fail. No cookie jar, vendor replay or token logging was added. Exact existing Upgrade session, body hashes and GET-only behavior remain. The caller-supplied pinned own cookie is unchanged.

Root copied the independent V1 Python suite to its own ignored evidence directory and replaced only the expected runner SHA. Its eleven assertion bodies are unchanged. Actual Windows invocation:

```text
python -I var/evidence/continuation-20260930/current-recovery-independent-v2.py scripts/recovery-current-runtime.py
```

**11/11 PASS**, 2.676 seconds, log `current-recovery-independent-v2.log`. These cover actual local files/archives/HTTP/UNKNOWN subprocess interruption, not native Docker/SQL. Author separately reports45/45 Windows+WSL and11/11 independent repeats; those counts are attributed, not extra root executions. Root's full repository TypeScript check passed after its unrelated test typing fix.

Root also ran the same pinned suite under `wsl -u root python3 -I`: **11/11 PASS**, 1.289 seconds, log `current-recovery-independent-v2-wsl.log`; POSIX ownership/metadata checks were exercised. **ACCEPT the code for a separately reviewed native plan.**

Native execution is still **NOT_RUN** at this code-acceptance checkpoint. The accepted native backup has completed with source runtime restored, and source facts/retained receipt were separately rechecked. Execute only a new exact reviewed plan, destination, Docker project/network and baseline. Source-only no-stop/no-SQL, unchanged original helpers, archived-journal audit-only and no UNKNOWN replay remain requirements. This acceptance does not establish native recovery or full readiness.
