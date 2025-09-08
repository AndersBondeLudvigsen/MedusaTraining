import { config as dotenv } from "dotenv";
dotenv();

export const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000";
export const MEDUSA_USERNAME = process.env.MEDUSA_USERNAME ?? "medusa_user";
export const MEDUSA_PASSWORD = process.env.MEDUSA_PASSWORD ?? "medusa_pass";
export const IS_DEV = process.env.NODE_ENV === "development";
