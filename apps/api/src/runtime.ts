import { ForgeUseCases, PersonalOmChanges, GitAccess, type InstanceSettings, type AppPort } from "@airic-forge/domain";
import { join } from "node:path";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import { loadAppPort } from "./app-adapter.js";
import { bindInstanceRoots } from "./instance-binding.js";
import { ForgeConfig } from "./config.js";
import { ForgeDatabase } from "./database.js";
import { PersonalGitOperatingModel } from "./personal-git-om.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";
import { JsonlTrajectoryStore } from "./trajectory.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";
import { PiWorkAgentRunner } from "./pi-work-agent.js";
import { PiReflectionAgentRunner } from "./pi-reflection-agent.js";
import { InMemoryEvidenceSessionStore, LocalEvidenceExtractor } from "./evidence.js";
import { GitOmWorkspaces } from "./git-om-workspaces.js";
import { GitContributions } from "./git-contributions.js";

/** Composition root only. Application policy lives in ForgeUseCases. */
export class ForgeRuntime {
  readonly db: ForgeDatabase;
  readonly om: PersonalGitOperatingModel;
  readonly omChanges: PersonalOmChanges;
  readonly drafts: GitOmWorkspaces;
  readonly organization: GitContributions;
  readonly gitAccess: GitAccess;
  readonly trajectories: JsonlTrajectoryStore;
  readonly sessions = new InMemoryAppSessionStore();
  readonly evidenceSessions = new InMemoryEvidenceSessionStore();
  readonly passwordSetups = new InMemoryPasswordSetupStore();
  readonly webSessions = new InMemoryWebSessionStore();
  readonly app: AppPort;
  readonly useCases: ForgeUseCases;
  readonly instanceSettings: InstanceSettings;
  constructor(readonly config: ForgeConfig, app: AppPort = loadAppPort(config)) {
    bindInstanceRoots(config.projectDir, config.dataDir, config.organizationId, config.appId ?? "");
    this.db = new ForgeDatabase(config.dataDir);
    this.db.interruptReflectionRuns(systemPort.now());
    this.db.interruptWorkTurns();
    this.om = new PersonalGitOperatingModel(config.projectDir, config.dataDir, config.seedProjectDir);
    this.trajectories = new JsonlTrajectoryStore(config.dataDir);
    this.app = app;
    this.instanceSettings = { operatingModel: { repositoryPath: config.projectDir, dataPath: config.dataDir, personalWorktreesPath: join(config.dataDir, "worktrees", "users") }, integration: app.describeIntegration?.() ?? {appId:config.appId ?? "",organizationId:config.organizationId,baseUrl:config.appUrl,mcpUrl:`${config.appUrl}/mcp`,transport:"streamable-http"} };
    this.om.initialize();
    this.drafts = new GitOmWorkspaces(this.om);
    this.organization = new GitContributions(this.om);
    this.omChanges = new PersonalOmChanges({ accounts: this.db, om: this.om, drafts: this.drafts, system: systemPort });
    this.gitAccess = new GitAccess({ accounts: this.db, tokens: this.db, system: systemPort });
    this.useCases = new ForgeUseCases({ accounts: this.db, works: this.db, om: this.om, omChanges: this.omChanges, workDefinitionId: config.workDefinitionId, omDrafts: this.drafts, organization: this.organization, measurements: this.db, instanceSettings: this.instanceSettings, app: this.app, organizationId: config.organizationId, toolSnapshots: this.db, agents: new PiWorkAgentRunner(config), reflectionAgent: new PiReflectionAgentRunner(config), reflectionRunStore: this.db, sessions: this.sessions, evidenceExtractor: new LocalEvidenceExtractor(), evidenceSessions: this.evidenceSessions, passwordSetups: this.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: this.trajectories, system: systemPort,  });
    this.bindUserLifecycle();
    // No model execution survives a process restart; interrupted work remains historical.
    for (const user of this.db.listUsers()) if (user.status === "draining") this.db.finishUserDrain(user.id);

  }
  private readonly boundUserLifecycles = new WeakSet<object>();
  bindUserLifecycle(): void {
    if (this.boundUserLifecycles.has(this.useCases.users)) return;
    this.boundUserLifecycles.add(this.useCases.users);
    this.useCases.users.onDisabled(userId => {
      this.webSessions.revokeUser(userId);
      this.passwordSetups.revokeUser(userId);
      for (const ticket of this.sessions.revokeUser(userId)) this.evidenceSessions.clear(ticket);
    });
  }

}
