# Technical Council Project: Prompt Pack for Local AI

## How to use this file

1. Start a new chat with your local AI and paste the **GLOBAL CONTEXT** section first.
2. Then paste **one PROMPT at a time**. Copy everything under a `## PROMPT n` heading up to the next `## ` heading.
3. After each prompt: run `npx tsc --noEmit` and `npm run dev`, test in Postman, then `git commit`. Do not move on until it works.
4. If the AI drifts or forgets, re-paste the GLOBAL CONTEXT.
5. Prompts 1-8 are the application. Prompts 9-11 are deployment files, the Lambda function and docs. The AWS console steps are at the bottom and are done by **you**, not the AI.

---

## GLOBAL CONTEXT (paste first, every session)

I am building the backend for a college mini project called **"Cloud-Based Technical Council Event Management and Digital Record System"**. It will be deployed on AWS (EC2 in a custom VPC, RDS MySQL, S3, IAM, SSM Parameter Store, CloudWatch, SNS, Auto Scaling, Lambda). A teammate builds the React frontend; I build the backend and the cloud infrastructure.

**Stack:** Node.js 20, Express, TypeScript (CommonJS, `tsx` for dev), `mysql2/promise`, `zod`, `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`, `morgan`, `dotenv`, AWS SDK for JavaScript v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-ssm`).

**Environment:** Windows + PowerShell for local work. MySQL 8 runs in Docker (container `tc-mysql`, database `tc_events`, user `root`, password `root`, port 3306). Files under `deploy/` are for Linux (Amazon Linux 2023) and may use bash.

**Already exists** in `backend/`: `package.json` (scripts: dev, build, start), `tsconfig.json` (strict, CommonJS, rootDir src, outDir dist), `.env`, `.env.example`, `src/app.ts` (helmet, cors, morgan, express.json, `GET /health`), `src/server.ts`, `src/db.ts` (basic pool), and empty folders `src/config`, `src/routes`, `src/controllers`, `src/services`, `src/middleware`. Repo root has `.gitignore`, `database/`, `docs/`.

**Target layout:**
```
backend/src/
  app.ts  server.ts  db.ts
  config/index.ts
  middleware/auth.ts  errorHandler.ts  validate.ts  asyncHandler.ts
  utils/HttpError.ts
  routes/index.ts  auth.routes.ts  events.routes.ts  participants.routes.ts
         files.routes.ts  certificates.routes.ts  dashboard.routes.ts
  controllers/  (one per route file)
  services/  s3.service.ts  certificate.service.ts
  scripts/  initDb.ts  seed.ts
