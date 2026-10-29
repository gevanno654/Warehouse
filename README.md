# Warehouse Receiving System

A warehouse receiving application for recording incoming goods, tracking partial and completed receipts, and maintaining accurate inventory transaction history.

The project follows a spec-driven development approach with AI-assisted implementation. Business rules, API contracts, and database integrity requirements are documented before implementation.

## 1. Features

- User authentication using JWT.
- Role-based access control for operators and supervisors.
- Product management with unique SKUs.
- Receiving document creation and retrieval.
- Partial and complete receipt processing.
- Automatic inventory quantity updates.
- Receiving document status tracking.
- Inventory transaction history.
- Idempotent receipt requests to prevent duplicate stock updates.
- API health and readiness endpoints.
- Automated unit and integration tests.
- Docker Compose-based local development.

## 2. Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Request validation | Zod |
| Authentication | JWT |
| API documentation | OpenAPI 3.1 |
| Testing | Vitest, Supertest |
| Local environment | Docker Compose |

## 3. Project Structure

The following is the intended repository structure. Update it to match the actual implementation as the project develops.

```text
warehouse-receiving-system/
├── AGENTS.md
├── README.md
├── docker-compose.yml
├── .env.example
├── .gitignore
├── .dockerignore
├── .nvmrc
├── docs/
│   ├── prd.md
│   ├── technical-spec.md
│   ├── data-model.md
│   ├── erd.mmd
│   ├── openapi.yaml
│   ├── data-flow.mmd
│   ├── ai-workflow.md
│   └── testing.md
├── docker/
│   └── postgres/
│       └── init-test-db.sql
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── components/
│       ├── hooks/
│       ├── services/
│       ├── App.tsx
│       └── main.tsx
└── backend/
    ├── Dockerfile
    ├── package.json
    ├── prisma.config.ts
    ├── prisma/
    │   ├── schema.prisma
    │   ├── seed.ts
    │   └── migrations/
    ├── src/
    │   ├── config/
    │   ├── lib/
    │   ├── middleware/
    │   ├── routes/
    │   ├── seed/
    │   ├── test-support/
    │   ├── app.ts
    │   └── server.ts
    └── tests/
        └── helpers/
```

Directories that appear in later phases — `backend/src/modules/` and the frontend feature pages — are added when the corresponding feature is implemented.

## 4. Prerequisites

Install the following tools before running the application:

- Node.js **24.x** (pinned; the repository includes an `.nvmrc`).
- npm.
- Docker Engine or Docker Desktop with Docker Compose support.
- Git.

A separate local PostgreSQL installation is not required if the database runs through Docker Compose.

## 5. Getting Started

### Step 1: Clone the repository

```bash
git clone <repository-url>
cd warehouse-receiving-system
```

Replace `<repository-url>` with the actual Git repository URL.

### Step 2: Configure environment variables

Copy the environment template:

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
```

**Linux or macOS**

```bash
cp .env.example .env
```

Configure the required values in `.env`. The full variable list is maintained in `.env.example`; the required keys are:

```dotenv
NODE_ENV=development
PORT=3000

# Used by the api container to reach PostgreSQL. Service name is "db".
DATABASE_URL=postgresql://<user>:<password>@db:5432/warehouse
# Used when running the API directly on the host instead of in Docker.
DATABASE_URL_HOST=postgresql://<user>:<password>@localhost:5432/warehouse
# Used by automated tests. Must be a separate database.
TEST_DATABASE_URL=postgresql://<user>:<password>@localhost:5432/warehouse_test

POSTGRES_USER=<user>
POSTGRES_PASSWORD=<password>
POSTGRES_DB=warehouse

JWT_SECRET=<replace-with-a-strong-random-secret>
JWT_EXPIRES_IN=1h
BCRYPT_ROUNDS=12

CORS_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=http://localhost:3000

