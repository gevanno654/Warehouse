# Testing Strategy and Test Cases

## 1. Purpose

This document defines the testing strategy and test cases for the Warehouse Receiving System.

Testing verifies that the application follows the approved requirements, API contract, database design, and business rules documented in:

- `docs/prd.md`
- `docs/technical-spec.md`
- `docs/erd.mmd`
- `docs/data-model.md`
- `docs/openapi.yaml`
- `docs/data-flow.mmd`
- `AGENTS.md`

`docs/data-model.md` holds the constraint, integrity, and idempotency rules that the tests below assert. `docs/erd.mmd` is the authoritative relationship model, so tests that depend on a relationship (for example, exactly one inventory record per product) cite it rather than restating it.

The primary testing objective is to ensure that receiving operations cannot produce incorrect inventory quantities, duplicate stock updates, or inconsistent receiving document statuses.

### 1.1 Status code and error code policy

The suite asserts both the HTTP status and the stable `error.code` value. The policy is:

| Status | Meaning | Examples |
|---|---|---|
| `400` | Malformed or schema-invalid request | `VALIDATION_ERROR`, `INVALID_QUANTITY`, `IDEMPOTENCY_KEY_REQUIRED` |
| `401` | Missing or invalid authentication | `UNAUTHENTICATED` |
| `403` | Authenticated but not authorised | `FORBIDDEN` |
| `404` | Resource does not exist | `NOT_FOUND` |
| `409` | Duplicate resource or idempotency conflict | `DUPLICATE_SKU`, `DUPLICATE_DOCUMENT_ITEM`, `IDEMPOTENCY_KEY_CONFLICT` |
| `422` | Structurally valid but a business rule was violated | `RECEIPT_EXCEEDS_REMAINING`, `DOCUMENT_ALREADY_COMPLETED` |
| `500` | Unexpected server error | `INTERNAL_ERROR` |
| `503` | Readiness dependency unavailable | `SERVICE_UNAVAILABLE` |

The distinction that matters most:

- A quantity that is **not a positive integer** (`0`, negative, fractional, non-numeric) is a schema violation and returns `400 INVALID_QUANTITY`.
- A quantity that is a **valid positive integer but exceeds the remaining expected quantity** is a business-rule violation and returns `422 RECEIPT_EXCEEDS_REMAINING`.

Tests must assert the documented code, not only the status. Two different `4xx` codes on the same endpoint are not interchangeable.

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

### 5.1 Test database configuration

- Tests read their connection string from `TEST_DATABASE_URL`, not `DATABASE_URL`.
- If `TEST_DATABASE_URL` is unset, the test runner must fail immediately with an explicit configuration error. It must never fall back to `DATABASE_URL`.
- The test database must be a separate database from the development database, for example `warehouse_test` on the same PostgreSQL server, or a dedicated Compose service.
- Provision the schema with `prisma migrate deploy` against `TEST_DATABASE_URL` before the suite runs. Do not use `migrate dev` in CI.
- Reset strategy: truncate all tables between test files (or wrap each test in a transaction that is rolled back) so that fixtures are deterministic. Truncation must respect foreign keys, for example `TRUNCATE ... RESTART IDENTITY CASCADE`.
- Concurrency tests need real committed transactions, so they must not run inside a per-test rollback wrapper. Give them their own fixtures and clean up explicitly.

Document the reset mechanism in the test setup so a new contributor can reproduce failures locally.

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
| AUTH-01 | Login with valid credentials | `200`; a bearer token and the user (without password hash) are returned |
| AUTH-02 | Login with an incorrect password | `401 UNAUTHENTICATED`; the message does not reveal whether the email exists |
| AUTH-03 | Request a protected endpoint without a token | `401 UNAUTHENTICATED` |
| AUTH-04 | Request a protected endpoint with an invalid or expired token | `401 UNAUTHENTICATED` |
| AUTH-05 | Operator attempts to create a product | `403 FORBIDDEN`; no product or inventory record is written |
| AUTH-06 | Supervisor creates a product | `201`; request is permitted |
| AUTH-07 | Operator accesses an endpoint allowed by the PRD | Request is permitted |
| AUTH-08 | Login with an email differing only by letter case | Authentication succeeds because emails are normalised to lower case |
| AUTH-09 | Inspect any user-bearing response | No password hash, JWT secret, or stack trace appears |

