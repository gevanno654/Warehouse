# AGENTS.md

## 1. Project Overview

Build a Warehouse Receiving System using spec-driven development.

The application must support product management, receiving document creation, partial and full receipts, inventory tracking, and inventory transaction history.

### Technology Stack

- Frontend: React, TypeScript, Vite
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Request validation: Zod
- Authentication: JWT
- API documentation: OpenAPI 3.1
- Automated testing: Vitest and Supertest
- Local development: Docker Compose

Follow the existing project structure and package configuration. Do not replace the selected stack without explicit approval.

## 2. Mandatory Documentation

Before implementing a feature, read the relevant documents:

- `docs/prd.md`
- `docs/technical-spec.md`
- `docs/erd.mmd`
- `docs/openapi.yaml`
- `docs/data-flow.mmd`
- `docs/ai-workflow.md`

These documents define the expected system behavior and architecture.

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
- Enforce SKU uniqueness.
- Only authorized roles may create or manage products.
- Do not delete or alter existing product records in ways that violate receiving or inventory history.

### Receiving documents

- Support `PENDING`, `PARTIALLY_RECEIVED`, and `COMPLETED` statuses.
- A receiving item must have a positive expected quantity.
- Received quantity must be an integer greater than or equal to zero.
- Received quantity must never exceed expected quantity.
- Reject invalid receipt requests without partially modifying data.
- Calculate document status from its item quantities according to the approved specifications.

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

1. Validate the receiving document and item.
2. Verify that the requested quantity is valid.
3. Determine the remaining expected quantity.
4. Handle idempotency.
5. Record the receipt operation.
6. Increase the receiving item's cumulative received quantity.
7. Increase inventory by the accepted quantity.
8. Insert the corresponding inventory transaction.
9. Recalculate the receiving document status.
10. Store the response snapshot required for idempotent retries.
11. Commit the database transaction.

If any required operation fails, roll back the entire transaction.

### Concurrency

- Use appropriate database transactions and row-level locking, or an equivalent strategy that guarantees correctness.
- Ensure concurrent requests cannot cause over-receiving or duplicate inventory updates.
- Do not depend solely on frontend validation or a prior unlocked read.
- Handle database uniqueness conflicts and transaction retries deliberately.

### Idempotency

- Require the `Idempotency-Key` header for receipt requests as defined in `docs/openapi.yaml`.
- Store enough information to associate a key with its request payload and result.
- Repeating a request with the same key and same payload must not apply the receipt twice.
- Reusing a key with a different payload must return the documented conflict response.
- Handle simultaneous requests using the same key safely.
- Do not return a successful response for an operation that was rolled back.

## 6. API and Validation

- Treat `docs/openapi.yaml` as the API contract.
- Keep endpoint paths, HTTP methods, request schemas, response schemas, and status codes consistent with the contract.
- Use Zod to validate incoming request data.
- Reject malformed identifiers, invalid quantities, missing required fields, and invalid payloads.
- Use consistent error response formats.
- Distinguish authentication failures, authorization failures, missing resources, business-rule conflicts, and unexpected server errors.
- Never expose stack traces, password hashes, JWT secrets, database credentials, or other sensitive implementation details in API responses.
- Update the OpenAPI document when an approved API change is implemented.

Custom OpenAPI extensions such as `x-required-role` are documentation metadata unless explicitly connected to enforcement code. Implement authorization checks separately.

## 7. Security

- Hash passwords using an appropriate password-hashing algorithm.
- Never store plaintext passwords.
- Keep JWT secrets and database credentials in environment variables.
- Never commit `.env` files containing real secrets.
- Provide `.env.example` with safe placeholder values.
- Validate and normalize user input where appropriate.
- Use the ORM or parameterized queries rather than constructing SQL from untrusted input.
- Enforce authentication and authorization on protected endpoints.
- Avoid returning unnecessary personal or sensitive information.
- Use secure defaults for production configuration.
- Do not disable security checks merely to make development or tests pass.

## 8. Database and Migrations

- Use Prisma and PostgreSQL according to the approved architecture.
- Keep schema changes in version-controlled migrations.
- Ensure relevant uniqueness, foreign-key, and quantity constraints are enforced by the database where possible.
- Do not rely exclusively on application-level validation for critical integrity rules.
- Do not edit an already-applied migration to change database history.
- Test migrations against a clean development or test database.
- Use an isolated test database for automated tests.
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
- Zero, negative, fractional, and excessive receipt quantities.
- Idempotent retries with the same payload.
- Idempotency key reuse with a different payload.
- Inventory updates and transaction history.
- Database rollback on receipt failure.
- Concurrent receipt requests.
- Receiving document status transitions.
- API contract compliance.

Use deterministic fixtures and isolated test data. Do not weaken assertions simply to make tests pass.

After making changes, run the relevant tests, linting, type checking, and build commands supported by the repository. Report any command that could not be executed and why.

## 11. Docker and Application Configuration

- Keep Docker configuration reproducible.
- Use Docker Compose for the documented local development setup.
- Configure PostgreSQL health checks and service dependencies appropriately.
- Provide application health and readiness endpoints as defined in the API contract.
- Do not treat a running process as proof that the database is ready.
- Document required environment variables.
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
