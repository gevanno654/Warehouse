# Backend Test Results

Verified evidence for the Warehouse Receiving System technical assessment.
Browser verification was a manual acceptance test, not an automated E2E suite.

| Check | Command | Result | Log |
|---|---|---|---|
| Backend automated tests | `npm test` (`vitest run`) | 207 passed, 0 failed (12 files) | `backend-test.log` |
| Backend lint | `npm run lint` (`eslint .`) | passed, exit 0 | `backend-lint.log` |
| Backend typecheck | `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) | passed, exit 0 | `backend-typecheck.log` |

Test isolation: ephemeral PostgreSQL `warehouse_test` on `127.0.0.1:5433`
(container `warehouse-test-pg`, removed after the run). Production database
`warehouse_production` was never touched by the test run.

Log headers record date (UTC), commit hash, Node.js version, npm version,
exact command, and exit code. See the referenced log files for full output.