# Development-only seed account password. Never reuse in production.
SEED_PASSWORD=<development-only-password>
```

The PostgreSQL service name is **`db`**. `DATABASE_URL` uses `db` because it is resolved inside the Compose network; `DATABASE_URL_HOST` uses `localhost` for processes running on your machine. These are two different hostnames for the same database — use the one that matches where the process runs.

These values are development placeholders only. Do not commit `.env` or real credentials to Git. Keep `.env.example` limited to safe placeholder values.

`VITE_API_BASE_URL` is read by Vite at **build time**, so changing it requires rebuilding the `web` image.

### Step 3: Start the services

Run the services using Docker Compose:

```bash
docker compose up --build -d
```

Check the service status:

```bash
docker compose ps
```

Inspect application logs if a service fails to start:

```bash
docker compose logs --tail=100
```

The application requires database migrations before the seeded users and any database-backed feature will work. Follow Steps 4 and 5 in that order. Health and readiness checks work without them, but readiness reports `503` until the database is reachable.

### Step 4: Apply database migrations

Run the Prisma migration command from the backend project directory, or through the `api` service.

For a development database:

```bash
cd backend
npx prisma migrate dev
```

For an environment using committed migrations, including production-like deployments:

```bash
cd backend
npx prisma migrate deploy
```

Use `migrate dev` for development workflows and `migrate deploy` to apply existing migrations in deployment environments. Do not use development migration commands against production.

The committed initial migration is `backend/prisma/migrations/20261029072619_init/`. It creates the seven application tables, their enums, unique and foreign-key constraints, and the quantity and hash `CHECK` constraints that Prisma cannot express in `schema.prisma`. Those `CHECK` constraints are added directly in the migration SQL and apply to every database created from the migration history.

`migrate deploy` never resets data. `migrate dev` may prompt to reset the development database when it detects drift, so run it only against a database you are willing to recreate.

### Step 5: Create the development users

The application requires seeded users before you can log in. The seed command creates one supervisor and one operator account:

```bash
cd backend
npm run db:seed
```

| Role | Email | Password |
|---|---|---|
| Supervisor | `supervisor@example.com` | value of `SEED_PASSWORD` |
| Operator | `operator@example.com` | value of `SEED_PASSWORD` |

The command requires:

- A migrated database reachable through `DATABASE_URL`.
- `SEED_PASSWORD` set to a non-empty value in the environment or in `.env`. The script loads the repository-root `.env` and then `backend/.env`, but an already-exported variable wins. Nothing is hard-coded, so no real credential appears in the repository.
- `BCRYPT_ROUNDS` optionally. It defaults to `12`, and values below the documented minimum of `10` are rejected.

These accounts exist for **development and demonstration only**. The seed script is idempotent: each account is looked up by email, so a second run creates no duplicates and reports `already exists; left unchanged`. An existing password is never reset. If an existing account has drifted from its documented role, the role is corrected and the password is left untouched. The script refuses to run when `NODE_ENV=production` unless `ALLOW_PROD_SEED=true` is set. Never enable it in a real deployment, and never reuse the development password.

### Step 6: Verify application health

Use the configured API address to check the health endpoint:

```bash
curl http://localhost:3000/health
```

Check readiness separately:

```bash
curl http://localhost:3000/ready
```

If the actual Docker configuration uses different host ports, replace them accordingly. The default host ports are `3000` for the API and `5173` for the web application.

A successful health response indicates process health according to the endpoint implementation. Readiness also verifies that required dependencies, such as PostgreSQL, are available, and returns `503` when they are not.

### Step 7: Stop the services

```bash
docker compose down
```

This stops and removes the containers while keeping the database volume. Add `-v` only when you intend to discard all database data; see the troubleshooting notes in section 12 before doing so.

## 6. Running the Application Without Docker

For local development without Docker, install and run the frontend and backend separately.

### Backend

```bash
cd backend
npm install
```

When running on the host, set `DATABASE_URL` to the host connection string (`DATABASE_URL_HOST` in `.env.example`, pointing at `localhost`).

Generate the Prisma client and validate the schema:

```bash
npm run db:generate
npm run db:validate
```

Start the backend with the script defined in `backend/package.json`:

```bash
npm run dev
```

### Frontend

Open another terminal:

```bash
cd frontend
npm install
```

`VITE_API_BASE_URL` is read from the repository-root `.env`, so the value from Step 2 applies to both projects. It must be the address the **browser** can reach, for example:

```dotenv
VITE_API_BASE_URL=http://localhost:3000
```

Start the frontend with the configured development script:

```bash
npm run dev
```

The Vite dev server runs on `http://localhost:5173`, which matches the default `CORS_ORIGIN`.

The frontend and backend scripts above are examples. Confirm the available scripts in each `package.json` before running them. Ensure the frontend API URL points to the reachable backend address.

## 7. API Documentation

The API contract is maintained in:

`docs/openapi.yaml`

It defines endpoints, request and response schemas, authentication requirements, and HTTP status codes.

The endpoint groups are:

| Endpoint | Purpose |
|---|---|
| `/health` | Process health |
| `/ready` | Application readiness |
| `/api/v1/auth/login` | Authenticate a user |
| `/api/v1/auth/me` | Retrieve the authenticated user |
| `/api/v1/products` | List or create products |
| `/api/v1/receiving-documents` | List or create receiving documents |
| `/api/v1/receiving-documents/{id}` | Retrieve a receiving document |
| `/api/v1/receiving-documents/{id}/items/{itemId}/receipts` | Record a receipt |
| `/api/v1/inventory` | Retrieve inventory |
| `/api/v1/inventory/transactions` | Retrieve inventory transaction history |

