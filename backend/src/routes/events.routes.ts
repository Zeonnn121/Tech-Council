import { Router, Request, Response } from "express";
import { z } from "zod";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { query } from "../db";
import { badRequest, conflict, notFound } from "../utils/HttpError";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// All routes require auth
router.use(requireAuth);

// ── Zod schemas ──

const eventBaseFields = {
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().min(1).max(50),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM or HH:MM:SS"),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM or HH:MM:SS"),
  venue: z.string().min(1).max(150),
  coordinator_id: z.number().int().positive().nullable().optional(),
  capacity: z.number().int().positive().default(100),
  registration_deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
};

const eventCreateSchema = z
  .object(eventBaseFields)
  .refine((data) => data.end_time > data.start_time, {
    message: "end_time must be after start_time",
    path: ["end_time"],
  })
  .refine(
    (data) =>
      !data.registration_deadline || data.registration_deadline <= data.event_date,
    {
      message: "registration_deadline must be on or before event_date",
      path: ["registration_deadline"],
    }
  );

// Update schema: all fields optional, no refine (validations done manually)
const eventUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  category: z.string().min(1).max(50).optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  venue: z.string().min(1).max(150).optional(),
  coordinator_id: z.number().int().positive().nullable().optional(),
  capacity: z.number().int().positive().optional(),
  registration_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum([
    "planned",
    "registration_open",
    "ongoing",
    "completed",
    "cancelled",
  ]),
});

const organizerSchema = z.object({
  user_id: z.number().int().positive(),
  responsibility: z.string().min(1).max(200),
});

