# Technical Specification

## Warehouse Receiving System

**Document Version:** 1.0  
**Status:** Initial Draft  
**Backend:** Node.js, Express, TypeScript  
**Frontend:** React, TypeScript, Vite  
**Database:** PostgreSQL  
**ORM:** Prisma ORM

---

## 1. Technical Overview

### 1.1 Objective

This document defines the technical design for implementing the Warehouse Receiving System described in `/docs/prd.md`.

The application manages products, receiving documents, received quantities, available inventory, and inventory transaction history. The backend is responsible for enforcing all business rules and maintaining data consistency.

### 1.2 Technology Stack

| Component | Technology | Responsibility |
|---|---|---|
| Runtime | Node.js 24.x (pinned major) | Application runtime for both services |
| Frontend | React, TypeScript, Vite | User interface and API integration |
| Backend | Express, TypeScript | REST API and business logic |
| Database | PostgreSQL | Persistent relational data |
| ORM | Prisma ORM | Database access and schema migrations |
| Validation | Zod | Request validation |
| Authentication | JWT | Authenticated API access |
| Password hashing | bcrypt | Password storage |
| API documentation | OpenAPI 3.1, Swagger UI | API contract and interactive documentation |
| Testing | Vitest, Supertest | Unit and API integration tests |
| Deployment | Docker, Docker Compose | Reproducible application environment |
| Diagrams | Mermaid | ERD and data-flow documentation |

Node.js is pinned to major version **24** in `package.json` (`engines` plus `.nvmrc`), in the Docker base image, and in the README prerequisites. Both services run on the same Node major version.

### 1.3 Architectural Principles

1. Business rules must be enforced by the backend.
2. The frontend must not directly access the database.
3. All receipt-related database changes must be atomic.
4. Inventory transactions must provide an auditable record of stock movements.
5. Database constraints must protect critical uniqueness and referential integrity requirements.
6. The application must be testable and runnable using the documented setup instructions.

---

## 2. System Architecture

The system uses a three-layer architecture.

```mermaid
flowchart TD
    U[Warehouse User] --> FE[React Frontend]
    FE -->|HTTPS / JSON REST API| API[Express API]
    API --> AUTH[Authentication Middleware]
    AUTH --> CTRL[Route Controllers]
    CTRL --> SVC[Business Services]
    SVC --> VAL[Zod Validation]
    SVC --> ORM[Prisma ORM]
    ORM --> DB[(PostgreSQL)]
    API --> DOC[OpenAPI / Swagger UI]
```

### 2.1 Frontend

The frontend provides the user interface for:

- Login.
- Product listing and creation.
- Receiving document listing and creation.
- Receiving document details.
- Partial and full receipt recording.
- Inventory listing.
- Inventory transaction history.

The frontend validates user input for usability, but it must not be treated as the authority for business-rule enforcement.

### 2.2 Backend

The backend is responsible for:

- Authentication and authorisation.
- Request validation.
- Product and receiving document management.
- Receipt processing.
- Inventory updates.
- Document status calculation.
- Inventory transaction recording.
- Idempotency and duplicate request handling.
- Consistent API error responses.

### 2.3 Database

PostgreSQL stores the application's persistent data. Prisma provides typed database access and migration management.

Critical receipt operations use database transactions and appropriate locking to prevent concurrent requests from exceeding the expected quantity.

---

## 3. Project Structure

The repository uses a root-level `frontend/` and `backend/` layout. This is the structure defined in the README and it is authoritative.

```text
warehouse-receiving-system/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── products/
│   │   │   ├── receiving/
│   │   │   ├── inventory/
│   │   │   └── transactions/
│   │   ├── lib/
│   │   ├── app.ts
│   │   └── server.ts
│   ├── tests/
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   └── types/
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── docs/
│   ├── prd.md
│   ├── technical-spec.md
│   ├── data-model.md
│   ├── erd.mmd
│   ├── openapi.yaml
│   ├── data-flow.mmd
│   ├── ai-workflow.md
│   └── testing.md
├── docker-compose.yml
├── .env.example
├── .nvmrc
├── .gitignore
└── README.md
```

### Module responsibilities

| Module | Responsibility |
|---|---|
| `auth` | Login, JWT generation, authentication |
| `products` | Product listing and creation |
| `receiving` | Receiving document management and receipt processing |
| `inventory` | Available stock queries |
| `transactions` | Inventory transaction history |
| `middleware` | Authentication, authorisation, error handling |
| `config` | Environment configuration |
| `lib` | Shared utilities and database client |

The structure separates business responsibilities without introducing unnecessary microservices.

---

## 4. Database Design

### 4.1 Entity Relationship Diagram

The authoritative relationship model is `docs/erd.mmd`, a raw Mermaid source file. This document does not restate it, so the two cannot drift apart.

| Relationship | Cardinality |
|---|---|
| `USERS` → `RECEIVING_DOCUMENTS` | one-to-many |
| `USERS` → `RECEIPT_OPERATIONS` | one-to-many |
| `USERS` → `INVENTORY_TRANSACTIONS` | one-to-many |
| `PRODUCTS` → `INVENTORIES` | **one-to-exactly-one** |
| `RECEIVING_DOCUMENTS` → `RECEIVING_ITEMS` | one-or-more |
| `PRODUCTS` → `RECEIVING_ITEMS` | one-to-many |
| `RECEIVING_ITEMS` → `RECEIPT_OPERATIONS` | one-to-many |
| `PRODUCTS` → `INVENTORY_TRANSACTIONS` | one-to-many |
| `RECEIVING_ITEMS` → `INVENTORY_TRANSACTIONS` | one-to-many |
| `RECEIPT_OPERATIONS` → `INVENTORY_TRANSACTIONS` | **one-to-exactly-one** |