### Swagger UI

When the API is running, interactive documentation is available at:

```text
http://localhost:3000/docs
```

The raw OpenAPI document is served at `http://localhost:3000/openapi.yaml`. Replace the host or port if your configuration differs.

### Authentication

Protected endpoints use a JWT bearer token.

```http
Authorization: Bearer <access-token>
```

Obtain a token from `POST /api/v1/auth/login`:

```bash
curl -s http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"supervisor@example.com","password":"<seed-password>"}'
```

The response contains `accessToken`, `tokenType` (`Bearer`), `expiresIn` (seconds) and the authenticated `user`. Send it as `Authorization: Bearer <accessToken>` on every protected request.

Implementation notes:

- Tokens are HS256 JWTs signed with `JWT_SECRET`, with a lifetime of `JWT_EXPIRES_IN` (seconds, parsed from values such as `1h`). `expiresIn` in the login response is that lifetime in seconds, so it matches the contract example of `3600`.
- Verification checks the signature, the algorithm, `exp`, `iss`, `aud`, and the `sub`/`role` claims. A missing, malformed, forged or expired token all produce `401 UNAUTHENTICATED`; the reason is not disclosed.
- `JWT_SECRET` must be at least 16 characters. Startup fails with an actionable configuration error when `JWT_SECRET` or `JWT_EXPIRES_IN` is missing or invalid, rather than starting a server that cannot authenticate.
- Unknown emails are compared against a dummy bcrypt hash so the response time does not reveal whether an account exists. Unknown email and wrong password return the same `401` body.
- The API does not implement registration, password reset, or refresh tokens.

Product creation requires the `SUPERVISOR` role. The permission is enforced on the backend, not by the UI: an operator who calls the endpoint receives `403 FORBIDDEN`. Listing products is available to both roles. All other endpoints in the table above require authentication but are available to both roles.

Product creation is atomic. The product row and its single `inventories` row (`available_quantity = 0`) are written in one transaction, so a failure on either leaves neither behind. The SKU is trimmed and upper-cased before the uniqueness check, so `widget-1` and `  WIDGET-1 ` collide and return `409 DUPLICATE_SKU`.

### Receipt requests

Receipt requests require an `Idempotency-Key` header:

```http
POST /api/v1/receiving-documents/{id}/items/{itemId}/receipts
Authorization: Bearer <access-token>
Idempotency-Key: <unique-request-key>
Content-Type: application/json
```

The request body must follow the schema defined in `docs/openapi.yaml`.

Idempotency keys are scoped to the authenticated user. The behaviour is:

| Request | Result |
|---|---|
| Same key, same document, item, and quantity | `200`, stored result returned, no additional stock movement |
| Same key, different document, item, or quantity | `409` with code `IDEMPOTENCY_KEY_CONFLICT`, no changes |
| New key | `201` when the receipt is accepted |

A first-time success returns `201`; a replay of that same request returns `200` with the identical body. Frontend code should generate one key per logical submission and reuse it only when retrying that submission.

## 8. Business Rules

- Receiving quantities must be positive integers.
- Received quantities must never exceed expected quantities.
- Receiving documents use `PENDING`, `PARTIALLY_RECEIVED`, and `COMPLETED` statuses.
- Inventory increases only when a receipt is successfully accepted.
- Every successful receipt operation must have a corresponding inventory transaction.
- Receipt processing must be atomic.
- Concurrent receipt requests must not cause over-receiving or duplicate stock updates.
- Receipt processing locks the receiving document, then the receiving item, then the inventory row, in that order.
- Backend authorization must enforce the permissions assigned to each role.

### HTTP status codes

| Status | Meaning |
|---|---|
| `400` | Malformed or schema-invalid request |
| `401` | Missing or invalid authentication |
| `403` | Authenticated but not authorised for the operation |
| `404` | Resource not found |
| `409` | Duplicate resource or idempotency conflict |
| `422` | Valid structure but a business rule was violated |
| `500` | Unexpected server error |
| `503` | Readiness check failed |

Over-receiving returns `422` with code `RECEIPT_EXCEEDS_REMAINING`. Receiving against a completed document returns `422` with code `DOCUMENT_ALREADY_COMPLETED`. Duplicate SKUs and idempotency key reuse return `409`.

