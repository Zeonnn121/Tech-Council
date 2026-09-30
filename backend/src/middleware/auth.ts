import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getConfig } from "../config";
import { unauthorized, forbidden } from "../utils/HttpError";
import { query } from "../db";

export interface AuthUser {
  user_id: number;
  role: string;
  email: string;
  name: string;
}

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface JwtPayload {
  user_id: number;
  role: string;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw unauthorized();
    }

    const token = authHeader.slice(7);
    const config = getConfig();
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;

    const rows = await query<any[]>(
      "SELECT user_id, role, email, name FROM users WHERE user_id = ?",
      [payload.user_id]
    );

    if (rows.length === 0) {
      throw unauthorized();
    }

    req.user = rows[0];
    next();
  } catch (err) {
    if (err instanceof Error && err.name === "JsonWebTokenError") {
      return next(unauthorized());
    }
    if (err instanceof Error && err.name === "TokenExpiredError") {
      return next(unauthorized());
    }
    next(err);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(forbidden());
    }
    next();
  };
}
