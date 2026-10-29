# Testing Strategy and Test Cases

## 1. Purpose

This document defines the testing strategy and test cases for the Warehouse Receiving System.

Testing verifies that the application follows the approved requirements, API contract, database design, and business rules documented in:

- `docs/prd.md`
- `docs/technical-spec.md`
- `docs/erd.mmd`
- `docs/openapi.yaml`
- `docs/data-flow.mmd`
- `AGENTS.md`

The primary testing objective is to ensure that receiving operations cannot produce incorrect inventory quantities, duplicate stock updates, or inconsistent receiving document statuses.

## 2. Testing Scope

### In scope

- Authentication and authorization.
- Product management.
- Receiving document creation and retrieval.
- Partial and complete receipt processing.
- Inventory quantity updates.
- Inventory transaction history.
- Idempotency and duplicate request handling.
- Database transaction rollback.
- Concurrent receipt processing.
- API contract validation.
- Application health and readiness.
- Database migrations and Docker-based startup.

### Out of scope

- Outbound inventory operations.
- Multi-warehouse inventory management.
- Supplier purchase order integration.
- Receipt cancellation and reversal workflows.
- Performance guarantees beyond the approved requirements.

These exclusions must remain in effect unless the product requirements are explicitly updated.

## 3. Testing Tools

| Tool | Purpose |
|---|---|
| Vitest | Unit and integration test runner |
| Supertest | HTTP endpoint testing |
| Prisma | Database access and migration testing |
| PostgreSQL | Test database and transaction verification |
| Docker Compose | Reproducible local test environment |
| OpenAPI validation tool | API specification syntax and contract checks |

Use the versions and scripts configured in the repository. Do not assume a test command exists until it has been added to and verified against the project configuration.

## 4. Test Levels

### 4.1 Unit testing

Test individual functions and business rules independently, including:

- Receipt quantity validation.
- Remaining quantity calculation.
- Receiving document status calculation.
- Request payload validation.
- Role and permission checks.
- Error mapping.

Unit tests must be deterministic and should not require a running production service.

### 4.2 Integration testing

Test interactions between the Express API, business logic, Prisma, and PostgreSQL.

Integration tests must verify actual database changes, including:

- Receiving item quantities.
- Inventory quantities.
- Receipt operation records.
- Inventory transaction records.
- Receiving document status.
- Rollback behavior after failures.

### 4.3 API testing

Verify HTTP status codes, request validation, authentication, authorization, response bodies, and error formats against `docs/openapi.yaml`.

### 4.4 End-to-end testing

Verify the main user workflow from creating a receiving document to recording receipts and viewing the resulting inventory.

If browser automation is introduced, document the selected tool and its configuration separately.

## 5. Test Data and Preconditions

Use an isolated PostgreSQL test database. Never run destructive tests against production data.

Suggested baseline fixtures:

| Entity | Test data |
|---|---|
| Supervisor | `supervisor@test.local` with supervisor role |
| Operator | `operator@test.local` with operator role |
| Product A | SKU `TEST-001`, inventory quantity `0` |
| Product B | SKU `TEST-002`, inventory quantity `0` |
| Receiving document A | Product A, expected quantity `10`, received quantity `0` |
| Receiving document B | Product B, expected quantity `5`, received quantity `0` |

Use valid password hashes and authentication tokens generated through the application's normal mechanisms.

Reset or isolate test data between tests. For concurrency tests, use independent database connections and synchronize requests so they genuinely overlap.

## 6. Authentication and Authorization Tests

| ID | Scenario | Expected result |
|---|---|---|
| AUTH-01 | Login with valid credentials | Authentication succeeds and a token is returned |
| AUTH-02 | Login with an incorrect password | Authentication fails without exposing sensitive details |
| AUTH-03 | Request a protected endpoint without a token | `401 Unauthorized` |
| AUTH-04 | Request a protected endpoint with an invalid or expired token | `401 Unauthorized` |
| AUTH-05 | Operator attempts a supervisor-only product operation | `403 Forbidden` |
| AUTH-06 | Supervisor accesses an authorized endpoint | Request is permitted |
| AUTH-07 | Operator accesses an endpoint allowed by the PRD | Request is permitted |

The expected permissions must match `docs/prd.md` and the authorization rules in `docs/openapi.yaml`.

## 7. Product Management Tests

| ID | Scenario | Expected result |
|---|---|---|
| PROD-01 | Create a product with valid data | Product is created |
| PROD-02 | Create a product without a required SKU | Validation error |
| PROD-03 | Create a product without a required name | Validation error |
| PROD-04 | Create a product using an existing SKU | `409 Conflict` |
| PROD-05 | List products | Valid paginated response |
| PROD-06 | Retrieve products with invalid pagination values | Validation error |
| PROD-07 | Operator attempts to create a product | Rejected if not authorized by the PRD |

Verify that a failed product creation does not leave a partial database record.

