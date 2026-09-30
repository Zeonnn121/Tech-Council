import "dotenv/config";
import app from "./app";
import { loadConfig } from "./config";
import { getPool, initPool } from "./db";

async function main() {
  try {
    const config = await loadConfig();
    initPool(config);
    const configSource =
      config.NODE_ENV === "production"
        ? "SSM Parameter Store"
        : "environment variables";

    // Startup info only — never log secret values.
    console.log(
      `[startup] env=${config.NODE_ENV} port=${config.PORT} region=${config.AWS_REGION} configSource=${configSource}`
    );

    const server = app.listen(config.PORT, () => {
      console.log(`[startup] API listening on port ${config.PORT}`);
    });

    let shuttingDown = false;

    function shutdown(signal: string): void {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`[shutdown] received ${signal}, closing server`);

      // Never hang forever waiting on a stuck connection.
      const forceExit = setTimeout(() => {
        console.error("[shutdown] timed out after 10s, forcing exit");
        process.exit(1);
      }, 10_000);

      server.close(async (err?: Error) => {
        if (err) {
          console.error("[shutdown] error while closing server:", err.message);
        }

        try {
          await getPool().end();
          console.log("[shutdown] database pool closed");
        } catch (poolErr) {
          console.error("[shutdown] error while closing pool:", poolErr);
        }

        clearTimeout(forceExit);
        console.log("[shutdown] done");
        process.exit(err ? 1 : 0);
      });

      // Drop idle keep-alive sockets so close() can finish promptly.
      server.closeIdleConnections();
    }

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

main();