// ── Allowed status transitions ──
const VALID_TRANSITIONS: Record<string, string[]> = {
  planned: ["registration_open", "cancelled"],
  registration_open: ["ongoing", "cancelled"],
  ongoing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

// ── Helper: check scheduling conflict ──
async function checkSchedulingConflict(
  venue: string,
  event_date: string,
  start_time: string,
  end_time: string,
  excludeEventId?: number
): Promise<{ event_id: number; title: string; start_time: string; end_time: string } | null> {
  let sql = `
    SELECT event_id, title, start_time, end_time
    FROM events
    WHERE venue = ?
      AND event_date = ?
      AND status != 'cancelled'
      AND start_time < ?
      AND end_time > ?
  `;
  const params: (string | number)[] = [venue, event_date, end_time, start_time];

  if (excludeEventId) {
    sql += " AND event_id != ?";
    params.push(excludeEventId);
  }

  sql += " LIMIT 1";
  const rows = await query<RowDataPacket[]>(sql, params);
  return rows.length > 0 ? rows[0] as { event_id: number; title: string; start_time: string; end_time: string } : null;
}

// ── GET /api/events/meta/filters ──
// Register BEFORE /:id so it doesn't get shadowed
router.get(
  "/meta/filters",
  asyncHandler(async (_req: Request, res: Response) => {
    const [categories, years, departments] = await Promise.all([
      query<RowDataPacket[]>(
        "SELECT DISTINCT category FROM events WHERE category IS NOT NULL ORDER BY category"
      ),
      query<RowDataPacket[]>(
        "SELECT DISTINCT YEAR(event_date) AS year FROM events WHERE event_date IS NOT NULL ORDER BY year"
      ),
      query<RowDataPacket[]>(
        `SELECT DISTINCT u.department
         FROM events e
         JOIN users u ON e.coordinator_id = u.user_id
         WHERE u.department IS NOT NULL
         ORDER BY u.department`
      ),
    ]);

    res.json({
      data: {
        categories: categories.map((r) => r.category),
        years: years.map((r) => r.year),
        departments: departments.map((r) => r.department),
      },
    });
  })
);

// ── GET /api/events (list with pagination, filters, search) ──
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    // When min_participants is used we need outcomes to be present, so we
    // switch from LEFT JOIN to INNER JOIN for that table in both queries.
    let outcomesJoin = "LEFT JOIN outcomes o ON e.event_id = o.event_id";

    // q - LIKE search on title and description
    if (req.query.q && typeof req.query.q === "string") {
      conditions.push("(e.title LIKE ? OR e.description LIKE ?)");
      const q = `%${req.query.q}%`;
      params.push(q, q);
    }

    // year
    if (req.query.year) {
      conditions.push("YEAR(e.event_date) = ?");
      params.push(Number(req.query.year));
    }

    // category
    if (req.query.category && typeof req.query.category === "string") {
      conditions.push("e.category = ?");
      params.push(req.query.category);
    }

    // status
    if (req.query.status && typeof req.query.status === "string") {
      conditions.push("e.status = ?");
      params.push(req.query.status);
    }

    // department (coordinator's department)
    if (req.query.department && typeof req.query.department === "string") {
      conditions.push("c_user.department = ?");
      params.push(req.query.department);
    }

    // organizer (user_id of an organizer for this event)
    if (req.query.organizer) {
      conditions.push("e.event_id IN (SELECT event_id FROM organizers WHERE user_id = ?)");
      params.push(Number(req.query.organizer));
    }

    // min_participants (from outcomes) — switch to INNER JOIN so NULL rows
    // are excluded by the JOIN itself, not silently by the WHERE predicate
    if (req.query.min_participants) {
      outcomesJoin = "INNER JOIN outcomes o ON e.event_id = o.event_id";
      conditions.push("o.participants_count >= ?");
      params.push(Number(req.query.min_participants));
    }

    // from date
    if (req.query.from && typeof req.query.from === "string") {
      conditions.push("e.event_date >= ?");
      params.push(req.query.from);
    }

    // to date
    if (req.query.to && typeof req.query.to === "string") {
      conditions.push("e.event_date <= ?");
      params.push(req.query.to);
    }

    const whereClause =
      conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    // Sort
    const sortMap: Record<string, string> = {
      date_desc: "e.event_date DESC, e.start_time DESC",
      date_asc: "e.event_date ASC, e.start_time ASC",
      title: "e.title ASC",
    };
    const sortKey = (req.query.sort as string) || "date_desc";
    const orderBy = sortMap[sortKey] || sortMap.date_desc;

    // Count total
    const countSql = `
      SELECT COUNT(*) AS total
      FROM events e
      LEFT JOIN users c_user ON e.coordinator_id = c_user.user_id
      ${outcomesJoin}
      ${whereClause}
    `;
    const countRows = await query<RowDataPacket[]>(countSql, params);
    const total = countRows[0].total;

    // Fetch rows
    const dataSql = `
      SELECT
        e.*,
        c_user.name AS coordinator_name,
        (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.event_id AND r.status = 'registered') AS registration_count,
        o.participants_count AS outcome_participants
      FROM events e
      LEFT JOIN users c_user ON e.coordinator_id = c_user.user_id
      ${outcomesJoin}
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
    const rows = await query<RowDataPacket[]>(dataSql, [...params, limit, offset]);

    res.json({
      data: rows,
      page,
      limit,
      total,
    });
  })
);

// ── GET /api/events/:id (event details) ──
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const rows = await query<RowDataPacket[]>(
      `SELECT e.*, c_user.name AS coordinator_name
       FROM events e
       LEFT JOIN users c_user ON e.coordinator_id = c_user.user_id
       WHERE e.event_id = ?`,
      [eventId]
    );

    if (rows.length === 0) throw notFound("Event not found");
    const event = rows[0];

    // Fetch related data in parallel
    const [organizers, regCount, fileCount, outcome] = await Promise.all([
      query<RowDataPacket[]>(
        `SELECT o.organizer_id, o.user_id, u.name AS user_name, o.responsibility
         FROM organizers o
         JOIN users u ON o.user_id = u.user_id
         WHERE o.event_id = ?`,
        [eventId]
      ),
      query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'registered'",
        [eventId]
      ),
      query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM event_files WHERE event_id = ?",
        [eventId]
      ),
      query<RowDataPacket[]>(
        "SELECT * FROM outcomes WHERE event_id = ?",
        [eventId]
      ),
    ]);

    res.json({
      data: {
        ...event,
        organizers,
        registration_count: regCount[0].count,
        file_count: fileCount[0].count,
        outcome: outcome.length > 0 ? outcome[0] : null,
      },
    });
  })
);

// ── POST /api/events (admin/organizer) ──
router.post(
  "/",
  requireRole("admin", "organizer"),
  validate(eventCreateSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      title,
      description,
      category,
      event_date,
      start_time,
      end_time,
      venue,
      coordinator_id,
      capacity,
      registration_deadline,
    } = req.body;

    // Normalize time to HH:MM:SS
    const normalizedStart = start_time.length === 5 ? `${start_time}:00` : start_time;
    const normalizedEnd = end_time.length === 5 ? `${end_time}:00` : end_time;

    // Check scheduling conflict
    const conflictEvent = await checkSchedulingConflict(
      venue,
      event_date,
      normalizedStart,
      normalizedEnd
    );
    if (conflictEvent) {
      throw conflict(
        "Scheduling conflict: another event exists at this venue and time",
        {
          conflicting_event_id: conflictEvent.event_id,
          conflicting_title: conflictEvent.title,
          conflicting_start_time: conflictEvent.start_time,
          conflicting_end_time: conflictEvent.end_time,
        }
      );
    }

    const result = await query<ResultSetHeader>(
      `INSERT INTO events (title, description, category, event_date, start_time, end_time, venue, coordinator_id, capacity, registration_deadline, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description || null,
        category,
        event_date,
        normalizedStart,
        normalizedEnd,
        venue,
        coordinator_id || null,
        capacity,
        registration_deadline || null,
        req.user!.user_id,
      ]
    );

    const created = await query<RowDataPacket[]>(
      "SELECT * FROM events WHERE event_id = ?",
      [result.insertId]
    );

    res.status(201).json({ data: created[0] });
  })
);