The expected permissions must match `docs/prd.md` and the authorization rules in `docs/openapi.yaml`. Authorization is enforced by the backend; do not treat a hidden or disabled frontend control as coverage for AUTH-05.

## 7. Product Management Tests

| ID | Scenario | Expected result |
|---|---|---|
| PROD-01 | Create a product with valid data | `201` with the product and `availableQuantity: 0` |
| PROD-02 | Create a product without a required SKU | `400 VALIDATION_ERROR` |
| PROD-03 | Create a product without a required name | `400 VALIDATION_ERROR` |
| PROD-04 | Create a product using an existing SKU | `409 DUPLICATE_SKU` |
| PROD-05 | List products | `200` with a valid paginated response |
| PROD-06 | Retrieve products with invalid pagination values | `400 VALIDATION_ERROR` |
| PROD-07 | Operator attempts to create a product | `403 FORBIDDEN`, as recorded in the resolved permission decision in `docs/prd.md` |
| PROD-08 | Create a product whose SKU differs from an existing SKU only by case or surrounding whitespace | `409 DUPLICATE_SKU`; normalisation occurs before the uniqueness check |
| PROD-09 | Create a product successfully | Exactly one `inventories` row exists for the product with `available_quantity = 0` |
| PROD-10 | Force the inventory insert to fail while creating a product | The product insert is rolled back; no product and no inventory row remain |

Verify that a failed product creation does not leave a partial database record. PROD-09 and PROD-10 cover the atomic product-plus-inventory requirement in `docs/data-model.md`.

## 8. Receiving Document Tests

| ID | Scenario | Expected result |
|---|---|---|
| DOC-01 | Create a document with valid products and positive expected quantities | `201`; document is created with `PENDING` status and a generated `documentNumber` |
| DOC-02 | Create a document with an empty item list | `400 VALIDATION_ERROR` |
| DOC-03 | Create a document with an unknown product ID | `404 NOT_FOUND` |
| DOC-04 | Create a document with a zero expected quantity | `400 INVALID_QUANTITY` |
| DOC-05 | Create a document with a negative expected quantity | `400 INVALID_QUANTITY` |
| DOC-06 | Create a document with a fractional expected quantity | `400 INVALID_QUANTITY` |
| DOC-07 | Add the same product more than once to one document | `409 DUPLICATE_DOCUMENT_ITEM` |
| DOC-08 | Retrieve an existing receiving document | Document and item quantities are returned |
| DOC-09 | Retrieve a nonexistent document | `404 NOT_FOUND` |
| DOC-10 | Retrieve a document after a successful receipt | Current quantities and status are returned |
| DOC-11 | Create a document | `documentNumber` matches `RCV-<YYYYMMDD>-<000001>` and is unique across sequential creations |
| DOC-12 | Force the generated number to collide once, then retry | Creation succeeds with the next number; no duplicate number is committed |
| DOC-13 | Force the number generator to collide beyond the retry limit | `500 INTERNAL_ERROR`; no document or item rows remain |
| DOC-14 | Retrieve a document with a malformed (non-UUID) identifier | `400 VALIDATION_ERROR` |

## 9. Receipt Processing Tests

| ID | Scenario | Expected result |
|---|---|---|
| REC-01 | Receive quantity `4` against expected quantity `10` | `201`; received quantity becomes `4`; inventory increases by `4`; status becomes `PARTIALLY_RECEIVED` |
| REC-02 | Receive the remaining quantity `6` | `201`; received quantity becomes `10`; inventory increases by `6`; status becomes `COMPLETED` |
| REC-03 | Receive the full expected quantity in one operation | `201`; item becomes complete and document status is recalculated |
| REC-04 | Receive quantity `0` | `400 INVALID_QUANTITY`; no database changes |
| REC-05 | Receive a negative quantity | `400 INVALID_QUANTITY`; no database changes |
| REC-06 | Receive a fractional quantity | `400 INVALID_QUANTITY`; no database changes |
| REC-07 | Receive a quantity exceeding the remaining expected quantity | `422 RECEIPT_EXCEEDS_REMAINING`; `details.remainingQuantity` reports the current limit; no database changes |
| REC-08 | Submit a receipt for an unknown document or item | `404 NOT_FOUND` |
| REC-09 | Submit a receipt without `Idempotency-Key` | `400 IDEMPOTENCY_KEY_REQUIRED`; no database changes |
| REC-10 | Receive a quantity exactly equal to the remaining quantity | `201`; receipt succeeds and the item becomes complete |
| REC-11 | Submit a receipt against an item that belongs to a different document | `404 NOT_FOUND`; the item is not resolved across documents |
| REC-12 | Submit a receipt with a malformed document ID, item ID, or body | `400 VALIDATION_ERROR` |
| REC-13 | Submit a receipt for a document already `COMPLETED`, using a fresh key | `422 DOCUMENT_ALREADY_COMPLETED`; no database changes |
| REC-14 | Receive against a document with several items, one still pending | Status remains `PARTIALLY_RECEIVED` until every item is complete |

