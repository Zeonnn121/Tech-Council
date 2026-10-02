# Backend — Technical Council API

The Express + TypeScript API. It owns all business logic, talks to MySQL through
a `mysql2` connection pool, and reaches S3/SSM through the AWS SDK using the
EC2 instance role (no static credentials).

```
src/
├── app.ts                 Express app: security middleware, routes, static serving
├── server.ts              Bootstrap: load config, init DB pool, listen, graceful shutdown
├── db.ts                  MySQL connection pool + typed query() helper
├── config/index.ts        Config loader (env vars in dev, SSM in prod)
├── middleware/            Cross-cutting request handling
├── routes/                Route definitions AND handlers (mounted under /api)
├── services/              Domain services (S3, PDF certificates)
├── utils/                 HttpError + helpers
└── scripts/               One-off CLI scripts (db init, seed)
```

> `src/controllers/` exists but is **empty and unused** — request handlers are
> written inline in the corresponding `routes/*.routes.ts` file. Add a
> `controllers/` layer only if you split handlers out.

---

## Entry points

### `server.ts`
1. Loads `dotenv/config`, then calls `loadConfig()`.
2. Calls `initPool(config)` to create the MySQL pool.
3. Starts `app.listen(config.PORT)` (default `4000`).
4. Registers `SIGTERM`/`SIGINT` handlers that close the HTTP server and drain the
   DB pool, with a 10-second force-exit guard. `closeIdleConnections()` is called
   so shutdown does not hang on keep-alive sockets.

Startup logs **never** include secret values.

### `app.ts`
- `trust proxy = 1` so `req.ip` is the real client IP behind the load balancer
  (the login rate limiter depends on this).
- **Helmet** with a CSP that allows presigned S3 images/uploads
  (`img-src`/`connect-src` include `https://*.amazonaws.com`) and disables
  `upgrade-insecure-requests` (the app runs over plain HTTP on EC2).
- **CORS** is enabled only in development, for `http://localhost:5173`; disabled
  in production (same-origin).
- `morgan` logging (`dev` locally, `combined` in production).
- Health: `GET /health`, `GET /health/db` (503 if the DB query fails).
- In production, serves `frontend/dist` with an SPA fallback that returns
  `index.html` for non-`/api`, non-`/health` GETs.
- Ends with `notFoundHandler` then `errorHandler`.

### `db.ts`
`initPool()` builds a pool (`connectionLimit: 10`, `dateStrings: true`,
`waitForConnections: true`). `query<T>(sql, params)` wraps `pool.query` and
returns the rows. Use `getPool().getConnection()` directly when you need a
transaction (`BEGIN` / `COMMIT` / `ROLLBACK`).

