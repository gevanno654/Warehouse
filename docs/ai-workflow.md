# AI-Assisted Development Workflow

## 1. Purpose

This document defines how AI coding assistants are used to develop the Warehouse Receiving System. The workflow follows a spec-driven development approach: requirements and technical specifications are established before implementation, and AI-generated code must be reviewed and tested before being accepted.

AI is a development assistant, not the source of truth. The approved requirements, technical specification, API contract, and automated tests take precedence over AI-generated assumptions.

## 2. Source of Truth

AI agents must consult the following documents before implementing features:

| Document | Purpose |
|---|---|
| `docs/prd.md` | Business requirements, user roles, business rules, and acceptance criteria |
| `docs/technical-spec.md` | Architecture, technology stack, database design, and implementation decisions |
| `docs/erd.mmd` | Entity relationships and database constraints |
| `docs/openapi.yaml` | REST API contract, request schemas, responses, and error formats |
| `docs/data-flow.mmd` | Request processing and receipt transaction flow |
| `docs/ai-workflow.md` | AI usage rules and verification process |

If these documents conflict, stop implementation and report the conflict instead of silently choosing an interpretation. Update the relevant specification before proceeding.

## 3. Development Workflow

### Step 1: Understand the requirements

Before writing code, the AI agent must:
- Read the relevant specification documents.
- Identify the feature's expected behavior and acceptance criteria.
- Identify affected API endpoints, database entities, and user roles.
- List assumptions, dependencies, and potential failure cases.
- Ask for clarification when a business rule is ambiguous.

**Output:** A short implementation plan with affected files, validation rules, and tests.

### Step 2: Design the implementation

Before modifying code, determine:
- Which backend routes, controllers, services, and schemas are required.
- Whether database migrations or constraints are needed.
- How authentication and authorization apply.
- How errors, duplicate requests, and concurrent operations are handled.
- Which automated tests will verify the feature.

**Output:** A proposed implementation plan consistent with the approved specifications.

### Step 3: Implement in small increments

Implement one feature or logical unit at a time. Avoid generating the entire application in a single unreviewed change.

Recommended order:

1. Project configuration and environment setup.
2. Database schema and migrations.
3. Authentication and authorization.
4. Product management.
5. Receiving document creation and retrieval.
6. Receipt processing and inventory updates.
7. Inventory and transaction history.
8. Frontend integration.
9. Docker configuration and documentation.

The AI agent must preserve existing behavior unless a change is explicitly required.

### Step 4: Verify the implementation

After each logical change:

1. Review the generated diff.
2. Run linting and type checking.
3. Run relevant unit and integration tests.
4. Verify that the implementation follows the API contract.
5. Test failure cases and authorization boundaries.
6. Run the full test suite before declaring the feature complete.

Do not claim a command or test passed unless it was actually executed and its result was inspected.

### Step 5: Review and document

Before accepting a change:
- Check for hardcoded secrets, unsafe SQL, and exposed sensitive data.
- Check transaction boundaries and database consistency.
- Confirm that documentation reflects the actual implementation.
- Record unresolved issues and known limitations.
- Commit the verified changes with a descriptive Git message.

## 4. AI Coding Agent Rules

The following instructions should be placed in the repository's `AGENTS.md` file or the equivalent project-level instruction file used by the selected coding agent.

### General rules

- Read relevant project documentation before modifying code.
- Use TypeScript consistently in the frontend and backend.
- Follow the established folder structure and naming conventions.
- Validate untrusted request data at the API boundary using the project's validation approach.
- Keep business logic out of route handlers where practical.
- Use parameterized database operations through the configured ORM.
- Never commit secrets, credentials, production data, or environment files containing secrets.
- Do not introduce dependencies without explaining why they are needed.
- Do not modify specifications merely to make an implementation appear compliant.
- Do not mark incomplete or untested functionality as complete.

### Warehouse receiving rules

- A receipt quantity must be a positive integer.
- The quantity received must never exceed the item's remaining expected quantity.
- Inventory must never become negative.
- Receipt processing must update the receiving item, inventory, receipt operation, inventory transaction, and document status atomically.
- Use database transactions and appropriate row locking or equivalent concurrency controls.
- Enforce idempotency for receipt requests using the `Idempotency-Key` contract.
- Reusing an idempotency key with a different request payload must return a conflict.
- A retry with the same key and same payload must not increase inventory twice.
- Recalculate the receiving document status from its item quantities within the transaction.
- Enforce role-based authorization on the backend; frontend restrictions alone are insufficient.
- Do not bypass database constraints to make a failing operation succeed.

## 5. Reusable AI Prompts

### Prompt A: Feature planning

```text
Read AGENTS.md and the relevant files in docs/ before making changes.

Feature: [describe the feature]

First, do not write code. Provide:
1. Requirements and acceptance criteria relevant to this feature.
2. Files and database entities likely to be affected.
3. API changes, if any.
4. Validation and authorization rules.
5. Failure cases and concurrency risks.
6. Automated tests required.
7. Any conflicts or ambiguities in the specifications.

Do not invent business rules. Identify assumptions explicitly.
```