For every rejected receipt, verify that the receiving item, inventory, receipt operations, inventory transactions, and document status remain unchanged. REC-04 to REC-06 must not be confused with REC-07: the first three are schema-level rejections (`400`), the last is a business-rule rejection (`422`).

Receipt processing must follow the documented order: lock the document, lock the item, check idempotency, then apply business rules (`docs/data-flow.mmd`). A test that reaches `422 DOCUMENT_ALREADY_COMPLETED` confirms the business-rule stage was reached, so a replay test that returns `200` on the same completed document confirms the idempotency check precedes it.

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
| INV-08 | Compare `inventories.available_quantity` with the sum of `inventory_transactions.quantity_change` for a product | The values are equal |
| INV-09 | Inspect `inventory_transactions` after a successful receipt | Exactly one transaction exists, `quantity_change` equals the accepted quantity, `transaction_type` is `RECEIPT`, and `receipt_operation_id` is unique |
| INV-10 | Attempt to record a stock change without a receipt operation | The operation is rejected; no inventory change is possible without a traceable receipt |

For successful receipt operations, verify this invariant:

`Inventory quantity after = Inventory quantity before + accepted receipt quantity`

The receiving item's cumulative received quantity must never exceed its expected quantity. Inventory must never become negative. Each accepted receipt must produce exactly one inventory transaction, per `docs/data-model.md`.

## 11. Idempotency Tests

Each receipt request must include an `Idempotency-Key`.

Idempotency keys are scoped to the authenticated user: the database uniqueness constraint is `(performed_by, idempotency_key)`, and the request hash is `sha256("post|" + documentId + "|" + itemId + "|" + quantity)`. Both rules are defined in `docs/data-model.md` and must be asserted directly.

| ID | Scenario | Expected result |
|---|---|---|
| IDEM-01 | Submit a receipt with a new key | `201`; receipt is processed once, one receipt operation and one inventory transaction exist |
| IDEM-02 | Retry the same request with the same key and payload | `200` with the identical body; no second receipt operation, inventory transaction, or stock change |
| IDEM-03 | Reuse the same key with a different quantity | `409 IDEMPOTENCY_KEY_CONFLICT`; no stock change |
| IDEM-04 | Retry after the original successful response was lost | `200` with the stored snapshot; the receipt is not applied twice |
| IDEM-05 | Submit two concurrent requests with the same key and payload | Only one receipt operation is applied; both responses are successful (`201` and `200`, or `200` for both if the loser reads the committed row) and neither duplicates stock |
| IDEM-06 | Submit two concurrent requests with the same key but different quantities | At most one payload is accepted; the other receives `409 IDEMPOTENCY_KEY_CONFLICT` |
| IDEM-07 | Verify the operation and its response snapshot after a successful receipt | The stored `response_snapshot` matches the committed operation's response body |
| IDEM-08 | Reuse the same key for a different receiving item, same quantity | `409 IDEMPOTENCY_KEY_CONFLICT`; the key hit is a conflict, never a replay |
| IDEM-09 | Reuse the same key for a different document, same item quantity | `409 IDEMPOTENCY_KEY_CONFLICT` |
| IDEM-10 | Replay a successful receipt after the document has become `COMPLETED` | `200` with the stored snapshot; the completed-document rule does not block a legitimate replay |
| IDEM-11 | Use the same key value as another user, with a different payload | Both users succeed independently; one user's key does not observe or collide with the other's |
| IDEM-12 | Use the same key value as another user, replaying that user's payload | Each user's operation is recorded separately under its own `performed_by` |
| IDEM-13 | Force the unique constraint on `(performed_by, idempotency_key)` to be violated by a concurrent insert | The transaction rolls back, the committed row is re-read, and the response is either the stored `200` replay or `409`; never a duplicate write |
| IDEM-14 | Retry with the same key after the transaction that created it rolled back | The retry is treated as a first-time request, because no row was committed |
| IDEM-15 | Inspect the stored `request_hash` | It is a 64-character lowercase hex SHA-256 digest over the canonical string: `post`, document ID, item ID, and quantity joined by a pipe character |