## 8. Receiving Document Tests

| ID | Scenario | Expected result |
|---|---|---|
| DOC-01 | Create a document with valid products and positive expected quantities | Document is created with `PENDING` status |
| DOC-02 | Create a document with an empty item list | Validation error |
| DOC-03 | Create a document with an unknown product ID | `404 Not Found` or the documented error response |
| DOC-04 | Create a document with a zero expected quantity | Validation error |
| DOC-05 | Create a document with a negative expected quantity | Validation error |
| DOC-06 | Create a document with a fractional expected quantity | Validation error |
| DOC-07 | Add the same product more than once to one document | `409 Conflict` |
| DOC-08 | Retrieve an existing receiving document | Document and item quantities are returned |
| DOC-09 | Retrieve a nonexistent document | `404 Not Found` |
| DOC-10 | Retrieve a document after a successful receipt | Current quantities and status are returned |

## 9. Receipt Processing Tests

| ID | Scenario | Expected result |
|---|---|---|
| REC-01 | Receive quantity `4` against expected quantity `10` | Received quantity becomes `4`; inventory increases by `4`; status becomes `PARTIALLY_RECEIVED` |
| REC-02 | Receive the remaining quantity `6` | Received quantity becomes `10`; inventory increases by `6`; status becomes `COMPLETED` |
| REC-03 | Receive the full expected quantity in one operation | Document item becomes complete and document status is recalculated |
| REC-04 | Receive quantity `0` | Request rejected; no database changes |
| REC-05 | Receive a negative quantity | Request rejected; no database changes |
| REC-06 | Receive a fractional quantity | Request rejected; no database changes |
| REC-07 | Receive more than the remaining expected quantity | Request rejected; no database changes |
| REC-08 | Submit a receipt for an unknown document or item | Appropriate `404 Not Found` response |
| REC-09 | Submit a receipt without `Idempotency-Key` | Request rejected according to the API contract |
| REC-10 | Receive a quantity exactly equal to the remaining quantity | Receipt succeeds and the item becomes complete |

For every rejected receipt, verify that the receiving item, inventory, receipt operations, inventory transactions, and document status remain unchanged.

## 10. Inventory Consistency Tests

| ID | Scenario | Expected result |
|---|---|---|
| INV-01 | Complete a valid receipt | Inventory increases by exactly the receipt quantity |
| INV-02 | Process two distinct valid receipt operations | Inventory equals the sum of both accepted quantities |
| INV-03 | Process a rejected over-receipt | Inventory remains unchanged |
| INV-04 | Retrieve inventory after receiving goods | Returned quantity matches the database |
| INV-05 | Retrieve transaction history after a successful receipt | A corresponding inbound transaction exists |
| INV-06 | Fail a receipt after one or more database writes have been attempted | All receipt-related changes are rolled back |
| INV-07 | Process multiple items in one receiving document | Each item's inventory and received quantity remain correct |

For successful receipt operations, verify this invariant:

`Inventory quantity after = Inventory quantity before + accepted receipt quantity`

The receiving item's cumulative received quantity must never exceed its expected quantity.

## 11. Idempotency Tests

Each receipt request must include an `Idempotency-Key`.

| ID | Scenario | Expected result |
|---|---|---|
| IDEM-01 | Submit a receipt with a new key | Receipt is processed once |
| IDEM-02 | Retry the same request with the same key and payload | Stored result is returned without additional stock changes |
| IDEM-03 | Reuse the same key with a different quantity | `409 Conflict`; no additional stock changes |
| IDEM-04 | Retry after the original successful response was lost | Receipt is not applied twice |
| IDEM-05 | Submit two concurrent requests with the same key and payload | Only one receipt operation is applied |
| IDEM-06 | Submit two concurrent requests with the same key but different payloads | At most one payload is accepted; the conflicting request is rejected |
| IDEM-07 | Verify the operation and its response snapshot after a successful receipt | The stored result corresponds to the committed operation |

A retry must not create a second receipt operation or inventory transaction for the same idempotent operation.

## 12. Concurrency Tests

Concurrency tests must use a real PostgreSQL test database. Mock-only tests are insufficient to establish database locking and transaction correctness.

### CON-01: Concurrent over-receiving

Precondition: expected quantity is `10`, received quantity is `0`.

Run two independent requests concurrently, each attempting to receive `7`.

Expected result:

- At most one request succeeds.
- Total received quantity does not exceed `10`.
- Inventory increases only by the quantity accepted.
- No duplicate or orphaned inventory transactions exist.
- The receiving document status matches the final quantities.

### CON-02: Concurrent distinct receipts

Precondition: expected quantity is `10`, received quantity is `0`.

Run two independent requests concurrently, each attempting to receive `4` with a different idempotency key.

Expected result:

- Both requests may succeed.
- Final received quantity is `8`.
- Inventory increases by `8`.
- Exactly two receipt operations and two corresponding inventory transactions exist.

