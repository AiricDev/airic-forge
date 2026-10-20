import { ForgeUseCases, PersonalOmChanges, GitAccess } from "@airic-forge/domain";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import { CertLabClient } from "./certlab-client.js";
import { bindCertLabRoots } from "./instance-binding.js";
import { ForgeConfig } from "./config.js";
import { ForgeDatabase } from "./database.js";
import { PersonalGitOperatingModel } from "./personal-git-om.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";
import { JsonlTrajectoryStore } from "./trajectory.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";
import { FileContextSummaryStore } from "./context-summary-store.js";
import { PiContextSummarizer } from "./pi-context-summary.js";
import { PiWorkAgentRunner } from "./pi-work-agent.js";
import { PiReflectionAgentRunner } from "./pi-reflection-agent.js";
import { InMemoryEvidenceSessionStore, LocalEvidenceExtractor } from "./evidence.js";

/** Composition root only. Application policy lives in ForgeUseCases. */
export class ForgeRuntime {
  readonly db: ForgeDatabase;
  readonly om: PersonalGitOperatingModel;
  readonly omChanges: PersonalOmChanges;
  readonly gitAccess: GitAccess;
  readonly trajectories: JsonlTrajectoryStore;
  readonly sessions = new InMemoryAppSessionStore();
  readonly evidenceSessions = new InMemoryEvidenceSessionStore();
  readonly passwordSetups = new InMemoryPasswordSetupStore();
  readonly webSessions = new InMemoryWebSessionStore();
  readonly app: CertLabClient;
  readonly useCases: ForgeUseCases;
  constructor(readonly config: ForgeConfig) {
    bindCertLabRoots(config.projectDir, config.dataDir, config.organizationId);
    this.db = new ForgeDatabase(config.dataDir);
    this.db.interruptReflectionRuns(systemPort.now());
    this.db.interruptWorkTurns();
    this.om = new PersonalGitOperatingModel(config.projectDir, config.dataDir, config.seedProjectDir);
    this.trajectories = new JsonlTrajectoryStore(config.dataDir);
    this.app = new CertLabClient(config.certLabUrl, config.organizationId);
    this.om.initialize();
    this.omChanges = new PersonalOmChanges({ accounts: this.db, catalogs: this.db, om: this.om, drafts: this.db, system: systemPort });
    this.gitAccess = new GitAccess({ accounts: this.db, tokens: this.db, system: systemPort });
    this.useCases = new ForgeUseCases({ accounts: this.db, works: this.db, om: this.om, omChanges: this.omChanges, reportWorkDefinitionId: config.reportWorkDefinitionId, omDrafts: this.db, organization: this.db, measurements: this.db, app: this.app, organizationId: config.organizationId, catalogs: this.db, agents: new PiWorkAgentRunner(config), workContext: { summarizer: new PiContextSummarizer(config), summaries: new FileContextSummaryStore(config.dataDir), inputTokens: config.contextInputTokens, outputTokens: config.contextOutputTokens }, reflectionAgent: new PiReflectionAgentRunner(config), reflectionRunStore: this.db, sessions: this.sessions, evidenceExtractor: new LocalEvidenceExtractor(), evidenceSessions: this.evidenceSessions, passwordSetups: this.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: this.trajectories, system: systemPort, initialAdminEmails: config.initialAdminEmails });
  }
}
