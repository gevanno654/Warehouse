# AGENTS.md

## 1. Project Overview

Build a Warehouse Receiving System using spec-driven development.

The application must support product management, receiving document creation, partial and full receipts, inventory tracking, and inventory transaction history.

### Technology Stack

- Frontend: React, TypeScript, Vite
- Backend: Node.js 24.x, Express, TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Request validation: Zod
- Authentication: JWT
- Password hashing: bcrypt
- API documentation: OpenAPI 3.1, served with Swagger UI
- Automated testing: Vitest and Supertest
- Local development: Docker Compose

Node.js is pinned to the **24.x** major version through `package.json` `engines`, `.nvmrc`, and the Docker base image. Do not change the pinned major version without explicit approval.

Follow the existing project structure and package configuration. Do not replace the selected stack without explicit approval.

## 2. Mandatory Documentation

Before implementing a feature, read the relevant documents:

- `docs/prd.md`
- `docs/technical-spec.md`
- `docs/erd.mmd`
- `docs/data-model.md`
- `docs/openapi.yaml`
- `docs/data-flow.mmd`
- `docs/ai-workflow.md`
- `docs/testing.md`

These documents define the expected system behavior and architecture.

`docs/erd.mmd` is the authoritative relationship model. `docs/data-model.md` holds the constraints, enumerated values, integrity rules, and idempotency storage rules that do not fit in a Mermaid diagram. `docs/erd.mmd` and `docs/data-flow.mmd` are raw Mermaid source files: keep them valid Mermaid, with no Markdown fences or prose blocks. Explanatory content belongs in the Markdown documents.

If a required document is missing, report it before proceeding with implementation that depends on it.

If documents conflict, do not silently choose one interpretation. Identify the conflict and propose a resolution before changing code or specifications.

## 3. Working Principles

1. Inspect the existing codebase before modifying files.
2. Create a concise implementation plan before making substantial changes.
3. Implement one logical feature at a time.
4. Prefer small, focused changes over unnecessary rewrites.
5. Follow existing naming conventions and folder structure.
6. Keep business logic separate from HTTP route handling where practical.
7. Use TypeScript types consistently and avoid `any` unless justified.
8. Validate incoming data at the API boundary.
9. Use database transactions for operations that require atomic updates.
10. Add or update automated tests for behavior changes.
11. Update relevant documentation when implementation or API behavior changes.
12. Never claim a test, build, migration, or command succeeded unless it was actually executed and verified.

Do not invent requirements or silently introduce new business rules. State assumptions explicitly and request clarification when an ambiguity affects correctness.

## 4. Business Rules

### Users and permissions

- Support the `OPERATOR` and `SUPERVISOR` roles defined in the project specifications.
- Enforce authorization on the backend.
- Do not rely on frontend visibility or disabled buttons as an authorization mechanism.
- Follow the approved role permissions in `docs/prd.md`.

### Products

- Follow the approved product schema and validation rules.
- Enforce SKU uniqueness after normalisation (trimmed and upper-cased).
- Product creation is restricted to the `SUPERVISOR` role. Both roles may list products. This is the resolved permission decision recorded in `docs/prd.md` and must be enforced on the backend.
- Create each product and its single inventory row atomically, with `available_quantity = 0`. There is no state in which a product exists without an inventory record.
- Do not delete or alter existing product records in ways that violate receiving or inventory history.

### Receiving documents

- Support `PENDING`, `PARTIALLY_RECEIVED`, and `COMPLETED` statuses.
- A receiving item must have a positive expected quantity.
- Received quantity must be an integer greater than or equal to zero.
- Received quantity must never exceed expected quantity.
- Reject invalid receipt requests without partially modifying data.
- Calculate document status from its item quantities according to the approved specifications.
- Generate `document_number` on the backend using the documented `RCV-<YYYYMMDD>-<000001>` algorithm. Clients never supply it. Do not fall back to a random or timestamp-only value.
- Document creation and item creation must be atomic.

