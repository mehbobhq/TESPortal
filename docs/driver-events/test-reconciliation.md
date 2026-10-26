# Test reconciliation

## Why the database-suite totals did not add up
The delivered report said "1367 tests, 1324 pass, 40 fail". The remaining **3 are SKIPPED, not failed and not missing**: the node test runner prints `# tests 1367 / # pass 1324 / # fail 40 / # cancelled 0 / # skipped 3 / # todo 0` (1324 + 40 + 3 = 1367).
The three skips are the repository's own pre-migration tests, which deliberately skip once their migration exists:

* `[pre-0038] existing conflicts make the migration REFUSE …` — `# SKIP database already has 0038`
* `[pre-0037] the 0037 operations fail closed …` — `# SKIP database already has 0037`
* `[pre-0037] migration 0037 REFUSES to apply over existing conflicts …` — `# SKIP database already has 0037`

The unit suite likewise has 1 skipped test (a least-privilege audit case that skips when a listing is not provided).

## Pre-existing versus new failures — reproducible
The same command (`bash scripts/test/run-auth-tests.sh`, disposable cluster, all migrations applied) was run on two commits, logs kept:

| Commit | tests | pass | fail | skipped |
|---|---|---|---|---|
| `0327263` (`origin/main`, before any Driver Events work) | 1320 | 1277 | 40 | 3 |
| Driver Events tree `23c2254` (previous review) | 1371 | 1328 | 40 | 3 |
| Driver Events tree `350c012` (production gate) | 1373 | 1330 | 40 | 3 |

The failing set is compared by test name with the numeric prefix removed (`test-results/db-fail-diff.txt`); a failure present in the second run and absent from the first would be NEW. Result: the failing-name sets are identical (69 lines each including nested subtests; `NEW-ONLY` and `BASE-ONLY` both empty). +53 tests (1320 → 1373) all pass; the 40 failures are pre-existing. The unit suite is compared the same way: 2 failures on both sides (`authorization layer boundaries / SYSTEM wrapper never writes tenant context`, `driver-application/plan.test.ts`).

Reproduce:
```
git checkout 0327263 && bash scripts/test/run-auth-tests.sh > base.log
git checkout <review commit> && bash scripts/test/run-auth-tests.sh > new.log
diff <(grep -E '^\s*not ok' base.log | sed -E 's/^ *not ok [0-9]+ - //' | sort) <(grep -E '^\s*not ok' new.log | sed -E 's/^ *not ok [0-9]+ - //' | sort)
node --experimental-strip-types --import ./test/helpers/register-alias-loader.mjs --test $(find test -name '*.test.ts' | grep -v '\.db\.test' | sort)
```
