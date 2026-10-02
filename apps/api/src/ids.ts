import { randomBytes, createHash } from "node:crypto";

export const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
