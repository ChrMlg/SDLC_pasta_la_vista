Fix payment permissions, card validation, and the PAID status. Repeated payment requests no longer duplicate charges, kitchen tickets, or receipts. Add notifications scoped by recipient and branch, H29/H30 queries, order linking fixes, and receipt access checks. Long receipts now span multiple PDF pages.

Validation: build, 5 unit test files, 3 existing PostgreSQL tests, and 108 HTTP/concurrency checks passed. The Docker image builds and its health endpoint responds successfully. Both Supabase connections and backend startup with SELECT 1 were verified; no remote migrations were applied.

Includes two migrations that preserve existing data, a lockfile, a local QA seed, a 43-request Postman collection, and test documentation. The collection was not executed with Postman or Newman; real HTTP integration tests ran with Node.

Pending: the Supabase public schema is empty. Deploying historical migrations, which include demo data, requires approval. Full M3/M4/M7 implementations remain outside this change. The frontend owner should review the updated payment, registration, and receipt pagination contracts. See docs/qa/FASE_A_CHRISTIAN.md for evidence and limitations.
