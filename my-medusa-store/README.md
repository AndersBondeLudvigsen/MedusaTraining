# Medusa Store Backend

This is the backend for the Medusa e-commerce store.

## Prerequisites

- Node.js (v20 or later)
- Docker and Docker Compose

## Getting Started

1.  **Clone the repository**

2.  **Navigate to the store directory:**
    ```bash
    cd my-medusa-store
    ```

3.  **Install dependencies:**
    ```bash
    npm install
    ```

4.  **Set up environment variables:**

    Create a `.env` file by copying the template:
    ```bash
    copy .env.template .env
    ```

    Update the `DATABASE_URL` in the `.env` file to:
    ```
    DATABASE_URL=postgres://medusa_user:medusa_pass@localhost:5432/medusa_db
    ```

5.  **Start the database:**

    From the root of the `MedusaTraining` directory, run:
    ```bash
    docker-compose up -d
    ```

6.  **Run database migrations:**

    In the `my-medusa-store` directory, run:
    ```bash
    npm run migrate
    ```

7.  **Seed the database:**

    To populate the database with sample products and data, run:
    ```bash
    npm run seed
    ```

8.  **Start the development server:**
    ```bash
    npm run dev
    ```

The Medusa backend should now be running on `http://localhost:9000`.
