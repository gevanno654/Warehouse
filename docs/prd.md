# Product Requirements Document (PRD)

## Warehouse Receiving System

**Document Version:** 1.0
**Status:** Initial Draft
**Project Type:** Web Application
**Target Users:** Warehouse Operators and Warehouse Supervisors

---

## 1. Product Overview

### 1.1 Problem Statement

The warehouse currently records incoming inventory using spreadsheets. This process can make it difficult to track expected quantities, record partial deliveries, maintain accurate stock levels, and review inventory transaction history.

The warehouse requires a web-based application that centralises product management, inbound receiving documents, receipt recording, inventory tracking, and transaction history.

The application must ensure that inventory quantities remain accurate and that receiving operations follow predefined business rules.

### 1.2 Product Vision

Build a reliable and straightforward Warehouse Receiving System that allows warehouse personnel to record incoming deliveries, monitor receiving progress, and maintain accurate inventory records.

### 1.3 Business Objectives

1. Replace spreadsheet-based receiving records with a centralised application.
2. Improve the accuracy and traceability of incoming inventory.
3. Support partial and complete receipt recording.
4. Automatically update inventory when goods are received.
5. Prevent over-receiving and premature completion of receiving documents.
6. Provide visibility into current stock levels and inventory transaction history.

### 1.4 Success Criteria

The project will be considered successful when:

- Users can create products and receiving documents.
- Users can record partial and full receipts.
- Stock quantities are updated correctly after successful receipt operations.
- Invalid receiving operations are rejected by the backend.
- Receiving documents cannot be completed while any item remains outstanding.
- Inventory transaction history accurately reflects successful receiving operations.
- Automated tests verify the critical business rules.
- The application can be started using the documented Docker deployment procedure.

---

## 2. User Roles and Responsibilities

### 2.1 Warehouse Operator

The warehouse operator is responsible for daily receiving activities.

Responsibilities:

- View registered products.
- View and create receiving documents.
- View receiving document details.
- Record partial and full receipts.
- View available inventory.
- View inventory transaction history.

### 2.2 Warehouse Supervisor

The warehouse supervisor oversees warehouse receiving and inventory records.

Responsibilities:

- Perform all warehouse operator activities.
- Create and manage product records.
- Review receiving documents and their statuses.
- Monitor inventory quantities and transaction history.

**Assumption A-01:** The assessment does not explicitly define detailed permissions for each role. The permissions above establish an initial role-based access policy. User administration, approval workflows, and granular permissions are outside the initial scope.

**Resolved decision:** Product creation is restricted to the supervisor role. Operators may list products but cannot create them. This resolves the open question previously recorded as item 1 in section 8.3. Every other in-scope operation is available to both roles. The backend enforces this; frontend visibility is not the control.

---

## 3. Scope

### 3.1 In Scope

The initial release must include:

1. Basic authentication and role-based access.
2. Product listing and creation.
3. Receiving document listing and creation.
4. Receiving document detail and item listing.
5. Partial and full receipt recording.
6. Automatic inventory updates.
7. Receiving document status tracking.
8. Available inventory listing.
9. Inventory transaction history.
10. Backend validation of business rules.
11. Automated tests for critical operations.
12. Docker-based deployment and database migrations.

### 3.2 Out of Scope

The following features are not required for the initial release:

- Purchase order management.
- Supplier management.
- Barcode or QR code scanning.
- Outbound inventory and sales processing.
- Inventory transfers between warehouses.
- Stock adjustments and stock opname.
- Return-to-supplier processing.
- Receiving cancellation and reversal workflows.
- Email, SMS, or push notifications.
- Advanced reporting and analytics.
- Multi-warehouse management.
- Mobile-specific application development.
- Public cloud deployment.
- User registration and password recovery workflows.

These features may be considered in future versions if required by the business.

---

## 4. Functional Requirements

### FR-01: Authentication and Authorisation

The system must provide an authentication mechanism for authorised users.

Requirements:

- Unauthenticated users must not access protected application functions.
- Authenticated users must only perform actions permitted by their roles.
- The backend must enforce role-based permissions independently of the frontend.
- Authentication credentials must not be stored in plaintext.
- The system must provide a documented way to create or seed initial users for development and demonstration.

### FR-02: Product Management

The system must allow authorised users to view and create products.

Each product must contain:

- Unique product identifier.
- SKU code.
- Product name.
- Creation and update timestamps.

Requirements:

