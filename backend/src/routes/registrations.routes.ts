import { Router, Request, Response } from "express";
import { z } from "zod";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPool, query } from "../db";
import { badRequest, conflict, notFound } from "../utils/HttpError";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// ── Zod schemas ──

const registrationCreateSchema = z.object({
  participant_id: z.number().int().positive(),
});

const registrationPatchSchema = z.object({
  status: z.literal("cancelled"),
});

const attendanceSchema = z.object({
  records: z.array(
    z.object({
      participant_id: z.number().int().positive(),
      present: z.boolean(),
    })
  ).min(1),
});

// ── POST /api/events/:id/registrations (admin/organizer) ──
router.post(
  "/events/:id/registrations",
  requireAuth,
  requireRole("admin", "organizer"),
  validate(registrationCreateSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const { participant_id } = req.body;

    // Verify event exists
    const eventRows = await query<RowDataPacket[]>(
      "SELECT event_id, status, capacity, registration_deadline FROM events WHERE event_id = ?",
      [eventId]
    );
    if (eventRows.length === 0) throw notFound("Event not found");

    const event = eventRows[0];

    // Event must be planned or registration_open
    if (event.status !== "planned" && event.status !== "registration_open") {
      throw badRequest(
        `Cannot register for an event with status '${event.status}'`
      );
    }

    // Check registration deadline
    if (event.registration_deadline) {
      const today = new Date().toISOString().slice(0, 10);
      if (today > event.registration_deadline) {
        throw badRequest("Registration deadline has passed");
      }
    }

    // Verify participant exists
    const participantRows = await query<RowDataPacket[]>(
      "SELECT participant_id FROM participants WHERE participant_id = ?",
      [participant_id]
    );
    if (participantRows.length === 0) throw notFound("Participant not found");

    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      // Lock the event row to count registrations safely
      const [lockedRows] = await conn.query<RowDataPacket[]>(
        "SELECT capacity FROM events WHERE event_id = ? FOR UPDATE",
        [eventId]
      );
      const capacity = lockedRows[0].capacity as number;

      const [countRows] = await conn.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS cnt FROM registrations WHERE event_id = ? AND status = 'registered'",
        [eventId]
      );
      const registeredCount = (countRows[0] as RowDataPacket).cnt as number;

      const status = registeredCount >= capacity ? "waitlisted" : "registered";

      let insertId: number;
      try {
        const [result] = await conn.query<ResultSetHeader>(
          "INSERT INTO registrations (event_id, participant_id, status) VALUES (?, ?, ?)",
          [eventId, participant_id, status]
        );
        insertId = result.insertId;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as { code: string }).code === "ER_DUP_ENTRY"
        ) {
          await conn.rollback();
          throw conflict("Participant is already registered for this event");
        }
        throw err;
      }

      await conn.commit();

      const created = await query<RowDataPacket[]>(
        "SELECT * FROM registrations WHERE registration_id = ?",
        [insertId]
      );

      res.status(201).json({ data: created[0] });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// ── GET /api/events/:id/registrations ──
router.get(
  "/events/:id/registrations",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const eventRows = await query<RowDataPacket[]>(
      "SELECT event_id FROM events WHERE event_id = ?",
      [eventId]
    );
    if (eventRows.length === 0) throw notFound("Event not found");

    const rows = await query<RowDataPacket[]>(
      `SELECT
         r.registration_id, r.event_id, r.participant_id,
         r.registration_date, r.status,
         p.name, p.email, p.department, p.year
       FROM registrations r
       JOIN participants p ON r.participant_id = p.participant_id
       WHERE r.event_id = ?
       ORDER BY r.registration_date ASC`,
      [eventId]
    );

    res.json({ data: rows });
  })
);