// ── PUT /api/events/:id (admin/organizer) ──
router.put(
  "/:id",
  requireRole("admin", "organizer"),
  validate(eventUpdateSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    // Check event exists
    const existing = await query<RowDataPacket[]>(
      "SELECT * FROM events WHERE event_id = ?",
      [eventId]
    );
    if (existing.length === 0) throw notFound("Event not found");

    const current = existing[0];
    const updates = { ...req.body };

    // Validate end_time > start_time (if both provided or merged)
    const mergedStartTime = updates.start_time ?? current.start_time;
    const mergedEndTime = updates.end_time ?? current.end_time;
    const normalizedMergedStart = mergedStartTime.length === 5 ? `${mergedStartTime}:00` : mergedStartTime;
    const normalizedMergedEnd = mergedEndTime.length === 5 ? `${mergedEndTime}:00` : mergedEndTime;
    if (normalizedMergedEnd <= normalizedMergedStart) {
      throw badRequest("end_time must be after start_time");
    }

    // Validate registration_deadline <= event_date (if provided)
    if (updates.registration_deadline && updates.event_date) {
      if (updates.registration_deadline > updates.event_date) {
        throw badRequest("registration_deadline must be on or before event_date");
      }
    } else if (updates.registration_deadline && !updates.event_date) {
      if (updates.registration_deadline > current.event_date) {
        throw badRequest("registration_deadline must be on or before event_date");
      }
    }

    // Merge with existing values for conflict check
    const venue = updates.venue ?? current.venue;
    const event_date = updates.event_date ?? current.event_date;
    const start_time_raw = updates.start_time ?? current.start_time;
    const end_time_raw = updates.end_time ?? current.end_time;
    const start_time = start_time_raw.length === 5 ? `${start_time_raw}:00` : start_time_raw;
    const end_time = end_time_raw.length === 5 ? `${end_time_raw}:00` : end_time_raw;

    // Check scheduling conflict (exclude self)
    const conflictEvent = await checkSchedulingConflict(
      venue,
      event_date,
      start_time,
      end_time,
      eventId
    );
    if (conflictEvent) {
      throw conflict(
        "Scheduling conflict: another event exists at this venue and time",
        {
          conflicting_event_id: conflictEvent.event_id,
          conflicting_title: conflictEvent.title,
          conflicting_start_time: conflictEvent.start_time,
          conflicting_end_time: conflictEvent.end_time,
        }
      );
    }

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const setParams: (string | number | null)[] = [];

    const allowedFields = [
      "title",
      "description",
      "category",
      "event_date",
      "start_time",
      "end_time",
      "venue",
      "coordinator_id",
      "capacity",
      "registration_deadline",
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        let val = updates[field];
        // Normalize time fields
        if ((field === "start_time" || field === "end_time") && typeof val === "string" && val.length === 5) {
          val = `${val}:00`;
        }
        setParams.push(val);
      }
    }

    if (setClauses.length > 0) {
      await query(
        `UPDATE events SET ${setClauses.join(", ")} WHERE event_id = ?`,
        [...setParams, eventId]
      );
    }

    const updated = await query<RowDataPacket[]>(
      "SELECT * FROM events WHERE event_id = ?",
      [eventId]
    );

    res.json({ data: updated[0] });
  })
);

