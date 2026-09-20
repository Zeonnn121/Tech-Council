import { Router, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { query } from "../db";
import { conflict } from "../utils/HttpError";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// All routes require auth
router.use(requireAuth);

// ── POST /api/users (admin only) ──
const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "organizer", "member"]),
  department: z.string().max(100).optional(),
});

router.post(
  "/",
  requireRole("admin"),
  validate(createUserSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, email, password, role, department } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const result = await query<any>(
        "INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)",
        [name, email, passwordHash, role, department || null]
      );

      const rows = await query<any[]>(
        "SELECT user_id, name, email, role, department, created_at FROM users WHERE user_id = ?",
        [(result as any).insertId]
      );

      res.status(201).json({ data: rows[0] });
    } catch (err: any) {
      if (err.code === "ER_DUP_ENTRY") {
        throw conflict("A user with this email already exists");
      }
      throw err;
    }
  })
);

// ── GET /api/users (admin or organizer) ──
router.get(
  "/",
  requireRole("admin", "organizer"),
  asyncHandler(async (req: Request, res: Response) => {
    const { role } = req.query;
    let sql = "SELECT user_id, name, email, role, department, created_at FROM users";
    const params: any[] = [];

    if (role && typeof role === "string") {
      sql += " WHERE role = ?";
      params.push(role);
    }

    sql += " ORDER BY created_at DESC";

    const rows = await query<any[]>(sql, params);
    res.json({ data: rows });
  })
);

export default router;
