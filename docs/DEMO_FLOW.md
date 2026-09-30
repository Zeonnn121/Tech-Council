# Demo Flow — Technical Council API

A step-by-step walkthrough covering all major features in logical order. Prerequisites: server running on `http://localhost:4000`, database seeded with at least one admin user.

---

## Step 1 — Login

```
POST /api/auth/login
Body: { "email": "admin@council.edu", "password": "secret123" }
```

Save the returned `token`. All subsequent requests use:
```
Authorization: Bearer <token>
```

---

## Step 2 — Create an Organizer User

```
POST /api/users
Body: {
  "name": "Bob Organizer",
  "email": "bob@council.edu",
  "password": "secret123",
  "role": "organizer",
  "department": "Electrical Engineering"
}
```

Save the returned `user_id` (e.g. `2`).

---

## Step 3 — Create an Event

```
POST /api/events
Body: {
  "title": "Annual Tech Symposium",
  "description": "A flagship annual event showcasing student innovations.",
  "category": "seminar",
  "event_date": "2025-10-15",
  "venue": "Main Auditorium",
  "max_participants": 200,
  "registration_deadline": "2025-10-10",
  "department": "Computer Science"
}
```

Save the returned `event_id` (e.g. `1`).

---

## Step 4 — Add Organizer to Event

```
POST /api/events/1/organizers
Body: { "user_id": 2, "responsibility": "Logistics" }
```

---

## Step 5 — Open Registration

```
PATCH /api/events/1/status
Body: { "status": "registration_open" }
```

---

## Step 6 — Create Participants

```
POST /api/participants
Body: {
  "name": "Carol Student",
  "email": "carol@student.edu",
  "department": "Computer Science",
  "year": 2,
  "phone": "9876543210"
}
```

Repeat for additional participants. Save each `participant_id` (e.g. `1`, `2`, `3`).

---

## Step 7 — Register Participants

```
POST /api/events/1/registrations
Body: { "participant_id": 1 }
```

Repeat for each participant. Response status will be `registered` (or `waitlisted` if capacity is full).

---

## Step 8 — Upload Event File (Two-step)

**Step 8a — Get Presigned Upload URL**
```
POST /api/events/1/files/upload-url
Body: {
  "file_name": "event-banner.jpg",
  "file_type": "photo",
  "content_type": "image/jpeg",
  "size_bytes": 204800
}
```

Response contains `upload_url` and `s3_key`.

**Step 8b — PUT file to S3**

```
PUT <upload_url>
Headers: Content-Type: image/jpeg
Body: <binary file data>
```

(Do this from the browser/client directly — not through the API server.)

**Step 8c — Register file in database**
```
POST /api/events/1/files
Body: {
  "s3_key": "events/event-1/photos/<uuid>-event-banner.jpg",
  "original_name": "event-banner.jpg",
  "file_type": "photo",
  "content_type": "image/jpeg",
  "size_bytes": 204800
}
```

---

## Step 9 — Mark Event Ongoing

```
PATCH /api/events/1/status
Body: { "status": "ongoing" }
```

---

## Step 10 — Submit Attendance

```
PUT /api/events/1/attendance
Body: {
  "records": [
    { "participant_id": 1, "present": true },
    { "participant_id": 2, "present": true },
    { "participant_id": 3, "present": false }
  ]
}
```

Verify with:
```
GET /api/events/1/attendance
```

---

## Step 11 — Mark Event Completed

```
PATCH /api/events/1/status
Body: { "status": "completed" }
```

---

## Step 12 — Create Certificate Records

```
POST /api/events/1/certificates
Body: { "participant_ids": [1, 2, 3] }
```

Only participants marked present receive certificates. Response shows `created` and `skipped` lists. Save the `certificate_id` values.

---

## Step 13 — Issue Certificate (Generate PDF)

```
POST /api/certificates/1/issue
```

This generates the PDF using pdfkit, uploads it to S3, and marks the certificate as `issued`. Repeat for each certificate.

---

## Step 14 — Download Certificate

```
GET /api/certificates/1/download-url
```

Follow the returned `download_url` (valid for 5 minutes) to retrieve the PDF.

---

## Step 15 — Record Event Outcome

```
PUT /api/events/1/outcome
Body: {
  "participants_count": 148,
  "feedback_score": 4.5,
  "winners": "Team Alpha",
  "description": "Highly successful event with great student participation."
}
```

---

## Step 16 — Dashboard Overview

```
GET /api/dashboard/stats
```

Shows aggregate counts (total events, participants, registrations, certificates issued), breakdowns by category and year, top 5 events, and 5 most recent file uploads.

---

## Step 17 — Search and Filter

```
GET /api/events?q=tech&status=completed&sort=date_desc&page=1&limit=20
GET /api/participants?q=carol&department=Computer+Science
GET /api/events/1/registrations
GET /api/events/1/files?file_type=photo
GET /api/participants/1/certificates
```

---

## Full State Transition Reference

```
Events:   planned → registration_open → ongoing → completed
                                      ↘ cancelled (from any non-terminal state)

Certificates: pending → issued
Registrations: registered | waitlisted → cancelled
               (waitlisted auto-promotes to registered when a registered slot opens)
```