### Inventory

- Inventory starts at zero for newly tracked products unless the approved specification states otherwise.
- A successful receipt increases inventory by exactly the accepted receipt quantity.
- Inventory must never become negative.
- Each successful receipt operation must have a corresponding inventory transaction.
- Do not create stock changes without a traceable receipt operation.

### Scope restrictions

Do not introduce outbound stock movements, multi-warehouse support, supplier purchase orders, receipt cancellation, or reversal workflows unless the approved requirements are explicitly updated.

## 5. Receipt Processing and Data Integrity

Receipt processing is a critical business operation. Follow `docs/data-flow.mmd` and `docs/technical-spec.md`.

A successful receipt must atomically:

1. Authenticate the caller and authorise the operation.
2. Validate the request shape: the `Idempotency-Key` header is present, both identifiers are valid UUIDs, and `quantity` is a positive integer.
3. Begin the database transaction.
4. Lock the receiving document row (`SELECT ... FOR UPDATE`), then the receiving item row, and verify that the item belongs to the document.
5. Check whether `(performed_by, idempotency_key)` already exists.
6. Replay or reject on a key hit, before any business-rule check.
7. Reject a completed document.
8. Verify that the requested quantity does not exceed the remaining expected quantity.
9. Lock the inventory row for the product.
10. Record the receipt operation.
11. Increase the receiving item's cumulative received quantity.
12. Increase inventory by the accepted quantity.
13. Insert the corresponding inventory transaction.
14. Recalculate the receiving document status from all of its items.
15. Store the response snapshot required for idempotent retries.
16. Commit the database transaction.

If any required operation fails, roll back the entire transaction.

The order above is not interchangeable. The idempotency check must precede the completed-document and remaining-quantity checks, so that a legitimate replay still returns the stored success after the document has become `COMPLETED`. Every other check must run inside the transaction, after its lock is held.

### Concurrency

- Use database transactions with row-level locking. Acquire locks in the fixed order `receiving_documents` → `receiving_items` → `inventories`, and hold the document lock until commit. Never lock inventory before the document.
- Lock the document row because status is derived from all sibling items; recalculating it from an unlocked read can lose a concurrent update.
- Lock the inventory row because the same product may be received against two different documents at once; document-level locking alone does not serialise those writes.
- Ensure concurrent requests cannot cause over-receiving or duplicate inventory updates.
- Do not depend solely on frontend validation or a prior unlocked read. A request that waits on a lock must re-validate against the committed values it reads after acquiring it.
- Handle database uniqueness conflicts and transaction retries deliberately. A unique-constraint violation on the idempotency key is not a `500`; it is a signal to roll back, re-read, and replay or return the conflict.
- Preserve the documented status codes: a schema failure is `400`, a business-rule failure is `422`, and a duplicate or idempotency collision is `409`.

### Idempotency

- Require the `Idempotency-Key` header for receipt requests as defined in `docs/openapi.yaml`. A missing header is `400 IDEMPOTENCY_KEY_REQUIRED`.
- Scope keys by `(performed_by, idempotency_key)`. Uniqueness is composite, never global, so one user's key cannot collide with or observe another user's stored response.
- Compute the request hash as `sha256(lowercase(method) + "|" + documentId + "|" + itemId + "|" + quantity)` — literally `sha256("post|" + documentId + "|" + itemId + "|" + quantity)` — using the resolved route UUIDs and the validated integer quantity, stored as 64 lowercase hex characters.
- Store enough information to associate a key with its request payload and result: `performed_by`, `idempotency_key`, `request_hash`, `receiving_item_id`, `quantity`, and the response snapshot.
- Repeating a request with the same key and same payload must not apply the receipt twice. Return the stored result with `200`.
- Reusing a key with a different target or payload must return `409 IDEMPOTENCY_KEY_CONFLICT`. This includes a different document or item with an identical quantity.
- Handle simultaneous requests using the same key safely, including the unique-constraint violation path.
- Do not return a successful response for an operation that was rolled back.
- Retain idempotency records for the documented retention period. Deleting an expired record must never alter a committed receipt.

