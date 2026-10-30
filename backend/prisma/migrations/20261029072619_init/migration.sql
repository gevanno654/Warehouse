-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OPERATOR', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "ReceivingDocumentStatus" AS ENUM ('PENDING', 'PARTIALLY_RECEIVED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('RECEIPT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_documents" (
    "id" UUID NOT NULL,
    "document_number" VARCHAR(32) NOT NULL,
    "status" "ReceivingDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receiving_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_items" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receiving_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "available_quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_operations" (
    "id" UUID NOT NULL,
    "performed_by" UUID NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "receiving_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "response_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "receiving_item_id" UUID NOT NULL,
    "receipt_operation_id" UUID NOT NULL,
    "transaction_type" "InventoryTransactionType" NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "performed_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "receiving_documents_document_number_key" ON "receiving_documents"("document_number");

-- CreateIndex
CREATE INDEX "receiving_documents_created_by_idx" ON "receiving_documents"("created_by");

-- CreateIndex
CREATE INDEX "receiving_items_product_id_idx" ON "receiving_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "receiving_items_document_id_product_id_key" ON "receiving_items"("document_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventories_product_id_key" ON "inventories"("product_id");

-- CreateIndex
CREATE INDEX "receipt_operations_receiving_item_id_idx" ON "receipt_operations"("receiving_item_id");

-- CreateIndex
CREATE INDEX "receipt_operations_created_at_idx" ON "receipt_operations"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_operations_performed_by_idempotency_key_key" ON "receipt_operations"("performed_by", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_receipt_operation_id_key" ON "inventory_transactions"("receipt_operation_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_product_id_created_at_idx" ON "inventory_transactions"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_receiving_item_id_idx" ON "inventory_transactions"("receiving_item_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_performed_by_idx" ON "inventory_transactions"("performed_by");

-- AddForeignKey
ALTER TABLE "receiving_documents" ADD CONSTRAINT "receiving_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_items" ADD CONSTRAINT "receiving_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "receiving_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_items" ADD CONSTRAINT "receiving_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_operations" ADD CONSTRAINT "receipt_operations_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_operations" ADD CONSTRAINT "receipt_operations_receiving_item_id_fkey" FOREIGN KEY ("receiving_item_id") REFERENCES "receiving_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_receiving_item_id_fkey" FOREIGN KEY ("receiving_item_id") REFERENCES "receiving_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_receipt_operation_id_fkey" FOREIGN KEY ("receipt_operation_id") REFERENCES "receipt_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Quantity integrity rules.
--
-- Prisma cannot express CHECK constraints, but docs/data-model.md §3 requires
-- them to be enforced by the database and not only by application code.
-- ---------------------------------------------------------------------------

-- receiving_items.expected_quantity > 0
ALTER TABLE "receiving_items"
    ADD CONSTRAINT "receiving_items_expected_quantity_positive"
    CHECK ("expected_quantity" > 0);

-- receiving_items.received_quantity >= 0 AND received_quantity <= expected_quantity
ALTER TABLE "receiving_items"
    ADD CONSTRAINT "receiving_items_received_quantity_range"
    CHECK ("received_quantity" >= 0 AND "received_quantity" <= "expected_quantity");

-- inventories.available_quantity >= 0
ALTER TABLE "inventories"
    ADD CONSTRAINT "inventories_available_quantity_non_negative"
    CHECK ("available_quantity" >= 0);

-- receipt_operations.quantity > 0
ALTER TABLE "receipt_operations"
    ADD CONSTRAINT "receipt_operations_quantity_positive"
    CHECK ("quantity" > 0);

-- receipt_operations.request_hash is a 64-character lowercase SHA-256 hex digest.
ALTER TABLE "receipt_operations"
    ADD CONSTRAINT "receipt_operations_request_hash_sha256"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

-- inventory_transactions.quantity_change > 0 for the only approved type (RECEIPT).
ALTER TABLE "inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_quantity_change_positive"
    CHECK ("quantity_change" > 0);