// ── PATCH /api/events/:id/status (admin/organizer) ──
router.patch(
  "/:id/status",
  requireRole("admin", "organizer"),
  validate(statusSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const { status } = req.body;

    const rows = await query<RowDataPacket[]>(
      "SELECT status FROM events WHERE event_id = ?",
      [eventId]
    );
    if (rows.length === 0) throw notFound("Event not found");

    const currentStatus = rows[0].status;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed || !allowed.includes(status)) {
      throw badRequest(
        `Cannot transition from '${currentStatus}' to '${status}'`
      );
    }

    await query("UPDATE events SET status = ? WHERE event_id = ?", [
      status,
      eventId,
    ]);

    const updated = await query<RowDataPacket[]>(
      "SELECT * FROM events WHERE event_id = ?",
      [eventId]
    );

    res.json({ data: updated[0] });
  })
);

// ── DELETE /api/events/:id (admin only) ──
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const rows = await query<RowDataPacket[]>(
      "SELECT event_id FROM events WHERE event_id = ?",
      [eventId]
    );
    if (rows.length === 0) throw notFound("Event not found");

    await query("DELETE FROM events WHERE event_id = ?", [eventId]);
    res.status(204).send();
  })
);

// ── GET /api/events/:id/organizers ──
router.get(
  "/:id/organizers",
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const rows = await query<RowDataPacket[]>(
      `SELECT o.organizer_id, o.event_id, o.user_id, u.name AS user_name, u.email, o.responsibility
       FROM organizers o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.event_id = ?`,
      [eventId]
    );

    res.json({ data: rows });
  })
);

// ── POST /api/events/:id/organizers (admin/organizer) ──
router.post(
  "/:id/organizers",
  requireRole("admin", "organizer"),
  validate(organizerSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    // Check event exists
    const eventRows = await query<RowDataPacket[]>(
      "SELECT event_id FROM events WHERE event_id = ?",
      [eventId]
    );
    if (eventRows.length === 0) throw notFound("Event not found");

    const { user_id, responsibility } = req.body;

    // Check user exists
    const userRows = await query<RowDataPacket[]>(
      "SELECT user_id FROM users WHERE user_id = ?",
      [user_id]
    );
    if (userRows.length === 0) throw notFound("User not found");

    try {
      const result = await query<ResultSetHeader>(
        "INSERT INTO organizers (event_id, user_id, responsibility) VALUES (?, ?, ?)",
        [eventId, user_id, responsibility]
      );

      const created = await query<RowDataPacket[]>(
        `SELECT o.*, u.name AS user_name
         FROM organizers o
         JOIN users u ON o.user_id = u.user_id
         WHERE o.organizer_id = ?`,
        [result.insertId]
      );

      res.status(201).json({ data: created[0] });
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "ER_DUP_ENTRY") {
        throw conflict("This user is already an organizer for this event");
      }
      throw err;
    }
  })
);

