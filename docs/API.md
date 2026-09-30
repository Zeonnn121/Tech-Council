# Technical Council API Reference

## Conventions

- **Base URL**: `http://localhost:4000/api` (dev) — set via `PORT` env var
- **Authentication**: JWT Bearer token — `Authorization: Bearer <token>`
- **Response envelope**: All successful responses use `{ "data": ... }`
- **Error envelope**: `{ "error": { "message": "...", "details": [...] } }`
- **Field naming**: snake_case throughout
- **Dates**: ISO 8601 strings (`YYYY-MM-DD` for dates, `YYYY-MM-DDTHH:mm:ss.sssZ` for timestamps)
- **Pagination**: `page` (default 1) and `limit` (default 20) query params; response includes `page`, `limit`, `total`

### HTTP status codes

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 204 | No Content (delete/update with no body) |
| 400 | Validation error |
| 401 | Missing or invalid token |
| 403 | Authenticated but insufficient role |
| 404 | Resource not found |
| 409 | Conflict (duplicate, capacity full, invalid state) |
| 500 | Internal server error |

### Role hierarchy

`admin` > `organizer` > `member`

---

## Auth

### POST /api/auth/login

Rate limited: 10 attempts per minute per IP.

**Request body**
```json
{ "email": "admin@council.edu", "password": "secret123" }
```

**Success** `200`
```json
{
  "data": {
    "token": "<JWT>",
    "user": {
      "user_id": 1,
      "name": "Alice Admin",
      "email": "admin@council.edu",
      "role": "admin",
      "department": "Computer Science"
    }
  }
}
```

**Errors**
- `401` — invalid credentials
- `429` — rate limit exceeded

---

### GET /api/auth/me

Requires: any authenticated user.

**Success** `200`
```json
{
  "data": {
    "user_id": 1,
    "name": "Alice Admin",
    "email": "admin@council.edu",
    "role": "admin",
    "department": "Computer Science"
  }
}
```

---

## Users

### POST /api/users

Requires: `admin`.

**Request body**
```json
{
  "name": "Bob Organizer",
  "email": "bob@council.edu",
  "password": "secret123",
  "role": "organizer",
  "department": "Electrical Engineering"
}
```

Fields: `name` (1–100 chars), `email` (valid email), `password` (min 8 chars), `role` (`admin` | `organizer` | `member`), `department` (optional, max 100 chars).

**Success** `201`
```json
{
  "data": {
    "user_id": 2,
    "name": "Bob Organizer",
    "email": "bob@council.edu",
    "role": "organizer",
    "department": "Electrical Engineering",
    "created_at": "2025-09-15T10:00:00.000Z"
  }
}
```

**Errors**
- `409` — email already exists

---

### GET /api/users

Requires: `admin` or `organizer`.

**Query params**
| Param | Type | Description |
|---|---|---|
| `role` | string | Filter by role (`admin`, `organizer`, `member`) |

