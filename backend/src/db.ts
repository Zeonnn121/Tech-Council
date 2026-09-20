import mysql from "mysql2/promise";
import { AppConfig } from "./config";

let pool: mysql.Pool | null = null;

export function initPool(config: AppConfig): void {
  if (pool) {
    pool.end();
  }
  pool = mysql.createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    connectionLimit: 10,
    dateStrings: true,
    waitForConnections: true,
  });
}

export function getPool(): mysql.Pool {
  if (!pool) {
    throw new Error("Database pool not initialized. Call initPool() first.");
  }
  return pool;
}

export async function query<T = any>(
  sql: string,
  params?: any[]
): Promise<T> {
  const [rows] = await getPool().query(sql, params);
  return rows as T;
}