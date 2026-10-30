-- Creates the dedicated automated-test database on first initialisation.
-- Automated tests use `TEST_DATABASE_URL` and never touch the development
-- database. This script runs only when the data volume is empty.

CREATE DATABASE warehouse_test;