A retry must not create a second receipt operation or inventory transaction for the same idempotent operation. A `201` and a `200` for the same key on the same payload are both correct across a retry boundary; what must never vary is the stored body and the applied quantity.

Rows older than the 30-day retention window may be removed by maintenance. Deleting an expired key must not alter any committed receipt, inventory quantity, or transaction history.

## 12. Concurrency Tests

Concurrency tests must use a real PostgreSQL test database. Mock-only tests are insufficient to establish database locking and transaction correctness.

All receipt operations must acquire row locks in the fixed order defined in `docs/technical-spec.md`:

```text
receiving_documents row  →  receiving_items row  →  inventories row
```

Tests should assert the observable consequences of that order rather than the SQL itself: no over-receiving, no lost update on cumulative quantities, no deadlock detection error under the scenarios below, and correct status recalculation under contention. Choose lock acquisition order in test helpers consistently with the service; a helper that locks rows in a different order can itself produce a deadlock that the service would not.

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

- Both requests succeed.
- Final received quantity is `8`.
- Inventory increases by `8`.
- Exactly two receipt operations and two corresponding inventory transactions exist.

Because both requests target the same document, the document row lock serialises them. The second request waits, then re-reads committed quantities; it must not reject with `422` merely because it started concurrently.

### CON-03: Concurrent duplicate request

Submit the same receipt request concurrently with the same idempotency key and payload.

Expected result:

- The receipt is applied only once.
- Inventory increases once.
- The client receives the appropriate successful or replay response; the loser of the race either replays the stored `200` or recovers from the unique-constraint violation by re-reading and replaying.
- No `500` is returned for the losing request.

### CON-04: Transaction failure

Force a controlled failure during receipt processing, such as a test-only injected exception before commit.

Expected result:

- The transaction rolls back.
- No partial inventory update, receipt operation, or inventory transaction remains.
- A retry with the same key is treated as a first-time request, because nothing was committed.

Do not introduce production-only failure hooks or weaken transaction handling to implement this test.

### CON-05: Concurrent receipts for the same product from different documents

Precondition: product A appears as an item in two different receiving documents, each with enough remaining quantity.

Run one receipt against each document concurrently.

Expected result:

- Both receipts succeed.
- Inventory for product A increases by the sum of both accepted quantities.
- Each receipt produces its own inventory transaction.
- The inventory row is locked in both transactions, so one update is not lost.

This case is why the inventory row must be locked even though the documents differ. Document-level locking alone does not serialise writes to a shared product.

### CON-06: Lock-order consistency

Run the receipt path concurrently with any other path that locks more than one of these tables.

Expected result:

- No `40P01` deadlock-detected error is returned to a client.
- If a deadlock or serialisation failure does occur, it is retried at most the documented number of times and surfaces as a documented error code, never as a partial write.

## 13. Receiving Document Status Tests

| ID | Scenario | Expected result |
|---|---|---|
| STAT-01 | No items have been received | `PENDING` |
| STAT-02 | Some, but not all, expected quantities have been received | `PARTIALLY_RECEIVED` |
| STAT-03 | All expected quantities for all items have been received | `COMPLETED` |
| STAT-04 | One item is complete while another remains pending | `PARTIALLY_RECEIVED` |
| STAT-05 | A receipt is rejected | Status remains unchanged |
| STAT-06 | Concurrent receipts complete a document | Final status is `COMPLETED` without lost updates |
| STAT-07 | Two items: one fully received, one untouched | `PARTIALLY_RECEIVED`, recalculated from all items, not only the item just received |
| STAT-08 | Status recalculation runs while the document row lock is held | Recalculation observes the receipt just written and all sibling item quantities |

