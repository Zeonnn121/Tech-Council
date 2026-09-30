import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";

export interface AppConfig {
  PORT: number;
  NODE_ENV: string;
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  JWT_SECRET: string;
  AWS_REGION: string;
  S3_BUCKET: string;
}

let cachedConfig: AppConfig | null = null;

const REQUIRED_KEYS = [
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "JWT_SECRET",
  "S3_BUCKET",
] as const;

function validateConfig(cfg: Record<string, string>): void {
  const missing = REQUIRED_KEYS.filter((k) => !cfg[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required config keys: ${missing.join(", ")}`);
  }
}

export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;

  const isProduction = process.env.NODE_ENV === "production";
  const values: Record<string, string> = {};

  if (!isProduction) {
    // Read from process.env (dotenv already loaded)
    for (const key of REQUIRED_KEYS) {
      values[key] = process.env[key] || "";
    }
    values["AWS_REGION"] = process.env.AWS_REGION || "ap-south-1";
  } else {
    // Read from SSM Parameter Store
    const ssmPath = process.env.SSM_PATH || "/tc-events/prod/";
    const region = process.env.AWS_REGION || "ap-south-1";
    const ssm = new SSMClient({ region });

    let nextToken: string | undefined;
    do {
      const command = new GetParametersByPathCommand({
        Path: ssmPath,
        WithDecryption: true,
        Recursive: true,
        NextToken: nextToken,
      });
      const response = await ssm.send(command);
      for (const param of response.Parameters || []) {
        const key = param.Name?.split("/").pop() || "";
        if (key && param.Value) {
          values[key] = param.Value;
        }
      }
      nextToken = response.NextToken;
    } while (nextToken);

    values["AWS_REGION"] = region;
  }

  validateConfig(values);

  cachedConfig = {
    PORT: Number(process.env.PORT) || 4000,
    NODE_ENV: process.env.NODE_ENV || "development",
    DB_HOST: values.DB_HOST,
    DB_PORT: Number(values.DB_PORT) || 3306,
    DB_USER: values.DB_USER,
    DB_PASSWORD: values.DB_PASSWORD,
    DB_NAME: values.DB_NAME,
    JWT_SECRET: values.JWT_SECRET,
    AWS_REGION: values.AWS_REGION,
    S3_BUCKET: values.S3_BUCKET,
  };

  return cachedConfig;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    throw new Error("Config not loaded. Call loadConfig() first.");
  }
  return cachedConfig;
}
