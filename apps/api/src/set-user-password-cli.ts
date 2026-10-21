import { stat } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Writable } from "node:stream";
import { createInterface } from "node:readline";
import { PasswordAdministration } from "@airic-forge/domain";
import { ForgeDatabase } from "./database.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { loadConfig } from "./config.js";

const help = `Usage: pnpm user:set-password --email USER_EMAIL [--data-dir /absolute/data] [--password-stdin]

Sets or resets an existing Forge user's password. Does not create users or change roles.
Stop Forge first, then restart it afterwards to discard existing login sessions.
By default, enter the password twice at hidden terminal prompts (at least 12 characters).
--password-stdin reads one UTF-8 line from a pipe, never from a terminal.
Data defaults to FORGE_DATA_DIR from the root .env, or runtime/certlab/data.
Passwords must not be supplied in command arguments or environment variables.
`;

async function hiddenPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error("InteractiveTerminalRequired");
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
  try {
    return await new Promise<string>((accept, reject) => {
      let finished = false;
      const finish = (value?: string) => {
        if (finished) return;
        finished = true;
        reader.close();
        if (value === undefined) reject(new Error("PasswordInputCancelled"));
        else accept(value);
      };
      reader.once("SIGINT", () => finish());
      reader.once("close", () => finish());
      reader.question("", value => finish(value));
      process.stderr.write(prompt);
    });
  } finally {
    reader.close();
    muted.destroy();
    process.stderr.write("\n");
  }
}

async function passwordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("PasswordStdinRequiresPipe");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 4096) throw new Error("PasswordInputTooLarge");
    chunks.push(bytes);
  }
  let value: string;
  try { value = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new Error("InvalidPasswordInput"); }
  value = value.replace(/\r?\n$/, "");
  if (/[\r\n]/.test(value)) throw new Error("PasswordInputMustBeOneLine");
  return value;
}

export async function main(): Promise<void> {
  let options;
  try {
    const parsed = parseArgs({ options: {
      email: { type: "string" }, "data-dir": { type: "string" },
      "password-stdin": { type: "boolean" }, help: { type: "boolean" },
    }, strict: true, allowPositionals: false, tokens: true });
    const seen = new Set<string>();
    for (const token of parsed.tokens) if (token.kind === "option") {
      if (seen.has(token.name)) throw new Error("DuplicateOption");
      seen.add(token.name);
    }
    options = parsed.values;
  } catch { throw new Error("InvalidArguments"); }
  if (options.help) { process.stdout.write(help); return; }
  if (!options.email?.trim()) throw new Error("EmailRequired");
  if (options["data-dir"] && !isAbsolute(options["data-dir"])) throw new Error("AbsoluteDataDirectoryRequired");
  const dataDir = options["data-dir"] ?? loadConfig().dataDir;
  try {
    if (!(await stat(join(dataDir, "forge.sqlite"))).isFile()) throw new Error("NotAFile");
  } catch { throw new Error("ExistingForgeDatabaseRequired"); }

  const password = options["password-stdin"]
    ? await passwordFromStdin()
    : await hiddenPassword("New password: ");
  if (Buffer.byteLength(password, "utf8") > 4096) throw new Error("PasswordInputTooLarge");
  if (!options["password-stdin"] && password !== await hiddenPassword("Confirm password: ")) throw new Error("PasswordConfirmationMismatch");
  const database = new ForgeDatabase(dataDir, { existingOnly: true });
  try {
    await new PasswordAdministration(database, { hash: hashPassword, verify: verifyPassword }).setPassword(options.email, password);
  } finally { database.close(); }
  process.stdout.write("Password updated. Restart Forge before logging in.\n");
}

const messages: Record<string, string> = {
  InvalidArguments: "Invalid arguments. Use --help. Password arguments are not supported.",
  EmailRequired: "--email is required.",
  AbsoluteDataDirectoryRequired: "--data-dir must be an absolute path.",
  ExistingForgeDatabaseRequired: "No existing Forge database at the selected data directory. Nothing was initialized.",
  InteractiveTerminalRequired: "A terminal is required for hidden input. For automation, use --password-stdin with a pipe.",
  PasswordStdinRequiresPipe: "--password-stdin requires a pipe, not a terminal.",
  PasswordInputCancelled: "Password entry cancelled. No password was changed.",
  PasswordInputTooLarge: "Password input exceeds 4096 bytes.",
  InvalidPasswordInput: "Password input must be valid UTF-8.",
  PasswordInputMustBeOneLine: "Provide exactly one password line.",
  PasswordConfirmationMismatch: "Passwords do not match. No password was changed.",
  UserNotFound: "Forge user not found. Connect from CertLab first; this command does not create users.",
  "Password must contain at least 12 characters": "Password must contain at least 12 characters.",
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`${messages[error instanceof Error ? error.message : ""] ?? "Unable to update the existing Forge database. Check its path, permissions and schema."}\n`);
    process.exitCode = 1;
  }
}