database/schema.sql
deploy/  lambda/  docs/
```

**Rules you must follow:**
- TypeScript strict. Avoid `any`.
- Never hard-code secrets or AWS keys. AWS SDK clients must use the default credential chain (so the EC2 IAM role works in production).
- All SQL must be parameterized (`?` placeholders). No string-concatenated user input in SQL.
- Wrap async route handlers with an `asyncHandler`. Validate every request body/query with `zod`.
- Do not add dependencies other than those named in a prompt. Do not change files outside the scope of the current prompt.
- After finishing, list every file you created or changed, and tell me exactly how to test it.

**API conventions:**
- All routes live under `/api`, except `GET /health` at the root.
- Success: `{ "data": ... }`. Lists: `{ "data": [...], "page": 1, "limit": 20, "total": 57 }`.
- Errors: `{ "error": { "message": "...", "details": ... } }` with correct status codes (400, 401, 403, 404, 409, 500).
- Return DB column names as-is (snake_case). The MySQL pool must use `dateStrings: true` so DATE/TIME columns come back as `"YYYY-MM-DD"` / `"HH:MM:SS"` strings (no timezone shifts).
- Roles: `admin`, `organizer`, `member`. Access: any authenticated user can GET; `admin` or `organizer` can create/update event data (events, organizers, registrations, attendance, files, certificates, outcomes); only `admin` can delete events and create users.

---

## PROMPT 1: Database schema, init script and seed data

Create `database/schema.sql` with **exactly** this content:

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','organizer','member') NOT NULL DEFAULT 'member',
  department VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  event_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  venue VARCHAR(150) NOT NULL,
  coordinator_id INT UNSIGNED NULL,
  capacity INT UNSIGNED NOT NULL DEFAULT 100,
  registration_deadline DATE NULL,
  status ENUM('planned','registration_open','ongoing','completed','cancelled') NOT NULL DEFAULT 'planned',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_coordinator FOREIGN KEY (coordinator_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_events_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_events_date (event_date),
  INDEX idx_events_category (category),
  INDEX idx_events_status (status),
  INDEX idx_events_venue_date (venue, event_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS participants (
  participant_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  department VARCHAR(100) NOT NULL,
  year TINYINT UNSIGNED NOT NULL,
  phone VARCHAR(20) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS registrations (
  registration_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  participant_id INT UNSIGNED NOT NULL,
  registration_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('registered','waitlisted','cancelled') NOT NULL DEFAULT 'registered',
  CONSTRAINT fk_reg_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_reg_participant FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
  UNIQUE KEY uq_reg_event_participant (event_id, participant_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance (
  attendance_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  participant_id INT UNSIGNED NOT NULL,
  present BOOLEAN NOT NULL DEFAULT FALSE,
  marked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_att_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_att_participant FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
  UNIQUE KEY uq_att_event_participant (event_id, participant_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS organizers (
  organizer_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  responsibility VARCHAR(200) NOT NULL,
  CONSTRAINT fk_org_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_org_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE KEY uq_org_event_user (event_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS certificates (
  certificate_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  certificate_code VARCHAR(40) NOT NULL UNIQUE,
  event_id INT UNSIGNED NOT NULL,
  participant_id INT UNSIGNED NOT NULL,
  s3_key VARCHAR(500) NULL,
  status ENUM('pending','issued') NOT NULL DEFAULT 'pending',
  issued_date DATE NULL,
  CONSTRAINT fk_cert_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_cert_participant FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
  UNIQUE KEY uq_cert_event_participant (event_id, participant_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS event_files (
  file_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  s3_key VARCHAR(500) NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  file_type ENUM('photo','report','poster','document') NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NULL,
  uploaded_by INT UNSIGNED NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_file_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_file_user FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_files_event (event_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS outcomes (
  outcome_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL UNIQUE,
  participants_count INT UNSIGNED NOT NULL DEFAULT 0,
  feedback_score DECIMAL(3,2) NULL,
  winners TEXT NULL,
  description TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_out_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

Then create:

1. `backend/src/scripts/initDb.ts`: loads `.env`, connects with `mysql2/promise` using `multipleStatements: true`, reads `../../../database/schema.sql` (resolve the path correctly from `src/scripts`), runs it. If run with the flag `--reset`, first run `SET FOREIGN_KEY_CHECKS=0`, drop all 9 tables, then `SET FOREIGN_KEY_CHECKS=1`. Print which tables exist at the end. Must refuse `--reset` when `NODE_ENV=production`.
2. `backend/src/scripts/seed.ts`: idempotent seed script. If `users` already has rows, print "already seeded" and exit, unless run with `--force`, which truncates all tables first. Hash passwords with `bcryptjs` (10 rounds). Seed:
   - Users: `admin@council.edu` / `Admin@123` (admin), `organizer1@council.edu` and `organizer2@council.edu` / `Organizer@123` (organizer), `member@council.edu` / `Member@123` (member). Include departments.
   - 20 participants (varied departments: CSE, IT, ECE, MECH; years 1-4).
   - 6 events across 2024, 2025 and 2026 with categories Workshop, Hackathon, Seminar, Competition; statuses mixed (some `completed`, one `registration_open`, one `planned`); no venue/time overlaps.
   - Organizers for each event; registrations (8-12 per event); attendance and outcomes for completed events; a few certificates (`pending` and `issued`, with `s3_key` NULL).
3. Add scripts to `backend/package.json`: `"db:init": "tsx src/scripts/initDb.ts"`, `"db:reset": "tsx src/scripts/initDb.ts --reset"`, `"db:seed": "tsx src/scripts/seed.ts"`.

**Definition of done:** `npm run db:reset` then `npm run db:seed` succeed, and `docker exec -it tc-mysql mysql -uroot -proot tc_events -e "SHOW TABLES;"` lists 9 tables.

---

## PROMPT 2: Config (env + SSM), DB pool, middleware, error handling

Implement the following. Do not implement any feature routes yet.

1. `src/utils/HttpError.ts`: class `HttpError extends Error` with `status` and optional `details`. Helpers: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`.
2. `src/config/index.ts`: export an interface `AppConfig` (PORT, NODE_ENV, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET, AWS_REGION, S3_BUCKET) and `async function loadConfig(): Promise<AppConfig>`.
   - If `NODE_ENV !== 'production'`: read everything from `process.env` (dotenv already loaded).
   - If `NODE_ENV === 'production'`: use `SSMClient` + `GetParametersByPath` (with `WithDecryption: true`, `Recursive: true`, and pagination via `NextToken`) on the path from `SSM_PATH` (default `/tc-events/prod/`). Map the parameter names (last path segment) DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET, S3_BUCKET into the config. `AWS_REGION` comes from the environment (default `ap-south-1`).
   - Throw a clear error listing any missing required key. Never log secret values.
   - Cache the loaded config in a module variable and export `getConfig()`.