A zero, negative, or fractional quantity is a schema failure rather than a business-rule failure: it returns `400` with code `INVALID_QUANTITY`. A missing `Idempotency-Key` header returns `400` with code `IDEMPOTENCY_KEY_REQUIRED`. The dividing rule is that a request which does not match the schema is `400`, while a schema-valid request that breaks a business rule is `422`.

Refer to `docs/prd.md` and `docs/technical-spec.md` for the complete requirements.

## 9. Running Tests

Database-backed tests require an isolated PostgreSQL database configured through `TEST_DATABASE_URL`. They must never run against the development or production database. If `TEST_DATABASE_URL` is unset, the test run fails with an explicit error rather than falling back to `DATABASE_URL`.

### Test database safety rule

`TEST_DATABASE_URL` is accepted only when **all** of the following hold:

1. The variable is set and is a valid connection string with an explicit database name.
2. The database name ends in `_test` (for example `warehouse_test`). This is the documented rule that makes a test target unambiguous.
3. The database name is not a system database (`postgres`, `template0`, `template1`).
4. It is not byte-for-byte identical to `DATABASE_URL`.

The check lives in [backend/src/test-support/test-database.ts](backend/src/test-support/test-database.ts). The test suite loads environment files and then **removes `DATABASE_URL`** from the process so an accidental fallback fails loudly instead of silently succeeding. `TRUNCATE ... RESTART IDENTITY CASCADE` is issued only after the target has passed the rule above; no reset, drop, truncate, or destructive migration runs against an unverified database.

Compose creates the test database through [docker/postgres/init-test-db.sql](docker/postgres/init-test-db.sql) when the data volume is first initialised. If the volume already exists, create it manually:

```bash
docker compose exec db createdb -U "$POSTGRES_USER" warehouse_test
```

### Applying migrations to the test database

The schema tests exercise real constraints, so the test database needs the same migration history:

```bash
cd backend
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
```

Run this once per fresh test database. Tests reset rows between cases; they never recreate the schema.

### Running the database-backed tests

```bash
cd backend
export TEST_DATABASE_URL="postgresql://<user>:<password>@localhost:5432/warehouse_test"
npm test
```

Without `TEST_DATABASE_URL` the database suites fail with `TestDatabaseConfigError` and the message explaining that there is no fallback. This is intentional: it proves the guard works. The health, configuration, and frontend suites open no database and pass either way.

Backend:

```bash
cd backend
npm test
npm run lint
npm run typecheck
npm run build
```

Frontend:

```bash
cd frontend
npm test
npm run lint
npm run typecheck
npm run build
```

Each project uses a single `eslint.config.js` flat config with type-aware rules. Run the commands from the project directory so the correct config and `tsconfig.json` are picked up.

Use an isolated test database. Do not point automated tests at production data.

Priority test areas include:

- Authentication and role-based authorization.
- Product and receiving document validation.
- Partial and complete receipt processing.
- Inventory consistency and transaction history.
- Idempotency and duplicate requests.
- Concurrent receipt processing.
- Database transaction rollback.
- API contract compliance.

The full test plan is available in `docs/testing.md`.

## 10. Database Management

Prisma schema and migrations are maintained in the backend project.

Common development commands include:

```bash
cd backend
npm run db:validate
npm run db:generate
npm run db:migrate:dev
npm run db:migrate:deploy
npm run db:seed
```

Use the commands from the backend directory with the correct environment variables configured.

Avoid manually editing the database schema without creating a corresponding migration. Never modify an already-applied migration to rewrite database history.

### Schema and constraint notes

`docs/data-model.md` §3 requires database-level enforcement of quantity and hash rules that Prisma's schema language cannot express (`CHECK` constraints). They are authored directly in the initial migration and are part of the migration history from its first application. Changing one later requires a new migration, not an edit to `20261029072619_init`.

Model-level naming uses `@map`/`@@map`, so the Prisma models are camel-case while the tables and columns match the snake_case names in `docs/erd.mmd`.

`20261029153544_widen_product_sku` widens `products.sku` from `VARCHAR(64)` to `VARCHAR(100)` so the column matches `docs/openapi.yaml` (`maxLength: 100`) and `docs/technical-spec.md` §4.2. It is additive: existing data, the unique index, and every relationship that references `products` are unchanged.

`20261029180000_add_document_number_sequence` adds the `receiving_document_number_seq` sequence backing backend-generated document numbers (`RCV-<YYYYMMDD>-<000001>`, `docs/technical-spec.md` §5.5). No table is altered; the Prisma schema is unchanged because the sequence is consumed through raw SQL inside the creation transaction.

## 11. AI-Assisted Development

