import { Pool } from "pg";

// Lazy pool creation - only create when first used
let pool: Pool | null = null;
let loggedSslModeUpgrade = false;

function normalizeDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const sslMode = parsed.searchParams.get("sslmode");

    if (sslMode && ["prefer", "require", "verify-ca"].includes(sslMode)) {
      parsed.searchParams.set("sslmode", "verify-full");
      if (!loggedSslModeUpgrade) {
        console.log(
          `Upgrading DATABASE_URL sslmode from "${sslMode}" to "verify-full" for secure pg defaults`
        );
        loggedSslModeUpgrade = true;
      }
    }

    return parsed.toString();
  } catch {
    // If DATABASE_URL cannot be parsed as a URL, use it as-is.
    return rawUrl;
  }
}

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set in environment variables");
    }
    pool = new Pool({
      connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on("connect", () => {
      console.log("Connected to PostgreSQL database");
    });

    pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err);
      process.exit(-1);
    });
  }
  return pool;
}

// Helper function to query the database
export async function query(text: string, params?: any[]) {
  const start = Date.now();
  try {
    const pool = getPool();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log("Executed query", { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error("Database query error:", error);
    throw error;
  }
}

// Helper function to get a client for transactions
export async function getClient() {
  const pool = getPool();
  const client = await pool.connect();
  return client;
}

export { getPool };
export default getPool;