**Success** `200`
```json
{
  "data": [
    {
      "user_id": 1,
      "name": "Alice Admin",
      "email": "admin@council.edu",
      "role": "admin",
      "department": "Computer Science",
      "created_at": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

---

## Events

### GET /api/events/meta/filters

Requires: any authenticated user. Returns distinct values for filter dropdowns.

**Success** `200`
```json
{
  "data": {
    "categories": ["workshop", "seminar", "competition", "cultural"],
    "years": [2024, 2025],
    "departments": ["Computer Science", "Electrical Engineering"]
  }
}
```

---

### GET /api/events

Requires: any authenticated user. Paginated list with optional filters.

**Query params**
| Param | Type | Description |
|---|---|---|
| `q` | string | Search title or description |
| `year` | number | Filter by event year |
| `category` | string | Filter by category |
| `status` | string | Filter by status (`planned`, `registration_open`, `ongoing`, `completed`, `cancelled`) |
| `department` | string | Filter by department |
| `organizer` | number | Filter by organizer user_id |
| `min_participants` | number | Min outcome participants count |
| `from` | date | Event date on or after (YYYY-MM-DD) |
| `to` | date | Event date on or before (YYYY-MM-DD) |
| `sort` | string | `date_asc`, `date_desc` (default), `title_asc`, `title_desc` |
| `page` | number | Page number (default 1) |
| `limit` | number | Items per page (default 20) |

**Success** `200`
```json
{
  "data": [
    {
      "event_id": 1,
      "title": "Annual Tech Symposium",
      "description": "...",
      "category": "seminar",
      "event_date": "2025-10-15",
      "venue": "Main Auditorium",
      "max_participants": 200,
      "registration_deadline": "2025-10-10",
      "status": "registration_open",
      "department": "Computer Science",
      "created_by": 1,
      "coordinator_name": "Alice Admin",
      "registration_count": 45,
      "outcome_participants": null,
      "created_at": "2025-09-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

---

### GET /api/events/:id

Requires: any authenticated user. Returns full event detail including organizers and outcome.

**Success** `200`
```json
{
  "data": {
    "event_id": 1,
    "title": "Annual Tech Symposium",
    "description": "...",
    "category": "seminar",
    "event_date": "2025-10-15",
    "venue": "Main Auditorium",
    "max_participants": 200,
    "registration_deadline": "2025-10-10",
    "status": "completed",
    "department": "Computer Science",
    "created_by": 1,
    "created_at": "2025-09-01T00:00:00.000Z",
    "organizers": [
      { "user_id": 2, "name": "Bob Organizer", "email": "bob@council.edu", "responsibility": "Logistics" }
    ],
    "registration_count": 150,
    "file_count": 8,
    "outcome": {
      "outcome_id": 1,
      "participants_count": 148,
      "feedback_score": 4.5,
      "winners": "Team Alpha",
      "description": "Highly successful event.",
      "created_at": "2025-10-16T00:00:00.000Z"
    }
  }
}
```

**Errors**
- `404` — event not found

---

### POST /api/events

Requires: `admin` or `organizer`.

**Request body**
```json
{
  "title": "Annual Tech Symposium",
  "description": "A flagship annual event.",
  "category": "seminar",
  "event_date": "2025-10-15",
  "venue": "Main Auditorium",
  "max_participants": 200,
  "registration_deadline": "2025-10-10",
  "department": "Computer Science"
}
```

All date fields: `YYYY-MM-DD`.

**Success** `201` — created event object (same shape as GET /api/events/:id without outcome)

**Errors**
- `409` — scheduling conflict (another event at the same venue on the same date); response includes conflicting event details

---

### PUT /api/events/:id

Requires: `admin` or `organizer`. Partial update — only send fields to change.

**Request body** — any subset of event fields (same as POST)

**Success** `200` — updated event object

**Errors**
- `404` — event not found
- `409` — scheduling conflict (excluding this event itself)

---

### PATCH /api/events/:id/status

Requires: `admin` or `organizer`.

**Request body**
```json
{ "status": "registration_open" }
```

**Allowed transitions**
```
planned → registration_open → ongoing → completed
any non-terminal → cancelled
```
Terminal states (`completed`, `cancelled`) are locked.

**Success** `200` — updated event object

**Errors**
- `409` — invalid transition or terminal state locked

---

### DELETE /api/events/:id

Requires: `admin`.

**Success** `204` — no body

---

### GET /api/events/:id/organizers

Requires: any authenticated user.

**Success** `200`
```json
{
  "data": [
    { "user_id": 2, "name": "Bob Organizer", "email": "bob@council.edu", "responsibility": "Logistics" }
  ]
}
```

---

### POST /api/events/:id/organizers

Requires: `admin` or `organizer`.

**Request body**
```json
{ "user_id": 2, "responsibility": "Logistics" }
```

**Success** `201`
```json
{ "data": { "event_id": 1, "user_id": 2, "responsibility": "Logistics" } }
```

**Errors**
- `409` — user is already an organizer for this event

---

### DELETE /api/events/:id/organizers/:organizerId

Requires: `admin` or `organizer`.

**Success** `204` — no body

---

### PUT /api/events/:id/outcome

Requires: `admin` or `organizer`. Event must be in `completed` status. Upserts (creates or fully replaces) the outcome record.

**Request body**
```json
{
  "participants_count": 148,
  "feedback_score": 4.5,
  "winners": "Team Alpha",
  "description": "Highly successful event with great participation."
}
```

Fields: `participants_count` (optional, int), `feedback_score` (optional, float 0–5), `winners` (optional, string), `description` (optional, string). At least one field required.

**Success** `200`
```json
{
  "data": {
    "outcome_id": 1,
    "event_id": 1,
    "participants_count": 148,
    "feedback_score": 4.5,
    "winners": "Team Alpha",
    "description": "Highly successful event with great participation.",
    "created_at": "2025-10-16T00:00:00.000Z"
  }
}
```

**Errors**
- `409` — event is not in `completed` status

---

### GET /api/events/:id/outcome

Requires: any authenticated user.

**Success** `200` — same shape as PUT /api/events/:id/outcome response; `data` is `null` if no outcome recorded yet

---

## Participants

### GET /api/participants

Requires: any authenticated user. Paginated.

**Query params**
| Param | Type | Description |
|---|---|---|
| `q` | string | Search name or email |
| `department` | string | Filter by department |
| `year` | number | Filter by year of study |
| `page` | number | Page number (default 1) |
| `limit` | number | Items per page (default 20) |

**Success** `200`
```json
{
  "data": [
    {
      "participant_id": 1,
      "name": "Carol Student",
      "email": "carol@student.edu",
      "department": "Computer Science",
      "year": 2,
      "phone": "9876543210",
      "created_at": "2025-08-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

---

### POST /api/participants

Requires: `admin` or `organizer`.

**Request body**
```json
{
  "name": "Carol Student",
  "email": "carol@student.edu",
  "department": "Computer Science",
  "year": 2,
  "phone": "9876543210"
}
```

**Success** `201` — created participant object

**Errors**
- `409` — email already registered as a participant

---

### GET /api/participants/:id

Requires: any authenticated user. Includes full participation history.

**Success** `200`
```json
{
  "data": {
    "participant_id": 1,
    "name": "Carol Student",
    "email": "carol@student.edu",
    "department": "Computer Science",
    "year": 2,
    "phone": "9876543210",
    "participation_history": [
      {
        "event_id": 1,
        "title": "Annual Tech Symposium",
        "event_date": "2025-10-15",
        "registration_status": "registered",
        "present": true,
        "certificate_status": "issued"
      }
    ]
  }
}
```

---

### PUT /api/participants/:id

Requires: `admin` or `organizer`. Partial update.

**Request body** — any subset of participant fields

**Success** `200` — updated participant object

**Errors**
- `404` — participant not found

---

## Registrations

### POST /api/events/:id/registrations

Requires: `admin` or `organizer`.

**Request body**
```json
{ "participant_id": 1 }
```

Checks: event must be in `planned` or `registration_open` status; registration deadline not passed; capacity — uses `SELECT ... FOR UPDATE` transaction to determine `registered` vs `waitlisted`.

**Success** `201`
```json
{
  "data": {
    "registration_id": 1,
    "event_id": 1,
    "participant_id": 1,
    "status": "registered",
    "registered_at": "2025-09-20T10:00:00.000Z"
  }
}
```

**Errors**
- `409` — duplicate registration, event not open for registration, or deadline passed

---

### GET /api/events/:id/registrations

Requires: any authenticated user.

**Success** `200`
```json
{
  "data": [
    {
      "registration_id": 1,
      "participant_id": 1,
      "name": "Carol Student",
      "email": "carol@student.edu",
      "department": "Computer Science",
      "year": 2,
      "status": "registered",
      "registered_at": "2025-09-20T10:00:00.000Z"
    }
  ]
}
```

---

### PATCH /api/registrations/:id

Requires: `admin` or `organizer`. Currently only supports cancellation.

**Request body**
```json
{ "status": "cancelled" }
```

If the cancelled registration had status `registered`, the oldest `waitlisted` participant is automatically promoted to `registered`.

**Success** `200` — updated registration object

---

### PUT /api/events/:id/attendance

Requires: `admin` or `organizer`. Bulk upsert attendance for an event.

**Request body**
```json
{
  "records": [
    { "participant_id": 1, "present": true },
    { "participant_id": 2, "present": false }
  ]
}
```

All `participant_id` values must be registered for this event. Uses `INSERT ... ON DUPLICATE KEY UPDATE` in a transaction.

**Success** `200`
```json
{ "data": { "updated": 2 } }
```

**Errors**
- `400` — one or more participant IDs are not registered for this event

---

### GET /api/events/:id/attendance

Requires: any authenticated user.

**Success** `200`
```json
{
  "data": {
    "records": [
      {
        "participant_id": 1,
        "name": "Carol Student",
        "email": "carol@student.edu",
        "department": "Computer Science",
        "present": true
      }
    ],
    "summary": {
      "registered": 150,
      "present": 148,
      "absent": 2
    }
  }
}
```

---

## Files

### POST /api/events/:id/files/upload-url

Requires: `admin` or `organizer`. Generates a presigned S3 PUT URL for direct browser upload.

**Request body**
```json
{
  "file_name": "banner.jpg",
  "file_type": "photo",
  "content_type": "image/jpeg",
  "size_bytes": 204800
}
```

`file_type` values: `photo`, `report`, `poster`, `document`. Validated against allowed `content_type` per type.

**Success** `200`
```json
{
  "data": {
    "upload_url": "https://s3.amazonaws.com/your-bucket/events/event-1/photos/uuid-banner.jpg?...",
    "s3_key": "events/event-1/photos/550e8400-e29b-41d4-a716-446655440000-banner.jpg"
  }
}
```

URL expires in 5 minutes.

---

### POST /api/events/:id/files

Requires: `admin` or `organizer`. Registers an already-uploaded file in the database.

Call this **after** the browser completes the PUT to the presigned URL.

**Request body**
```json
{
  "s3_key": "events/event-1/photos/uuid-banner.jpg",
  "original_name": "banner.jpg",
  "file_type": "photo",
  "content_type": "image/jpeg",
  "size_bytes": 204800
}
```

Verifies the key starts with `events/event-{id}/` and performs a HeadObject check to confirm the file exists in S3 before inserting the database row.

**Success** `201`
```json
{
  "data": {
    "file_id": 1,
    "event_id": 1,
    "s3_key": "events/event-1/photos/uuid-banner.jpg",
    "original_name": "banner.jpg",
    "file_type": "photo",
    "content_type": "image/jpeg",
    "size_bytes": 204800,
    "uploaded_by": 1,
    "uploaded_at": "2025-09-15T12:00:00.000Z"
  }
}
```

---

### GET /api/events/:id/files

Requires: any authenticated user.

**Query params**
| Param | Type | Description |
|---|---|---|
| `file_type` | string | Filter by type (`photo`, `report`, `poster`, `document`) |

**Success** `200`
```json
{
  "data": [
    {
      "file_id": 1,
      "event_id": 1,
      "original_name": "banner.jpg",
      "file_type": "photo",
      "content_type": "image/jpeg",
      "size_bytes": 204800,
      "uploader_name": "Alice Admin",
      "uploaded_at": "2025-09-15T12:00:00.000Z"
    }
  ]
}
```

---

### GET /api/files/:fileId/download-url

Requires: any authenticated user. Returns a presigned S3 GET URL valid for 5 minutes.

**Success** `200`
```json
{
  "data": {
    "download_url": "https://s3.amazonaws.com/your-bucket/events/event-1/photos/uuid-banner.jpg?..."
  }
}
```

---

### DELETE /api/files/:fileId

Requires: `admin` or `organizer`. Deletes both the database row and the S3 object.

**Success** `200`
```json
{ "data": { "message": "File deleted successfully" } }
```

---

## Certificates

### POST /api/events/:id/certificates

Requires: `admin` or `organizer`. Batch-creates certificate records for participants who are marked present. Participants without attendance or already having a certificate are skipped.

**Request body**
```json
{ "participant_ids": [1, 2, 3] }
```

**Success** `200`
```json
{
  "data": {
    "created": [
      { "certificate_id": 1, "participant_id": 1, "certificate_code": "TC-2025-E001-P0001" }
    ],
    "skipped": [
      { "participant_id": 3, "reason": "not present" }
    ]
  }
}
```

Certificate code format: `TC-{year}-E{eventId padded to 3 digits}-P{participantId padded to 4 digits}`

---

### GET /api/events/:id/certificates

Requires: any authenticated user.

**Success** `200`
```json
{
  "data": [
    {
      "certificate_id": 1,
      "certificate_code": "TC-2025-E001-P0001",
      "participant_id": 1,
      "participant_name": "Carol Student",
      "email": "carol@student.edu",
      "department": "Computer Science",
      "year": 2,
      "status": "issued",
      "issued_date": "2025-10-17"
    }
  ]
}
```

---

### GET /api/participants/:id/certificates

Requires: any authenticated user.

**Success** `200`
```json
{
  "data": [
    {
      "certificate_id": 1,
      "certificate_code": "TC-2025-E001-P0001",
      "event_id": 1,
      "event_title": "Annual Tech Symposium",
      "event_date": "2025-10-15",
      "category": "seminar",
      "status": "issued",
      "issued_date": "2025-10-17"
    }
  ]
}
```

---

### POST /api/certificates/:id/issue

Requires: `admin` or `organizer`. Generates a PDF certificate using pdfkit, uploads it to S3 at `certificates/event-{eventId}/{certificate_code}.pdf`, and marks the record as `issued` with today's date.

**Success** `200`
```json
{
  "data": {
    "certificate_id": 1,
    "certificate_code": "TC-2025-E001-P0001",
    "status": "issued",
    "issued_date": "2025-10-17",
    "s3_key": "certificates/event-1/TC-2025-E001-P0001.pdf"
  }
}
```

**Errors**
- `409` — certificate already issued

---

### GET /api/certificates/:id/download-url

Requires: any authenticated user. Returns a presigned S3 GET URL valid for 5 minutes.

**Success** `200`
```json
{
  "data": {
    "download_url": "https://s3.amazonaws.com/.../TC-2025-E001-P0001.pdf?..."
  }
}
```

**Errors**
- `409` — certificate has not been issued yet (PDF does not exist)

---

## Dashboard

### GET /api/dashboard/stats

Requires: any authenticated user. Returns aggregate statistics and overview data.

**Success** `200`
```json
{
  "data": {
    "total_events": 25,
    "upcoming_events": 8,
    "completed_events": 14,
    "total_participants": 320,
    "total_registrations": 1200,
    "certificates_issued": 980,
    "events_by_category": [
      { "category": "seminar", "count": 10 },
      { "category": "workshop", "count": 8 }
    ],
    "events_by_year": [
      { "year": 2024, "count": 12 },
      { "year": 2025, "count": 13 }
    ],
    "top_events": [
      {
        "event_id": 1,
        "title": "Annual Tech Symposium",
        "category": "seminar",
        "event_date": "2025-10-15",
        "participants_count": 148
      }
    ],
    "recent_uploads": [
      {
        "file_id": 10,
        "event_id": 1,
        "original_name": "banner.jpg",
        "file_type": "photo",
        "content_type": "image/jpeg",
        "size_bytes": 204800,
        "uploaded_at": "2025-09-15T12:00:00.000Z",
        "event_title": "Annual Tech Symposium"
      }
    ]
  }
}
```