Every product has exactly one `inventories` row. A product without inventory is not a valid state, because the API returns `availableQuantity` for every product. Product creation and inventory creation must therefore occur in the same database transaction.

Constraints, enumerated values, integrity rules, and the idempotency storage rules are documented in `docs/data-model.md`. The Prisma schema and migrations must satisfy both that document and `docs/erd.mmd`.

### 4.2 Table Definitions

#### `users`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | Primary key |
| `email` | VARCHAR(255) | Required, unique |
| `password_hash` | VARCHAR(255) | Required |
| `role` | ENUM | `OPERATOR` or `SUPERVISOR` |
| `created_at` | TIMESTAMPTZ | Required |

The initial users should be created using a seed script. Passwords must be hashed before storage.

#### `products`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | Primary key |
| `sku` | VARCHAR(100) | Required, unique |
| `name` | VARCHAR(255) | Required |
| `created_at` | TIMESTAMPTZ | Required |
| `updated_at` | TIMESTAMPTZ | Required |

SKU values are normalised by trimming whitespace and converting to uppercase before insertion. A plain unique constraint on the normalised column enforces case-insensitive uniqueness, so `SKU-001` and `sku-001` collide. A database-level uniqueness constraint must remain in place so concurrent requests cannot create duplicate SKUs.

Product creation inserts the `products` row and its `inventories` row (`available_quantity = 0`) in a single database transaction. If either insert fails, both roll back, which preserves the one-to-exactly-one relationship in `docs/erd.mmd`.

Product names are trimmed but preserve their case. Email addresses are normalised to lowercase on seed and on login lookup.

#### `receiving_documents`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | Primary key |
| `document_number` | VARCHAR(50) | Required, unique |
| `status` | ENUM | `PENDING`, `PARTIALLY_RECEIVED`, `COMPLETED` |
| `created_by` | UUID | Foreign key to `users.id` |
| `created_at` | TIMESTAMPTZ | Required |
| `updated_at` | TIMESTAMPTZ | Required |

Document numbers must be generated by the backend, not trusted from arbitrary frontend input. A unique database constraint must prevent collisions.

#### `receiving_items`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | Primary key |
| `document_id` | UUID | Foreign key |
| `product_id` | UUID | Foreign key |
| `expected_quantity` | INTEGER | Greater than zero |
| `received_quantity` | INTEGER | At least zero |
| `created_at` | TIMESTAMPTZ | Required |
| `updated_at` | TIMESTAMPTZ | Required |

Required constraints:

- `expected_quantity > 0`.
- `received_quantity >= 0`.
- `received_quantity <= expected_quantity`.
- Unique combination of `(document_id, product_id)`.

These constraints supplement service-level validation.

#### `inventories`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | Primary key |
| `product_id` | UUID | Foreign key, unique |
| `available_quantity` | INTEGER | Required, at least zero |
| `updated_at` | TIMESTAMPTZ | Required |

Each product has exactly one inventory record in the single-warehouse version. The record is created in the same transaction as the product, with `available_quantity = 0`. The `UNIQUE (product_id)` constraint and the atomic creation rule together preserve that cardinality.

#### `receipt_operations`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | Primary key |
| `performed_by` | UUID | Foreign key to `users.id` |
| `idempotency_key` | VARCHAR(255) | Required; unique **in combination with `performed_by`** |
| `request_hash` | CHAR(64) | Required; SHA-256 hex digest of the canonical request |
| `receiving_item_id` | UUID | Foreign key |
| `quantity` | INTEGER | Greater than zero |
| `response_snapshot` | JSONB | Required |
| `created_at` | TIMESTAMPTZ | Required |

This table records accepted receipt requests and supports safe retries.

**Key scoping.** The uniqueness constraint is `UNIQUE (performed_by, idempotency_key)`. It is deliberately not a global unique constraint: a key supplied by one user must never collide with, or resolve to, another user's stored response. Two users may independently use the same key string.

**Request hash.** `request_hash` is SHA-256 over the canonical string defined in `docs/data-model.md` §6: method `|` documentId `|` itemId `|` quantity. It covers the **target**, not only the body, so a key reused against a different document or item is detected as a conflict even when the quantity is identical.

**Conflict rules.**

| Incoming request | Stored row for `(performed_by, idempotency_key)` | Result |
|---|---|---|
| Same document, item, and quantity (hash equal) | Present | `200`, return `response_snapshot`, no writes |
| Different document, item, or quantity (hash differs) | Present | `409 IDEMPOTENCY_KEY_CONFLICT`, no writes |
| No row | Absent | Process normally |

**Unique-constraint conflict recovery.** Two concurrent requests with the same user and key can both pass the lookup before either inserts. The second insert then violates `UNIQUE (performed_by, idempotency_key)`. The transaction must roll back, re-read the row in a fresh transaction, and resolve it by the same table above: a matching hash replays the stored snapshot with `200`, and a differing hash returns `409`. The request must never surface the raw database error, and must never apply the receipt twice.

**Retention.** Idempotency rows are retained for **30 days** from `created_at`. A scheduled cleanup may delete expired rows. Deleting an expired key does not alter any committed receipt, inventory value, or transaction record. The cleanup task is optional for the initial release, but the retention period is fixed so the behaviour is defined.

The response snapshot preserves the original result for a retry, rather than treating the same request as a new receipt. It stores the success response `data` object only; the replay status code is fixed at `200` by rule, so it need not be stored.

