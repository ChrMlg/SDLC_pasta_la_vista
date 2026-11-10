# SDLC backend

## H10 - Table reservations

Story: [H10 / issue #41](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues/41).
Branch: `feature/H10-table-reservations`, based on `develop`.

This change implements customer reservation creation and the availability query needed to select a time. Management occupancy, cancellation, and customer reservation lists belong to H11/H12 and are not included.

| Method | Route (prefix `/api`) | Access |
| --- | --- | --- |
| POST | `/reservations` | CUSTOMER |
| GET | `/branches/:branchId/reservation-availability?date=YYYY-MM-DD&partySize=2` | CUSTOMER |

```json
{"branchId":"<uuid>","date":"2030-01-15","time":"12:00","partySize":4}
```

Successful creation returns HTTP 201 with `id`, `branchId`, `tableId`, `customerId`, `date`, `startTime`, `endTime`, `partySize`, `status`, timestamps, `branchName`, and `tableNumber`. The customer comes from the verified session cookie. Errors use `{code, message, field}`: 400 for invalid data, 401 for no session, 403 for staff roles, 404 for a missing branch, and 409 when no suitable table is available.

Reservations last 90 minutes. Start times are one hour apart from opening and the full reservation must fit before closing. The implementation default is **12:00-22:00 daily**, configurable through `Branch.openingTime` and `Branch.closingTime`; the last default start is 20:00. H10 does not specify exact business hours, so configure these values for each branch before shared deployment. Dates and times use `America/El_Salvador`. The canonical `date`, `startTime`, and `endTime` fields are stored as local strings, while audit timestamps use UTC.

Creation locks the branch and its eligible tables within one transaction, then checks overlaps using half-open intervals. Two requests for the last table produce one 201 and one 409. PENDING and CONFIRMED reservations block capacity; CANCELLED reservations do not. Tables without a capacity or marked OUT_OF_SERVICE are excluded. The smallest suitable table is selected. Future bookings do not change the table's current operational status.

Availability returns `{branchId, date, partySize, timeZone, slots}`; each slot contains only `{time, endTime, available}`. It does not disclose customers or table IDs. Creation always checks availability again inside the transaction.

After commit, the existing notification service records `reservation.confirmed:<id>` for the customer. A notification failure is logged and does not undo the reservation. Persistent notification retries remain outside this story.

## Migration and seed

`20261109000000_h10_table_reservations` adds only Reservation, branch opening hours, nullable table capacity, indexes, and validation constraints. Existing records are retained. Existing table capacities remain unset until explicitly configured.

The Prisma seed requires three existing branch IDs through `RESERVATION_CENTRO_ID`, `RESERVATION_BAMBU_ID`, and `RESERVATION_RAMBLAS_ID`. It prepares 12/10/8 tables with the documented capacity groups. It fills unset capacities, preserves existing capacities and statuses, and can be repeated without duplicates. Run `prisma db seed --schema backend/prisma/schema.prisma` with those variables only after selecting the intended database. Historical branch names and identities are not replaced automatically.

No migrations or seeds from this story have been applied to Supabase. Local QA uses a separate PostgreSQL database.

## Local verification

Run commands from the repository root. `.env.h10.qa.local` is private and ignored. It contains DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, QA_DB_PORT, QA_API_PORT, and QA_BASE_URL. Use a URL-safe random local password, the database name `sdlc_h10_test`, database port 55440, and API port 3310. `run-qa.cjs` rejects remote databases and names without the `_test` suffix; it sets DIRECT_URL to that same local database. It never reads `backend/.env`.

```bash
docker compose -p sdlc-h10 -f compose.yaml -f compose.test.yaml --env-file .env.h10.qa.local up -d --wait db
node backend/scripts/run-qa.cjs ./node_modules/.bin/prisma generate --schema backend/prisma/schema.prisma
node backend/scripts/run-qa.cjs ./node_modules/.bin/prisma migrate deploy --schema backend/prisma/schema.prisma
npm run build --workspace backend
npm test --workspace backend
node backend/scripts/run-qa.cjs npm run test:h10 --workspace backend
node backend/scripts/run-qa.cjs npm run test:integration --workspace backend
```

The H10 suite starts its own backend on port 3323, creates isolated fixtures, and removes only those fixtures afterward. It covers concurrent requests, access control, validation, notification ownership/failure, database constraints, and repeatable seeding. The notification-failure test deliberately produces an error log; that log is expected.

For the H10 Postman collection:

```bash
node backend/scripts/run-qa.cjs npm run db:seed:h10:qa --workspace backend
PORT=3310 node backend/scripts/run-qa.cjs node backend/dist/main.js
```

In another terminal, import `postman/H10-Reservations.postman_collection.json` and the private `postman/.env.h10.local` into Postman, or run with Newman installed separately:

```bash
newman run postman/H10-Reservations.postman_collection.json -e postman/.env.h10.local
```

The tracked `postman/H10-Local.postman_environment.json` contains placeholders only. Each run creates a reservation; choose another future date/time if repeated runs fill the selected slot. Do not commit private environments or exported session cookies. Execution evidence is in `docs/qa/H10_RESULTS.txt`.

## Review

Use `feat(H10): registrar reservaciones de mesa (#41)` as the commit and PR title. Explain that the change prevents overlapping bookings and derives customer identity from the session. Link issue #41 in the PR and add the PR URL to the board card. Confirm the story is assigned to the responsible contributor. Another team member must approve the PR before it is merged into `develop`. See [H10 delivery instructions](../docs/qa/H10_ENTREGA.md) for the exact staging commands, reason for the commit, and verification performed on 2026-11-10.