### CON-03: Concurrent duplicate request

Submit the same receipt request concurrently with the same idempotency key and payload.

Expected result:

- The receipt is applied only once.
- Inventory increases once.
- The client receives the appropriate successful or replay response.

### CON-04: Transaction failure

Force a controlled failure during receipt processing, such as a test-only injected exception before commit.

Expected result:

- The transaction rolls back.
- No partial inventory update, receipt operation, or inventory transaction remains.
- A retry can be handled correctly according to the idempotency design.

Do not introduce production-only failure hooks or weaken transaction handling to implement this test.

## 13. Receiving Document Status Tests

| ID | Scenario | Expected result |
|---|---|---|
| STAT-01 | No items have been received | `PENDING` |
| STAT-02 | Some, but not all, expected quantities have been received | `PARTIALLY_RECEIVED` |
| STAT-03 | All expected quantities for all items have been received | `COMPLETED` |
| STAT-04 | One item is complete while another remains pending | `PARTIALLY_RECEIVED` |
| STAT-05 | A receipt is rejected | Status remains unchanged |
| STAT-06 | Concurrent receipts complete a document | Final status is `COMPLETED` without lost updates |

Status must be calculated from persisted receiving quantities, not trusted from client input.

## 14. API Contract Tests

Validate the OpenAPI document and test the implemented endpoints against it.

| ID | Scenario | Expected result |
|---|---|---|
| API-01 | Validate `docs/openapi.yaml` | YAML and OpenAPI structure are valid |
| API-02 | Call an endpoint with a valid request | Status and response schema match the contract |
| API-03 | Call an endpoint with an invalid request | Documented validation error is returned |
| API-04 | Call a protected endpoint without authentication | `401 Unauthorized` |
| API-05 | Call a role-restricted endpoint without permission | `403 Forbidden` |
| API-06 | Reuse an idempotency key with a different payload | `409 Conflict` |
| API-07 | Call health endpoint | Health response matches the contract |
| API-08 | Call readiness endpoint while dependencies are unavailable | Readiness indicates the service is not ready |

An OpenAPI syntax check alone does not prove that the implementation conforms to the API contract. Test actual responses as well.

## 15. Health, Readiness, and Deployment Tests

| ID | Scenario | Expected result |
|---|---|---|
| DEP-01 | Start the application using the documented Docker Compose configuration | Required services start successfully |
| DEP-02 | Start the application with a clean PostgreSQL database | Migrations apply successfully |
| DEP-03 | Call `/health` while the process is running | Health response indicates process health |
| DEP-04 | Call `/ready` when required dependencies are available | Readiness check succeeds |
| DEP-05 | Call `/ready` when PostgreSQL is unavailable | Readiness fails with the documented status |
| DEP-06 | Follow the README setup instructions on a clean environment | Application can be started using the documented steps |

Verify that readiness checks reflect required dependencies rather than merely checking that the HTTP server is running.

## 16. Test Execution Checklist

Use this checklist during development and before submission.

- [ ] Unit tests pass.
- [ ] API integration tests pass.
- [ ] Authentication and authorization tests pass.
- [ ] Product and receiving document tests pass.
- [ ] Receipt validation and status transition tests pass.
- [ ] Inventory consistency tests pass.
- [ ] Idempotency tests pass.
- [ ] Concurrent receipt tests pass against PostgreSQL.
- [ ] Transaction rollback tests pass.
- [ ] OpenAPI validation passes.
- [ ] Type checking and linting pass.
- [ ] Production build completes successfully.
- [ ] Database migrations work on a clean database.
- [ ] Docker Compose startup and health checks work.
- [ ] No known critical failures remain.

Do not check an item until the relevant command or scenario has actually been executed and verified.

## 17. Test Report Template

Record actual test results before submission.

| Field | Details |
|---|---|
| Test run date | `[YYYY-MM-DD]` |
| Git commit | `[commit hash]` |
| Environment | `[local / Docker / CI]` |
| Node.js version | `[version]` |
| PostgreSQL version | `[version]` |
| Total tests | `[number]` |
| Passed | `[number]` |
| Failed | `[number]` |
| Skipped | `[number]` |
| Build result | `[pass / fail / not run]` |
| Migration result | `[pass / fail / not run]` |
| Outstanding defects | `[list or none]` |

### Failure record

For each failure, document:

- Test ID and name.
- Expected result.
- Actual result.
- Reproduction steps.
- Relevant error message or logs.
- Root cause, if confirmed.
- Fix and retest result.

Never fill this report with assumed or fabricated results.

## 18. Exit Criteria

The testing phase is complete when all required tests have been executed, critical business rules are verified, no known critical defects remain, and any skipped tests or limitations are explicitly documented.

Passing tests provide evidence of correctness for the tested scenarios; they do not prove the absence of every possible defect.