## 6. API and Validation

- Treat `docs/openapi.yaml` as the API contract.
- Keep endpoint paths, HTTP methods, request schemas, response schemas, and status codes consistent with the contract.
- Use Zod to validate incoming request data.
- Reject malformed identifiers, invalid quantities, missing required fields, and invalid payloads.
- Use consistent error response formats with a stable `error.code` from the documented enum.
- Distinguish the failure classes with the documented status codes:
  - `400` — malformed or schema-invalid request, including a quantity that is not a positive integer and a missing `Idempotency-Key` header.
  - `401` — missing, malformed, or expired authentication.
  - `403` — authenticated but lacking the required role.
  - `404` — referenced resource does not exist.
  - `409` — duplicate resource or idempotency conflict.
  - `422` — structurally valid request that violates a business rule, such as over-receiving or receiving against a completed document.
  - `500` — unexpected server error.
  - `503` — readiness dependency unavailable.
- Do not use `422` for a schema failure, and do not use `409` for a plain business-rule violation.
- Never expose stack traces, password hashes, JWT secrets, database credentials, or other sensitive implementation details in API responses.
- Update the OpenAPI document when an approved API change is implemented.

Custom OpenAPI extensions such as `x-required-role` are documentation metadata unless explicitly connected to enforcement code. Implement authorization checks separately.

## 7. Security

- Hash passwords with bcrypt using a documented work factor (default `BCRYPT_ROUNDS=12`, minimum 10). Do not substitute a different algorithm without explicit approval.
- Never store plaintext passwords.
- Compare credentials in a way that does not reveal whether an email exists, and normalise emails to lower case before lookup.
- Keep JWT secrets and database credentials in environment variables.
- Never commit `.env` files containing real secrets.
- Provide `.env.example` with safe placeholder values.
- Validate and normalize user input where appropriate.
- Use the ORM or parameterized queries rather than constructing SQL from untrusted input.
- Enforce authentication and authorization on protected endpoints.
- Avoid returning unnecessary personal or sensitive information.
- Use secure defaults for production configuration.
- Do not disable security checks merely to make development or tests pass.
- Development seed accounts are for demonstration only. The seed command must be idempotent, must read its password from `SEED_PASSWORD`, and must refuse to run with `NODE_ENV=production` unless `ALLOW_PROD_SEED=true`. Never document a real credential in the repository.

## 8. Database and Migrations

- Use Prisma and PostgreSQL according to the approved architecture.
- Keep schema changes in version-controlled migrations.
- Ensure relevant uniqueness, foreign-key, and quantity constraints are enforced by the database where possible.
- Do not rely exclusively on application-level validation for critical integrity rules.
- Do not edit an already-applied migration to change database history.
- Test migrations against a clean development or test database.
- Use an isolated test database for automated tests, configured through `TEST_DATABASE_URL`. If it is unset, the test run must fail instead of falling back to `DATABASE_URL`.
- Enforce uniqueness with composite constraints where the rule is composite, notably `UNIQUE (performed_by, idempotency_key)` on `receipt_operations` and `UNIQUE (document_id, product_id)` on `receiving_items`.
- Preserve transaction history and referential integrity.

Cross-table rules that cannot be enforced using ordinary database constraints must be protected by transactional application logic and tests.

## 9. Frontend Requirements

- Use React and TypeScript.
- Keep API communication separate from presentation logic where practical.
- Display clear validation errors and request failures.
- Prevent accidental duplicate submissions where appropriate, without treating UI controls as the only idempotency protection.
- Reflect receiving document status and inventory values returned by the backend.
- Do not calculate authoritative inventory changes solely in the frontend.
- Do not expose protected functionality to unauthorized users.
- Keep the UI consistent with the approved scope; avoid adding unrelated features.