// ── DELETE /api/events/:id/organizers/:organizerId ──
router.delete(
  "/:id/organizers/:organizerId",
  requireRole("admin", "organizer"),
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    const organizerId = Number(req.params.organizerId);
    if (!eventId || !organizerId) throw badRequest("Invalid ID");

    const rows = await query<RowDataPacket[]>(
      "SELECT organizer_id FROM organizers WHERE organizer_id = ? AND event_id = ?",
      [organizerId, eventId]
    );
    if (rows.length === 0) throw notFound("Organizer not found for this event");

    await query(
      "DELETE FROM organizers WHERE organizer_id = ? AND event_id = ?",
      [organizerId, eventId]
    );

    res.status(204).send();
  })
);

// ── Outcomes ──

const outcomeSchema = z.object({
  participants_count: z.number().int().min(0).optional(),
  feedback_score: z.number().min(0).max(5).nullable().optional(),
  winners: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

// ── PUT /api/events/:id/outcome (admin/organizer) ──
// Omitted fields keep their existing value; participants_count defaults to the
// number of present attendance rows when neither supplied nor already set.
router.put(
  "/:id/outcome",
  requireRole("admin", "organizer"),
  validate(outcomeSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const eventRows = await query<RowDataPacket[]>(
      "SELECT status FROM events WHERE event_id = ?",
      [eventId]
    );
    if (eventRows.length === 0) throw notFound("Event not found");
    if (eventRows[0].status !== "completed") {
      throw badRequest(
        `Outcomes can only be recorded for completed events (current status: '${eventRows[0].status}')`
      );
    }

    const { participants_count, feedback_score, winners, description } = req.body;

    const existingRows = await query<RowDataPacket[]>(
      "SELECT * FROM outcomes WHERE event_id = ?",
      [eventId]
    );
    const existing = existingRows.length > 0 ? existingRows[0] : null;

    let resolvedCount: number;
    if (participants_count !== undefined) {
      resolvedCount = participants_count;
    } else if (existing) {
      resolvedCount = existing.participants_count;
    } else {
      const presentRows = await query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM attendance WHERE event_id = ? AND present = TRUE",
        [eventId]
      );
      resolvedCount = Number(presentRows[0].count);
    }

    const resolvedFeedback =
      feedback_score !== undefined
        ? feedback_score
        : existing
          ? existing.feedback_score
          : null;
    const resolvedWinners =
      winners !== undefined ? winners : existing ? existing.winners : null;
    const resolvedDescription =
      description !== undefined
        ? description
        : existing
          ? existing.description
          : null;

    await query(
      `INSERT INTO outcomes (event_id, participants_count, feedback_score, winners, description)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         participants_count = VALUES(participants_count),
         feedback_score = VALUES(feedback_score),
         winners = VALUES(winners),
         description = VALUES(description)`,
      [
        eventId,
        resolvedCount,
        resolvedFeedback,
        resolvedWinners,
        resolvedDescription,
      ]
    );

    const updated = await query<RowDataPacket[]>(
      "SELECT * FROM outcomes WHERE event_id = ?",
      [eventId]
    );

    res.json({ data: updated[0] });
  })
);

// ── GET /api/events/:id/outcome ──
router.get(
  "/:id/outcome",
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const eventRows = await query<RowDataPacket[]>(
      "SELECT event_id FROM events WHERE event_id = ?",
      [eventId]
    );
    if (eventRows.length === 0) throw notFound("Event not found");

    const rows = await query<RowDataPacket[]>(
      "SELECT * FROM outcomes WHERE event_id = ?",
      [eventId]
    );
    if (rows.length === 0) throw notFound("No outcome recorded for this event");

    res.json({ data: rows[0] });
  })
);

export default router;
