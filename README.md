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
├── docs/
│   ├── prd.md
│   ├── technical-spec.md
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
    │   └── migrations/
    ├── src/
    └── tests/
```

## 4. Prerequisites

Install the following tools before running the application:

- Node.js version compatible with the project dependencies.
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

Configure the required values in `.env`, including the PostgreSQL connection string, JWT secret, and application ports.

Example configuration keys:

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://<user>:<password>@postgres:5432/warehouse
JWT_SECRET=<replace-with-a-strong-random-secret>
PORT=3000
```

These values are illustrative. The actual variable names, ports, database credentials, and service names must match the implementation and Docker configuration.

Do not commit `.env` or real credentials to Git. Keep `.env.example` limited to safe placeholder values.

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

Run the Prisma migration command from the backend service or the configured backend container.

For a development database:

```bash
npx prisma migrate dev
```

For an environment using committed migrations, including production-like deployments:

```bash
npx prisma migrate deploy
```

Run these commands in the backend project directory or through the appropriate Docker Compose service.

Use `migrate dev` for development workflows and `migrate deploy` to apply existing migrations in deployment environments. Do not use development migration commands against production.

If the application uses a custom startup or migration script, follow the script defined in `backend/package.json` and the Docker configuration.

### Step 5: Verify application health

Use the configured API address to check the health endpoint:

```bash
curl http://localhost:3000/health
```

Check readiness separately:

```bash
curl http://localhost:3000/ready
```

Replace the host or port if the actual Docker configuration uses different values.

A successful health response indicates process health according to the endpoint implementation. Readiness should also verify that required dependencies, such as PostgreSQL, are available.

## 6. Running the Application Without Docker

For local development without Docker, install and run the frontend and backend separately.

### Backend

```bash
cd backend
npm install
```

Configure the database connection and other required environment variables, then apply migrations.

```bash
npx prisma migrate dev
```

Start the backend using the script defined in `backend/package.json`, for example:

```bash
npm run dev
```

### Frontend

Open another terminal:

```bash
cd frontend
npm install
```

Configure the frontend API base URL using the environment variable expected by the Vite application.

Start the frontend using the configured development script, for example:

```bash
npm run dev
```

The frontend and backend scripts above are examples. Confirm the available scripts in each `package.json` before running them. Ensure the frontend API URL points to the reachable backend address.

## 7. API Documentation

The API contract is maintained in:

`docs/openapi.yaml`

It defines endpoints, request and response schemas, authentication requirements, and HTTP status codes.

The planned endpoint groups include:

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

The API base URL and actual route availability depend on the implementation.

### Authentication

Protected endpoints use a JWT bearer token.

```http
Authorization: Bearer <access-token>
```

### Receipt requests

Receipt requests require an `Idempotency-Key` header:

```http
POST /api/v1/receiving-documents/{id}/items/{itemId}/receipts
Authorization: Bearer <access-token>
Idempotency-Key: <unique-request-key>
Content-Type: application/json
```

The request body must follow the schema defined in `docs/openapi.yaml`.

The same key and same payload must not apply a receipt more than once. Reusing the same key with a different payload must return the documented conflict response.

## 8. Business Rules

- Receiving quantities must be positive integers.
- Received quantities must never exceed expected quantities.
- Receiving documents use `PENDING`, `PARTIALLY_RECEIVED`, and `COMPLETED` statuses.
- Inventory increases only when a receipt is successfully accepted.
- Every successful receipt operation must have a corresponding inventory transaction.
- Receipt processing must be atomic.
- Concurrent receipt requests must not cause over-receiving or duplicate stock updates.
- Backend authorization must enforce the permissions assigned to each role.

Refer to `docs/prd.md` and `docs/technical-spec.md` for the complete requirements.

## 9. Running Tests

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
docker compose logs postgres
```

Replace `postgres` with the actual database service name in `docker-compose.yml`.

Verify the database connection string and wait for PostgreSQL to become ready before running migrations.

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

### Receipt request returns `409 Conflict`

Check whether the receipt exceeds the remaining expected quantity, duplicates an existing product entry, or reuses an idempotency key with a different request payload. The exact reason depends on the endpoint and response body.

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
| `docs/erd.mmd` | Entity relationship diagram |
| `docs/openapi.yaml` | REST API contract |
| `docs/data-flow.mmd` | Request and receipt-processing data flow |
| `docs/ai-workflow.md` | AI-assisted development workflow |
| `docs/testing.md` | Testing strategy and test cases |

## 14. Project Status

Update this section as implementation progresses.

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