## 10. Testing Requirements

Use Vitest and Supertest according to the project's test configuration.

Add tests for applicable cases, including:

- Valid requests and expected responses.
- Missing or invalid input.
- Authentication and authorization.
- Missing resources.
- Duplicate SKU and invalid receiving document data.
- Partial and complete receipts.
- Zero, negative, and fractional quantities rejected as `400`; excessive quantities rejected as `422`.
- Idempotent retries with the same payload.
- Idempotency key reuse with a different target or payload, returning `409`.
- Replay of a successful receipt after the document has become `COMPLETED`.
- Idempotency keys scoped per user, including two users using the same key value.
- Inventory updates and transaction history.
- Database rollback on receipt failure.
- Concurrent receipt requests, including two documents receiving the same product.
- Receiving document status transitions, recalculated from all items.
- Document number generation and collision retry.
- API contract compliance, asserting the stable `error.code`.

Use deterministic fixtures and isolated test data. Do not weaken assertions simply to make tests pass.

After making changes, run the relevant tests, linting, type checking, and build commands supported by the repository. Report any command that could not be executed and why.

## 11. Docker and Application Configuration

- Keep Docker configuration reproducible.
- Use Docker Compose with the documented services: `db` (PostgreSQL), `api` (Express), and `web` (built frontend).
- Configure PostgreSQL health checks and `depends_on` conditions appropriately.
- The API container reaches PostgreSQL at host `db`; host processes use `localhost`. `DATABASE_URL` and `DATABASE_URL_HOST` exist for that reason and must not be conflated.
- Provide application health and readiness endpoints as defined in the API contract.
- Do not treat a running process as proof that the database is ready.
- Document required environment variables, including `DATABASE_URL`, `DATABASE_URL_HOST`, `TEST_DATABASE_URL`, `JWT_SECRET`, `BCRYPT_ROUNDS`, `CORS_ORIGIN`, `VITE_API_BASE_URL`, and `SEED_PASSWORD`.
- `VITE_API_BASE_URL` is consumed at build time, so changing it requires rebuilding the `web` image.
- Verify migrations and startup behavior using the documented setup.
- Never include production secrets in Docker files or committed configuration.

## 12. AI-Assisted Development Workflow

For each feature:

1. Read the relevant specifications.
2. Summarize the acceptance criteria.
3. Identify affected files, endpoints, database entities, and tests.
4. Propose an implementation plan.
5. Implement a focused change.
6. Review the diff for correctness and unintended modifications.
7. Run applicable automated checks.
8. Fix verified failures.
9. Update documentation.
10. Summarize changes, test results, and known limitations.

For code reviews, report findings with severity and file references. Distinguish confirmed defects from potential risks.

Do not fabricate test results, performance measurements, review findings, or AI usage history.

## 13. Git Practices

Use small, descriptive commits, for example:

- `chore: initialize project structure`
- `feat: add product management endpoints`
- `feat: create receiving documents`
- `feat: implement idempotent receipt processing`
- `test: cover inventory consistency`
- `docs: update API and setup instructions`

Before committing:

- Review the diff.
- Check for secrets and unrelated changes.
- Confirm that generated files are intentional.
- Verify that relevant tests have been run.

Do not rewrite or discard unrelated user changes.

## 14. Definition of Done

A feature is complete only when:

- Its behavior matches the approved requirements.
- Validation and authorization are implemented.
- Database integrity is preserved.
- Relevant automated tests are added and executed.
- API and technical documentation are updated where necessary.
- No known critical defects remain.
- Verification results and limitations are reported honestly.

The project is ready for submission when the required workflows are implemented, database migrations work from a clean state, automated checks pass, Docker setup is reproducible, and the README enables another developer to run the application locally.
