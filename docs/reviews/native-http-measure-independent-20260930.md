# Independent review: bounded HTTP measurement, 2026-09-30

Verdict: **ACCEPT V2 for the scoped, operator-authorized GET-only measurement**. This is an independent source/local-test review; no target, source site, CMS, database or Store was accessed by the reviewer. Native execution remains the root operator's separate step.

Frozen files reviewed:

- `scripts/measure-demo-http.py`: SHA-256 `9de6d2bc677d487e2912698b20c61a1238d5dbbc04f473bd463d72186326f6c5`.
- `tests/unit/demo-http-measurement.test.ts`: SHA-256 `90cb49830d9bcac6da8ef5ceba4d33b9367695fbaa5a4a06b2def521eb5ac3fc`.

## Findings and resolution

The first source draft used urllib's socket inactivity timeout while calling `response.read()`. A peer sending a slow continuous response could outlast the advertised timeout; input files were also read completely before checking their size. This draft was **REJECTED** for bounded execution. It was not accepted by this review, and its source bytes were not separately frozen by the reviewer.

V2 uses bounded input reads (plan 2 MB, password 4 KiB), an absolute per-call join limit, a 600-second run deadline and a shared abort event. The added real localhost slow-body test sends one byte every 20 ms; a 100 ms absolute deadline returns before 800 ms, sets the abort flag and rejects a subsequent request before its callback executes. This closes the reported issue for the standalone measurement process. An already admitted daemon GET is not synchronously canceled by the join timeout: it may complete during failure reporting and is terminated when the standalone process exits. No instantaneous packet-stop or zero-in-flight guarantee is claimed. Calling `main()` inside a persistent service would change that lifetime boundary and is outside this acceptance.

## Checked behavior

- The externally supplied SHA binds the plan bytes; the plan enumerates the authorized HTTPS origin and exact route strings. Relative protocol URLs, credentials in origin, fragments, header controls, foreign absolute URLs and invalid scope are rejected. HTTPS certificate verification is not disabled; environment proxy use is disabled. Origin-to-target ownership and package-to-deployment identity remain trusted operator attestations, not inferred from a boolean in a receipt.
- Only `GET` is constructed. `NoRedirect` never follows Location to either an own or foreign endpoint. No forms, requests with bodies, source discovery, target writes, CMS calls or database commands are implemented. Query order/repetition is retained in the original route string.
- Routes are at most 10,000; concurrency at most 10, rounds at most 10, performance paths at most 8, socket timeout at most 30 seconds. Maximum configured call count is `routes + clients*(1 + rounds*paths) + 2` (10,812 at all maxima). The root's proposed 389 routes / 10 clients / 12 samples per client results in 521 admitted calls if none fail early.
- Password, Authorization and session-cookie bytes remain in memory. Receipt rows contain route, status, elapsed time, byte count, body hash and fixed header-policy booleans; raw headers, cookies, body text and credentials are not serialized. The output is a new private directory. The plan itself is persisted; operators must not put secrets in route query strings.
- Required privacy headers and restrictive CSP directives are explicitly checked. Redirects, errors and incomplete policies cannot produce `privacy_and_http_pass=true`. The unauthenticated request must return 401.
- Timings describe this one warm application HTTP/no-store observation. No Lighthouse, load-capacity certification, exact cache-hit conclusion, source completeness, native editing, browser scenarios, recovery or readiness is implied. The package manifest pin in the receipt identifies the operator's plan; it does not independently verify delivered file membership.

## Independent commands and results

```powershell
node --disable-warning=ExperimentalWarning --test tests/unit/demo-http-measurement.test.ts
Get-FileHash scripts/measure-demo-http.py,tests/unit/demo-http-measurement.test.ts -Algorithm SHA256
```

Final run: outer Node test **1/1 PASS, 0 SKIP**, executing **12 actual Python unittest cases** (the harness asserts `Ran 12 tests`), including the real localhost trickle-response test. No native target test was run.

Review checks:

```json
[
  {"id":"measurement-no-source-or-write","status":"PASS","details":"Pinned HTTPS origin and exact plan paths; GET-only implementation; redirects disabled; no form/CMS/database/source-discovery code. Caller authorizes target ownership."},
  {"id":"measurement-exact-boundaries-and-claims","status":"PASS","details":"12 Python cases pass including actual slow-response absolute deadline; finite concurrency/count/body/input bounds; explicit daemon lifetime limit; no Lighthouse/cache/readiness promotion."}
]
```

Next: the root operator may execute the pinned plan on the separately authorized demo, keeping that native receipt separate from this local review.