- SKU is mandatory and must be unique.
- Product name is mandatory.
- Leading and trailing whitespace must be removed from SKU and product name.
- Invalid product data must be rejected.
- The system must prevent duplicate SKU values, including values that differ only by letter case.
- Product creation must also create the product's single inventory record in the same database transaction.
- Products referenced by receiving records must not be physically deleted in a way that breaks historical records.

**Authorisation:** Creating a product requires the `SUPERVISOR` role. Listing products is available to both roles. This is the resolved decision recorded in section 2.1.

**Assumption A-02:** Product categories, descriptions, prices, and supplier details are not required because the assessment does not specify them.

### FR-03: Receiving Document Creation

The system must allow authorised users to create receiving documents containing one or more product items.

Each receiving document must contain:

- Unique document identifier.
- Unique document number.
- Creation timestamp.
- User who created the document.
- Receiving status.
- One or more receiving items.

Each receiving item must contain:

- Product reference.
- Expected quantity.
- Cumulative received quantity.

Requirements:

- A document must contain at least one item.
- Each product may appear only once in a document.
- Every referenced product must exist.
- Expected quantities must be positive integers.
- Initial received quantity must be zero.
- The document number must be unique and generated by the backend, never supplied by the client.
- A document must be created with a status indicating that receiving is pending.
- Document creation must be atomic: a document is never persisted without its items, and the user never receives a successful response for a partially created document.

**Assumption A-03:** Receiving documents can be created directly without a purchase order or supplier record. Expected quantities are entered manually by the user.

### FR-04: Receiving Document Listing and Details

The system must provide a list of receiving documents and a detail view for each document.

The list must display:

- Document number.
- Creation date.
- Receiving status.
- Total number of items.
- Overall expected quantity.
- Overall received quantity.

The detail view must display:

- Document information.
- Product SKU and name.
- Expected quantity per item.
- Cumulative received quantity.
- Remaining quantity.
- Current document status.

The system should support filtering by document status and searching by document number.

### FR-05: Recording Partial and Full Receipts

The system must allow authorised users to record received quantities against receiving document items.

Requirements:

- Receipt quantities must be positive integers.
- The receiving document and item must exist.
- The document must not already be completed, except when the request is an idempotent replay of a receipt that was already accepted.
- The received quantity must not exceed the item's remaining expected quantity.
- The backend must calculate the remaining quantity using the current persisted values.
- The system must reject an invalid receipt without changing inventory or receiving quantities.
- A successful receipt must update the item's cumulative received quantity.
- A successful receipt must create an inventory transaction.
- A successful receipt must update the available stock.

**Example:**

An item has an expected quantity of 100 units and a cumulative received quantity of 60 units.

- Receiving 40 units is valid.
- Receiving 20 units is valid, leaving 20 units outstanding.
- Receiving 41 units is invalid.
- Receiving zero or a negative quantity is invalid.

### FR-06: Receiving Document Status

The system must track the progress of each receiving document.

The initial status model consists of:

- `PENDING`: No quantities have been received for any item.
- `PARTIALLY_RECEIVED`: At least one unit has been received, but one or more items remain incomplete.
- `COMPLETED`: Every item has reached its expected quantity.

Requirements:

- A newly created document must have the `PENDING` status.
- After the first successful receipt, the status must be recalculated.
- The status must become `COMPLETED` only when every item has been fully received.
- A completed document must reject further receipt operations, while still returning its stored result for an idempotent replay of an already-accepted receipt.
- Status changes must be derived from persisted receiving quantities rather than trusted from frontend input.
- Users must not directly assign arbitrary document statuses.

**Assumption A-04:** Draft, cancelled, and rejected states are excluded from the initial release. Receiving documents become available for receipt immediately after creation.

### FR-07: Inventory Management

The system must provide a list of products and their available stock quantities.

Requirements:

- Every registered product must be identifiable by SKU and product name.
- Every registered product must have exactly one inventory record. A product cannot exist without a stock quantity, and stock cannot exist without a product.
- Products without previous receipts must have an initial available stock of zero.
- Successful receipt operations must increase stock by the accepted quantity.
- Invalid or failed receipt operations must not increase stock.
- Stock must never be increased twice for a single accepted receipt operation.
- Inventory quantities must remain consistent with the inventory transaction records.

The system must provide a documented source of truth for inventory quantities.

**Assumption A-05:** The initial release uses one warehouse and non-negative integer stock quantities. Opening stock adjustments are outside the initial scope.