This repository uses spec-driven development with AI coding assistance.

Before implementing a feature, consult `AGENTS.md` and the relevant documents in `docs/`.

AI-generated code must be reviewed and verified through automated tests. Do not assume generated code is correct merely because it compiles.

The AI workflow, reusable prompts, verification practices, and development rules are documented in:

- `AGENTS.md`
- `docs/ai-workflow.md`

## 12. Troubleshooting

### PostgreSQL is unavailable

Check the service status and logs:

```bash
docker compose ps
docker compose logs db
```

The database service is named `db`. Verify that `DATABASE_URL` uses `db` when the API runs inside Compose and `DATABASE_URL_HOST` uses `localhost` when it runs on the host. Wait for PostgreSQL to become ready before running migrations; Compose enforces this with a health check and `depends_on`.

### Database migration fails

Check that:

- `DATABASE_URL` is correct.
- PostgreSQL is available.
- The database user has the required permissions.
- The migration files are present.
- The schema is compatible with the current migration history.

Do not delete database volumes or reset the database without confirming that the data can safely be discarded.

### API returns `401 Unauthorized`

Verify that the login request succeeded, the token is valid, and the `Authorization` header uses the bearer token format.

### API returns `403 Forbidden`

Verify that the authenticated user has the required role for the requested operation.

### Receipt request returns `422 Unprocessable Entity`

The request was structurally valid but violated a business rule. Check `error.code`:

- `RECEIPT_EXCEEDS_REMAINING` — the quantity exceeds the item's remaining expected quantity. `error.details.remainingQuantity` reports the current limit.
- `DOCUMENT_ALREADY_COMPLETED` — the receiving document is already fully received and accepts no further receipts.

### Receipt request returns `409 Conflict`

The request collided with existing state. Check `error.code`:

- `IDEMPOTENCY_KEY_CONFLICT` — the key was already used by this user for a different document, item, or quantity.
- `DUPLICATE_DOCUMENT_ITEM` — the same product appears more than once in the submitted document.
- `DUPLICATE_SKU` — a product with that SKU already exists.

### Services fail to start

Inspect container logs:

```bash
docker compose logs --tail=200
```

Verify environment variables, ports, dependency health, and the configured startup commands.

## 13. Documentation Index

| Document | Description |
|---|---|
| `AGENTS.md` | Instructions for AI coding agents |
| `docs/prd.md` | Product requirements and acceptance criteria |
| `docs/technical-spec.md` | System architecture and implementation design |
| `docs/data-model.md` | Constraints, enumerated values, integrity and idempotency rules |
| `docs/erd.mmd` | Entity relationship diagram (raw Mermaid source) |
| `docs/openapi.yaml` | REST API contract |
| `docs/data-flow.mmd` | Request and receipt-processing data flow (raw Mermaid source) |
| `docs/ai-workflow.md` | AI-assisted development workflow |
| `docs/testing.md` | Testing strategy and test cases |

## 14. Project Status

Update this section as implementation progresses.

- [x] Specifications and project documentation (Phase 0)
- [x] Project foundation (Phase 1) — API health/readiness, Swagger UI, frontend shell, Docker Compose
- [x] Database schema and migrations (Phase 2) — seven Prisma models, initial migration, test-database safeguards, idempotent development seed
- [x] Authentication and authorization (Phase 3A) — login, `/auth/me`, JWT bearer middleware, `OPERATOR`/`SUPERVISOR` role enforcement
- [x] Product management (Phase 3A) — list and supervisor-only create, atomic product plus inventory creation
- [x] Receiving document management (Phase 3B) — atomic list/create/detail, backend-generated document numbers with sequence plus bounded collision retry
- [x] Partial and complete receipt processing (Phase 3B) — single-transaction receipts with document → item → inventory row locking and derived status recalculation
- [x] Inventory and transaction history (Phase 3B) — persisted stock listing with search, newest-first `RECEIPT` audit trail with product and date filters
- [x] Idempotency and concurrency protection (Phase 3B) — per-user keys, canonical SHA-256 request hash, stored-snapshot replay (`200`), conflict (`409`), unique-violation race recovery, rollback on failure
- [x] Automated tests (Phase 3B backend) — 196 backend tests passing (11 files) against an isolated PostgreSQL test database, including real concurrency, fault-injection rollback, and contract-consistency suites
- [x] API contract verification (Phase 3B backend) — served `openapi.yaml` is byte-identical to the reviewed document; implemented routes match documented paths/methods and the error registry matches the `ErrorCode` enum
- [ ] Final setup and deployment verification

Do not mark a feature as complete until its implementation and verification have been performed.
