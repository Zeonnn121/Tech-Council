import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { getPool } from "./db";
import routes from "./routes";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

const app = express();
const isProd = process.env.NODE_ENV === "production";

// Requests arrive through the load balancer / iptables redirect, so trust the
// first proxy hop to make req.ip the real client IP. The login rate limiter
// depends on this, otherwise every request looks like it came from the proxy.
app.set("trust proxy", 1);

// CORS
app.use(
  cors({
    origin: isProd ? false : "http://localhost:5173",
  })
);

// Helmet. The CSP has to allow the frontend to show images served from
// presigned S3 URLs and to PUT uploads straight to S3.
// `upgrade-insecure-requests` is deliberately disabled: the app is served over
// plain HTTP on EC2 (no TLS), and that directive would rewrite same-origin
// asset requests to https:// and leave the page blank.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "img-src": ["'self'", "data:", "https://*.amazonaws.com"],
        "connect-src": ["'self'", "https://*.amazonaws.com"],
        "upgrade-insecure-requests": null,
      },
    },
  })
);

// pm2 redirects stdout to /var/log/tc-app/out.log in production
app.use(morgan(isProd ? "combined" : "dev"));
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

// Built frontend. Only in production: during local backend work the folder may
// not exist, in which case we warn and serve the API alone.
if (isProd) {
  const frontendDist = path.join(__dirname, "../../frontend/dist");

  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));

    // SPA fallback: any GET that is not an API or health route returns the app
    // shell, so client-side routes survive a refresh or a deep link.
    app.use((req, res, next) => {
      if (req.method !== "GET") {
        next();
        return;
      }
      if (req.path.startsWith("/api") || req.path.startsWith("/health")) {
        next();
        return;
      }
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  } else {
    console.warn(
      `[warn] Frontend build not found at ${frontendDist}; skipping static file serving`
    );
  }
}

// 404 and error handling (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;