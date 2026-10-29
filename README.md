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
├── frontend/
│   ├── package.json
│   └── src/
└── backend/
    ├── package.json
    ├── prisma/
    │   ├── schema.prisma
    │   ├── migrations/
    │   └── seed.ts
    ├── src/
    └── tests/
```

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

The application may require database migrations before it can serve requests. Follow the migration instructions below.

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

These accounts exist for **development and demonstration only**. The seed script is idempotent, so running it again does not create duplicates. It refuses to run when `NODE_ENV=production` unless `ALLOW_PROD_SEED=true` is set. Never enable it in a real deployment, and never reuse the development password.

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

When running on the host, set `DATABASE_URL` to the host connection string (`DATABASE_URL_HOST` in `.env.example`, pointing at `localhost`). Then apply migrations and seed the development users:

```bash
npx prisma migrate dev
npm run db:seed
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

Set `VITE_API_BASE_URL` in `frontend/.env` to the reachable API address, for example:

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

Product creation requires the `SUPERVISOR` role. All other endpoints in the table above require authentication but are available to both roles.

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

Tests require an isolated PostgreSQL database configured through `TEST_DATABASE_URL`. They must never run against the development or production database. If `TEST_DATABASE_URL` is unset, the test run fails with an explicit error rather than falling back to `DATABASE_URL`.

Run the tests from the backend project directory:

```bash
cd backend
npm test
```

Run linting, type checking, and the production build using the scripts configured in `package.json`. Example commands, if the scripts exist:

```bash
npm run lint
npm run typecheck
npm run build
```

Verify the actual script names before executing them.

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
npx prisma validate
npx prisma generate
npx prisma migrate dev
```

Use the commands from the backend directory with the correct environment variables configured.

Avoid manually editing the database schema without creating a corresponding migration. Never modify an already-applied migration to rewrite database history.

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

- [x] Specifications and project documentation (Phase 0) — written, pending review before implementation begins
- [ ] Project configuration and Docker Compose
- [ ] Database schema and migrations
- [ ] Authentication and authorization
- [ ] Product management
- [ ] Receiving document management
- [ ] Partial and complete receipt processing
- [ ] Inventory and transaction history
- [ ] Idempotency and concurrency protection
- [ ] Automated tests
- [ ] API contract verification
- [ ] Final setup and deployment verification

Do not mark a feature as complete until its implementation and verification have been performed.