### FR-08: Inventory Transaction History

The system must record successful inventory movements.

Each inventory transaction must contain:

- Unique transaction identifier.
- Product reference.
- Reference to the receiving item or receipt operation.
- Transaction type.
- Quantity change.
- Transaction timestamp.
- User who performed the operation.

Requirements:

- Successful receipts must generate positive inventory movements.
- Rejected receipt operations must not create inventory transactions.
- Users must be able to view transaction history.
- History records must preserve traceability to the relevant receiving document.
- Existing transaction records must not be silently overwritten when a new receipt is recorded.

**Assumption A-06:** Only inbound receiving transactions are supported in the initial release. Outbound movements and stock adjustments are excluded.

### FR-09: Error Handling and Data Integrity

The system must handle invalid requests without corrupting business data.

Requirements:

- Invalid inputs must produce meaningful error responses, using a stable machine-readable error code.
- Missing resources must produce an appropriate not-found response.
- Unauthorised requests must be rejected.
- The system must distinguish a structurally invalid request from a request that is structurally valid but violates a business rule, so a client can tell whether to fix its payload or its intent.
- Database failures must not leave partial receiving updates.
- Inventory updates, receiving quantity updates, transaction creation, and status recalculation must be handled atomically.
- Concurrent receipt operations must not allow the accepted quantity to exceed the remaining expected quantity.
- Repeated submission of the same receipt request must not cause unintended duplicate stock increases.

**Assumption A-07:** The implementation uses idempotency keys for receipt deduplication. The key identifies one logical submission and is scoped to the authenticated user, so two users may independently use the same key value. A retry with the same key and the same target and payload must return the original result without applying the receipt again. Reusing a key for a different document, item, or quantity must be rejected as a conflict.

---

## 5. Business Rules

| ID    | Rule                                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------- |
| BR-01 | Every product must have a unique SKU.                                                                           |
| BR-02 | A receiving document must contain at least one item.                                                            |
| BR-03 | A product may appear only once within a receiving document.                                                     |
| BR-04 | Expected quantities must be positive integers.                                                                  |
| BR-05 | Receipt quantities must be positive integers.                                                                   |
| BR-06 | Cumulative received quantity must never exceed expected quantity.                                               |
| BR-07 | Remaining quantity equals expected quantity minus cumulative received quantity.                                 |
| BR-08 | Stock increases only after a receipt operation succeeds.                                                        |
| BR-09 | Every successful receipt must generate a corresponding inventory transaction.                                   |
| BR-10 | A document is `PENDING` when no item has any received quantity.                                                 |
| BR-11 | A document is `PARTIALLY_RECEIVED` when at least one item has been received but not all items are complete.     |
| BR-12 | A document is `COMPLETED` only when all items are fully received.                                               |
| BR-13 | Completed documents reject new receipts; an idempotent replay returns its stored result.                        |
| BR-14 | Failed receipt operations must not modify receiving quantities, stock, transaction history, or document status. |
| BR-15 | Receipt validation and inventory updates must be enforced by the backend.                                       |
| BR-16 | Related database updates for one receipt operation must succeed or roll back together.                          |
| BR-17 | Concurrent requests must not bypass the remaining-quantity validation.                                          |
| BR-18 | Repeated requests must follow the documented deduplication strategy.                                            |

---

## 6. User Stories and Acceptance Criteria

### US-01: Create a Product

**As a warehouse supervisor, I want to register a product so that it can be used in receiving documents.**

Acceptance criteria:

1. Given valid SKU and product name, when the supervisor creates a product, the system saves it successfully.
2. Given an existing SKU, when a duplicate SKU is submitted, the system rejects the request.
3. Given missing or invalid required fields, the system returns validation errors.
4. Given a newly created product with no receipts, the inventory listing shows zero available stock.

### US-02: Create a Receiving Document

**As a warehouse operator, I want to create a receiving document so that I can record expected incoming goods.**

Acceptance criteria:

1. Given at least one valid product item, the system creates the document.
2. The document number must be unique.
3. Every expected quantity must be a positive integer.
4. Each receiving item starts with a received quantity of zero.
5. The initial document status is `PENDING`.
6. The system rejects unknown products and duplicate product entries within the same document.

### US-03: Record a Partial Receipt

**As a warehouse operator, I want to record a partial receipt so that actual deliveries can be tracked incrementally.**

Acceptance criteria:

1. Given an expected quantity of 100 and no previous receipts, recording 60 units succeeds.
2. The item's cumulative received quantity becomes 60.
3. Available stock increases by 60.
4. One corresponding inventory transaction is recorded.
5. The document status becomes `PARTIALLY_RECEIVED`.
6. The remaining quantity becomes 40.

### US-04: Record the Remaining Receipt

**As a warehouse operator, I want to receive the remaining goods so that the document can be completed.**

Acceptance criteria:

1. Given an expected quantity of 100 and a cumulative received quantity of 60, recording 40 succeeds.
2. The cumulative received quantity becomes 100.
3. Stock increases by 40, not by the full expected quantity again.
4. The remaining quantity becomes zero.
5. The document becomes `COMPLETED` if every item is fully received.
6. Further receipt attempts against the completed document are rejected.

### US-05: Prevent Over-Receiving

**As a warehouse supervisor, I want the system to reject quantities exceeding the outstanding amount so that stock and receiving records remain accurate.**

Acceptance criteria:

1. Given an expected quantity of 100 and a cumulative received quantity of 60, recording 41 units is rejected.
2. The system returns a meaningful validation error.
3. The cumulative received quantity remains 60.
4. Stock remains unchanged.
5. No inventory transaction is created for the rejected operation.
6. The document status remains unchanged.

### US-06: Prevent Premature Completion

**As a warehouse supervisor, I want receiving documents to be completed only when all items are fully received.**

Acceptance criteria:

1. Given a document containing multiple items, the document cannot be `COMPLETED` while any item has a remaining quantity greater than zero.
2. After the final outstanding quantity is received, the system automatically recalculates the status.
3. The system does not accept a client-provided status as authoritative.

### US-07: View Available Inventory

**As a warehouse operator, I want to view available stock so that I know the current inventory quantity.**

Acceptance criteria:

1. The inventory listing displays product SKU, product name, and available stock.
2. Stock reflects all successful receipt operations.
3. Invalid or rejected receipt operations do not affect the displayed stock.

### US-08: View Inventory Transaction History

**As a warehouse supervisor, I want to inspect inventory transaction history so that I can trace stock increases to receiving activities.**

Acceptance criteria:

1. Each successful receipt appears in the transaction history.
2. Each transaction identifies the relevant product, quantity, timestamp, and receiving reference.
3. Rejected receipt operations do not appear as successful inventory movements.
4. Transaction records remain available for historical review.

### US-09: Enforce Access Control

**As a warehouse supervisor, I want protected operations to be accessible only to authorised users.**

Acceptance criteria:

1. Unauthenticated requests to protected endpoints are rejected.
2. Authenticated users can access permitted operations.
3. Users cannot bypass role restrictions by directly calling backend endpoints.
4. The system returns appropriate authentication or authorisation errors.

### US-10: Prevent Duplicate Receipt Processing

**As a warehouse supervisor, I want repeated receipt requests to be handled safely so that stock is not increased more than once.**

Acceptance criteria:

1. Repeated submission with the same idempotency key must not create another stock movement.
2. The system must return a documented response for a previously processed request, and that response must be the one stored when the receipt was first accepted.
3. A retry must still succeed after the document has become `COMPLETED`, because replay is resolved before current document status is evaluated.
4. Reusing a key for a different document, item, or quantity must be rejected as a conflict.
5. Different requests must still undergo current quantity and document-status validation.
6. Concurrent requests must preserve the expected-quantity limit.

---

## 7. Non-Functional Requirements

### NFR-01: Data Integrity

The system must use relational database constraints and transactional operations to protect inventory and receiving data.

### NFR-02: Security

- Protected endpoints must require authentication.
- Authorisation must be enforced server-side.
- Passwords must be securely hashed if password-based authentication is used.
- Secrets and credentials must not be committed to version control.
- Input validation must be applied at the backend.

### NFR-03: Reliability

Failed operations must not leave partial database changes. Critical business rules must be covered by automated tests.

### NFR-04: Maintainability

The codebase must use a clear separation of responsibilities between frontend, backend, database access, and business logic.

### NFR-05: Usability

The interface must provide clear forms, readable inventory tables, visible document statuses, and meaningful validation messages.

### NFR-06: Reproducibility

The application must support environment-based configuration, database migrations, and Docker-based startup from a clean environment.

### NFR-07: API Consistency

The REST API must use appropriate HTTP methods and status codes. Request and response formats, validation errors, and authentication requirements must be documented.

