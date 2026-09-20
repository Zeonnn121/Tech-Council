import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { getPool } from "./db";
import routes from "./routes";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

const app = express();

// CORS
const isProd = process.env.NODE_ENV === "production";
app.use(
  cors({
    origin: isProd ? false : "http://localhost:5173",
  })
);

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

// Health checks
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/health/db", async (_req, res) => {
  try {
    await getPool().query("SELECT 1");
    res.json({ status: "ok", db: "up" });
  } catch {
    res.status(503).json({ status: "error", db: "down" });
  }
});

// API routes
app.use("/api", routes);

// 404 and error handling (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;