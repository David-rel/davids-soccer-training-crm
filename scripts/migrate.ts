#!/usr/bin/env ts-node
// Load environment variables FIRST before any other imports
import { config } from "dotenv";
config({ path: ".env.local" });

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { getPool, query } from "../lib/db.js";

async function runMigrations() {
  try {
    console.log("🔄 Starting database migrations...\n");

    // Ensure migrations table exists
    await query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Get list of migration files
    const migrationsDir = join(process.cwd(), "db/migrations");
    const files = await readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    console.log(`Found ${sqlFiles.length} migration files\n`);

    // Get already executed migrations
    const executedResult = await query(
      "SELECT name FROM migrations ORDER BY name"
    );
    const executed = new Set(executedResult.rows.map((r) => r.name));

    // Run pending migrations
    let ranCount = 0;
    for (const file of sqlFiles) {
      const migrationName = file.replace(".sql", "");

      if (executed.has(migrationName)) {
        console.log(`✓ ${migrationName} (already executed)`);
        continue;
      }

      console.log(`⏳ Running ${migrationName}...`);

      // Read and execute migration
      const sql = await readFile(join(migrationsDir, file), "utf-8");

      // Remove comments and split into statements
      const statements = sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Execute each statement
      for (const statement of statements) {
        await query(statement);
      }

      // Record the migration
      await query(
        "INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        [migrationName]
      );

      console.log(`✅ ${migrationName} completed\n`);
      ranCount++;
    }

    if (ranCount === 0) {
      console.log("✨ All migrations up to date!\n");
    } else {
      console.log(`✨ Successfully ran ${ranCount} migration(s)\n`);
    }

    await getPool().end();
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    await getPool().end();
    process.exit(1);
  }
}

runMigrations();
