import type { OrganizationContribution, OrganizationContributionPort } from "@airic-forge/domain";
import { git, type PersonalGitOperatingModel } from "./personal-git-om.js";

const trailer = (message: string, name: string) => new RegExp(`^AiricForge-${name}: (.*)$`, "m").exec(message)?.[1] ?? "";
const line = (value: string) => value.replace(/[\r\n]/g, " ");

export class GitContributions implements OrganizationContributionPort {
  constructor(private readonly om: PersonalGitOperatingModel) {}
  private branch(id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("InvalidContributionSource");
    return `contributions/${id}`;
  }
  createContribution(record: OrganizationContribution): void {
    const branch = this.branch(record.id);
    if (this.om.head("main") !== record.baseMainRevision) throw new Error("OrganizationReviewStale");
    const tree = git(this.om.projectDir, ["rev-parse", `${record.baseMainRevision}^{tree}`]);
    const message = ["Create organization OM contribution", "",
      `AiricForge-Contribution: ${record.id}`, `AiricForge-Author: ${line(record.authorUserId)}`,
      `AiricForge-Source-Revision: ${record.sourceRevision}`, `AiricForge-Base: ${record.baseMainRevision}`,
      `AiricForge-Reason: ${line(record.reason)}`, `AiricForge-Evidence: ${line(record.evidence)}`].join("\n");
    const revision = git(this.om.projectDir, ["commit-tree", tree, "-p", record.baseMainRevision], message);
    git(this.om.projectDir, ["update-ref", `refs/heads/${branch}`, revision, "0".repeat(40)]);
  }
  contribution(id: string): OrganizationContribution | undefined {
    const branch = this.branch(id);
    const refs = git(this.om.projectDir, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${branch}`]).split("\n");
    if (!refs.includes(branch)) return undefined;
    const revision = this.om.head(branch);
    const commits = git(this.om.projectDir, ["log", "--first-parent", "--fixed-strings", `--grep=AiricForge-Contribution: ${id}`, "--format=%H", revision]).split("\n").filter(Boolean);
    const metadata = commits.map((commit) => ({ commit, message: git(this.om.projectDir, ["show", "-s", "--format=%B", commit]) }))
      .filter(({ message }) => trailer(message, "Contribution") === id && trailer(message, "Source-Revision") && trailer(message, "Author"));
    if (!metadata.length) throw new Error(`InvalidContributionMetadata: ${id}`);
    const first = metadata.at(-1)!;
    const baseMainRevision = trailer(first.message, "Base") || git(this.om.projectDir, ["rev-parse", `${first.commit}^`]);
    const accepted = this.om.includesRevision("main", revision);
    const selectedPaths = git(this.om.projectDir, ["diff", "--no-renames", "--name-only", baseMainRevision, revision]).split("\n").filter(Boolean);
    const tipMessage = git(this.om.projectDir, ["show", "-s", "--format=%B", revision]);
    const selectionRevision = trailer(tipMessage, "Selected-Paths") ? revision : undefined;
    let acceptedRevision: string | undefined;
    if (accepted) {
      acceptedRevision = git(this.om.projectDir, ["rev-list", "--first-parent", "--reverse", `${baseMainRevision}..main`]).split("\n").find((commit) => commit && this.om.includesRevision(commit, revision)) ?? revision;
    }
    return { id, authorUserId: trailer(first.message, "Author"), sourceRevision: trailer(first.message, "Source-Revision"), baseMainRevision,
      reason: trailer(first.message, "Reason"), evidence: trailer(first.message, "Evidence"), status: accepted ? "accepted" : "open",
      selectedPaths, candidateBranch: branch, reviewedRevision: revision, ...(selectionRevision ? { selectionRevision } : {}), ...(acceptedRevision ? { acceptedRevision, acceptedAt: git(this.om.projectDir, ["show", "-s", "--format=%aI", acceptedRevision]) } : {}),
      createdAt: git(this.om.projectDir, ["show", "-s", "--format=%aI", first.commit]) };
  }
  contributions(): OrganizationContribution[] {
    const branches = git(this.om.projectDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/contributions/"]).split("\n").filter(Boolean);
    return branches.map((branch) => this.contribution(branch.slice("contributions/".length))!).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  saveSelection(id: string, expectedRevision: string, revision: string): void {
    git(this.om.projectDir, ["update-ref", `refs/heads/${this.branch(id)}`, revision, expectedRevision]);
  }
  abandonContribution(id: string, expectedRevision: string): void {
    const record = this.contribution(id);
    if (!record || record.status === "accepted") throw new Error("ContributionNotOpen");
    git(this.om.projectDir, ["update-ref", "-d", `refs/heads/${this.branch(id)}`, expectedRevision]);
  }
}