Status must be calculated from persisted receiving quantities, not trusted from client input. It must be recalculated inside the receipt transaction after the document row lock is acquired, because a document with several items cannot derive its status from a single item.

## 14. API Contract Tests

Validate the OpenAPI document and test the implemented endpoints against it.

| ID | Scenario | Expected result |
|---|---|---|
| API-01 | Validate `docs/openapi.yaml` | YAML and OpenAPI 3.1 structure are valid, including resolvable `$ref` values |
| API-02 | Call an endpoint with a valid request | Status and response schema match the contract, including required properties |
| API-03 | Call an endpoint with an invalid request | The documented `400` error is returned |
| API-04 | Call a protected endpoint without authentication | `401 UNAUTHENTICATED` |
| API-05 | Call a role-restricted endpoint without permission | `403 FORBIDDEN` |
| API-06 | Reuse an idempotency key with a different payload | `409 IDEMPOTENCY_KEY_CONFLICT` |
| API-07 | Call health endpoint | Health response matches the contract |
| API-08 | Call readiness endpoint while dependencies are unavailable | `503 SERVICE_UNAVAILABLE` |
| API-09 | Inspect every error response body | `error.code` is a value from the documented `ErrorCode` enum |
| API-10 | Compare implemented routes and status codes with `docs/openapi.yaml` | No undocumented endpoint, status code, or required field |
| API-11 | Inspect any `5xx` response | No stack trace, SQL, credential, or secret is present |

An OpenAPI syntax check alone does not prove that the implementation conforms to the API contract. Test actual responses as well. The schema examples in `docs/technical-spec.md` must match the required properties in `docs/openapi.yaml`; API-02 catches drift between them.

## 15. Health, Readiness, and Deployment Tests

| ID | Scenario | Expected result |
|---|---|---|
| DEP-01 | Start the application using the documented Docker Compose configuration | `db`, `api`, and `web` services start; the API waits for the database health check |
| DEP-02 | Start the application against a clean PostgreSQL database | Committed migrations apply successfully with `prisma migrate deploy` |
| DEP-03 | Call `/health` while the process is running | Health response indicates process health |
| DEP-04 | Call `/ready` when required dependencies are available | Readiness check succeeds |
| DEP-05 | Call `/ready` when PostgreSQL is unavailable | `503 SERVICE_UNAVAILABLE` |
| DEP-06 | Follow the README setup instructions on a clean environment | Application can be started using the documented steps, including seeding |
| DEP-07 | Run the seed command twice | No duplicate users; the command is idempotent |
| DEP-08 | Run the seed command with `NODE_ENV=production` | The command refuses to run unless `ALLOW_PROD_SEED=true` |
| DEP-09 | Confirm no secret is committed | `.env` is ignored; `.env.example` contains placeholders only |
| DEP-10 | Open the documented Swagger UI URL while the API runs | Interactive documentation loads from `docs/openapi.yaml` |

Verify that readiness checks reflect required dependencies rather than merely checking that the HTTP server is running. `DEP-01` is not satisfied by a running `api` container alone: the API must be able to reach `db`.

## 16. Test Execution Checklist

Use this checklist during development and before submission.

- [ ] Unit tests pass.
- [ ] API integration tests pass.
- [ ] Authentication and authorization tests pass.
- [ ] Product and receiving document tests pass.
- [ ] Product-plus-inventory atomicity tests pass.
- [ ] Receipt validation and status transition tests pass.
- [ ] Inventory consistency tests pass.
- [ ] Idempotency tests pass, including user-scoped keys and replay after `COMPLETED`.
- [ ] Concurrent receipt tests pass against PostgreSQL.
- [ ] Transaction rollback tests pass.
- [ ] Document number generation and collision-retry tests pass.
- [ ] OpenAPI validation passes.
- [ ] Error responses assert the documented `error.code`, not only the status.
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
| Node.js version | `[version, expected 24.x]` |
| PostgreSQL version | `[version]` |
| Test database | `[TEST_DATABASE_URL host and database name, no credentials]` |
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