Status codes must be assigned consistently: `400` for malformed or schema-invalid requests, `401` for authentication failures, `403` for authorization failures, `404` for missing resources, `409` for duplicate resources and idempotency conflicts, `422` for business-rule violations on a schema-valid request, `500` for unexpected server errors, and `503` for readiness failures. Each error response must carry a stable, documented error code.

### NFR-08: Testability

The implementation must support automated unit and integration tests for receiving rules, stock consistency, authorisation, error handling, and duplicate requests.

**Performance targets:** The assessment does not specify numerical response-time, throughput, or concurrent-user targets. These remain open requirements and should not be presented as agreed business commitments.

---

## 8. Assumptions and Constraints

### 8.1 Assumptions

| ID   | Assumption                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------- |
| A-01 | The initial roles are warehouse operator and warehouse supervisor.                             |
| A-02 | Products require SKU and name; additional product attributes are optional future enhancements. |
| A-03 | Receiving documents are created manually without purchase orders or supplier integration.      |
| A-04 | Documents can be received immediately after creation.                                          |
| A-05 | The initial system manages one warehouse and non-negative integer quantities.                  |
| A-06 | Inventory history records inbound receiving transactions only.                                 |
| A-07 | Receipt retries use user-scoped idempotency keys with replay and conflict behaviour.           |
| A-08 | Receiving quantities represent individual units; fractional quantities are not supported.      |
| A-09 | Product records referenced by historical receiving records must be preserved.                  |
| A-10 | Receiving cancellation and reversal are not part of the initial release.                       |
| A-11 | Every product has exactly one inventory record, created when the product is created.           |
| A-12 | Receipt idempotency keys are scoped to the authenticated user.                                 |
| A-13 | Development seed accounts exist for demonstration only and are never used in production.       |

### 8.2 Constraints

- A relational database must be used.
- The backend must expose a documented REST API.
- Git must be used with meaningful commit history.
- An AI coding agent must be part of the development workflow.
- Dockerfiles and Docker Compose configuration must be provided.
- The project must prioritise core workflow correctness over visual polish.
- The target effort is 8–12 hours, with a maximum submission window of three calendar days.

### 8.3 Unresolved Questions

The following questions remain open and should be confirmed with the hiring team if clarification is available:

1. Should receiving documents support cancellation or correction after receipt?
2. Are supplier information and purchase order references expected in a future version?
3. Is there a required inventory valuation or costing method?
4. Are multiple warehouses or storage locations expected?
5. Are numerical performance targets or a maximum dataset size required?
6. Is a public deployment URL required for this particular submission?

The former question "Should product creation be restricted to supervisors?" is resolved: yes, as recorded in section 2.1.

Until clarified, the implementation should follow the documented assumptions and avoid adding unnecessary features. None of the remaining open questions block the initial implementation, because the documented scope already excludes cancellation, suppliers, costing, and multi-warehouse support.

---

## 9. Definition of Done

The initial release is complete when:

- [ ] All in-scope functional requirements are implemented.
- [ ] All critical user stories have testable acceptance criteria.
- [ ] Backend validation enforces the business rules.
- [ ] Receiving quantities, stock, transaction history, and statuses remain consistent.
- [ ] Duplicate and concurrent receipt operations are handled safely.
- [ ] Automated tests for critical business rules pass.
- [ ] API documentation matches the implemented endpoints.
- [ ] Database migrations execute successfully.
- [ ] Docker Compose starts the application and database.
- [ ] A health or readiness endpoint is available.
- [ ] README instructions have been tested from a clean environment.
- [ ] AI workflow documentation includes at least three meaningful task instructions.
- [ ] Known limitations and unfinished work are documented.
- [ ] The Git repository contains the required deliverables and no committed secrets.

---

## 10. Related Technical Documents

This PRD is the source of business requirements for the following documents:

- `/docs/technical-spec.md` — system architecture, database design, API behaviour, authorisation, and testing strategy.
- `/docs/erd.mmd` — authoritative entity relationships, keys, and cardinalities.
- `/docs/data-model.md` — database constraints, enumerated values, integrity rules, and idempotency storage rules.
- `/docs/openapi.yaml` — REST API contracts.
- `/docs/data-flow.mmd` — system data flow and receiving workflow.
- `/docs/ai-workflow.md` — AI coding agent instructions and development records.
- `/docs/testing.md` — test scenarios, execution results, and known limitations.

The technical documents must remain consistent with this PRD. Any requirement changes should be reflected in both the documentation and the implementation.
