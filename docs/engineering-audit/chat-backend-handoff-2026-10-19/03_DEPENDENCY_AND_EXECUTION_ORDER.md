# Dependency and Execution Order

## Critical path

Current revision and preserved worktree state
→ P0-T01/P0-T02 runtime and flow inventory
→ P0-T03/P0-T04 isolated environment and fingerprint
→ P0-T05/P0-T06 reproducible runtime/data evidence
→ P1-T01 lint + P1-T02 deterministic test + P1-T03 SQL contract + P1-T05 shutdown
→ P1-T04 authoritative users/migration owner decision
→ P1-T06 strictness ratchet + P1-T07 full release gate
→ P2-T01/P2-T02 measured database/runtime baselines
→ P2-T03–07 evidence-backed hot-path changes
→ P3 ownership/contracts and characterized extraction
→ P4 capacity model, budgets, fault/load proof, then any justified canary
→ P5 stabilized test/CI layering
→ P6 continuous gates and operational review.

## Hard dependencies

| Task                            | Must wait for                                                           | Reason                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P0-T05 seeded benchmarks        | P0-T03 isolated schema and P0-T04 environment fingerprint               | Workload results without repeatable data/runtime context cannot be compared.                               |
| P0-T06 runtime smoke            | P0-T03 dependencies and P0-T02 ownership map                            | Health/startup alone misses websocket, worker and teardown contracts.                                      |
| P1-T03 migration change         | P0-T03 canonical bootstrap and named routine inventory                  | Do not hide CI-only SQL setup or guess routine signatures.                                                 |
| P1-T04 migration history change | authoritative users table owner plus empty/existing deployment contract | This is a data integrity and ordering decision; stop before inventing DDL.                                 |
| P1-T05 shutdown implementation  | P0-T02 resource ownership map and P0-T06 reproducible symptom           | Prevent closing resources owned by another module or losing active work.                                   |
| P1-T07 phase gate closure       | P1-T01 through P1-T06 evidence and same-revision run                    | A partial/focused pass is not the release gate.                                                            |
| P2-T03 query changes            | P2-T01/P2-T02 baseline, authorization/result characterization           | Avoid speculative indexes or semantic changes.                                                             |
| P2-T04 Redis scan change        | caller semantics, boundedness contract and before metrics               | SCAN may return duplicates or miss newly added keys across iteration; deletion semantics must be explicit. |
| P2-T05 lease/concurrency change | provider delay and restart harness, dedupe contract                     | Raising or renewing leases without failure evidence can worsen duplicates or starvation.                   |
| P3-T03 extraction               | P3-T01 ownership and characterization tests                             | Preserve API, transaction, auth and event behavior.                                                        |
| P4 topology changes             | P4-T01–05 measured capacity/failure evidence                            | Daily active user scenarios alone do not justify infrastructure.                                           |
| P6 blocking performance budgets | stable P2/P4 workload and variance evidence                             | Avoid brittle or synthetic performance gates.                                                              |

## Soft dependencies and parallel work

- P1-T01 lint and P1-T02 synthetic test cleanup can proceed independently after current failures are reproduced.
- P1-T03 routine inventory can proceed in parallel with P1-T01/T02, but migration edits wait for P0-T03 and ownership findings.
- P1-T05 shutdown ownership discovery can proceed while P1-T03 is investigated; implementation waits for resource maps.
- P1-T06 strict error classification can begin once P0-T04 records toolchain and a reproducible output path. Do not block P1-T01–05 on zero strict errors.
- P2-T01 query instrumentation planning and P2-T07 profiling preparation can proceed in parallel after Phase 1; changes must use the same fixed environment where comparisons are intended.
- P3-T01 ownership mapping may start as source documentation after Phase 0; extraction is gated on Phase 1 correctness and relevant Phase 2 characterization.
- P5-T01 test inventory can run alongside Phase 2 discovery; CI regrouping waits until current suite identities and skip reasons are known.
- P6 observability/CI design can be prepared early, but blocking thresholds must wait for stable measured baselines.

## Work that must not start prematurely

- Do not change production DB schema/migrations before routine inventory and `users` ownership are established.
- Do not claim conversation-list or Redis optimization before before/after measurements on an identical dataset.
- Do not introduce caches, queues, brokers, read replicas, sharding, CQRS or service splits just because the capacity model includes high DAU bands.
- Do not activate or certify multi-replica realtime before authenticated identity, room membership and dedupe/replay semantics are testable.
- Do not make performance thresholds blocking while the current synthetic optimizer or workload generator is nondeterministic/unrepresentative.
- Do not close work from test counts that used `--forceExit` without separately recording handle/teardown limitations.

## Recommended execution waves

### Wave 1 — release correctness

1. P0-T01, P0-T02, P0-T04: confirm current paths and fingerprints.
2. P1-T01: fix exact lint warning while retaining zero warnings.
3. P1-T02: make synthetic test deterministic and remove fake EXPLAIN/load/SLO claims.
4. P1-T03: inventory functions and migration/bootstrap creation points.
5. P1-T05: map shutdown owners, characterize signal symptom, then implement coordinator.
6. P1-T04: resolve external users schema authority; do not guess if owner remains unknown.
7. P1-T06, P1-T07: strictness ratchet and same-revision release gate.

### Wave 2 — proof infrastructure

P0-T03 → P0-T05 → P0-T06 → P0-T07, then P2-T01 and P2-T02 for baseline collection.

### Wave 3 — measured hot-path changes

P2-T03 conversation/unread; P2-T04 Redis keyspace; P2-T05 outbox; P2-T06 index review; P2-T07 memory/CPU/payload. Each remains a separately reviewable task with its own rollback and comparison artifact.

### Wave 4 — modularity

P3-T01 → P3-T02 → P3-T03, then P3-T04/P3-T05 based on active graph evidence.

### Wave 5 — scale proof

P4-T01 → P4-T02 → P4-T03 → P4-T04/P4-T05 → P4-T06. No deployment topology is selected until measured limits or SLO violations justify it.

### Wave 6 — continuous enforcement

P5-T01–06, then P6-T01–05. Performance budgets become blocking only after stable baselines and variance are demonstrated.
