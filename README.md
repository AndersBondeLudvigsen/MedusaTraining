# Local Setup --- Medusa + MCP + Storefront
---------------------------------------

### Prerequisites

-   **Node v20+**

-   **Docker** or **Docker Desktop**

* * * * *

### Quick Start


# 1) Start infrastructure (Postgres + Redis) from the repo root
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



* * * * *

### Environment Variables

Create **two** `.env` files: one in `my-medusa-store` and one in `medusa-mcp`.

#### `.env` for `my-medusa-store` (backend)

```
Onboarding

MEDUSA_ADMIN_ONBOARDING_TYPE=nextjs
MEDUSA_ADMIN_ONBOARDING_NEXTJS_DIRECTORY=my-medusa-store-storefront

CORS

STORE_CORS=http://localhost:8000,https://docs.medusajs.com
ADMIN_CORS=http://localhost:5173,http://localhost:9000,https://docs.medusajs.com
AUTH_CORS=http://localhost:5173,http://localhost:9000,http://localhost:8000,https://docs.medusajs.com

Redis

REDIS_URL=redis://localhost:6379

Secrets (use strong random values if moving to production)

JWT_SECRET=supersecret
COOKIE_SECRET=supersecret

Database
Example: DATABASE_URL=postgres://postgres:postgres@localhost:5432/medusa

DATABASE_URL=
DB_NAME=medusa-v2

Integrations / keys (fill as needed)

GEMINI_API_KEY=
PUBLISHABLE_KEY=

Backend + Admin credentials/tokens (used by tools/scripts)

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

-   **Storefront :**

    -   `http://localhost:8000` 

Ensure your frontend origin(s) are included in `STORE_CORS`, `ADMIN_CORS`, and `AUTH_CORS`.

* * * * *

### Mock Data

If you need more mock data in PostgreSQL:

-   Use **Seed Data** from the Admin sidebar; **or**

-   Run our seeding script (e.g. `npm run seed`, `npm run fulfillAllOrders`) defined in `package.json`.

