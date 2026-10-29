# Data Model Notes

## Purpose

`docs/erd.mmd` is the authoritative relationship model. It is a raw Mermaid source file that defines entities, fields, keys, and cardinalities only.

This document holds the supporting detail that does not fit inside a Mermaid `erDiagram`: database constraints, enumerated values, integrity rules, and idempotency storage rules. The prose here is descriptive; the cardinalities in `docs/erd.mmd` are authoritative.

## 1. Entities

| Entity | Table | Purpose |
|---|---|---|
| `USERS` | `users` | Authenticated operators and supervisors |
| `PRODUCTS` | `products` | Product catalogue with unique SKU |
| `RECEIVING_DOCUMENTS` | `receiving_documents` | Receiving header and derived status |
| `RECEIVING_ITEMS` | `receiving_items` | Expected and cumulative received quantity per product |
| `INVENTORIES` | `inventories` | Current available stock per product |
| `RECEIPT_OPERATIONS` | `receipt_operations` | Accepted receipt requests and idempotent replay snapshots |
| `INVENTORY_TRANSACTIONS` | `inventory_transactions` | Immutable stock movement audit trail |

## 2. Cardinalities

These are repeated from `docs/erd.mmd` so the technical specification and the diagram cannot drift silently.

| Relationship | Cardinality | Meaning |
|---|---|---|
| `USERS` → `RECEIVING_DOCUMENTS` | one-to-many | A user creates zero or more documents; each document has exactly one creator |
| `USERS` → `RECEIPT_OPERATIONS` | one-to-many | A user performs zero or more receipt operations |
| `USERS` → `INVENTORY_TRANSACTIONS` | one-to-many | A user is recorded as the performer of each transaction |
| `PRODUCTS` → `INVENTORIES` | one-to-exactly-one | Every product has exactly one inventory record |
| `RECEIVING_DOCUMENTS` → `RECEIVING_ITEMS` | one-or-more | A document always has at least one item |
| `PRODUCTS` → `RECEIVING_ITEMS` | one-to-many | A product may appear in many documents, but only once per document |
| `RECEIVING_ITEMS` → `RECEIPT_OPERATIONS` | one-to-many | An item accumulates receipts over time |
| `PRODUCTS` → `INVENTORY_TRANSACTIONS` | one-to-many | Each transaction references exactly one product |
| `RECEIVING_ITEMS` → `INVENTORY_TRANSACTIONS` | one-to-many | Each transaction references exactly one receiving item |
| `RECEIPT_OPERATIONS` → `INVENTORY_TRANSACTIONS` | one-to-exactly-one | Each accepted receipt produces exactly one transaction |

`PRODUCTS ||--|| INVENTORIES` is intentional and replaces the earlier "at most one" wording. The API returns `availableQuantity` for every product, so a product without an inventory record is not a valid state. Product creation and inventory creation must occur in the same database transaction.

## 3. Database Constraints

The following constraints must be implemented in the Prisma schema and PostgreSQL migrations.

| Table | Constraint |
|---|---|
| `users` | `email` must be unique. |
| `products` | `sku` must be unique after normalisation (trimmed and upper-cased). |
| `receiving_documents` | `document_number` must be unique. |
| `receiving_items` | `UNIQUE (document_id, product_id)` |
| `receiving_items` | `expected_quantity > 0` |
| `receiving_items` | `received_quantity >= 0 AND received_quantity <= expected_quantity` |
| `inventories` | `UNIQUE (product_id)` and `available_quantity >= 0` |
| `receipt_operations` | `UNIQUE (performed_by, idempotency_key)` |
| `receipt_operations` | `quantity > 0` |
| `inventory_transactions` | `receipt_operation_id` must be unique. |
| `inventory_transactions` | `quantity_change > 0` for receipt transactions, and `quantity_change = receipt_operations.quantity` for the producing operation |

`receipt_operations.idempotency_key` is unique **only in combination with `performed_by`**. It is deliberately not globally unique, so that one user's key cannot collide with, or observe, another user's stored response.

Foreign keys must use `ON DELETE RESTRICT` on relationships that carry history: `receiving_documents.created_by`, `receiving_items.document_id`, `receiving_items.product_id`, `receipt_operations.performed_by`, `receipt_operations.receiving_item_id`, `inventory_transactions.product_id`, `inventory_transactions.receiving_item_id`, `inventory_transactions.receipt_operation_id`, and `inventory_transactions.performed_by`.

## 4. Enumerated Values

- `users.role`: `OPERATOR`, `SUPERVISOR`
- `receiving_documents.status`: `PENDING`, `PARTIALLY_RECEIVED`, `COMPLETED`
- `inventory_transactions.transaction_type`: `RECEIPT`

## 5. Relationship and Integrity Rules

1. A receiving document must contain at least one receiving item.
2. A product can appear only once in the same receiving document.
3. Every product has exactly one inventory record, created with `available_quantity = 0` in the same transaction as the product.
4. Each accepted receipt operation produces exactly one inventory transaction.
5. Each inventory transaction references the product and receiving item involved in the receipt.
6. `receipt_operation_id` is unique in `inventory_transactions`, preventing multiple inventory transactions from referencing the same accepted receipt operation.
7. Receipt quantity, inventory quantity, transaction history, and document status must be updated within the same database transaction.
8. Foreign keys must prevent deletion of records that are required to preserve historical receiving and inventory records.
9. Document status is not a stored invariant that the database can validate on its own. It is recalculated by the service from all item quantities inside the receipt transaction, while holding the document row lock, and is covered by the status tests in `docs/testing.md`.
10. `inventories.available_quantity` must equal the sum of `inventory_transactions.quantity_change` for that product, because opening stock is zero and outbound movements are out of scope.

## 6. Idempotency Storage

`receipt_operations` stores one row per accepted receipt request.

| Field | Purpose |
|---|---|
| `performed_by` | User scope for the idempotency key |
| `idempotency_key` | Client-supplied `Idempotency-Key` value, raw as received |
| `request_hash` | SHA-256 hex digest, 64 characters, over the canonical request string |
| `receiving_item_id` | Target item; a key hit against a different item is a conflict, never a replay |
| `quantity` | Accepted quantity for this operation |
| `response_snapshot` | JSON body of the committed success response, `data` payload only |

`request_hash` is computed as SHA-256 over the UTF-8 string formed from the four parts joined by `|`:

```text
sha256(lowercase(method) + "|" + documentId + "|" + itemId + "|" + quantity)
```

with `method` = `POST`, so the literal prefix is `post|`. Both identifiers are the canonical UUID strings from the matched route. The quantity is the validated integer with no padding. The digest is stored as 64 lowercase hex characters.

Canonicalisation rules:

- Method is lower-cased before hashing so the string is stable (`POST` → `post`).
- Path identifiers are taken from the resolved route parameters, not from the raw request URL.
- A key hit whose stored `(receiving_item_id, quantity, request_hash)` does not match the incoming request returns `409 IDEMPOTENCY_KEY_CONFLICT`. This includes reusing a key against a different document or item even when the quantity is identical.
- A key hit with a matching hash returns `200` with the stored `response_snapshot`, with no writes and no new inventory movement.

Retention: idempotency records are kept for **30 days** from `created_at`. A scheduled maintenance task may delete expired rows; deletion of an expired key does not retroactively affect already-committed receipts. For the initial release the cleanup task is optional, but the retention period is fixed so the behaviour is defined.
