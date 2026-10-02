import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const hashPassword = (password: string): string => {
  if (password.length < 12) throw new Error("Password must contain at least 12 characters");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

export const verifyPassword = (password: string, value: string): boolean => {
  const [salt, expected] = value.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
};
