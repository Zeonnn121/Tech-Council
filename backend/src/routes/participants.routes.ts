import { Router, Request, Response } from "express";
import { z } from "zod";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { query } from "../db";
import { badRequest, conflict, notFound } from "../utils/HttpError";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

// ── Zod schemas ──

const participantCreateSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(150),
  department: z.string().min(1).max(100),
  year: z.number().int().min(1).max(4),
  phone: z.string().max(20).nullable().optional(),
});

const participantUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(150).optional(),
  department: z.string().min(1).max(100).optional(),
  year: z.number().int().min(1).max(4).optional(),
  phone: z.string().max(20).nullable().optional(),
});

// ── GET /api/participants ──
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (req.query.q && typeof req.query.q === "string") {
      conditions.push("(p.name LIKE ? OR p.email LIKE ?)");
      const q = `%${req.query.q}%`;
      params.push(q, q);
    }

    if (req.query.department && typeof req.query.department === "string") {
      conditions.push("p.department = ?");
      params.push(req.query.department);
    }

    if (req.query.year) {
      conditions.push("p.year = ?");
      params.push(Number(req.query.year));
    }

    const whereClause =
      conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const countRows = await query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM participants p ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    const rows = await query<RowDataPacket[]>(
      `SELECT * FROM participants p ${whereClause} ORDER BY p.name ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ data: rows, page, limit, total });
  })
);

// ── POST /api/participants (admin/organizer) ──
router.post(
  "/",
  requireRole("admin", "organizer"),
  validate(participantCreateSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, email, department, year, phone } = req.body;

    try {
      const result = await query<ResultSetHeader>(
        "INSERT INTO participants (name, email, department, year, phone) VALUES (?, ?, ?, ?, ?)",
        [name, email, department, year, phone ?? null]
      );

      const created = await query<RowDataPacket[]>(
        "SELECT * FROM participants WHERE participant_id = ?",
        [result.insertId]
      );

      res.status(201).json({ data: created[0] });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "ER_DUP_ENTRY"
      ) {
        throw conflict("A participant with this email already exists");
      }
      throw err;
    }
  })
);

// ── GET /api/participants/:id ──
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const participantId = Number(req.params.id);
    if (!participantId) throw badRequest("Invalid participant ID");

    const rows = await query<RowDataPacket[]>(
      "SELECT * FROM participants WHERE participant_id = ?",
      [participantId]
    );
    if (rows.length === 0) throw notFound("Participant not found");

    // Participation history: every event they registered for
    const history = await query<RowDataPacket[]>(
      `SELECT
         e.event_id, e.title, e.event_date, e.category, e.status AS event_status,
         r.registration_id, r.status AS registration_status, r.registration_date,
         a.present,
         c.certificate_id, c.certificate_code, c.status AS certificate_status
       FROM registrations r
       JOIN events e ON r.event_id = e.event_id
       LEFT JOIN attendance a ON a.event_id = r.event_id AND a.participant_id = r.participant_id
       LEFT JOIN certificates c ON c.event_id = r.event_id AND c.participant_id = r.participant_id
       WHERE r.participant_id = ?
       ORDER BY e.event_date DESC`,
      [participantId]
    );

    res.json({ data: { ...rows[0], participation_history: history } });
  })
);

// ── PUT /api/participants/:id (admin/organizer) ──
router.put(
  "/:id",
  requireRole("admin", "organizer"),
  validate(participantUpdateSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const participantId = Number(req.params.id);
    if (!participantId) throw badRequest("Invalid participant ID");

    const existing = await query<RowDataPacket[]>(
      "SELECT * FROM participants WHERE participant_id = ?",
      [participantId]
    );
    if (existing.length === 0) throw notFound("Participant not found");

    const allowedFields = ["name", "email", "department", "year", "phone"];
    const setClauses: string[] = [];
    const setParams: (string | number | null)[] = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        setParams.push(req.body[field] ?? null);
      }
    }

    if (setClauses.length === 0) {
      return res.json({ data: existing[0] });
    }

    try {
      await query(
        `UPDATE participants SET ${setClauses.join(", ")} WHERE participant_id = ?`,
        [...setParams, participantId]
      );
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "ER_DUP_ENTRY"
      ) {
        throw conflict("A participant with this email already exists");
      }
      throw err;
    }

    const updated = await query<RowDataPacket[]>(
      "SELECT * FROM participants WHERE participant_id = ?",
      [participantId]
    );

    res.json({ data: updated[0] });
  })
);

export default router;
