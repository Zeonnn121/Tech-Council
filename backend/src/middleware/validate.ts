import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { badRequest } from "../utils/HttpError";

export function validate(
  schema: ZodSchema,
  target: "body" | "query" | "params" = "body"
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      return next(badRequest("Validation failed", details));
    }
    // Replace with parsed (and coerced/defaulted) values
    (req as any)[target] = result.data;
    next();
  };
}
