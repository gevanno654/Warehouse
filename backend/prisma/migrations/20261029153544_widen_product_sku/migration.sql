-- Widen "products"."sku" from VARCHAR(64) to VARCHAR(100) so the column matches
-- the approved contract in "docs/openapi.yaml" (maxLength: 100) and
-- "docs/technical-spec.md" section 4.2.
--
-- Additive only: existing data, the unique index on "sku", and every
-- relationship that references "products" are unchanged. The previous
-- migration ("20261029072619_init") is left untouched.
ALTER TABLE "products" ALTER COLUMN "sku" TYPE VARCHAR(100);