// ── PATCH /api/registrations/:id (admin/organizer) ──
router.patch(
  "/registrations/:id",
  requireAuth,
  requireRole("admin", "organizer"),
  validate(registrationPatchSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const registrationId = Number(req.params.id);
    if (!registrationId) throw badRequest("Invalid registration ID");

    const regRows = await query<RowDataPacket[]>(
      "SELECT * FROM registrations WHERE registration_id = ?",
      [registrationId]
    );
    if (regRows.length === 0) throw notFound("Registration not found");

    const reg = regRows[0];

    if (reg.status === "cancelled") {
      throw badRequest("Registration is already cancelled");
    }

    const wasRegistered = reg.status === "registered";

    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      // Cancel the registration
      await conn.query(
        "UPDATE registrations SET status = 'cancelled' WHERE registration_id = ?",
        [registrationId]
      );

      // If the cancelled one was 'registered', promote the oldest waitlisted
      if (wasRegistered) {
        const [waitlisted] = await conn.query<RowDataPacket[]>(
          `SELECT registration_id FROM registrations
           WHERE event_id = ? AND status = 'waitlisted'
           ORDER BY registration_date ASC
           LIMIT 1`,
          [reg.event_id]
        );

        if (waitlisted.length > 0) {
          const promoteId = (waitlisted[0] as RowDataPacket).registration_id;
          await conn.query(
            "UPDATE registrations SET status = 'registered' WHERE registration_id = ?",
            [promoteId]
          );
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const updated = await query<RowDataPacket[]>(
      "SELECT * FROM registrations WHERE registration_id = ?",
      [registrationId]
    );

    res.json({ data: updated[0] });
  })
);

// ── PUT /api/events/:id/attendance (admin/organizer) ──
router.put(
  "/events/:id/attendance",
  requireAuth,
  requireRole("admin", "organizer"),
  validate(attendanceSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const eventRows = await query<RowDataPacket[]>(
      "SELECT event_id FROM events WHERE event_id = ?",
      [eventId]
    );
    if (eventRows.length === 0) throw notFound("Event not found");

    const { records } = req.body as {
      records: { participant_id: number; present: boolean }[];
    };

    // Validate all participant_ids are registered for this event
    const registeredRows = await query<RowDataPacket[]>(
      `SELECT participant_id FROM registrations
       WHERE event_id = ? AND status = 'registered'`,
      [eventId]
    );
    const registeredSet = new Set(
      registeredRows.map((r) => r.participant_id as number)
    );

    const invalidIds = records
      .map((r) => r.participant_id)
      .filter((id) => !registeredSet.has(id));

    if (invalidIds.length > 0) {
      throw badRequest(
        "Some participants are not registered (status 'registered') for this event",
        { invalid_participant_ids: invalidIds }
      );
    }

    // Upsert attendance in one transaction
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      for (const record of records) {
        await conn.query(
          `INSERT INTO attendance (event_id, participant_id, present)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE present = VALUES(present)`,
          [eventId, record.participant_id, record.present]
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.json({ data: { message: "Attendance recorded successfully" } });
  })
);

// ── GET /api/events/:id/attendance ──
router.get(
  "/events/:id/attendance",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const eventRows = await query<RowDataPacket[]>(
      "SELECT event_id FROM events WHERE event_id = ?",
      [eventId]
    );
    if (eventRows.length === 0) throw notFound("Event not found");

    const rows = await query<RowDataPacket[]>(
      `SELECT
         p.participant_id, p.name, p.email, p.department, p.year,
         COALESCE(a.present, FALSE) AS present,
         a.marked_at
       FROM registrations r
       JOIN participants p ON r.participant_id = p.participant_id
       LEFT JOIN attendance a ON a.event_id = r.event_id AND a.participant_id = r.participant_id
       WHERE r.event_id = ? AND r.status = 'registered'
       ORDER BY p.name ASC`,
      [eventId]
    );

    const presentCount = rows.filter((r) => r.present).length;
    const absentCount = rows.length - presentCount;

    res.json({
      data: rows,
      summary: {
        registered: rows.length,
        present: presentCount,
        absent: absentCount,
      },
    });
  })
);

export default router;
