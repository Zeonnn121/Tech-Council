import "dotenv/config";
import app from "./app";
import { loadConfig } from "./config";
import { initPool } from "./db";

async function main() {
  try {
    const config = await loadConfig();
    initPool(config);
    console.log(`Config loaded from ${config.NODE_ENV === "production" ? "SSM" : "env"}`);

    app.listen(config.PORT, () => {
      console.log(`API running on port ${config.PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

main();