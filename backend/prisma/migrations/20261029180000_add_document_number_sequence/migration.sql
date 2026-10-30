-- Adds the database sequence backing backend-generated receiving document
-- numbers (`RCV-<YYYYMMDD>-<000001>`).
--
-- `docs/technical-spec.md` §5.5 requires the numeric suffix to come from a
-- PostgreSQL sequence so concurrent document creations cannot produce the same
-- number; the `UNIQUE (document_number)` constraint plus a bounded retry is
-- the safety net, not the primary mechanism. This migration is additive only:
-- no existing table, constraint, or applied migration is touched.
CREATE SEQUENCE receiving_document_number_seq;