#### `inventory_transactions`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | Primary key |
| `product_id` | UUID | Foreign key |
| `receiving_item_id` | UUID | Foreign key |
| `receipt_operation_id` | UUID | Foreign key, unique |
| `transaction_type` | ENUM or VARCHAR | `RECEIPT` |
| `quantity_change` | INTEGER | Greater than zero for receipts |
| `performed_by` | UUID | Foreign key to `users.id` |
| `created_at` | TIMESTAMPTZ | Required |

Each accepted receipt operation creates exactly one corresponding inventory transaction. Transaction records must not be edited or deleted through ordinary application functions.

### 4.3 Indexes

Recommended indexes:

- Unique index on `users.email`.
- Unique index on `products.sku`.
- Unique index on `receiving_documents.document_number`.
- Index on `receiving_documents.status`.
- Index on `receiving_documents.created_at`.
- Unique composite index on `receiving_items(document_id, product_id)`.
- Index on `receiving_items.product_id`.
- Unique index on `inventories.product_id`.
- Unique composite index on `receipt_operations(performed_by, idempotency_key)`.
- Index on `inventory_transactions.product_id, created_at`.
- Index on `inventory_transactions.receiving_item_id`.

Foreign keys must use appropriate delete restrictions to preserve historical records. Product and receiving records referenced by inventory history should not be physically deleted.

### 4.4 Inventory as a Source of Truth

`inventories.available_quantity` is the current stock value used by the inventory listing.

`inventory_transactions` is the historical audit trail for stock movements. The system must update both within the same database transaction.

A useful consistency check is:

`Current stock = Opening stock + Sum of inventory transaction quantity changes`

In the initial release, opening stock is zero because opening stock adjustments are out of scope. If opening balances are introduced later, they must be represented explicitly rather than silently changing the inventory value.

---

## 5. API Design

### 5.1 API Conventions

- Base path: `/api/v1`. Health endpoints are served at the root.
- Data format: JSON.
- Authentication: Bearer JWT.
- Content type: `application/json`.
- UUIDs identify persistent resources.
- Dates use ISO 8601 timestamps.
- Pagination is applied to all list endpoints using `page` and `limit`, defaulting to `1` and `20`, with `limit` capped at `100`.
- Validation and business rules are enforced by the backend.
- Interactive documentation is served by Swagger UI at `/docs`. The OpenAPI document is served at `/openapi.yaml`.

### 5.2 Endpoint List

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Authenticate a user |
| `GET` | `/api/v1/auth/me` | Retrieve the current user |
| `GET` | `/api/v1/products` | List products |
| `POST` | `/api/v1/products` | Create a product |
| `GET` | `/api/v1/receiving-documents` | List receiving documents |
| `POST` | `/api/v1/receiving-documents` | Create a receiving document |
| `GET` | `/api/v1/receiving-documents/{id}` | Retrieve document details |
| `POST` | `/api/v1/receiving-documents/{id}/items/{itemId}/receipts` | Record a receipt |
| `GET` | `/api/v1/inventory` | List available inventory |
| `GET` | `/api/v1/inventory/transactions` | List inventory transaction history |
| `GET` | `/health` | Check application health |
| `GET` | `/ready` | Check application readiness |

Product creation is restricted to supervisors. Other permissions follow the role policy in the PRD.

### 5.3 Login

**Request**

`POST /api/v1/auth/login`

```json
{
  "email": "operator@example.com",
  "password": "example-password"
}
```

**Successful response: `200 OK`**

```json
{
  "data": {
    "accessToken": "<jwt-token>",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "user": {
      "id": "3f1c2a90-0000-4000-8000-000000000001",
      "email": "operator@example.com",
      "role": "OPERATOR"
    }
  }
}
```

`tokenType` is always `Bearer`. `expiresIn` is the token lifetime in seconds and must match the configured `JWT_EXPIRES_IN`.

Invalid credentials return `401 UNAUTHENTICATED` with a generic message that does not reveal whether the email exists. A malformed body returns `400 VALIDATION_ERROR`. Production deployments must use HTTPS.

### 5.4 Create Product

**Request**

`POST /api/v1/products`

```json
{
  "sku": "SKU-001",
  "name": "Sample Product"
}
```

**Successful response: `201 Created`**

```json
{
  "data": {
    "id": "9b2e4f10-0000-4000-8000-000000000010",
    "sku": "SKU-001",
    "name": "Sample Product",
    "availableQuantity": 0,
    "createdAt": "2026-10-28T09:00:00.000Z",
    "updatedAt": "2026-10-28T09:00:00.000Z"
  }
}
```

Validation:

- SKU and name are required and must be non-empty after trimming.
- SKU is trimmed and upper-cased before persistence.
- Duplicate SKU, including one differing only by case, returns `409 DUPLICATE_SKU`.
- Schema failures return `400 VALIDATION_ERROR`.
- Only a supervisor may create a product; an operator receives `403 FORBIDDEN`.
- The product and its zero-quantity inventory record are committed in one transaction.

### 5.5 Create Receiving Document

**Request**

`POST /api/v1/receiving-documents`

```json
{
  "items": [
    {
      "productId": "9b2e4f10-0000-4000-8000-000000000010",
      "expectedQuantity": 100
    },
    {
      "productId": "9b2e4f10-0000-4000-8000-000000000011",
      "expectedQuantity": 50
    }
  ]
}
```

**Successful response: `201 Created`**

