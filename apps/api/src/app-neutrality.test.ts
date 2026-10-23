/** Two unrelated Apps exercise the same production runtime without report/assessment DTOs. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AppPort,
  AgentRunnerPort,
  AppToolSnapshot,
} from "@airic-forge/domain";
import { ForgeUseCases } from "@airic-forge/domain";
import { ForgeRuntime } from "./runtime.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";
import { buildServer } from "./server.js";

for (const [appId, workType, resourceType, capabilityId] of [
  ["inventory", "stocktake", "warehouse", "stock.adjust"],
  ["museum", "cataloguing", "collection", "catalogue.annotate"],
])
  test(`production runtime binds ${appId}/${workType} and recovers an opaque receipt without replay`, async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-neutral-"));
    const catalog: AppToolSnapshot = {
      id: "tools",
      appId,
      domainRelease: `${appId}/2026`,
      digest: appId,
      discoveredAt: "now",
      tools: [
        {
          id: capabilityId,
          title: "Update",
          description: "Synthetic update",
          kind: "command",
          receiptScope: "update",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
      ],
    };
    let submissions = 0,
      lookups = 0;
    let receipt: Record<string, unknown> | undefined;
    const app: AppPort = {
      identity: async () => ({
        appId,
        organizationId: "test-org",
        appUserId: "user",
        email: "member@example.invalid",
        displayName: "Member",
      }),
      resourceContext: async (_token, id) => ({
        resource: { namespace: appId, resourceType, resourceId: id },
      }),
      discoverTools: async () => catalog,
      query: async () => {
        throw Error("UnexpectedBusinessQuery");
      },
      bindInput: (entityId, input) => ({ ...input, object: entityId }),
      prepareCommand: async (_token, _id, input) => ({
        resourceKind: resourceType,
        resourceId: String(input.object),
        scope: "update",
        targetKind: "entry",
        targetId: "entry-1",
      }),
      submitCommand: async (_token, _id, body, locator) => {
        submissions++;
        assert.deepEqual(body.input, { value: "checked", object: "object-1" });
        assert.equal(locator?.resourceKind, resourceType);
        receipt = { status: "committed", commandId: body.commandId };
        return { status: "unknown" };
      },
      receipt: async () => {
        lookups++;
        return lookups > 1 ? receipt : undefined;
      },
    };
    const config = {
      port: 0,
      appId,
      projectDir: join(root, "project"),
      dataDir: join(root, "data"),
      seedProjectDir: resolve("../../tests/fixtures/operating-model"),
      workDefinitionId: "document-task",
      appUrl: "http://localhost:1",
      organizationId: "test-org",
      webDistDir: join(root, "web"),
      allowedOrigin: "http://localhost",
    };
    const runtime = new ForgeRuntime(config, app);
    const agents: AgentRunnerPort = {
      runWork: async ({ tools }) => {
        const result = await tools[0].invoke({ value: "checked" });
        assert.equal(result.status, "unknown");
        await assert.rejects(
          () => tools[0].invoke({ value: "again" }),
          /UnresolvedCommandBlocksFurtherWrites/,
        );
        return { text: "Pending original receipt" };
      },
    };
    const useCases = new ForgeUseCases({
      accounts: runtime.db,
      works: runtime.db,
      om: runtime.om,
      app,
      organizationId: "test-org",
      workDefinitionId: "document-task",
      toolSnapshots: runtime.db,
      agents,
      sessions: runtime.sessions,
      passwordSetups: runtime.passwordSetups,
      passwordCodec: { hash: hashPassword, verify: verifyPassword },
      trajectories: runtime.trajectories,
      system: systemPort,
    });
    Object.assign(runtime, { useCases });
    const server = buildServer(runtime);
    try {
      const wrong = await server.inject({
        method: "POST",
        url: "/api/v1/app-sessions/bootstrap",
        headers: { authorization: "Bearer private" },
        payload: { appId: "foreign", workType, entityId: "object-1" },
      });
      assert.equal(wrong.statusCode, 400);
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/app-sessions/bootstrap",
        headers: { authorization: "Bearer private" },
        payload: { appId, workType, entityId: "object-1" },
      });
      assert.equal(response.statusCode, 201);
      const first = response.json();
      assert.equal(first.work.appId, appId);
      assert.equal(first.work.workType, workType);
      await assert.rejects(
        () =>
          useCases.bootstrap({
            token: "private",
            appId: "foreign",
            workType,
            entityId: "object-1",
          }),
        /AppOrganizationBindingMismatch/,
      );
      await useCases.startTurn(first.ticket, "Update the selected entry");
      const events = (await useCases.sessionHistory(first.ticket)).events;
      const pending = events.find(
        (e) => e.type === "action" && e.payload.status === "unknown",
      )!;
      assert.equal(
        (
          await useCases.recoverCommand(
            first.ticket,
            String(pending.payload.commandId),
          )
        ).status,
        "committed",
      );
      assert.equal(submissions, 1);
      catalog.appId = "foreign";
      const progress = (await useCases.sessionHistory(first.ticket)).progress;
      await useCases.checkpointFeedback(
        first.ticket,
        {
          checkpointId: progress.checkpoint!.id,
          kind: "resume",
          note: "Recheck current tools",
        },
        "feedback",
      );
      await assert.rejects(
        () => useCases.startTurn(first.ticket, "Continue"),
        /UnsupportedAppTools/,
      );
    } finally {
      await server.close();
      runtime.db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
