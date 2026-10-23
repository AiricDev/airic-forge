---
name: airic-app-integration
description: Integrate a business App with AiricForge, including MCP and embedded Copilot, versioned Pi capabilities, local development, deployment, and independently governed organization OM. Use when designing or changing an App's Forge integration or delivery; not for performing professional assessments or editing OM alone.
---

# Integrate an App with AiricForge

Forge is a versioned third-party service assembled into the App environment. The App owns business facts, permissions, transactions and receipts. Forge owns Work, execution provenance, OM governance and learning. Pi owns the native agent loop, sessions, compaction, file tools and extension mechanisms. Preserve these boundaries during local development and deployment.

Use current-user MCP discovery. Do not introduce a second capability registry, catalog acceptance or WD tool authorization lists.

## Start with the right contract

- Read [App integration and delivery requirements](../../docs/app-integration.md) first. It distinguishes agreed requirements from implemented behavior and assigns stable I-xx acceptance identifiers.
- For CertLab, read [the current integration guide](../../docs/certlab-integration.md), then inspect the deployed App's assistant protocol and the specific source entry points it names.
- For tool discovery or commands, consult [MCP discovery](../../docs/contracts/mcp-tool-discovery.md); for sessions and resource loading, consult [native execution](../../docs/contracts/context-projection.md).
- Use [integration scenarios](../../docs/acceptance/app-integration.feature) to scope verification. These are requirements, not evidence of passing tests.

Inspect the actual deployed Forge version and target App before copying configuration. Current bootstrap still binds CertLab/report-authoring; the native Pi configuration directory, explicit initialization and offline recovery commands are implemented; generic App registration is not. Use [the deployment entry points](../../docs/deployment.md) for current commands and limitations.

## Place each change with its owner

| Concern | Placement |
| --- | --- |
| PDF chunking, text/image choice, coverage, working notes, compaction recovery | Reusable base Agent capability / Skill / extension |
| Domain-specific judgment, evidence sufficiency, exceptions and responsibilities | Organization OM |
| Material retrieval schema, source identity, query/command semantics | App MCP adapter and existing business use cases |
| Agent packages/configuration, dependency versions, system programs | App code and release artifacts |
| Active OM, proposals, sessions, notes, trajectories and databases | Persistent runtime state |

Do not repair basic document-reading failures by adding pagination or memory procedures to OM. A generic reading package must work across domains; keep App schema mapping separate. When migrating existing mixed content, update seeds and prepare user-branch changes through governance; do not silently reset active OM or merge organization main.

## Implement the integration loop

1. Select a concrete business task and identify its facts, effects, actor permissions and human handoff. Route tools to existing business use cases rather than adding an Agent-specific mutation path.
2. Establish App identity, organization and entity/Work binding. Page state is a focus hint; fetch authoritative context. Use current-user MCP discovery and pin each Turn's immutable snapshot, with no separate catalog acceptance or WD authorization list.
3. Assemble explicit Agent resources with Pi native settings, package management and resource loading. Version configuration with App code; prepare dependencies before ordinary Turns; exclude host personal and Work-generated configuration from implicit discovery. Keep Work and Reflection profiles distinct.
4. Provide a local source-run path for App API/MCP, frontend and Forge with independent development data. Support explicit reload or service restart without Docker build; verify the process loaded new resources and any required workspace build. Stop active work safely before changing its environment.
5. Verify a representative task with a deterministic model and temporary data: read original material, persist source-linked progress, continue after compaction/restart and confirm an actual App receipt. Test rejection, cancellation, disconnected clients and unknown commands. Real customer material/model use needs applicable authorization.
6. Initialize new organizations from a fixed seed with provenance and repeat-safe behavior. Restarts and new release seeds must not overwrite organization or personal OM. Keep runtime OM evolution independent from software releases.
7. Assemble immutable release artifacts from the locally verified configuration and dependencies. Inject secrets separately; persist OM and runtime data. Record software/config/resource identities per execution, check compatibility, and rehearse upgrade/restore in isolation.

Use the existing use-case/port boundaries. Keep Pi types, package resolution, paths and transport details in adapters. Do not create a second generic summary loop, package registry, PDF parser or permission system.

## Reliability and evidence

- Token lifetime is bounded by the existing App session/bridge mechanisms; do not put credentials in settings, prompts, work files, transcripts or URLs. Extension code has process privileges; selecting resources does not create an OS sandbox.
- A business receipt determines the effect. Unknown outcomes block writes until the original command is reconciled; native retry/session recovery must not replay the operation under a new key.
- Preserve current disconnect/cancel semantics unless the user explicitly changes them. Restoring a Pi transcript does not restore App authorization or authorize automatic background execution.
- Relevant OM/tool/model/resource changes may require a new native session association. Keep old sessions and notes; revalidate notes against current business/source facts. Never select a recent session as a substitute for a missing explicit binding.
- Reflection can analyze local files and use its trajectory/candidate governance tools; it receives no Work App credentials. A missing tool becomes a software capability request, not an automatic plugin install or OM workaround.
- Backups include OM/worktrees, database, trajectories, native sessions and working files plus the App recovery point. Verify path repair and source identities after relocation. Separate software rollback, OM reversal and data restore.

Report implemented behavior, requirements still pending, executed checks and actual release/resource identities separately. Do not claim that a new guide, green health endpoint, passing mock run or model's success sentence proves the integration or professional judgment is complete.