```json
{
  "data": {
    "id": "2c7d8e30-0000-4000-8000-000000000020",
    "documentNumber": "RCV-20261028-000001",
    "status": "PENDING",
    "createdAt": "2026-10-28T09:05:00.000Z",
    "updatedAt": "2026-10-28T09:05:00.000Z",
    "totalItems": 2,
    "totalExpectedQuantity": 150,
    "totalReceivedQuantity": 0,
    "createdBy": {
      "id": "3f1c2a90-0000-4000-8000-000000000001",
      "email": "operator@example.com",
      "role": "OPERATOR"
    },
    "items": [
      {
        "id": "7a4b1c50-0000-4000-8000-000000000031",
        "productId": "9b2e4f10-0000-4000-8000-000000000010",
        "sku": "SKU-001",
        "productName": "Sample Product",
        "expectedQuantity": 100,
        "receivedQuantity": 0,
        "remainingQuantity": 100
      },
      {
        "id": "7a4b1c50-0000-4000-8000-000000000032",
        "productId": "9b2e4f10-0000-4000-8000-000000000011",
        "sku": "SKU-002",
        "productName": "Second Product",
        "expectedQuantity": 50,
        "receivedQuantity": 0,
        "remainingQuantity": 50
      }
    ]
  }
}
```

Validation:

- The items array must contain at least one item.
- Product IDs must exist; unknown products return `404 NOT_FOUND`.
- Duplicate product IDs within the same document return `409 DUPLICATE_DOCUMENT_ITEM`.
- Expected quantities must be positive integers; a zero, negative, fractional, or non-numeric value returns `400 INVALID_QUANTITY`, and any other schema failure returns `400 VALIDATION_ERROR`.
- Initial received quantities and document status are assigned by the backend.
- Document creation and item creation must be atomic.

#### Document number generation

The format is `RCV-<YYYYMMDD>-<000001>`, where the date is the UTC creation date and the numeric suffix is a zero-padded sequence.

The generator must be collision-safe under concurrency:

1. Insert the document inside the creation transaction with a provisional number derived from `receiving_documents_id_seq` (a PostgreSQL sequence), for example `RCV-<YYYYMMDD>-<lpad(seq, 6, '0')>`.
2. Rely on the `UNIQUE (document_number)` constraint as the final authority.
3. On a unique violation, roll back and retry the creation, up to **3 attempts**, then return `500 INTERNAL_ERROR`. The retry never leaves a partially created document, because document and items are created in one transaction.

Because the suffix comes from a sequence, concurrent creations cannot produce the same number; the unique constraint and bounded retry are the safety net, not the primary mechanism.

### 5.6 Record a Receipt

**Request**

`POST /api/v1/receiving-documents/{id}/items/{itemId}/receipts`

Header:

`Idempotency-Key: <unique-client-generated-key>`

Body:

```json
{
  "quantity": 60
}
```

**Successful response: `201 Created`**

```json
{
  "data": {
    "receiptOperationId": "5e8f2a40-0000-4000-8000-000000000041",
    "documentNumber": "RCV-20261028-000001",
    "itemId": "7a4b1c50-0000-4000-8000-000000000031",
    "quantityReceivedNow": 60,
    "cumulativeReceivedQuantity": 60,
    "remainingQuantity": 40,
    "availableStock": 60,
    "documentStatus": "PARTIALLY_RECEIVED"
  }
}
```

The values above illustrate the response for a new product with zero initial stock and an expected quantity of 100.

Validation and processing, in this exact order:

1. The caller must be authenticated and authorised.
2. The request must be schema-valid: `Idempotency-Key` header present and within length limits, `quantity` a positive integer, `id` and `itemId` valid UUIDs. A missing or empty header returns `400 IDEMPOTENCY_KEY_REQUIRED`; a non-positive, fractional, or non-numeric quantity returns `400 INVALID_QUANTITY`; any other schema failure returns `400 VALIDATION_ERROR`. All are schema-level rejections and occur before the transaction begins.
3. Begin the database transaction.
4. Lock the receiving document row (`SELECT ... FOR UPDATE`), then the receiving item row, and verify the item belongs to the document. A missing document or item returns `404 NOT_FOUND`.
5. Check whether `(performed_by, idempotency_key)` already exists. This check happens **before** the completed-document and remaining-quantity checks, because a replay must succeed even when the document has since become `COMPLETED`.
   - Row present with a matching request hash returns `200` with the stored snapshot and writes nothing.
   - Row present with a differing request hash returns `409 IDEMPOTENCY_KEY_CONFLICT`.
6. The document must not be completed, otherwise `422 DOCUMENT_ALREADY_COMPLETED`.
7. The quantity must not exceed the current remaining quantity, otherwise `422 RECEIPT_EXCEEDS_REMAINING`.
8. Lock the inventory row for the product.
9. Insert the receipt operation.
10. Increase the receiving item's cumulative received quantity.
11. Increase inventory by the accepted quantity.
12. Insert the inventory transaction.
13. Recalculate the document status from **all** item quantities, read inside this transaction after the document lock was acquired.
14. Store the response snapshot.
15. Commit.

A request that exceeds the remaining quantity returns `422 RECEIPT_EXCEEDS_REMAINING` with `details.remainingQuantity`. A receipt against a completed document returns `422 DOCUMENT_ALREADY_COMPLETED`.

A repeated request with the same key and the same target and payload returns `200` with the stored result, without increasing stock again. Reusing that key with a different target or payload returns `409 IDEMPOTENCY_KEY_CONFLICT`.

A first-time success returns `201`. A replay returns `200`. Both share the same `ReceiptResult` body.

If the `UNIQUE (performed_by, idempotency_key)` constraint is violated during step 9, the transaction rolls back, the row is re-read in a fresh transaction, and the request resolves to `200` (matching hash) or `409` (differing hash). The raw database error must never reach the client.

