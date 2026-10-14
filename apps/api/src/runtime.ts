import { ForgeUseCases } from "@airic-forge/domain";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import { CertReporterClient } from "./certreporter-client.js";
import { ForgeConfig } from "./config.js";
import { ForgeDatabase } from "./database.js";
import { GitOperatingModel } from "./git-om.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";
import { JsonlTrajectoryStore } from "./trajectory.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";
import { PiWorkAgentRunner } from "./pi-work-agent.js";
import { PiReflectionAgentRunner } from "./pi-reflection-agent.js";
import { InMemoryEvidenceSessionStore, LocalEvidenceExtractor } from "./evidence.js";

/** Composition root only. Application policy lives in ForgeUseCases. */
export class ForgeRuntime {
  readonly db: ForgeDatabase;
  readonly om: GitOperatingModel;
  readonly trajectories: JsonlTrajectoryStore;
  readonly sessions = new InMemoryAppSessionStore();
  readonly evidenceSessions = new InMemoryEvidenceSessionStore();
  readonly passwordSetups = new InMemoryPasswordSetupStore();
  readonly webSessions = new InMemoryWebSessionStore();
  readonly certReporter: CertReporterClient;
  readonly useCases: ForgeUseCases;
  constructor(readonly config: ForgeConfig) {
    this.db = new ForgeDatabase(config.dataDir);
    this.om = new GitOperatingModel(config.projectDir, config.dataDir, config.seedProjectDir);
    this.trajectories = new JsonlTrajectoryStore(config.dataDir);
    this.certReporter = new CertReporterClient(config.certReporterUrl);
    this.om.initialize();
    this.useCases = new ForgeUseCases({ accounts: this.db, works: this.db, om: this.om, omDrafts: this.db, organization: this.db, measurements: this.db, certReporter: this.certReporter, catalogs: this.db, agents: new PiWorkAgentRunner(config), reflectionAgent: new PiReflectionAgentRunner(config), sessions: this.sessions, evidenceExtractor: new LocalEvidenceExtractor(), evidenceSessions: this.evidenceSessions, passwordSetups: this.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: this.trajectories, system: systemPort, initialAdminEmails: config.initialAdminEmails });
  }
}
