/** Explicit synthetic accounts for fixtures; production users enter through verified App bootstrap. */
import { randomUUID } from "node:crypto";
import type { ForgeDatabase } from "./database.js";
export function testUser(db: ForgeDatabase, email: string, admin: boolean) {
  if (!db.listUsers().length) db.ensureUser("fixture-initial-admin@example.invalid");
  const owner = db.listUsers().find(user => user.role === "admin" && user.status === "active")!;
  const user = db.ensureUser(email);
  return admin && user.role !== "admin" ? db.changeUser(owner.id,user.id,{ expectedVersion:user.version,requestId:randomUUID(),reason:"Synthetic fixture administrator",role:"admin" },false) : user;
}
