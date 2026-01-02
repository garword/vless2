import { StorageAdapter } from "grammy";
import { db } from "./db";

export class TursoAdapter<T> implements StorageAdapter<T> {
    constructor(private readonly table: string = "sessions") { }

    async read(key: string): Promise<T | undefined> {
        const res = await db.execute({
            sql: `SELECT value FROM ${this.table} WHERE key = ?`,
            args: [key],
        });
        const row = res.rows[0];
        if (!row) return undefined;
        try {
            return JSON.parse(row.value as string) as T;
        } catch (e) {
            return undefined;
        }
    }

    async write(key: string, value: T): Promise<void> {
        await db.execute({
            sql: `INSERT INTO ${this.table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
            args: [key, JSON.stringify(value), JSON.stringify(value)],
        });
    }

    async delete(key: string): Promise<void> {
        await db.execute({
            sql: `DELETE FROM ${this.table} WHERE key = ?`,
            args: [key],
        });
    }
}
