import { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/HttpError";
import { ZodError } from "zod";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { message: "Not found" } });
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // HttpError
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { message: err.message, details: err.details },
    });
    return;
  }

  // ZodError
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    res.status(400).json({
      error: { message: "Validation failed", details },
    });
    return;
  }

  // MySQL duplicate entry
  const mysqlErr = err as any;
  if (mysqlErr.code === "ER_DUP_ENTRY") {
    res.status(409).json({
      error: { message: "Resource already exists" },
    });
    return;
  }

  // MySQL foreign key violation
  if (mysqlErr.code === "ER_NO_REFERENCED_ROW_2") {
    res.status(400).json({
      error: { message: "Referenced resource does not exist" },
    });
    return;
  }

  // Everything else
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: { message: "Internal server error" },
  });
}
