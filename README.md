# Local Setup --- Medusa + MCP + Storefront
---------------------------------------

### Prerequisites

-   **Node v20+**

-   **Docker** or **Docker Desktop**

* * * * *

### Quick Start

```
# 1) Start infra (Postgres + Redis) from the repo root
docker compose up -d

# 2) Go to the backend directory
cd my-medusa-store

# 3) Install dependencies
npm i

# 4) Run database migrations (fixed typo: migrate, not migrabe)
npx medusa db:migrate

# 5) Seed data (pick one approach)
#   a) If you have a "seed" script in package.json:
npm run seed
#   b) Or use the Admin panel's "Seed Data" later.

# 6) Create an admin user
npx medusa user --email <yourchosenemail> --password <yourchosenpassword>

# 7) Start the dev server
npm run dev

```

* * * * *

### Environment Variables

Create **two** `.env` files: one in `my-medusa-store` and one in `medusa-mcp`.

#### `.env` for `my-medusa-store` (backend)

```
# Onboarding
MEDUSA_ADMIN_ONBOARDING_TYPE=nextjs
MEDUSA_ADMIN_ONBOARDING_NEXTJS_DIRECTORY=my-medusa-store-storefront

# CORS
STORE_CORS=http://localhost:8000,https://docs.medusajs.com
ADMIN_CORS=http://localhost:5173,http://localhost:9000,https://docs.medusajs.com
AUTH_CORS=http://localhost:5173,http://localhost:9000,http://localhost:8000,https://docs.medusajs.com

# Redis
REDIS_URL=redis://localhost:6379

# Secrets (use strong random values in real projects)
JWT_SECRET=supersecret
COOKIE_SECRET=supersecret

# Database
# DATABASE_URL=postgres://postgres:postgres@localhost:5432/medusa
DATABASE_URL=
DB_NAME=medusa-v2

# Integrations / keys (fill as needed)
GEMINI_API_KEY=
PUBLISHABLE_KEY=

# Backend + Admin credentials/tokens (used by your tools/scripts)
MEDUSA_BACKEND_URL=http://localhost:9000
MEDUSA_USERNAME=
MEDUSA_PASSWORD=
MEDUSA_ADMIN_API_KEY=

```

#### `.env` for `medusa-mcp`

```
MEDUSA_BACKEND_URL=http://localhost:9000
MEDUSA_USERNAME=
MEDUSA_PASSWORD=
PUBLISHABLE_KEY=
MEDUSA_ADMIN_API_KEY=

```

> **Tip:** Setting `MEDUSA_BACKEND_URL=http://localhost:9000` in both places helps your MCP or other tools reach the backend locally.

* * * * *

### Getting Keys from the Admin

-   **Publishable API Key:** `http://localhost:9000/app/settings/publishable-api-keys`

-   **Secret Admin API Key:** `http://localhost:9000/app/settings/secret-api-keys`

Paste those values into the respective `.env` files above.

* * * * *

### Where to Access Things

-   **Admin:** `http://localhost:9000/app`

-   **Storefront (examples):**

    -   `http://localhost:5173` (if your Next.js/Vite app runs there)

    -   `http://localhost:8000` (if you use a different local frontend)

Ensure your frontend origin(s) are included in `STORE_CORS`, `ADMIN_CORS`, and `AUTH_CORS`.

* * * * *

### Mock Data

If you need more mock data in PostgreSQL:

-   Use **Seed Data** from the Admin sidebar; **or**

-   Run your seeding script (e.g. `npm run seed`) if defined in `package.json`.

* * * * *

### Feedback / Fixes & Suggestions

-   **Typos fixed**

    -   `npx medusa db:migrabe` → `npx medusa db:migrate`.

-   **Seeding command**

    -   You wrote `npm seed`; it's usually `npm run seed` (provided you have a `"seed"` script in `package.json`). Otherwise, use the Admin's **Seed Data**.

-   **Database configuration**

    -   You listed both `DATABASE_URL` and `DB_NAME`. Typically you'll use **one** approach:

        -   **Preferred:** `DATABASE_URL=postgres://USER:PASS@HOST:PORT/DBNAME`

        -   **Alternative:** rely on your setup's `DB_NAME`. If `DATABASE_URL` is present, `DB_NAME` is often ignored.

-   **Set `MEDUSA_BACKEND_URL` locally**

    -   In both `.env` files, set `MEDUSA_BACKEND_URL=http://localhost:9000` so your tools (like `medusa-mcp`) can hit the backend.

-   **Strong secrets**

    -   Replace `supersecret` with strong random strings for `JWT_SECRET` and `COOKIE_SECRET`.

-   **CORS check**

    -   Your CORS lists include `http://localhost:5173`, `http://localhost:9000`, and `http://localhost:8000`. Make sure these match the actual ports your Admin and frontend(s) use.

-   **Docker assumptions**

    -   This guide assumes your `docker compose` brings up **Postgres** and **Redis** accessible at `localhost:5432` and `localhost:6379`. If your compose uses different ports or container names, update `DATABASE_URL` and `REDIS_URL` accordingly.

-   **Keys naming consistency**

    -   You used `PUBLISHABLE_KEY` and `MEDUSA_ADMIN_API_KEY`. Double-check your MCP service expects those exact variable names. Some setups use slightly different env names.

-   **Admin user step is in the backend dir**

    -   Run `npx medusa user ...` inside `my-medusa-store` (where Medusa is configured).

-   **Optional extras**

    -   Consider adding `PORT=9000` and `NODE_ENV=development` to the backend `.env` for clarity (if your project uses them).