### `config/index.ts`
Caches config for the process lifetime.
- **Dev**: reads `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
  `JWT_SECRET`, `S3_BUCKET` from `process.env`; `AWS_REGION` defaults to
  `ap-south-1`.
- **Prod** (`NODE_ENV=production`): `GetParametersByPath` on `SSM_PATH`
  (default `/tc-events/prod/`) with `WithDecryption` and `Recursive`, mapping
  each parameter's last name segment to its config key.
- Fails fast if any required key is missing.

---

## Middleware (`src/middleware/`)

| File | Responsibility |
| --- | --- |
| `auth.ts` | `requireAuth` verifies the `Bearer` JWT, re-loads the user from the DB, and attaches `req.user`. `requireRole(...roles)` gates by role. |
| `validate.ts` | `validate(schema, target)` runs a Zod schema against `body`/`query`/`params` and replaces the value with the parsed (coerced/defaulted) result. |
| `errorHandler.ts` | `notFoundHandler` + `errorHandler`. Maps `HttpError` → its status, `ZodError` → 400 with per-field details, MySQL `ER_DUP_ENTRY` → 409, `ER_NO_REFERENCED_ROW_2` → 400, everything else → 500. |
| `asyncHandler.ts` | Wraps async handlers so rejected promises reach `errorHandler`. |

## Utilities (`src/utils/`)

`HttpError.ts` defines the `HttpError` class and helpers `badRequest`,
`unauthorized`, `forbidden`, `notFound`, `conflict`.

---

## Routes (`src/routes/`)

`index.ts` mounts the feature routers under `/api`. Order matters: specific
prefixes (`/auth`, `/users`, `/events`, `/participants`) are mounted first, then
the routers that declare full paths (`registrations`, `files`, `certificates`).
`events.routes.ts` registers `/meta/filters` **before** `/:id` so it is not
shadowed.

### `auth.routes.ts`
- `POST /auth/login` — in-memory rate limiter (10 attempts/IP/minute), bcrypt
  password check, 8-hour JWT (`user_id`, `role`).
- `GET /auth/me` — current user.

### `users.routes.ts`
- `POST /users` — admin only; bcrypt-hashes the password; duplicate email → 409.
- `GET /users` — admin/organizer; optional `?role=` filter.

### `events.routes.ts`
Full event lifecycle plus organizers and outcomes:
- `GET /events/meta/filters` — distinct categories, years, departments.
- `GET /events` — paginated list with `q`, `year`, `category`, `status`,
  `department`, `organizer`, `min_participants`, `from`, `to`, `sort`.
  `min_participants` switches the outcomes `LEFT JOIN` to an `INNER JOIN`.
- `GET /events/:id` — event + organizers, registration/file counts, outcome.
- `POST /events` — admin/organizer; validates `end_time > start_time` and
  `registration_deadline <= event_date`; rejects venue/time **scheduling
  conflicts** with 409.
- `PUT /events/:id` — partial update with the same conflict + time checks.
- `PATCH /events/:id/status` — enforces `VALID_TRANSITIONS`:
  `planned → registration_open → ongoing → completed`; `cancelled` from any
  non-terminal state; terminal states locked. Invalid transitions return 400.
- `DELETE /events/:id` — admin only.
- `GET/POST/DELETE /events/:id/organizers[...]` — manage organizer assignments.
- `PUT/GET /events/:id/outcome` — upsert outcome, only for **completed** events.
  When `participants_count` is omitted it defaults to the present-attendance
  count.

### `participants.routes.ts`
- `GET /participants` — paginated; `q` (name/email), `department`, `year`.
- `POST /participants` — admin/organizer; duplicate email → 409.
- `GET /participants/:id` — participant + full `participation_history`
  (registration, attendance, certificate per event).
- `PUT /participants/:id` — admin/organizer; partial update.

### `registrations.routes.ts`
- `POST /events/:id/registrations` — admin/organizer. Event must be `planned` or
  `registration_open` and the deadline must not have passed. Uses a
  `SELECT ... FOR UPDATE` transaction on the event row to decide `registered`
  vs `waitlisted` against `capacity`.
- `GET /events/:id/registrations` — list.
- `PATCH /registrations/:id` — cancel; if the cancelled row was `registered`,
  the oldest `waitlisted` participant is promoted to `registered`.
- `PUT /events/:id/attendance` — bulk `INSERT ... ON DUPLICATE KEY UPDATE`; every
  `participant_id` must already be `registered` for the event.
- `GET /events/:id/attendance` — records plus a registered/present/absent summary.

### `files.routes.ts`
Two-step direct-to-S3 upload. Validates `content_type` against a per-`file_type`
allow-list (photo/report/poster/document) and a 10 MB size cap.
- `POST /events/:id/files/upload-url` — returns a 5-minute presigned PUT URL and
  the generated `events/event-{id}/<folder>/<uuid>-<name>` key.
- `POST /events/:id/files` — registers the object after `HeadObject` confirms it
  exists; rejects keys that don't start with `events/event-{id}/`.
- `GET /events/:id/files` — optional `?file_type=`.
- `GET /files/:fileId/download-url` — 5-minute presigned GET URL.
- `DELETE /files/:fileId` — admin/organizer; deletes DB row then S3 object.

### `certificates.routes.ts`
- `POST /events/:id/certificates` — admin/organizer. Creates **pending**
  certificate rows only for participants marked present; skips others (with a
  reason) and duplicates. Runs in a transaction.
- `GET /events/:id/certificates`, `GET /participants/:id/certificates` — lists.
- `POST /certificates/:id/issue` — admin/organizer. Generates the PDF, uploads to
  S3, sets `status='issued'` and `issued_date`. Already-issued → 409.
- `GET /certificates/:id/download-url` — 5-minute presigned GET URL; 409 if not
  yet issued.

### `dashboard.routes.ts`
- `GET /dashboard/stats` — aggregate counts, events by category/year, top 5
  events (outcome count falling back to registration count), and 5 recent
  uploads, all via `Promise.all`.

---

## Services (`src/services/`)

### `s3.service.ts`
Thin wrapper over `@aws-sdk/client-s3` + presigner. Exports:
`sanitizeFilename`, `buildEventKey`, `getUploadUrl` (PUT, 300s),
`getDownloadUrl` (GET, 300s), `putObject`, `deleteObject`, `headObject`.
The S3 client is created per call from the loaded `AWS_REGION`. The bucket needs
CORS allowing `PUT`/`GET` (documented at the top of this file).

### `certificate.service.ts`
PDF generation with `pdfkit` (A4 landscape), rendered entirely in memory and
returned as a `Buffer` — nothing is written to disk. Exports
`buildCertificateCode` (`TC-{year}-E{eventId:3}-P{participantId:4}`),
`buildCertificateKey` (`certificates/event-{id}/{code}.pdf`), and
`generateCertificatePdf`.

---

## Scripts (`src/scripts/`)

Run via `tsx` (see `package.json`):

| Script | Command | Purpose |
| --- | --- | --- |
| `initDb.ts` | `npm run db:init` / `db:reset` | Applies `../../database/schema.sql`; `--reset` drops first. |
| `seed.ts` | `npm run db:seed` | Inserts demo users, participants, events, and related rows. |

The seed creates four users (admin `admin@council.edu` / `Admin@123`, two
organizers / `Organizer@123`, one member / `Member@123`) and 20 participants.
See the root [README](../README.md#2-seeded-logins-development-only) for logins.

---

## Notes on API documentation

`docs/API.md` describes the intended contract. A few endpoints have drifted from
it — verify against the route files above when in doubt. Notable differences:

- Event create/update use **`capacity`**, `start_time`, `end_time`, and
  `coordinator_id` (not `max_participants`).
- Invalid status transitions and non-completed outcome writes return **400**,
  not 409.
- `GET /events/:id/outcome` returns **404** when no outcome exists (not `null`).
- `GET /files/:fileId/download-url` and the attendance response shapes differ
  slightly from the examples in `docs/API.md`.