### 5.7 Inventory Listing

**Request**

`GET /api/v1/inventory?page=1&limit=20&search=SKU-001`

**Example response**

```json
{
  "data": [
    {
      "productId": "9b2e4f10-0000-4000-8000-000000000010",
      "sku": "SKU-001",
      "name": "Sample Product",
      "availableQuantity": 60
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

The endpoint must return persisted stock values and should support pagination and product search.

### 5.8 Inventory Transaction History

**Request**

`GET /api/v1/inventory/transactions?page=1&limit=20&productId=9b2e4f10-0000-4000-8000-000000000010`

**Example response**

```json
{
  "data": [
    {
      "id": "8c9d0e10-0000-4000-8000-000000000051",
      "productId": "9b2e4f10-0000-4000-8000-000000000010",
      "sku": "SKU-001",
      "transactionType": "RECEIPT",
      "quantityChange": 60,
      "documentNumber": "RCV-20261028-000001",
      "performedBy": "operator@example.com",
      "createdAt": "2026-10-28T10:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

Transactions should be ordered by creation time, newest first. The endpoint must not expose password hashes or other sensitive user data.

### 5.9 Standard Error Format

Use a consistent error response:

```json
{
  "error": {
    "code": "RECEIPT_EXCEEDS_REMAINING",
    "message": "The receipt quantity exceeds the remaining expected quantity.",
    "details": {
      "remainingQuantity": 40
    }
  }
}
```

`code` is a stable, machine-readable identifier and is part of the API contract. `message` is human-readable and may change. `details` is optional and only present when it carries structured context.

### HTTP status mapping

| Status | Meaning | Applies to |
|---|---|---|
| `400` | Malformed or schema-invalid request | Wrong types, missing fields, invalid UUID format, invalid pagination, missing `Idempotency-Key` |
| `401` | Missing or invalid authentication | No token, malformed token, expired token, bad credentials |
| `403` | Authenticated but not authorised | Operator attempting a supervisor-only action |
| `404` | Resource not found | Unknown document, item, or product |
| `409` | Duplicate resource or idempotency conflict | Duplicate SKU, duplicate product in one document, key reused with a different target or payload |
| `422` | Schema-valid but business-rule-violating | Over-receiving, receipt against a completed document |
| `429` | Rate limit exceeded | Only if rate limiting is implemented |
| `500` | Unexpected server error | Unhandled failure; includes the bounded document-number retry exhaustion |
| `503` | Dependency unavailable | Readiness failure only |

The dividing rule is: **a request that could not be parsed or did not match the schema structure is `400`; a request that parsed correctly but violates a business rule is `422`; a request that collides with existing state is `409`.** A validation failure is never reported as `422`, and a business-rule failure is never reported as `400`.

### Error codes

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | `400` | Request body, query, path, or required header failed schema validation |
| `UNAUTHENTICATED` | `401` | Missing, malformed, or expired token, or invalid credentials |
| `FORBIDDEN` | `403` | Authenticated user lacks the required role |
| `NOT_FOUND` | `404` | Requested resource does not exist |
| `IDEMPOTENCY_KEY_REQUIRED` | `400` | `Idempotency-Key` header absent on a receipt request |
| `IDEMPOTENCY_KEY_CONFLICT` | `409` | Key reused with a different target or payload |
| `DUPLICATE_SKU` | `409` | SKU already exists after normalisation |
| `DUPLICATE_DOCUMENT_ITEM` | `409` | The same product appears more than once in one document |
| `INVALID_QUANTITY` | `400` | Quantity is not a positive integer, or is fractional, for a receipt or expected quantity |
| `RECEIPT_EXCEEDS_REMAINING` | `422` | Requested receipt exceeds the remaining expected quantity |
| `DOCUMENT_ALREADY_COMPLETED` | `422` | Receipt attempted against a completed document |
| `INTERNAL_ERROR` | `500` | Unexpected failure, including document-number collision retry exhaustion |
| `SERVICE_UNAVAILABLE` | `503` | Readiness check failed because a dependency is unavailable |

The API must not expose database credentials, stack traces, or internal SQL details in production error responses.

---

## 6. Receipt Processing and State Transitions

### 6.1 Document Status Calculation

The backend calculates document status from the persisted quantities of all its items.

- `PENDING`: Every item's received quantity is zero.
- `COMPLETED`: Every item's received quantity equals its expected quantity.
- `PARTIALLY_RECEIVED`: At least one unit has been received, but not all items are complete.

The backend must not accept a status value from the receipt request.

### 6.2 Status Transition Diagram

```mermaid
stateDiagram-v2
    [*] --> PENDING: Create document
    PENDING --> PARTIALLY_RECEIVED: First successful receipt
    PENDING --> COMPLETED: All quantities received in one operation
    PARTIALLY_RECEIVED --> PARTIALLY_RECEIVED: Receipt leaves outstanding quantity
    PARTIALLY_RECEIVED --> COMPLETED: Final outstanding quantity received
    COMPLETED --> [*]
```

The diagram describes status changes resulting from valid receipt operations. There are no transitions out of `COMPLETED` in the initial scope.

### 6.3 Receipt Transaction Flow

The full flow, including lock acquisition order, the idempotency check, and the unique-violation recovery path, is defined in `docs/data-flow.mmd`.

The sequence is:

1. Authenticate and authorise.
2. Validate the request schema.
3. Begin the transaction.
4. Lock the receiving document row.
5. Lock the receiving item row and verify it belongs to the document.
6. Check `(performed_by, idempotency_key)` — replay or conflict, before any business-rule check.
7. Validate that the document is not completed.
8. Validate that the quantity does not exceed the remaining quantity.
9. Lock the inventory row for the product.
10. Insert the receipt operation.
11. Increase the item's cumulative received quantity.
12. Increase inventory.
13. Insert the inventory transaction.
14. Recalculate the document status from all items.
15. Store the response snapshot.
16. Commit.

### 6.4 Atomicity and Concurrency

A receipt operation must update the following records in one PostgreSQL transaction:

1. The receiving item's cumulative received quantity.
2. The product's available inventory.
3. The receipt operation used for idempotency.
4. The inventory transaction.
5. The receiving document's status.
6. The stored response snapshot.

If any required step fails, all changes must roll back.

#### Lock order (mandatory)

Receipt processing **must** acquire locks in this order, and no receipt path may deviate from it:

```text
receiving_documents row  →  receiving_items row  →  inventories row
```

Concretely, the service issues `SELECT ... FOR UPDATE` on the document, then on the item, then on the inventory row, all inside the same transaction, before any write. The acquisition is mandatory, not advisory. Ordering is fixed globally so that concurrent receipts acquire the same resources in the same sequence and cannot deadlock each other.

**Why document-level locking is required.** Document status is recalculated from *every* item in the document. Two concurrent receipts against *different items of the same document* could otherwise each read the sibling item before the other's update commits, both conclude that not all items are complete, and both persist `PARTIALLY_RECEIVED` — leaving a genuinely complete document mislabelled. Locking the document row serialises status recalculation for that document and makes `PENDING → COMPLETED` correct. The status must be recalculated *after* the document lock is held, never from a pre-lock read.

**Why item locking is required.** Locking the document alone would still allow two requests targeting the *same* item to be serialised correctly, but the item lock is what makes the read-modify-write of `received_quantity` explicit and keeps the intent legible. It is also the row whose values are validated.

**Why inventory locking is required.** Inventory is incremented by a read-modify-write. Two receipts for the **same product in different documents** touch different document and item rows, so only the inventory row lock prevents a lost update there.

The remaining quantity is calculated from the locked, current database values:

`Remaining quantity = Expected quantity - Cumulative received quantity`

The backend must validate the new cumulative quantity before writing updates.

**Important:** A preliminary read followed by an unlocked update is insufficient. Two concurrent requests could otherwise both pass validation using the same stale remaining quantity. A pre-transaction read may be used only for a fast rejection; it is never authoritative.

Concurrent requests wait on the lock and are then re-validated against the committed values, so the second request observes the first request's updated remaining quantity. The expected outcome is that it either succeeds with a smaller valid quantity or fails with `422 RECEIPT_EXCEEDS_REMAINING`; it is never permitted to over-receive. This wait-and-revalidate behaviour is what the concurrency tests in `docs/testing.md` assert.

---

## 7. Authentication and Authorisation

### 7.1 Authentication

The login endpoint verifies the supplied credentials against a securely hashed password. Successful login returns a signed JWT.

The authentication middleware validates the token and attaches the authenticated user's ID and role to the request context.

Passwords are hashed with **bcrypt** using a work factor of **12**. The cost factor is a configuration value (`BCRYPT_ROUNDS`), defaulting to 12, so it can be raised for production without changing code, but it must never be lowered below 10.

Email addresses are normalised to lowercase before persistence and before login lookup. Because `users.email` is unique, case variants of the same address cannot create duplicate accounts, and a user who types a different case can still log in.

Login responses are identical for an unknown email and a wrong password (`401 UNAUTHENTICATED` with a generic message), so the endpoint does not disclose which accounts exist. The password comparison uses the bcrypt verify function against a dummy hash even when the user is not found, to avoid a timing distinction.

### 7.2 Authorisation Matrix

| Operation | Operator | Supervisor |
|---|---|---|
| Login and view own identity | Yes | Yes |
| List products | Yes | Yes |
| Create products | No | Yes |
| List receiving documents | Yes | Yes |
| Create receiving documents | Yes | Yes |
| View receiving document details | Yes | Yes |
| Record receipts | Yes | Yes |
| View inventory | Yes | Yes |
| View inventory transaction history | Yes | Yes |

This matrix follows the initial PRD assumptions. It can be revised if the hiring team specifies different role permissions.

### 7.3 Security Requirements

- Hash passwords using bcrypt with work factor 12, never below 10.
- Keep JWT secrets in environment variables.
- Never commit real credentials or secrets.
- Validate all input on the backend.
- Use parameterised database operations through Prisma or safe parameterised raw queries.
- Enforce authorisation on every protected endpoint.
- Avoid logging passwords, access tokens, or other secrets.
- Seed accounts are development-only. Their credentials are documented in the README as clearly non-production defaults, and the seed script must refuse to run when `NODE_ENV=production` unless an explicit override is supplied.

---

## 8. Testing Strategy

Testing must focus on business-rule correctness rather than only checking whether endpoints return successful responses.

### 8.1 Unit Tests

Unit tests should cover:

- Remaining quantity calculation.
- Document status calculation.
- Receipt quantity validation.
- SKU normalisation.
- Request payload validation.
- Role permission decisions.

### 8.2 Integration Tests

Integration tests should use a test database and verify actual persistence.

| ID | Scenario | Expected result |
|---|---|---|
| T-01 | Create a valid product | Product exists; stock is zero |
| T-02 | Create a duplicate SKU | Request rejected; no duplicate product |
| T-03 | Create a document with no items | Request rejected |
| T-04 | Create a document with duplicate product items | Request rejected |
| T-05 | Create a document with a negative expected quantity | Request rejected |
| T-06 | Receive a valid partial quantity | Received quantity and stock increase correctly |
| T-07 | Receive the exact remaining quantity | Item completes; document completes if all items are complete |
| T-08 | Receive more than the remaining quantity | Request rejected; no data changes |
| T-09 | Receive zero or a negative quantity | Request rejected |
| T-10 | Receive against a completed document | Request rejected |
| T-11 | Retry a request with the same key and payload | No additional stock movement |
| T-12 | Reuse a key with a different payload | Conflict returned; no additional movement |
| T-13 | Submit concurrent receipts that together exceed the remaining quantity | At most the valid quantity is accepted |
| T-14 | Simulate a failure during receipt processing | All related changes roll back |
| T-15 | Access a protected endpoint without a token | `401 Unauthorized` |
| T-16 | Operator attempts to create a product | `403 Forbidden` |
| T-17 | View transaction history after a receipt | Correct transaction and document reference returned |
| T-18 | Check inventory after multiple receipts | Stock equals the sum of accepted receipt quantities |

### 8.3 Test Data Isolation

Each integration test must use isolated test data or reset the test database safely between runs.

Tests must not connect to a production database. Test database configuration must be explicit.

### 8.4 Evidence to Record

The testing documentation should include:

- Test command and execution date.
- Automated test results.
- Example successful partial receipt.
- Example successful completion.
- Evidence that invalid receipts leave stock unchanged.
- Evidence that repeated requests do not duplicate stock.
- Evidence that concurrent requests preserve quantity limits.
- Known limitations or failed tests.

Screenshots or terminal output should show actual execution results, not fabricated examples.

---

## 9. Deployment Design

### 9.1 Docker Services

Docker Compose should define at least:

- `db`: PostgreSQL.
- `api`: Node.js Express application.
- `web`: React application built with Vite and served by a production web server.

The frontend service is part of the Compose definition, not an optional extra. Compose must be able to start the complete application, including the UI, from a clean checkout.

The API must connect to PostgreSQL using environment-based configuration.

### 9.2 Service names, ports, and networking

| Service | Container port | Host port | Purpose |
|---|---|---|---|
| `db` | `5432` | `5432` | PostgreSQL |
| `api` | `3000` | `3000` | Express REST API, Swagger UI, health endpoints |
| `web` | `80` | `5173` | Static React build served over HTTP |

Inside Compose, the API reaches PostgreSQL at host `db`. From the host machine, the same database is reachable at `localhost:5432`. These are different hostnames and the connection string must be chosen accordingly; see §9.3.

The service name is `db` everywhere. Documentation must not use `postgres` as a service name.

### 9.3 Environment Configuration

The `.env.example` file documents the required variables without containing real secrets.

```dotenv
NODE_ENV=development
PORT=3000

# Container-to-container connection string used by the api service.
DATABASE_URL=postgresql://app:app_password@db:5432/warehouse
# Host connection string used when running the API directly on the host.
DATABASE_URL_HOST=postgresql://app:app_password@localhost:5432/warehouse
# Dedicated test database; never the development database.
TEST_DATABASE_URL=postgresql://app:app_password@localhost:5432/warehouse_test

POSTGRES_USER=app
POSTGRES_PASSWORD=app_password
POSTGRES_DB=warehouse

JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=1h
BCRYPT_ROUNDS=12

# Origin the API accepts browser requests from.
CORS_ORIGIN=http://localhost:5173
# Base URL the browser uses to reach the API; baked into the Vite build.
VITE_API_BASE_URL=http://localhost:3000

# Development-only seed account password. Never reuse in production.
SEED_PASSWORD=development-only-password
```

All values shown are development placeholders. Production secrets must be generated and managed separately, and the demo seed accounts described in §9.4 must never exist in a production deployment.

`DATABASE_URL` and `DATABASE_URL_HOST` differ only in hostname. The Docker Compose `api` service uses `DATABASE_URL`; a developer running the API directly on the host uses `DATABASE_URL_HOST`. This is the documented resolution for the host/container hostname difference.

`VITE_API_BASE_URL` is read at **build time** by Vite, so it is passed as a build argument to the `web` image rather than injected at runtime. The `web` service maps container port `80` to host port `5173`, so the default `CORS_ORIGIN=http://localhost:5173` is correct for the Compose setup as well as for the Vite dev server.

### 9.4 Seed accounts

The seed script creates two development accounts:

| Email | Role | Purpose |
|---|---|---|
| `supervisor@example.com` | `SUPERVISOR` | Full access, including product creation |
| `operator@example.com` | `OPERATOR` | Receiving access without product creation |

The development password is defined in `.env.example` as `SEED_PASSWORD`. It is a **development-only** value and must not be reused anywhere else. The seed command is:

```bash
npm run db:seed
```

The script is idempotent: it upserts by email, so running it twice does not duplicate users or fail on the unique constraint. It refuses to run when `NODE_ENV=production` unless `ALLOW_PROD_SEED=true` is also set, which prevents demo credentials from reaching a real deployment.

### 9.5 Database Migrations

The application must use version-controlled Prisma migrations.

Recommended clean-start sequence:

1. Start PostgreSQL.
2. Wait for database health checks to pass.
3. Apply committed database migrations.
4. Run the user seed process.
5. Start the API.
6. Start or serve the frontend.

Production startup should apply committed migrations through a controlled deployment step, rather than relying on `prisma db push` to alter the schema implicitly.

### 9.6 Test database

Automated tests must use an isolated database, never the development database and never production.

- `TEST_DATABASE_URL` points at a separate database, `warehouse_test`, on the same PostgreSQL instance.
- Provisioning: the Compose PostgreSQL service creates `warehouse_test` via an init script, or the test setup creates it if absent.
- Reset strategy: before each test file, truncate the application tables in dependency order (`inventory_transactions`, `receipt_operations`, `receiving_items`, `receiving_documents`, `inventories`, `products`, `users`) and re-run deterministic fixtures. `TRUNCATE ... RESTART IDENTITY CASCADE` is acceptable because the test database contains no retained data.
- Concurrency tests require real independent connections; they must not use mocked Prisma clients.
- Test runs must fail fast with a clear message if `TEST_DATABASE_URL` is unset, rather than falling back to `DATABASE_URL`.

The command is:

```bash
npm test
```

### 9.7 Health and Readiness

`GET /health` confirms that the API process is running.

`GET /ready` confirms that the application can reach the database and is ready to serve requests.

Docker Compose must define a PostgreSQL health check and route service dependencies through `depends_on: condition: service_healthy`, so the API does not start against an unready database. A healthy database alone does not prove that the API is ready, and a running process is not proof of readiness.

Both endpoints are public and unauthenticated. `/ready` returns `503 SERVICE_UNAVAILABLE` when the database probe fails; it does not return `200` merely because the HTTP server is listening.

### 9.8 Startup Instructions

The README must document:

1. Required software and versions, including Node.js **24.x**.
2. How to clone the repository.
3. How to configure environment variables, including the container and host database URLs.
4. How to build and start the services with Docker Compose.
5. How database migrations and the seed process work, including the development seed accounts.
6. Local frontend and API URLs.
7. Swagger UI URL (`http://localhost:3000/docs`).
8. Test commands and the test database requirement.
9. How to stop the services.
10. Troubleshooting steps for common startup errors.

The final startup procedure must be tested from a clean environment.

---

## 10. Implementation Sequence

The development order should minimise rework and prioritise the core business flow.

### Phase 1: Foundation

- Create the Git repository and project structure.
- Configure Express, TypeScript, PostgreSQL, and Prisma.
- Configure Docker Compose and environment variables.
- Add the initial database migration.

### Phase 2: Backend Core

- Implement authentication and role-based access.
- Implement product creation and listing.
- Implement receiving document creation and detail retrieval.
- Implement receipt processing with transactions and idempotency.
- Implement inventory and transaction history endpoints.

### Phase 3: Testing

- Add unit tests for business rules.
- Add integration tests for receipt processing.
- Verify duplicate requests and concurrency handling.
- Confirm failed operations do not change stock.

### Phase 4: Frontend

- Implement login.
- Implement product listing and creation.
- Implement receiving document listing, creation, and details.
- Implement partial receipt forms.
- Implement inventory and transaction history pages.
- Display `400`, `403`, `404`, `409`, `422`, and `500` responses distinctly, using the `error.code` value.
- Generate an `Idempotency-Key` per logical receipt submission and reuse it only for retries of that same submission.

### Phase 5: Documentation and Delivery

- Verify the implemented API against the OpenAPI specification and update it for any approved change.
- Keep the ERD and data-flow diagrams consistent with the implementation.
- Document the AI-assisted development workflow.
- Record real test evidence.
- Test Docker startup from a clean environment.
- Review Git history and ensure no secrets are committed.

---

## 11. Technical Decisions and Known Limitations

| Topic | Initial decision | Reason or limitation |
|---|---|---|
| Backend framework | Express with TypeScript | Small REST API with straightforward routing |
| Runtime | Node.js 24.x | Pinned major version across host, CI, and Docker |
| Repository layout | Root-level `backend/` and `frontend/` | Matches the README; no monorepo tooling required |
| Database | PostgreSQL | Relational constraints and transaction support |
| ORM | Prisma | Typed database access and migrations |
| Password hashing | bcrypt, work factor 12 | Available in the base image without a native build stage |
| Stock storage | Persisted inventory per product, exactly one row | Efficient inventory queries |
| Stock audit | Immutable inventory transactions | Traceability of accepted stock movements |
| Receipt retry | Idempotency key scoped to `(performed_by, key)`, plus unique database constraint | Prevent duplicate processing without cross-user key collisions |
| Request hashing | SHA-256 over method, document ID, item ID, quantity | Detects key reuse against a different target |
| Concurrent receipt | Transaction plus mandatory lock order document → item → inventory | Preserves quantity limits and correct document status |
| Status recalculation | Inside the transaction, after the document lock | Prevents a completed document being mislabelled `PARTIALLY_RECEIVED` |
| Document numbering | Sequence-derived suffix, UTC date, unique constraint plus bounded retry | Collision-safe under concurrency |
| Error mapping | `400` schema, `422` business rule, `409` duplicate or idempotency | One rule, applied consistently |
| Warehouse model | Single warehouse | Multi-warehouse support is out of scope |
| Initial stock | Zero | Opening stock adjustments are not in scope |
| Receiving cancellation | Not supported | Requires a separate reversal design |
| Performance target | Not specified | Must not be treated as an agreed requirement |

### Final Design Rule

The backend must be the authority for receipt validation, inventory updates, and receiving status. The frontend may improve usability, but it must never be able to bypass those rules by submitting arbitrary quantities or document statuses.

This technical specification must be kept consistent with `docs/prd.md`, `docs/erd.mmd`, `docs/data-model.md`, `docs/openapi.yaml`, `docs/data-flow.mmd`, and `docs/testing.md`. Any changes to the business requirements must be reflected in both the documentation and the implementation.
