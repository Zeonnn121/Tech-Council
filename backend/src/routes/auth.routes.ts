import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { query } from "../db";
import { getConfig } from "../config";
import { unauthorized } from "../utils/HttpError";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { requireAuth } from "../middleware/auth";

const router = Router();

// ── Rate limiter (in-memory, max 10 attempts per minute per IP) ──
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const record = attempts.get(ip);

  if (record && now > record.resetAt) {
    attempts.delete(ip);
  }

  const current = attempts.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (current.count >= 10) {
    res.status(429).json({
      error: { message: "Too many login attempts. Try again later." },
    });
    return;
  }

  current.count++;
  attempts.set(ip, current);
  next();
}

// ── POST /api/auth/login ──
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  "/login",
  rateLimiter,
  validate(loginSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    const rows = await query<any[]>(
      "SELECT user_id, name, email, password_hash, role, department FROM users WHERE email = ?",
      [email]
    );

    if (rows.length === 0) {
      throw unauthorized("Invalid email or password");
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw unauthorized("Invalid email or password");
    }

    const config = getConfig();
    const token = jwt.sign(
      { user_id: user.user_id, role: user.role },
      config.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      data: {
        token,
        user: {
          user_id: user.user_id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
        },
      },
    });
  })
);

// ── GET /api/auth/me ──
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await query<any[]>(
      "SELECT user_id, name, email, role, department FROM users WHERE user_id = ?",
      [req.user!.user_id]
    );

    if (rows.length === 0) {
      throw unauthorized();
    }

    res.json({ data: rows[0] });
  })
);

export default router;
