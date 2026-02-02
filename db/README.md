# Database Setup

## Structure

```
db/
├── migrations/          # SQL migration files
│   └── 001_initial_setup.sql
└── README.md
```

## Running Migrations

To run migrations:

```bash
npm run migrate
```

## Creating New Migrations

1. Create a new `.sql` file in `db/migrations/`
2. Name it with a number prefix (e.g., `002_add_players_table.sql`)
3. Write your SQL statements
4. Run `npm run migrate`

## Migration File Format

```sql
-- Description of what this migration does
-- Migration: 002_migration_name
-- Created: YYYY-MM-DD

-- Your SQL statements here
CREATE TABLE example (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255)
);

-- Insert migration record (optional - script handles this)
INSERT INTO migrations (name) VALUES ('002_migration_name')
ON CONFLICT (name) DO NOTHING;
```

## Database Connection

Connection string is in `.env.local`:

```
DATABASE_URL=postgresql://davidfales@localhost:5432/davids-soccer-training-dev
```

## Testing Connection

```typescript
import { query } from "@/lib/db";

const result = await query("SELECT NOW()");
console.log(result.rows[0]);
```
