# Root acceptance of admission V2

Frozen Runtime `4b6ccd70cd6f5b716720492dbe4517781421d4959de256c548ec8cff5d6fed26`; Web `2dd119124a437e4ce5bddf787930c8be632b86b5aa83fdcc2fb7b8af3834521c`; Engine `d90d6ecc8858ca0305064304227b345e70479b3dd38a4b1afa00e6ca362eb905`; author test `4c340a62d9ec12cc55d575a749efccd53f90b2933fa34c4743ac62b36dfd2996`. Author report `0969e4c5c1ed44a0a4882040805a8fe1d1678f80102c75192fac2dd6e30f9a71`.

Root reviewed V2's bounded change under the existing admission lock: reserve two new file slots for a new session's lock plus pending/committed JSON; reserve one pending slot for an existing write. A read attempt requiring creation remains conservatively new even if a stale cookie's file reappears. Read-only returns still bypass the global gate; POST/replay remains gated. No eviction, source-fact, session-format, snapshot-loader or FPM change.

Root independently ran the unchanged review probes and expanded author admission cases with real PHP8.3.35/flock:

```text
node --disable-warning=ExperimentalWarning --test var/evidence/demo-admission-independent-20260930/probes.test.ts tests/integration/demo-runtime-admission.test.ts
```

**31/31 PASS, 0 SKIP**, 26.389 seconds. Log `var/evidence/continuation-20260930/admission-root-v2.log`. The original 4999→5001 witness now passes without changing its assertion; boundary/parallel admissions, actual pending-file rename failure, retained receipt, exact concurrent replay, corruption, missing/reappearing state and unrelated-read progress pass. The author's broader86/86 result includes prior Engine/Web/Snapshot coverage and is not counted again as a root run. TypeScript PASS.

**ACCEPT code**, native deployment/performance **NOT_RUN**. V1 REJECT and raw failing evidence stay retained. This is not a native p95 claim or readiness promotion.