### Prompt B: Implementation

```text
Implement the approved feature plan for [feature].

Requirements:
- Follow AGENTS.md and the approved specifications.
- Preserve the existing architecture and API contract.
- Add or update database migrations when required.
- Validate all incoming data.
- Enforce backend authorization.
- Handle errors explicitly.
- Add automated tests for success, validation failure,
  authorization failure, and relevant edge cases.

Do not claim tests passed unless you run them.
After implementation, summarize the changed files,
design decisions, test commands, actual test results,
and remaining limitations.
```

### Prompt C: Receipt transaction review

```text
Review the receipt-processing implementation against
docs/prd.md, docs/technical-spec.md, docs/erd.mmd,
docs/openapi.yaml, and docs/data-flow.mmd.

Do not modify code initially.

Check:
1. Whether over-receiving is prevented.
2. Whether concurrent requests can cause incorrect stock.
3. Whether row locking and transaction boundaries are correct.
4. Whether duplicate requests are idempotent.
5. Whether a reused key with a different payload returns a conflict.
6. Whether all receipt-related database writes are atomic.
7. Whether document status is calculated correctly.
8. Whether database constraints support the business rules.
9. Whether failure paths roll back all relevant changes.
10. Whether automated tests cover these cases.

Report findings by severity, with file references and
specific reproduction scenarios where possible.
Do not report a risk as a confirmed defect without evidence.
```

### Prompt D: Test generation and verification

```text
Review the tests for [feature] against its acceptance criteria.

Identify missing cases, then add focused automated tests.

Include applicable cases for:
- Valid requests.
- Invalid input and boundary values.
- Unauthenticated and unauthorized requests.
- Missing or invalid resource identifiers.
- Duplicate requests and idempotency.
- Database failures and transaction rollback.
- Concurrent requests and data consistency.

Run the relevant tests and report the exact commands,
results, failures, and any tests that could not be executed.
Do not weaken assertions simply to make tests pass.
```

### Prompt E: Final code review

```text
Review the current changes against the approved specifications.

Check correctness, security, maintainability, API compatibility,
database integrity, test coverage, and documentation.

Return:
1. Findings ordered by severity.
2. Evidence with file and line references.
3. Reproduction steps for confirmed defects.
4. Missing tests.
5. Recommended fixes.

Do not change code until the review findings are presented.
Do not approve the changes if critical correctness issues remain.
```

## 6. Required Testing Strategy

| Area | Minimum verification |
|---|---|
| Authentication | Valid login, invalid credentials, expired or invalid token |
| Authorization | Operator cannot perform supervisor-only actions |
| Products | Required fields, invalid input, duplicate SKU |
| Receiving documents | Valid creation, empty items, invalid products, duplicate products in one document |
| Receipt processing | Valid partial receipt, final receipt, zero or negative quantity, over-receiving |
| Idempotency | Same key and payload does not duplicate stock; same key with different payload returns conflict |
| Inventory | Stock increases by exactly the accepted receipt quantity |
| Transaction history | One corresponding inventory transaction per successful receipt operation |
| Atomicity | Failed receipt processing leaves no partial database updates |
| Concurrency | Concurrent receipts cannot exceed expected quantity or corrupt inventory |
| API contract | Response bodies and HTTP status codes conform to `docs/openapi.yaml` |
| Deployment | Docker services start, health checks work, and database migrations apply |

Tests should use an isolated test database and deterministic fixtures. Avoid relying on production data or external services for core business-rule tests.

## 7. Git and Change Management

Use small, descriptive commits. Examples:

```text
chore: initialize project structure
docs: add product and receiving requirements
feat: add product management endpoints
feat: implement receiving document creation
feat: process receipts with idempotency
test: cover concurrent receipt processing
fix: prevent duplicate inventory updates
docs: document local setup and API usage
```

Before committing, inspect the diff and ensure that no secrets, temporary files, or unrelated changes are included.

## 8. Definition of Done

A feature is complete only when:

- Its behavior matches the approved requirements.
- Relevant validation and authorization are implemented.
- Database integrity is preserved.
- Automated tests have been added and executed.
- The API contract and documentation are updated when necessary.
- No known critical defects remain.
- The actual verification results are recorded.

The application is ready for submission when the required features are implemented, migrations work on a clean database, automated tests pass, Docker setup is documented, and another developer can follow the README to run the application locally.

## 9. Transparency and Limitations

AI-generated code may contain incorrect assumptions, incomplete edge-case handling, or security vulnerabilities. All generated code must be reviewed and verified.

Record meaningful AI-assisted decisions and corrections in Git history or development notes. Do not fabricate prompts, test results, performance measurements, or claims about AI usage.

The final implementation and test results, rather than the AI's own assessment, determine whether the system meets the requirements.
```