import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();


const url = process.env.TURSO_DATABASE_URL || "file:dummy.db";
const authToken = process.env.TURSO_AUTH_TOKEN || "";

if (!process.env.TURSO_DATABASE_URL) {
    console.warn("⚠️ TURSO_DATABASE_URL is missing. DB calls will fail.");
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
