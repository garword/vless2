import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env");
}

export const db = createClient({
    url,
    authToken,
});

export type User = {
    id: number;
    username: string;
    full_name: string;
    role: 'admin' | 'member';
};

export type CFAccount = {
    id: number;
    email: string;
    api_key: string;
    account_id: string;
    type: 'vpn' | 'feeder';
    owner_id: number;
    status: 'active' | 'limit';
};