3. Refactor `src/db.ts` into `initPool(config)` and `getPool()` (throws if not initialised). Pool options: `connectionLimit: 10`, `dateStrings: true`, `waitForConnections: true`. Also export `query<T>(sql, params)` helper.
4. `src/middleware/asyncHandler.ts`, `validate.ts` (takes a zod schema and a target of `body`, `query` or `params`; on failure throws a 400 `HttpError` with the zod issues in `details`; on success replaces the request value with the parsed one), and `errorHandler.ts` (handles `HttpError`, `ZodError`, MySQL duplicate-entry `ER_DUP_ENTRY` → 409, foreign key errors `ER_NO_REFERENCED_ROW_2` → 400, everything else → 500 with a generic message; log the real error with `console.error`). Also export a `notFoundHandler` (404 JSON).
5. Update `src/app.ts`: keep `/health` returning `{status:"ok"}` (no DB access). Add `GET /health/db` that runs `SELECT 1` and returns `{status:"ok", db:"up"}` or 503. Mount `routes/index.ts` (an empty router for now) at `/api`. Add `notFoundHandler` and `errorHandler` last. CORS: allow `http://localhost:5173` in development; in production allow same-origin only.
6. Update `src/server.ts`: `await loadConfig()`, `initPool(config)`, then listen. On failure, log and `process.exit(1)`.

**Definition of done:** `npm run dev` starts, `/health` and `/health/db` both return ok, and an unknown route returns a JSON 404.

---

## PROMPT 3: Authentication and users

Implement:

1. `src/middleware/auth.ts`: `requireAuth` (reads `Authorization: Bearer <jwt>`, verifies with `JWT_SECRET`, loads `{ user_id, role, email, name }` onto `req.user`; 401 if missing/invalid) and `requireRole(...roles)` (403 if the role isn't allowed). Add a type declaration so `req.user` is typed.
2. `POST /api/auth/login` body `{ email, password }`. Compare with `bcryptjs`. Use the same error message for unknown email and wrong password. Return `{ data: { token, user: { user_id, name, email, role, department } } }`. JWT expires in 8h and contains `user_id` and `role`.
3. `GET /api/auth/me`: requires auth, returns the current user.
4. `POST /api/users` (admin only): create a user with `{ name, email, password (min 8), role, department }`, hash the password. Never return `password_hash`.
5. `GET /api/users` (admin or organizer): list users (without `password_hash`), optional `?role=` filter. The frontend needs this to pick coordinators and organizers.
6. Add a simple in-memory rate limiter for `/api/auth/login` (max 10 attempts per minute per IP) written by hand (no new dependency).

**Definition of done:** Login with the seeded admin returns a token, `/api/auth/me` works with it and returns 401 without it, and a `member` gets 403 on `POST /api/users`.

---

## PROMPT 4: Events, organizers and historical search

Implement (all require auth; see the access rules in the global context):

1. `GET /api/events`: pagination (`page`, `limit` default 20, max 100) and filters: `q` (LIKE on title and description), `year` (from `event_date`), `category`, `status`, `department` (department of the event's coordinator), `organizer` (user_id), `min_participants` (from `outcomes.participants_count`), `from`/`to` dates, and `sort` (`date_desc` default, `date_asc`, `title`). Each row includes `coordinator_name`, `registration_count` (status 'registered') and `outcome_participants` (null if none). Build the SQL dynamically with parameterized conditions only.
2. `GET /api/events/:id`: event details plus `coordinator`, `organizers` (with user names and responsibility), `registration_count`, `file_count` and `outcome` (or null).
3. `POST /api/events` and `PUT /api/events/:id` (admin/organizer): validate with zod (`end_time` must be after `start_time`, `registration_deadline` must be on or before `event_date`, `capacity ≥ 1`). **Scheduling conflict check:** reject with 409 if a non-cancelled event exists at the same `venue` on the same `event_date` with overlapping time (`new_start < existing_end AND new_end > existing_start`), excluding the event itself on update. The 409 body's `details` must include the conflicting event's id, title and times. Set `created_by` from the logged-in user.
4. `PATCH /api/events/:id/status` (admin/organizer): body `{ status }`. Allowed transitions: planned → registration_open → ongoing → completed; any state → cancelled; no transitions out of completed or cancelled. Invalid transition → 400.
5. `DELETE /api/events/:id` (admin only).
6. Organizers: `GET /api/events/:id/organizers`, `POST /api/events/:id/organizers` (`{ user_id, responsibility }`, 409 on duplicate), `DELETE /api/events/:id/organizers/:organizerId`.
7. `GET /api/events/meta/filters`: returns distinct `categories`, `years` and `departments` so the frontend can populate filter dropdowns. Register this route **before** `/:id` so it doesn't get shadowed.

**Definition of done:** Creating an overlapping event returns 409; searching `?year=2025&category=Hackathon` returns only matching events; a `member` gets 403 on POST.

---

## PROMPT 5: Participants, registrations and attendance

Implement:

1. Participants: `GET /api/participants` (pagination, `q` on name/email, `department`, `year`), `POST /api/participants` (admin/organizer; email unique → 409), `GET /api/participants/:id` (details plus **participation history**: every event they registered for, with registration status, attendance and certificate status), `PUT /api/participants/:id`.
2. Registration: `POST /api/events/:id/registrations` (admin/organizer) body `{ participant_id }`. Rules, in this order:
   - Event must exist and have status `planned` or `registration_open`, otherwise 400.
   - If `registration_deadline` is set and today is after it → 400.
   - If already registered (unique key) → 409.
   - Count current `registered` rows inside a **transaction** with `SELECT ... FOR UPDATE` on the event row. If count ≥ `capacity`, insert with status `waitlisted`, else `registered`. Return the created row.
3. `GET /api/events/:id/registrations`: list with participant name, email, department, year and status.
4. `PATCH /api/registrations/:id` (admin/organizer): body `{ status: 'cancelled' }`. When a registered participant cancels, promote the oldest `waitlisted` registration for the same event to `registered` (inside a transaction).
5. Attendance: `PUT /api/events/:id/attendance` (admin/organizer) body `{ records: [{ participant_id, present }] }`. Only accept participants with a `registered` status for that event (others → 400 listing the invalid ids). Upsert with `INSERT ... ON DUPLICATE KEY UPDATE` in one transaction. `GET /api/events/:id/attendance` returns every registered participant with `present` (false if not marked) plus a summary `{ registered, present, absent }`.

**Definition of done:** Registering beyond capacity yields `waitlisted`; cancelling promotes a waitlisted participant; attendance summary numbers are correct.

---

## PROMPT 6: Files and S3 (presigned URLs)

Implement `src/services/s3.service.ts` and `src/routes/files.routes.ts`.

**Important:** The S3 client must be created with only `{ region }`, with no access keys in code. Locally it will use my AWS CLI profile; on EC2 it will use the instance role. The bucket is private.

1. `s3.service.ts`: `getUploadUrl({ key, contentType })` → presigned PUT URL (expires in 5 minutes), `getDownloadUrl(key)` → presigned GET URL (expires in 5 minutes), `putObject(key, body, contentType)`, `deleteObject(key)`, `buildEventKey(eventId, fileType, originalName)`.
2. Key format: `events/event-{eventId}/{photos|reports|posters|documents}/{uuid}-{sanitizedFilename}`. Use `crypto.randomUUID()`. Sanitize filenames (letters, digits, dot, dash, underscore only; max 100 chars).
3. `POST /api/events/:id/files/upload-url` (admin/organizer) body `{ file_name, file_type, content_type, size_bytes }`. Allowed types: photos `image/jpeg`, `image/png`, `image/webp`; reports/documents `application/pdf` (and docx for documents); posters images or PDF. Max 10 MB (reject larger with 400). Return `{ upload_url, s3_key }`. The frontend then uploads with `PUT` directly to S3 and calls the next endpoint.
4. `POST /api/events/:id/files` (admin/organizer) body `{ s3_key, original_name, file_type, content_type, size_bytes }`. Verify that `s3_key` starts with `events/event-{id}/`. Optionally confirm the object exists using `HeadObject`. Then insert into `event_files` with `uploaded_by`.
5. `GET /api/events/:id/files` (optional `?file_type=`): list of file rows.
6. `GET /api/files/:fileId/download-url`: returns `{ url }` (presigned GET, 5 min).
7. `DELETE /api/files/:fileId` (admin/organizer): delete the DB row and the S3 object.
8. Document in a code comment the S3 CORS configuration the bucket needs for browser uploads: allow `PUT` and `GET` from the site origin and `http://localhost:5173`, allow header `Content-Type`, expose `ETag`.

**Definition of done:** With valid local AWS credentials and a real bucket, I can get an upload URL, `PUT` a file to it from Postman, register it, and download it through the presigned GET URL.

---

## PROMPT 7: Certificates, outcomes and dashboard

Implement:

1. Certificates (admin/organizer to write, any authenticated user to read):
   - `POST /api/events/:id/certificates` body `{ participant_ids: number[] }`. Only participants who have `present = true` for that event get one (others reported back in a `skipped` list with the reason). Certificate code format: `TC-{year}-E{eventId padded to 3}-P{participantId padded to 4}`. Status `pending`. Duplicates are skipped, not errors.
   - `GET /api/events/:id/certificates` and `GET /api/participants/:id/certificates`.
   - `POST /api/certificates/:id/issue`: generate a PDF certificate with **`pdfkit`** (this is the only new dependency for this prompt: `npm i pdfkit` and `npm i -D @types/pdfkit`) showing the participant name, event title, date, and certificate code. Generate it in memory, upload to S3 at `certificates/event-{eventId}/{certificate_code}.pdf` via `putObject`, then set `s3_key`, `status='issued'`, `issued_date=CURDATE()`. Put the PDF logic in `services/certificate.service.ts`.
   - `GET /api/certificates/:id/download-url`: presigned GET URL (409 if not issued yet).
2. Outcomes:
   - `PUT /api/events/:id/outcome` (admin/organizer): upsert `{ participants_count?, feedback_score? (0-5), winners?, description? }`. If `participants_count` is not given, default to the number of `present` attendance rows. Event must be `completed`, otherwise 400.
   - `GET /api/events/:id/outcome`.
3. Dashboard `GET /api/dashboard/stats` (any authenticated user) returning:
   `total_events`, `upcoming_events` (date ≥ today, not cancelled), `completed_events`, `total_participants`, `total_registrations`, `certificates_issued`, `events_by_category` (array of `{category, count}`), `events_by_year` (array of `{year, count}`), `top_events` (top 5 by outcome participants_count or registration count), and `recent_uploads` (last 5 `event_files` with the event title).

**Definition of done:** Issuing a certificate creates a real PDF object in S3 and updates the row; dashboard numbers match the seeded data.

---

## PROMPT 8: Production hardening and static frontend serving

Implement:

1. In `app.ts`, when `NODE_ENV === 'production'`, serve the built frontend from `path.join(__dirname, '../../frontend/dist')` (note that `__dirname` is `backend/dist` after compile) using `express.static`. Add an SPA fallback: any `GET` request that does not start with `/api` or `/health` returns `index.html`. Skip all of this if the folder doesn't exist (log a warning).
2. Trust the proxy (`app.set('trust proxy', 1)`) so the rate limiter sees real IPs behind a load balancer.
3. Graceful shutdown in `server.ts`: on `SIGTERM` and `SIGINT`, stop accepting connections, close the DB pool, then exit (force-exit after 10 s).
4. Structured request logging in production: use morgan's `combined` format writing to stdout. (pm2 will redirect to files later.) Log startup information: environment, port, and which config source (env or SSM) was used. Never log secrets.
5. Add the `helmet` CSP setting so the frontend can still load images from presigned S3 URLs (`img-src 'self' data: https://*.amazonaws.com`) and can `PUT` to S3 (`connect-src 'self' https://*.amazonaws.com`).
6. Add `npm run build` verification: `npm run build && npm start` must work locally with `NODE_ENV=development` and the built output.

**Definition of done:** `npm run build && npm start` runs from `dist`, and graceful shutdown works with Ctrl+C.

---

## PROMPT 9: Deployment artifacts (Linux, for EC2 and Auto Scaling)

Create a `deploy/` folder at the repo root with the following files. Target OS is **Amazon Linux 2023**, region `ap-south-1`.

1. `deploy/build-and-upload.ps1` (PowerShell, runs on my Windows machine): builds the frontend (`npm ci && npm run build` in `frontend/`) and the backend (`npm ci && npm run build` in `backend/`), creates `app.tar.gz` containing `backend/dist`, `backend/package.json`, `backend/package-lock.json`, `frontend/dist` and `deploy/ecosystem.config.js` (use the Windows built-in `tar`), then uploads it with `aws s3 cp app.tar.gz s3://$BucketName/deploy/app.tar.gz`. Take `$BucketName` as a parameter.
2. `deploy/ecosystem.config.js`: pm2 app named `tc-backend`, script `backend/dist/server.js`, `NODE_ENV=production`, `SSM_PATH=/tc-events/prod/`, `AWS_REGION=ap-south-1`, `PORT=80` is **not** allowed for a non-root user, so use `PORT=3000` and document that a port-80 redirect is done with an iptables rule (see next file). Logs: `out_file: /var/log/tc-app/out.log`, `error_file: /var/log/tc-app/err.log`, `merge_logs: true`.
3. `deploy/user-data.sh` (bash, used as EC2 Launch Template user data and for the first manual instance). It must be idempotent-friendly and do the following, in order:
   - Install Node.js 20 (NodeSource RPM setup for 20.x), `pm2` (global) and the CloudWatch agent (`dnf install -y amazon-cloudwatch-agent`).
   - Create `/var/log/tc-app` owned by `ec2-user`, and `/opt/tc-app` for the app.
   - Download `s3://<BUCKET>/deploy/app.tar.gz` using `aws s3 cp` (the instance role provides the credentials) and extract to `/opt/tc-app`.
   - Run `npm ci --omit=dev` in `/opt/tc-app/backend`.
   - Add an iptables rule redirecting port 80 → 3000 (`iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000`).
   - Start the app with pm2 as `ec2-user`, run `pm2 save` and set up `pm2 startup systemd` so it survives reboot.
   - Start the CloudWatch agent with the config from the next file.
   - Use a `BUCKET_NAME` variable at the top of the script that I can edit.
4. `deploy/cloudwatch-agent-config.json`: collect logs from `/var/log/tc-app/out.log` and `/var/log/tc-app/err.log` into log group `/tc-events/app` (stream name `{instance_id}`), and metrics `mem_used_percent` and `disk_used_percent` (root `/`) every 60 seconds.
5. `deploy/iam-ec2-policy.json`: a least-privilege inline policy for the EC2 role, with placeholders `BUCKET_NAME`, `REGION`, `ACCOUNT_ID`:
   - S3: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::BUCKET_NAME/*`, and `s3:ListBucket` on `arn:aws:s3:::BUCKET_NAME`.
   - SSM: `ssm:GetParametersByPath` and `ssm:GetParameter` on `arn:aws:ssm:REGION:ACCOUNT_ID:parameter/tc-events/prod*`.
   Also add a `deploy/README.md` stating that the managed policies `CloudWatchAgentServerPolicy` and `AmazonSSMManagedInstanceCore` must also be attached to the role (the second one allows Session Manager access without opening SSH).
6. `deploy/ssm-parameters.md`: a table of the parameter names to create under `/tc-events/prod/` (DB_HOST, DB_PORT, DB_USER, DB_NAME, JWT_SECRET, S3_BUCKET as String; DB_PASSWORD and JWT_SECRET as SecureString), plus the equivalent `aws ssm put-parameter` commands (PowerShell-compatible, with placeholders).
7. `deploy/schema-import.md`: how to import `database/schema.sql` into RDS **from the EC2 instance** (RDS is private): connect through Session Manager, install the MySQL client (`dnf install -y mariadb105`), then run `mysql -h <RDS_ENDPOINT> -u <USER> -p tc_events < schema.sql`.

**Definition of done:** All files exist, the scripts are syntactically valid, and there is no hard-coded secret anywhere.

---

## PROMPT 10: Lambda function (S3 upload trigger → SNS)

Create `lambda/s3-upload-handler/` with `index.mjs` (Node.js 20 runtime, ES modules, uses the AWS SDK v3 that is already included in the Lambda runtime, so **no `package.json` dependencies needed**) and a `README.md`.

The function is triggered by S3 `ObjectCreated:*` events (prefixes `events/` and `certificates/`).

For each record:
1. Decode the object key: `decodeURIComponent(key.replace(/\+/g, ' '))`.
2. Validate: extension must be one of `jpg, jpeg, png, webp, pdf, docx`; size must be ≤ 10 MB. Classify the object as `photo`, `report`, `poster`, `document` or `certificate` from the key path.
3. Write a structured JSON log line (`console.log(JSON.stringify({...}))`) with bucket, key, size, category, and `valid: true/false`.
4. Publish a message to the SNS topic in the environment variable `SNS_TOPIC_ARN` (`@aws-sdk/client-sns`, `PublishCommand`), with subject `New upload: <category>` (or `Invalid upload` for failures), and body containing the key, size and time.
5. One record's failure must not stop the others (try/catch per record; rethrow at the end if any failed so Lambda retries).

The README must contain: the required environment variable; the execution role permissions (`AWSLambdaBasicExecutionRole` plus `sns:Publish` on the topic ARN); steps to add the S3 trigger (event type, prefix filters); and a warning **not** to configure overlapping prefix triggers and **not** to make the Lambda write to the same bucket path it is triggered by (recursive-invocation loop).

**Definition of done:** A local test with a sample S3 event JSON (include `lambda/s3-upload-handler/sample-event.json`) shows the correct parsing when run with a small `node` test harness that stubs the SNS call.

---

## PROMPT 11: API documentation and Postman collection

1. Create `docs/API.md` documenting every endpoint implemented: method, path, auth/role required, request body/query, example success response, error cases. Group by module. Note the conventions (the `/api` prefix, `{data}` and `{error}` envelopes, snake_case, date formats).
2. Create `docs/TechCouncil.postman_collection.json` (Postman v2.1) with: a collection variable `baseUrl` (default `http://localhost:4000`) and `token`; a login request whose test script stores the token into the `token` variable; and one request per endpoint using `Bearer {{token}}` auth, in the order of the demo flow: login → create event → add organizer → register participant → mark attendance → get upload URL → register file → issue certificate → set outcome → dashboard → search.
3. Create `docs/DEMO_FLOW.md` listing the demo steps with the exact endpoint calls, so the frontend teammate and I can rehearse.

**Definition of done:** The collection imports into Postman and the full flow runs top to bottom against the local server.

---

# YOUR MANUAL AWS CHECKLIST (do this yourself in the console)

Do this **after Prompt 8 works locally**. The AI cannot do this part for you, and you'll need screenshots for your report anyway. Take one screenshot per step.

**A. Local AWS access for S3 testing**
- Create an IAM user for local development with access to **only your bucket** (never use the root account). Run `aws configure` with its keys (stored in your user profile, never in the repo).

**B. Networking**
1. VPC `10.0.0.0/16`.
2. Subnets: 2 public (`10.0.1.0/24`, `10.0.2.0/24`) and 2 private (`10.0.11.0/24`, `10.0.12.0/24`), spread across 2 AZs.
3. Internet Gateway attached to the VPC. Public route table sends `0.0.0.0/0` to the IGW and is associated with the public subnets. Private route table has no internet route. **Do not create a NAT Gateway** (it costs money).
4. Security groups: `app-sg` (HTTP 80 from anywhere; no SSH rule needed if you use Session Manager) and `db-sg` (MySQL 3306 **only from `app-sg`**).

**C. Data layer**
5. RDS DB subnet group using the two private subnets.
6. RDS MySQL: free-tier template, `db.t3.micro` or `db.t4g.micro`, single-AZ, **public access = No**, `db-sg`, initial database name `tc_events`.
7. S3 bucket: block all public access; add the CORS config from Prompt 6; create the folders `events/`, `certificates/`, `backups/`, `deploy/`.

**D. Security and config**
8. IAM role for EC2 using `deploy/iam-ec2-policy.json` plus the two managed policies.
9. SSM parameters from `deploy/ssm-parameters.md`.

**E. Compute**
10. Run `deploy/build-and-upload.ps1`, then launch an EC2 instance (Amazon Linux 2023, `t3.micro`) in a public subnet with `app-sg`, the IAM role, and `deploy/user-data.sh` as user data.
11. Connect through Session Manager and import the schema into RDS (`deploy/schema-import.md`). Open the instance public IP in a browser.

**F. Monitoring and extras**
12. SNS topic and your email subscription (confirm the email!).
13. CloudWatch alarm: `CPUUtilization` > 70% for 5 minutes → SNS. For testing, temporarily use a low threshold and run `stress` on the instance.
14. Lambda function (Prompt 10) with the S3 trigger; upload a file through the app and check the email.
15. AMI of the working instance → Launch Template (with user data) → Auto Scaling Group (min 1, desired 1, max 2) with a target-tracking CPU policy. If you skip the load balancer for cost reasons, say so in your report and demo the scaling policy and a scale-out event.

**G. After your evaluation:** delete the ASG, EC2, RDS (skip the final snapshot), S3 objects and bucket, and the SNS topic, so you don't get billed.
