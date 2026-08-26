import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import type { CommandEnvelope, CommandResult, EventEnvelope, ModelProvider, SessionSnapshot } from "./types.js";
import { FileEventStore, type EventStore } from "./persistence/event-store.js";
import { FileSnapshotStore, type SnapshotStore } from "./persistence/snapshot-store.js";
import { CommandJournal, type CommandJournalLike } from "./persistence/command-journal.js";
import { EffectJournal, type EffectJournalLike } from "./persistence/effect-journal.js";
import type { SessionLeaseManagerLike } from "./persistence/session-lease.js";
import { PostgresDatabase, type PostgresDatabaseOptions } from "./persistence/postgres/database.js";
import { PostgresEventStore } from "./persistence/postgres/event-store.js";
import { PostgresSnapshotStore } from "./persistence/postgres/snapshot-store.js";
import { PostgresCommandJournal } from "./persistence/postgres/command-journal.js";
import { PostgresEffectJournal } from "./persistence/postgres/effect-journal.js";
import { PostgresSessionLeaseManager } from "./persistence/postgres/session-lease.js";
import { ApprovalService } from "./policy/approval-service.js";
import { DefaultPolicyEngine, type PolicyEngine } from "./policy/policy-engine.js";
import { LayeredPolicyEngine, OpaPolicyEngine, type OpaPolicyOptions } from "./policy/opa-policy-engine.js";
import { AuroraPolicyEngine, type AuroraPolicyOptions } from "./policy/aurora-policy-engine.js";
import { CapabilityBroker } from "./capabilities/capability-broker.js";
import { MemoryStore } from "./memory/memory-store.js";
import { ExternalMemoryProviderManager } from "./memory/external-memory-provider.js";
import { HonchoMemoryProvider, type HonchoMemoryProviderOptions } from "./memory/honcho-memory-provider.js";
import { SkillRegistry } from "./skills/skill-registry.js";
import { SkillsHub } from "./skills/skills-hub.js";
import { LearningGovernor } from "./learning/learning-governor.js";
import { LearningRolloutManager } from "./learning/learning-rollout.js";
import { RefinementService } from "./learning/refinement-service.js";
import { AutomaticRefinementCoordinator, RefinementPlanner } from "./learning/refinement-planner.js";
import { ContextManager } from "./context/context-manager.js";
import { RollingMicroCompactor, type RollingMicroCompactorOptions } from "./context/rolling-micro-compactor.js";
import { ModelRouter } from "./models/model-router.js";
import { MockModelProvider } from "./models/mock-provider.js";
import { OpenAICompatibleProvider } from "./models/openai-compatible-provider.js";
import { CodexOAuthManager } from "./models/codex-oauth-manager.js";
import { ModelOAuthManager } from "./models/model-oauth-manager.js";
import { CodexSubscriptionProvider } from "./models/codex-subscription-provider.js";
import { ProviderProfileRegistry } from "./models/provider-profiles.js";
import { FileCredentialPoolStateStore, type ProviderCredentialInput } from "./models/provider-credential-pool.js";
import { ModelConfigurationRegistry } from "./models/model-configuration-registry.js";
import { AgentProfileRegistry } from "./profiles/agent-profile-registry.js";
import { KernelManager } from "./kernel/kernel-manager.js";
import { Supervisor, type AgentFanoutLimits } from "./runtime/supervisor.js";
import { FileAgentInboxStore, PostgresAgentInboxStore, type AgentInboxStore } from "./runtime/agent-inbox.js";
import { filesystemCapabilities } from "./capabilities/filesystem.js";
import { memoryCapabilities } from "./capabilities/memory.js";
import { skillCapabilities } from "./capabilities/skills.js";
import { processCapability } from "./capabilities/process.js";
import { backgroundShellCapabilities } from "./capabilities/background-shell.js";
import { autoApprovalCapabilities } from "./capabilities/auto-approval.js";
import { verificationCapabilities } from "./capabilities/verification.js";
import { VerificationService } from "./harness/verification-service.js";
import { codeIntelligenceCapabilities } from "./capabilities/code-intelligence.js";
import { CodeIntelligenceService } from "./code-intelligence/service.js";
import { AutoApprovalService } from "./policy/auto-approval.js";
import { SessionBudgetService } from "./policy/session-budget.js";
import { sessionBudgetCapabilities } from "./capabilities/session-budget.js";
import { BackgroundShellService } from "./sandbox/background-shell.js";
import { gitCapabilities } from "./capabilities/git.js";
import { pythonCapability } from "./capabilities/python.js";
import { agentCapabilities } from "./capabilities/agents.js";
import { goalCapabilities } from "./capabilities/goals.js";
import { taskCapabilities } from "./capabilities/tasks.js";
import type { SandboxResourceLimits } from "./sandbox/sandbox.js";
import { createSandboxFactory, type SandboxBackendKind, type SingularitySandboxOptions, type SshSandboxOptions } from "./sandbox/sandbox.js";
import type { CloudSandboxGatewayOptions } from "./sandbox/cloud-sandbox.js";
import { DurableScheduler, type Schedule, type ScheduledJob } from "./scheduler/scheduler.js";
import { HostedSchedulerRelay, type HostedSchedulerRelayOptions } from "./scheduler/hosted-relay.js";
import { McpManager } from "./mcp/mcp-manager.js";
import { McpElicitationService } from "./mcp/mcp-elicitation-service.js";
import { ChannelGateway } from "./channels/channel-gateway.js";
import { HookBus } from "./plugins/hook-bus.js";
import { WasiPluginManager, type WasiPluginManagerOptions } from "./plugins/wasi/wasi-plugin-manager.js";
import { ChannelAdapterRegistry } from "./channels/delivery-adapters.js";
import { channelCapabilities } from "./capabilities/channels.js";
import { webCapabilities } from "./capabilities/web.js";
import { webSearchCapability } from "./capabilities/web-search.js";
import {
  BraveSearchProvider,
  TavilySearchProvider,
  WebSearchService,
  type BraveSearchProviderOptions,
  type TavilySearchProviderOptions,
} from "./web/web-search.js";
import { OperationalMetrics } from "./observability/operational-metrics.js";
import { OtlpMetricsExporter, type OtlpExporterOptions } from "./observability/otlp-exporter.js";
import { CredentialBroker, type CredentialBrokerLike } from "./security/credential-broker.js";
import { VaultCredentialBroker, type VaultCredentialBrokerOptions } from "./security/vault-credential-broker.js";
import { KmsEnvelopeCredentialBroker, type KmsProvider } from "./security/kms-envelope-credential-broker.js";
import { SecretSourceRegistry } from "./security/secret-source-registry.js";
import { BackendRegistry } from "./backends/backend-registry.js";
import { AutomationService } from "./automation/automation-service.js";
import { AutomationGitSyncService } from "./automation/automation-git-sync.js";
import { AutomationResponderService } from "./automation/automation-responder-service.js";
import { BrowserManager, type BrowserManagerOptions } from "./browser/browser-manager.js";
import { AudioService, type AudioServiceOptions } from "./audio/audio-service.js";
import { audioCapabilities } from "./capabilities/audio.js";
import { imageCapabilities } from "./capabilities/images.js";
import {
  ImageGenerationService, OpenAIImageProvider, FalImageProvider, FalImageUpscaleProvider,
  type OpenAIImageProviderOptions, type FalImageProviderOptions, type FalImageUpscaleProviderOptions,
} from "./media/image-generation.js";
import { FalVideoProvider, FalQueuedVideoProvider, FalVideoUpscaleProvider, VideoGenerationService, type FalVideoProviderOptions, type FalQueuedVideoProviderOptions, type FalVideoUpscaleProviderOptions } from "./media/video-generation.js";
import { MediaJobManager } from "./media/media-job-manager.js";
import { videoCapability, videoUpscaleCapability } from "./capabilities/video.js";
import { mediaJobCapabilities } from "./capabilities/media-jobs.js";
import { interactiveArtifactCapabilities } from "./capabilities/artifacts.js";
import { hostedReviewCapabilities } from "./capabilities/hosted-reviews.js";
import { societyCapabilities } from "./capabilities/society.js";
import { cognitiveCapabilities } from "./capabilities/cognitive.js";
import { browserCapabilities } from "./capabilities/browser.js";
import { SessionSearchService } from "./search/session-search.js";
import { sessionSearchCapability } from "./capabilities/session-search.js";
import { learningCapabilities } from "./capabilities/learning.js";
import { HybridSearchIndex, HashEmbeddingProvider, OpenAIEmbeddingProvider, type OpenAIEmbeddingOptions } from "./search/hybrid-index.js";
import { KnowledgeIndexer } from "./search/knowledge-indexer.js";
import { knowledgeSearchCapability } from "./capabilities/knowledge-search.js";
import { NatsCommandBus, NatsEventBridge, NatsTransport, type NatsTransportOptions } from "./transport/nats/nats-transport.js";
import { RepositoryImporter } from "./repositories/repository-importer.js";
import { InteractiveArtifactRegistry } from "./artifacts/interactive-artifact-registry.js";
import { HostedRepositoryProviderRegistry } from "./repositories/hosted-repository-provider.js";
import { GitHubAppManager } from "./repositories/github-app-manager.js";
import { AgentSocietyService } from "./society/agent-society-service.js";
import { CognitiveWorkspaceService } from "./cognitive/cognitive-workspace-service.js";
import { MemoryGraphService } from "./memory/memory-graph-service.js";
import { WorldModelService } from "./world/world-model-service.js";
import { MultiWorldModelService } from "./world/multi-world-model-service.js";
import { ProactiveInitiativeService } from "./initiative/proactive-initiative-service.js";
import { UserModelService } from "./user/user-model-service.js";
import { SkillEvolutionService } from "./evolution/skill-evolution-service.js";
import { EnvironmentAwarenessService } from "./environment/environment-awareness-service.js";
import { ConstitutionService } from "./aurora/constitution-service.js";
import { CognitiveOrchestrator } from "./aurora/cognitive-orchestrator.js";
import { AuroraContextComposer } from "./aurora/aurora-context-composer.js";
import { DecisionService } from "./aurora/decision-service.js";
import { PlanningService } from "./aurora/planning-service.js";
import { ExperienceDistiller } from "./aurora/experience-distiller.js";
import { AuroraAutopilot } from "./aurora/autopilot.js";
import { AuroraFleetSupervisor } from "./aurora/fleet-supervisor.js";
import { AuroraExecutionBridge } from "./aurora/execution-bridge.js";
import { RoleAuthorityService } from "./aurora/role-authority-service.js";
import { AuroraOutcomeHarvester } from "./aurora/outcome-harvester.js";
import { AuroraPlanFeedback } from "./aurora/plan-feedback-service.js";
import { AuroraEstimationCalibrator } from "./aurora/estimation-calibrator.js";
import { ProvenanceService } from "./aurora/provenance-service.js";
import { WorkspaceCheckpointService } from "./aurora/workspace-checkpoint-service.js";
import { AuroraMetricsCollector } from "./aurora/aurora-metrics.js";
import { AuroraDataGovernanceService } from "./aurora/data-governance-service.js";
import {
  auroraMetricsCapabilities, checkpointCapabilities, delegationCapabilities, fleetCapabilities, governanceCapabilities,
  estimationCapabilities, harvestCapabilities, planFeedbackCapabilities, probationCapabilities, roleAuthorityCapabilities,
} from "./capabilities/aurora-operations.js";
import {
  autopilotCapabilities, decisionCapabilities, distillerCapabilities, planningCapabilities, provenanceCapabilities,
} from "./capabilities/aurora-reasoning.js";
import { ContinualHarnessService } from "./harness/continual-harness-service.js";
import { MicroagentRegistry } from "./knowledge/microagent-registry.js";
import { RiskAnalyzerService } from "./policy/risk-analyzer.js";
import { StuckDetectorService } from "./runtime/stuck-detector.js";
import {
  constitutionCapabilities, harnessCapabilities, insightCapabilities, microagentCapabilities,
  orchestratorCapabilities, riskCapabilities, stuckCapabilities,
} from "./capabilities/aurora-core.js";
import { discoveryCapabilities } from "./capabilities/discovery.js";
import { backgroundTaskCapabilities, planModeCapabilities } from "./capabilities/background-tasks.js";
import {
  effortCapabilities, lifecycleHookCapabilities, projectInstructionCapabilities, repositoryCommandCapabilities,
  reviewCapabilities, sessionLifecycleCapabilities, sessionModeCapabilities, settingsCapabilities,
  subagentCapabilities, userQuestionCapabilities, worktreeCapabilities,
} from "./capabilities/workspace-conventions.js";
import { LifecycleHookService } from "./policy/lifecycle-hooks.js";
import { SessionModePolicyEngine, SessionModeService } from "./policy/session-modes.js";
import { ProjectInstructionService } from "./knowledge/project-instructions.js";
import { RepositoryCommandService } from "./knowledge/repository-commands.js";
import { SubagentDefinitionService } from "./knowledge/subagent-definitions.js";
import { WorkingTreeReviewService } from "./repositories/working-tree-review.js";
import { WorktreeService } from "./repositories/worktree-service.js";
import { SessionEffortService } from "./policy/session-effort.js";
import { ManifestTrustService } from "./security/manifest-trust.js";
import { SettingsResolver } from "./policy/settings-resolver.js";
import { UserQuestionService } from "./runtime/user-questions.js";
import { StatelessMcpRegistry } from "./mcp/stateless-mcp-registry.js";
import { SessionLifecycleService } from "./runtime/session-lifecycle.js";
import { memoryGraphCapabilities } from "./capabilities/memory-graph.js";
import { multiWorldCapabilities, worldModelCapabilities } from "./capabilities/world-model.js";
import { initiativeCapabilities } from "./capabilities/initiative.js";
import { userModelCapabilities } from "./capabilities/user-model.js";
import { evolutionCapabilities } from "./capabilities/evolution.js";
import { environmentCapabilities } from "./capabilities/environment.js";

export interface EngineConfig {
  homePath: string;
  /** Aurora prompt context block: constitution, harness, microagent knowledge and memory recall. */
  auroraContext?: { enabled?: boolean; constitutionChars?: number; harnessChars?: number; knowledgeChars?: number; memoryChars?: number; instructionChars?: number };
  /** Unattended ACOS cadence. Disabled unless explicitly enabled; bounded by the autopilot ledger. */
  autopilot?: { enabled?: boolean; tenantId?: string; driverIntervalMs?: number };
  /**
   * Multi-tenant driver above the autopilot. Disabled unless explicitly enabled; every tenant it
   * drives must be enrolled, and each sweep is bounded and recorded in the durable sweep ledger.
   */
  auroraFleet?: { enabled?: boolean; tenantIds?: string[]; sweepIntervalMs?: number; maxTenantsPerSweep?: number; maxSweepsPerDay?: number };
  /** Workspace checkpoint bounds for the real rollback path. */
  checkpoints?: { maxFiles?: number; maxTotalBytes?: number; maxFileBytes?: number; excludes?: string[] };
  /**
   * Aurora governance at the capability boundary. Enabled by default and escalation-only: it can
   * require approval or deny, but never grants authority another policy layer withheld.
   */
  auroraGovernance?: { enabled?: boolean } & AuroraPolicyOptions;
  /** Automatic candidate-only lesson extraction when a session closes. Enabled by default. */
  experienceDistillation?: { onSessionClose?: boolean };
  /** Deterministic operator hooks at the capability boundary and session lifecycle. Enabled by default. */
  lifecycleHooks?: { enabled?: boolean };
  /** Absolute enterprise settings floor. Anything it sets cannot be relaxed from below. */
  managedSettingsPath?: string;
  /** Default per-session effort level; sessions may still set their own. */
  effort?: { defaultLevel?: "low" | "medium" | "high" | "xhigh" | "max" };
  /** Named permission and sandbox modes per session, with the tenant default and bypass switch. */
  sessionModes?: { defaultPermissionMode?: "plan" | "manual" | "acceptEdits" | "auto" | "dontAsk" | "bypass"; defaultSandboxMode?: "read-only" | "workspace-write" | "danger-full-access"; allowBypass?: boolean };
  /** Discovery bounds for AGENTS.md / CLAUDE.md style repository instruction files. */
  projectInstructions?: { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number; maxDepth?: number };
  /**
   * Code intelligence: language server diagnostics, symbols, definition and
   * references. LSP is on by default only for the local sandbox backend, where
   * the engine and the workspace share a filesystem; toolchain diagnostics run
   * through whichever sandbox backend is configured. `serverBinaries` pins an
   * LSP server executable by id (operators, hermetic installs).
   */
  codeIntelligence?: {
    lsp?: boolean;
    serverBinaries?: Record<string, string>;
    serverArgs?: Record<string, string[]>;
    maxLspServers?: number;
    toolchainTimeoutMs?: number;
  };
  kernelServerScript: string;
  sandboxBackend: SandboxBackendKind;
  sshSandbox?: SshSandboxOptions;
  singularitySandbox?: SingularitySandboxOptions;
  cloudSandbox?: CloudSandboxGatewayOptions;
  autoApproveWorkspaceWrites?: boolean;
  allowProcessExecution?: boolean;
  masterKey?: string;
  vault?: VaultCredentialBrokerOptions;
  kmsProvider?: KmsProvider;
  wasiPlugins?: Omit<WasiPluginManagerOptions, "rootPath">;
  learningTrustedKeys?: Record<string, string>;
  autoRefineEveryTurns?: number;
  repositoryImport?: { maxFiles?: number; maxBytes?: number; timeoutMs?: number };
  hostedScheduler?: HostedSchedulerRelayOptions;
  otlp?: OtlpExporterOptions;
  browser?: BrowserManagerOptions;
  audio?: AudioServiceOptions;
  images?: OpenAIImageProviderOptions & { maxImageBytes?: number; allowRemoteImageUrls?: boolean };
  falImages?: FalImageProviderOptions;
  imageUpscale?: FalImageUpscaleProviderOptions;
  video?: FalVideoProviderOptions & { maxVideoBytes?: number; allowRemoteVideoUrls?: boolean };
  queuedVideo?: FalQueuedVideoProviderOptions;
  videoUpscale?: FalVideoUpscaleProviderOptions;
  webSearch?:
    | (BraveSearchProviderOptions & { provider?: "brave" })
    | (TavilySearchProviderOptions & { provider: "tavily" });
  opa?: OpaPolicyOptions;
  postgres?: PostgresDatabaseOptions;
  nats?: NatsTransportOptions;
  embeddings?: OpenAIEmbeddingOptions;
  /** Ordered, explicit provider:model routes used only after the primary fails before output. */
  modelFallbacks?: string[];
  agentMessaging?: {
    maxChars?: number;
    maxPending?: number;
    rateCapacity?: number;
    rateRefillMs?: number;
  };
  /** Child-agent fan-out limits: live children per session, tree depth, lifetime spawns. */
  agentFanout?: AgentFanoutLimits;
  /** Per-command resource limits (memory, CPU seconds, file size, processes). */
  sandboxLimits?: SandboxResourceLimits;
  modelOAuthRedirectUri?: string;
  context?: {
    maxMessageChars?: number;
    rollingMicroCompaction?: boolean;
    microCompaction?: RollingMicroCompactorOptions;
  };
  externalMemory?: ({ provider: "honcho" } & HonchoMemoryProviderOptions);
  model?:
    | { provider: "mock"; modelName?: string }
    | { provider: "codex-subscription"; modelName: string; reasoningEffort?: "low" | "medium" | "high" | "max"; requestTimeoutMs?: number }
    | { provider: "openai-compatible"; id?: string; baseUrl: string; apiKey?: string; modelName: string }
    | { provider: "profile"; profileId: string; baseUrl?: string; apiKey?: string; apiKeys?: ProviderCredentialInput[]; modelName?: string; headers?: Record<string, string>; apiVersion?: string; region?: string };
}

export class HybridAgentEngine {
  readonly events: EventStore;
  readonly snapshots: SnapshotStore;
  readonly database: PostgresDatabase | undefined;
  readonly nats: NatsTransport | undefined;
  readonly natsEvents: NatsEventBridge | undefined;
  readonly natsCommands: NatsCommandBus | undefined;
  readonly metrics: OperationalMetrics;
  readonly otlp: OtlpMetricsExporter | undefined;
  readonly credentials: CredentialBrokerLike;
  readonly codexAuth: CodexOAuthManager;
  readonly modelOAuth: ModelOAuthManager;
  readonly secretSources: SecretSourceRegistry;
  readonly backends: BackendRegistry;
  readonly repositories: RepositoryImporter;
  readonly githubApps: GitHubAppManager;
  readonly hostedRepositories: HostedRepositoryProviderRegistry;
  readonly interactiveArtifacts: InteractiveArtifactRegistry;
  readonly approvals: ApprovalService;
  readonly hooks: HookBus;
  readonly wasiPlugins: WasiPluginManager | undefined;
  readonly capabilities: CapabilityBroker;
  readonly memory: MemoryStore;
  readonly externalMemory: ExternalMemoryProviderManager;
  readonly skills: SkillRegistry;
  readonly skillsHub: SkillsHub;
  readonly learning: LearningGovernor;
  readonly refinements: RefinementService;
  readonly refinementPlanner: RefinementPlanner;
  readonly automaticRefinement: AutomaticRefinementCoordinator;
  readonly learningRollouts: LearningRolloutManager;
  readonly models: ModelRouter;
  readonly providerProfiles: ProviderProfileRegistry;
  readonly modelConfigurations: ModelConfigurationRegistry;
  readonly agentProfiles: AgentProfileRegistry;
  readonly agentInbox: AgentInboxStore;
  readonly kernels: KernelManager;
  readonly supervisor: Supervisor;
  readonly hostedScheduler: HostedSchedulerRelay | undefined;
  readonly scheduler: DurableScheduler;
  readonly automations: AutomationService;
  readonly automationGitSync: AutomationGitSyncService;
  readonly automationResponders: AutomationResponderService;
  readonly browser: BrowserManager;
  readonly audio: AudioService | undefined;
  readonly images: ImageGenerationService;
  readonly video: VideoGenerationService;
  readonly mediaJobs: MediaJobManager;
  readonly webSearch: WebSearchService;
  readonly sessionSearch: SessionSearchService;
  readonly knowledgeIndex: HybridSearchIndex;
  readonly knowledgeIndexer: KnowledgeIndexer;
  readonly mcp: McpManager;
  readonly mcpElicitations: McpElicitationService;
  readonly channels: ChannelGateway;
  readonly outboundChannels: ChannelAdapterRegistry;
  readonly society: AgentSocietyService;
  readonly cognitive: CognitiveWorkspaceService;
  readonly memoryGraph: MemoryGraphService;
  readonly worldModel: WorldModelService;
  readonly multiWorld: MultiWorldModelService;
  readonly initiative: ProactiveInitiativeService;
  readonly userModel: UserModelService;
  readonly evolution: SkillEvolutionService;
  readonly environment: EnvironmentAwarenessService;
  readonly constitution: ConstitutionService;
  readonly harness: ContinualHarnessService;
  readonly microagents: MicroagentRegistry;
  readonly riskAnalyzer: RiskAnalyzerService;
  readonly stuckDetector: StuckDetectorService;
  readonly acos: CognitiveOrchestrator;
  readonly auroraContextComposer: AuroraContextComposer | undefined;
  readonly decisions: DecisionService;
  readonly planning: PlanningService;
  readonly distiller: ExperienceDistiller;
  readonly autopilot: AuroraAutopilot;
  readonly auroraFleet: AuroraFleetSupervisor;
  readonly delegation: AuroraExecutionBridge;
  readonly roleAuthority: RoleAuthorityService;
  readonly harvester: AuroraOutcomeHarvester;
  readonly planFeedback: AuroraPlanFeedback;
  readonly estimation: AuroraEstimationCalibrator;
  readonly provenance: ProvenanceService;
  readonly checkpoints: WorkspaceCheckpointService;
  readonly auroraMetrics: AuroraMetricsCollector;
  readonly dataGovernance: AuroraDataGovernanceService;
  readonly auroraPolicy: AuroraPolicyEngine | undefined;
  readonly lifecycleHooks: LifecycleHookService;
  readonly sessionModes: SessionModeService;
  private readonly hookWorkspaceRoot: string;
  readonly projectInstructions: ProjectInstructionService;
  readonly repositoryCommands: RepositoryCommandService;
  readonly worktreeReview: WorkingTreeReviewService;
  readonly worktrees: WorktreeService;
  readonly sessionEffort: SessionEffortService;
  readonly manifestTrust: ManifestTrustService;
  readonly settings: SettingsResolver;
  readonly userQuestions: UserQuestionService;
  readonly backgroundShells: BackgroundShellService;
  readonly autoApprovals: AutoApprovalService;
  readonly sessionBudgets: SessionBudgetService;
  readonly verification: VerificationService;
  readonly codeIntelligence: CodeIntelligenceService;
  readonly statelessMcp: StatelessMcpRegistry;
  readonly subagents: SubagentDefinitionService;
  readonly sessionLifecycle: SessionLifecycleService;

  constructor(readonly config: EngineConfig) {
    const dataRoot = resolve(config.homePath, "data");
    const workspaceRoot = resolve(config.homePath, "workspaces");
    let commands: CommandJournalLike;
    let effects: EffectJournalLike;
    let leaseManager: SessionLeaseManagerLike | undefined;
    if (config.postgres) {
      this.database = new PostgresDatabase(config.postgres);
      this.events = new PostgresEventStore(this.database);
      this.snapshots = new PostgresSnapshotStore(this.database);
      commands = new PostgresCommandJournal(this.database);
      effects = new PostgresEffectJournal(this.database);
      leaseManager = new PostgresSessionLeaseManager(this.database);
    } else {
      this.database = undefined;
      this.events = new FileEventStore(dataRoot);
      this.snapshots = new FileSnapshotStore(dataRoot);
      commands = new CommandJournal(dataRoot);
      effects = new EffectJournal(dataRoot);
    }
    this.agentInbox = this.database ? new PostgresAgentInboxStore(this.database) : new FileAgentInboxStore(dataRoot);
    this.nats = config.nats ? new NatsTransport(config.nats) : undefined;
    this.natsEvents = this.nats ? new NatsEventBridge(this.nats, this.events) : undefined;
    this.natsCommands = this.nats ? new NatsCommandBus(this.nats) : undefined;
    const embeddings = config.embeddings ? new OpenAIEmbeddingProvider(config.embeddings) : new HashEmbeddingProvider();
    this.knowledgeIndex = new HybridSearchIndex(dataRoot, embeddings);
    this.knowledgeIndexer = new KnowledgeIndexer(this.events, this.knowledgeIndex);
    this.metrics = new OperationalMetrics(this.events);
    this.otlp = config.otlp ? new OtlpMetricsExporter(this.metrics, config.otlp) : undefined;
    if (config.vault && config.kmsProvider) throw new Error("Configure either Vault or KMS credentials, not both.");
    this.credentials = config.vault
      ? new VaultCredentialBroker(config.vault)
      : config.kmsProvider
        ? new KmsEnvelopeCredentialBroker(dataRoot, config.kmsProvider)
        : new CredentialBroker(dataRoot, config.masterKey ?? process.env.HAF_MASTER_KEY);
    this.codexAuth = new CodexOAuthManager({ broker: this.credentials });
    this.modelOAuth = new ModelOAuthManager({
      rootPath: dataRoot, credentials: this.credentials,
      ...(config.modelOAuthRedirectUri ? { redirectUri: config.modelOAuthRedirectUri } : {}),
    });
    this.secretSources = new SecretSourceRegistry(dataRoot, this.credentials);
    this.backends = new BackendRegistry(dataRoot);
    this.repositories = new RepositoryImporter({
      workspaceRoot,
      stateRoot: dataRoot,
      credentials: this.credentials,
      ...(config.repositoryImport?.maxFiles ? { maxFiles: config.repositoryImport.maxFiles } : {}),
      ...(config.repositoryImport?.maxBytes ? { maxBytes: config.repositoryImport.maxBytes } : {}),
      ...(config.repositoryImport?.timeoutMs ? { timeoutMs: config.repositoryImport.timeoutMs } : {}),
    });
    this.githubApps = new GitHubAppManager({ rootPath: dataRoot, credentials: this.credentials });
    this.hostedRepositories = new HostedRepositoryProviderRegistry({ rootPath: dataRoot, credentials: this.credentials, githubApps: this.githubApps });
    this.interactiveArtifacts = new InteractiveArtifactRegistry(dataRoot);
    this.approvals = new ApprovalService();
    this.hooks = new HookBus();
    const localPolicy = new DefaultPolicyEngine({
      autoApproveWorkspaceWrites: config.autoApproveWorkspaceWrites ?? false,
      allowLocalProcess: config.allowProcessExecution ?? false,
    });
    // Aurora governance binds at the capability boundary. The risk analyzer and constitution must
    // exist before the broker, and the layer is escalation-only, so it can only add scrutiny.
    this.riskAnalyzer = new RiskAnalyzerService(dataRoot);
    this.constitution = new ConstitutionService(dataRoot);
    this.auroraPolicy = config.auroraGovernance?.enabled === false
      ? undefined
      : new AuroraPolicyEngine(
        { risk: this.riskAnalyzer, constitution: this.constitution },
        dataRoot,
        {
          ...(config.auroraGovernance?.confirmAtOrAbove ? { confirmAtOrAbove: config.auroraGovernance.confirmAtOrAbove } : {}),
          ...(config.auroraGovernance?.denyAtOrAbove ? { denyAtOrAbove: config.auroraGovernance.denyAtOrAbove } : {}),
          ...(config.auroraGovernance?.alwaysCheckConstitution !== undefined ? { alwaysCheckConstitution: config.auroraGovernance.alwaysCheckConstitution } : {}),
          ...(config.auroraGovernance?.recordDecisions !== undefined ? { recordDecisions: config.auroraGovernance.recordDecisions } : {}),
        },
      );
    // Deterministic operator hooks join the same escalation-only stack: they can add scrutiny to a
    // capability call, never remove it. Actions run through the broker, so they stay governed.
    this.hookWorkspaceRoot = workspaceRoot;
    this.lifecycleHooks = new LifecycleHookService(dataRoot, {
      execute: async (call) => await this.runHookCapability(call),
    });
    this.projectInstructions = new ProjectInstructionService(Date.now, config.projectInstructions ?? {});
    this.sessionEffort = new SessionEffortService(dataRoot, Date.now, config.effort ?? {});
    this.settings = new SettingsResolver({ managedPath: config.managedSettingsPath ?? process.env.HAF_MANAGED_SETTINGS });
    // Reviewed automatic approvals sit in front of the human queue. They start with no rules, so the
    // default behaviour is unchanged: every approval reaches a person until an operator writes a rule
    // and says, in words that are stored, why that class of request is safe.
    this.autoApprovals = new AutoApprovalService(dataRoot);
    this.sessionBudgets = new SessionBudgetService(dataRoot);
    this.autoApprovals.bindEnabled(async (tenantId) => {
      const resolved = await this.settings.value<boolean>({ tenantId, key: "allowAutoApprovals" });
      // Absent means allowed; only an explicit `false` (from any layer, managed included) disables it.
      return resolved.value !== false;
    });
    this.approvals.bindReviewer(async (request) => await this.autoApprovals.review(request));
    this.userQuestions = new UserQuestionService();
    this.repositoryCommands = new RepositoryCommandService();
    const policyLayers: PolicyEngine[] = [localPolicy];
    if (config.opa) policyLayers.push(new OpaPolicyEngine(config.opa));
    if (config.lifecycleHooks?.enabled !== false) policyLayers.push(this.lifecycleHooks.policyLayer());
    if (this.auroraPolicy) policyLayers.push(this.auroraPolicy);
    policyLayers.push({
      decide: async (input) => {
        try {
          const denied = await this.settings.value<string[]>({ tenantId: input.context.tenantId, key: "deniedCapabilities", workspacePath: input.context.workspacePath });
          const list = Array.isArray(denied.value) ? denied.value : [];
          if (list.includes(input.descriptor.id)) {
            return { decision: "deny", reasonCode: "managed_denied_capability", message: `${input.descriptor.id} is denied by ${denied.locked ? "managed" : denied.layer} settings.` };
          }
        } catch {
          // Unreadable settings must never widen authority; they simply add no denial.
        }
        return { decision: "allow", reasonCode: "managed_settings_allow", message: "No managed denial applies." };
      },
    });
    const layered = policyLayers.length > 1 ? new LayeredPolicyEngine(policyLayers) : localPolicy;
    // The mode dial wraps the whole stack: it may tighten anything, and may relax only base-policy
    // approval requirements — never a governance decision.
    this.sessionModes = new SessionModeService(dataRoot, Date.now, {
      ...(config.sessionModes?.defaultPermissionMode ? { defaultPermissionMode: config.sessionModes.defaultPermissionMode } : {}),
      ...(config.sessionModes?.defaultSandboxMode ? { defaultSandboxMode: config.sessionModes.defaultSandboxMode } : {}),
      ...(config.sessionModes?.allowBypass !== undefined ? { allowBypass: config.sessionModes.allowBypass } : {}),
    });
    // Managed settings are an administrator floor: a permission ceiling sessions cannot exceed, and a
    // deny list nothing below the managed layer can shrink.
    this.sessionModes.bindCeiling(async (tenantId) => {
      const resolved = await this.settings.value<string>({ tenantId, key: "permissionModeCeiling" });
      const value = resolved.value;
      return value && ["plan", "manual", "acceptEdits", "auto", "dontAsk", "bypass"].includes(value)
        ? value as "plan" | "manual" | "acceptEdits" | "auto" | "dontAsk" | "bypass"
        : undefined;
    });
    const policy = new SessionModePolicyEngine(layered, this.sessionModes);
    this.capabilities = new CapabilityBroker(policy, this.approvals, effects, this.hooks);
    // A 2026-07-28 MCP server that needs input mid-call asks the human through the same bounded
    // question service the agent uses: a remote server never gets to script its own confirmation.
    this.statelessMcp = new StatelessMcpRegistry(this.capabilities, {
      askUser: async ({ tenantId, sessionId, requests }) => {
        const answers: Array<{ id: string; value: string }> = [];
        for (const request of requests.slice(0, 5)) {
          const options = request.options?.length
            ? request.options.map((option) => ({ label: option.label }))
            : [{ label: "Yes" }, { label: "No" }];
          const asked = await this.userQuestions.ask({
            tenantId,
            sessionId,
            question: request.prompt,
            context: "An MCP tool needs input to continue.",
            options,
            allowFreeText: request.kind === "text",
            timeoutMs: 120_000,
          });
          if (asked.status !== "answered") throw new Error(`MCP input request "${request.id}" was not answered (${asked.status}).`);
          const chosen = asked.options.find((option) => option.id === asked.answer?.optionId);
          answers.push({ id: request.id, value: asked.answer?.text ?? chosen?.label ?? "" });
        }
        return answers;
      },
    });
    this.wasiPlugins = config.wasiPlugins
      ? new WasiPluginManager(this.capabilities, this.hooks, { rootPath: dataRoot, ...config.wasiPlugins })
      : undefined;
    this.mcpElicitations = new McpElicitationService(dataRoot);
    this.mcp = new McpManager(this.capabilities, {
      schemaCacheRoot: resolve(dataRoot, "mcp", "schema-cache"),
      elicitationService: this.mcpElicitations,
      credentialBroker: this.credentials,
    });
    this.memory = new MemoryStore(dataRoot);
    this.skills = new SkillRegistry(dataRoot);
    this.manifestTrust = new ManifestTrustService(dataRoot);
    this.skillsHub = new SkillsHub(dataRoot, this.skills, this.manifestTrust);
    this.learning = new LearningGovernor(dataRoot, this.memory, this.skills, this.knowledgeIndex);
    this.refinements = new RefinementService(dataRoot, this.learning, this.events);
    const externalMemoryProvider = config.externalMemory?.provider === "honcho"
      ? new HonchoMemoryProvider(config.externalMemory)
      : undefined;
    this.externalMemory = new ExternalMemoryProviderManager(dataRoot, this.capabilities, externalMemoryProvider);
    const contextMaxChars = Math.min(2_000_000, Math.max(10_000, config.context?.maxMessageChars ?? 80_000));
    const rollingCompactor = config.context?.rollingMicroCompaction === false
      ? undefined
      : new RollingMicroCompactor(dataRoot, config.context?.microCompaction);
    // Aurora services that feed prompt assembly must exist before the context manager is built.
    this.harness = new ContinualHarnessService(dataRoot);
    this.microagents = new MicroagentRegistry(dataRoot);
    // Semantic recall: the memory graph shares the engine's embedding-backed hybrid index.
    this.memoryGraph = new MemoryGraphService(dataRoot, Date.now, {
      upsert: async (input) => await this.knowledgeIndex.upsert({ id: input.id, tenantId: input.tenantId, kind: input.kind, text: input.text, metadata: input.metadata }),
      remove: async (tenantId, id) => await this.knowledgeIndex.remove(tenantId, id),
      search: async (input) => (await this.knowledgeIndex.search(input)).map((hit) => ({ id: hit.id, score: hit.score, vectorScore: hit.vectorScore, lexicalScore: hit.lexicalScore })),
    });
    this.auroraContextComposer = config.auroraContext?.enabled === false
      ? undefined
      : new AuroraContextComposer(
        { constitution: this.constitution, harness: this.harness, microagents: this.microagents, memoryGraph: this.memoryGraph, instructions: this.projectInstructions },
        {
          ...(config.auroraContext?.constitutionChars !== undefined ? { constitutionChars: config.auroraContext.constitutionChars } : {}),
          ...(config.auroraContext?.harnessChars !== undefined ? { harnessChars: config.auroraContext.harnessChars } : {}),
          ...(config.auroraContext?.knowledgeChars !== undefined ? { knowledgeChars: config.auroraContext.knowledgeChars } : {}),
          ...(config.auroraContext?.memoryChars !== undefined ? { memoryChars: config.auroraContext.memoryChars } : {}),
          ...(config.auroraContext?.instructionChars !== undefined ? { instructionChars: config.auroraContext.instructionChars } : {}),
        },
      );
    const context = new ContextManager(this.memory, this.skills, this.learning, contextMaxChars, this.hooks, rollingCompactor, this.externalMemory, this.auroraContextComposer);
    this.models = new ModelRouter();
    this.providerProfiles = new ProviderProfileRegistry(true, new FileCredentialPoolStateStore(dataRoot));
    this.modelConfigurations = new ModelConfigurationRegistry(dataRoot, this.providerProfiles, this.modelOAuth);
    this.agentProfiles = new AgentProfileRegistry(dataRoot);
    this.browser = new BrowserManager(config.browser ?? {});
    this.audio = config.audio ? new AudioService(config.audio) : undefined;
    this.images = new ImageGenerationService({
      ...(config.images?.maxImageBytes ? { maxImageBytes: config.images.maxImageBytes } : {}),
      allowRemoteImageUrls: config.images?.allowRemoteImageUrls ?? false,
    });
    if (config.images) this.images.register(new OpenAIImageProvider(config.images), true);
    if (config.falImages) this.images.register(new FalImageProvider(config.falImages), !config.images);
    if (config.imageUpscale) this.images.registerUpscaler(new FalImageUpscaleProvider(config.imageUpscale));
    this.video = new VideoGenerationService({
      ...(config.video?.maxVideoBytes ? { maxVideoBytes: config.video.maxVideoBytes } : {}),
      allowRemoteVideoUrls: config.video?.allowRemoteVideoUrls ?? false,
    });
    if (config.video) this.video.register(new FalVideoProvider(config.video), true);
    if (config.queuedVideo) this.video.registerQueued(new FalQueuedVideoProvider(config.queuedVideo));
    if (config.videoUpscale) this.video.registerUpscaler(new FalVideoUpscaleProvider(config.videoUpscale));
    this.mediaJobs = new MediaJobManager(dataRoot, this.video);
    this.webSearch = new WebSearchService();
    if (config.webSearch) {
      this.webSearch.register(
        config.webSearch.provider === "tavily"
          ? new TavilySearchProvider(config.webSearch)
          : new BraveSearchProvider(config.webSearch),
        true,
      );
    }

    const model = config.model ?? { provider: "mock" as const };
    let modelName: string | undefined;
    if (model.provider === "mock") {
      this.models.register(new MockModelProvider(), true);
      modelName = model.modelName;
    } else if (model.provider === "codex-subscription") {
      const provider = new CodexSubscriptionProvider({
        model: model.modelName,
        oauth: this.codexAuth,
        ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
        ...(model.requestTimeoutMs ? { requestTimeoutMs: model.requestTimeoutMs } : {}),
      });
      this.models.register(provider, true);
      modelName = `${provider.id}:${model.modelName}`;
    } else if (model.provider === "openai-compatible") {
      const provider = new OpenAICompatibleProvider({
        id: model.id ?? "openai-compatible",
        baseUrl: model.baseUrl,
        ...(model.apiKey ? { apiKey: model.apiKey } : {}),
        model: model.modelName,
      });
      this.models.register(provider, true);
      modelName = `${provider.id}:${model.modelName}`;
    } else {
      const resolved = this.providerProfiles.createProvider({
        profileId: model.profileId,
        ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
        ...(model.apiKey ? { apiKey: model.apiKey } : {}),
        ...(model.apiKeys?.length ? { apiKeys: model.apiKeys } : {}),
        ...(model.modelName ? { model: model.modelName } : {}),
        ...(model.headers ? { headers: model.headers } : {}),
        ...(model.apiVersion ? { apiVersion: model.apiVersion } : {}),
        ...(model.region ? { region: model.region } : {}),
      });
      this.models.register(resolved.provider, true);
      modelName = resolved.modelName;
    }

    // Register every additional provider whose credential is explicitly present.
    // Credentials remain in provider closures and never enter session/kernel state.
    for (const profile of this.providerProfiles.list()) {
      if (this.models.list().includes(profile.id)) continue;
      const apiKey = process.env[profile.apiKeyEnvironmentVariable];
      if (!apiKey || !profile.defaultModel) continue;
      const configured = this.providerProfiles.createProvider({
        profileId: profile.id,
        apiKey,
        model: profile.defaultModel,
      });
      this.models.register(configured.provider, false);
    }

    this.kernels = new KernelManager(
      resolve(config.kernelServerScript),
      dataRoot,
      this.capabilities,
      { kind: config.sandboxBackend === "local" || config.sandboxBackend === "docker" ? config.sandboxBackend : "disabled" },
    );
    this.supervisor = new Supervisor({
      dataRoot,
      workspaceRoot,
      eventStore: this.events,
      snapshotStore: this.snapshots,
      commandJournal: commands,
      ...(leaseManager ? { leaseManager } : {}),
      agentInbox: this.agentInbox,
      ...(config.agentFanout ? { fanout: config.agentFanout } : {}),
      ...(config.agentMessaging?.maxChars ? { agentMessageMaxChars: config.agentMessaging.maxChars } : {}),
      ...(config.agentMessaging?.maxPending ? { agentMessageMaxPending: config.agentMessaging.maxPending } : {}),
      ...(config.agentMessaging?.rateCapacity ? { agentMessageRateCapacity: config.agentMessaging.rateCapacity } : {}),
      ...(config.agentMessaging?.rateRefillMs ? { agentMessageRateRefillMs: config.agentMessaging.rateRefillMs } : {}),
      model: this.models,
      capabilities: this.capabilities,
      context,
      ...(modelName ? { modelName } : {}),
      ...(config.modelFallbacks?.length ? { modelFallbacks: config.modelFallbacks } : {}),
      resolveEffort: async (tenantId: string, sessionId: string) => {
        const resolved = await this.sessionEffort.get(tenantId, sessionId);
        return { toolIterations: resolved.profile.toolIterations, reasoningEffort: resolved.profile.reasoningEffort };
      },
      onSessionClose: async (sessionId) => {
        await this.kernels.close(sessionId);
        this.userQuestions.cancelForSession(sessionId, "session closed");
        // Nothing a session started may outlive it: a build left running after its owner is gone is
        // an unowned process holding a workspace open.
        await this.backgroundShells.stopForSession(sessionId, "session closed").catch(() => undefined);
        try {
          const closing = await this.supervisor.getSession(sessionId);
          await this.lifecycleHooks.run({ tenantId: closing.tenantId, event: "session.stop", subject: sessionId });
        } catch {
          // A hook must never keep a session from closing.
        }
        // Closed sessions are where lessons are cheapest to extract. Distillation only ever produces
        // candidates, so this is safe to run unattended; failures must never block session closure.
        if (this.config.experienceDistillation?.onSessionClose === false) return;
        try {
          const snapshot = await this.supervisor.getSession(sessionId);
          await this.distiller.distill({ tenantId: snapshot.tenantId, sessionId });
        } catch {
          // ignored: distillation is an optimization, never a precondition for closing a session
        }
      },
    });
    this.sessionLifecycle = new SessionLifecycleService(dataRoot, {
      sessions: async (tenantId?: string) => await this.supervisor.listSessions(tenantId),
      session: async (sessionId: string) => await this.supervisor.getSession(sessionId),
      defaultModel: () => modelName ?? this.models.list()[0],
    });
    this.society = new AgentSocietyService(dataRoot, this.supervisor, this.agentProfiles, this.events);
    this.subagents = new SubagentDefinitionService({
      capabilities: this.capabilities, profiles: this.agentProfiles, society: this.society, hooks: this.lifecycleHooks,
    });
    this.cognitive = new CognitiveWorkspaceService(dataRoot);
    this.worldModel = new WorldModelService(dataRoot);
    this.multiWorld = new MultiWorldModelService(dataRoot);
    this.userModel = new UserModelService(dataRoot);
    this.evolution = new SkillEvolutionService(dataRoot);
    this.environment = new EnvironmentAwarenessService(dataRoot);
    this.decisions = new DecisionService(dataRoot);
    this.planning = new PlanningService(dataRoot);
    this.checkpoints = new WorkspaceCheckpointService(dataRoot, config.checkpoints ?? {});
    this.stuckDetector = new StuckDetectorService(this.events);
    // Queued initiatives are mirrored into the Global Workspace so proactive signals compete for
    // attention under the same constitutional budget as every other cognitive object.
    this.initiative = new ProactiveInitiativeService(dataRoot, Date.now, {
      onQueued: async (item) => {
        try {
          await this.cognitive.intake({
            tenantId: item.tenantId,
            source: "initiative",
            title: item.title,
            content: item.message,
            sourceId: item.id,
            kind: item.kind === "risk" ? "risk" : item.kind === "opportunity" ? "opportunity" : "observation",
            confidence: item.confidence,
            importance: item.importance,
            urgency: item.urgency,
            impact: item.impact,
            userRelevance: item.userRelevance,
            horizon: item.priority === "P0" ? "reactive" : "tactical",
            tags: ["initiative", item.priority.toLowerCase()],
          });
        } catch {
          // Initiative delivery must never fail because the workspace quota is exhausted.
        }
      },
    });
    this.refinementPlanner = new RefinementPlanner(
      dataRoot,
      this.models,
      this.events,
      this.refinements,
      async (sessionId) => await this.supervisor.getSession(sessionId),
    );
    this.automaticRefinement = new AutomaticRefinementCoordinator(this.events, this.refinementPlanner, {
      everyTurns: Math.max(0, Math.floor(config.autoRefineEveryTurns ?? 0)),
    });
    this.learningRollouts = new LearningRolloutManager(
      dataRoot,
      this.learning,
      this.capabilities,
      this.supervisor,
      config.learningTrustedKeys ?? {},
    );
    this.hostedScheduler = config.hostedScheduler ? new HostedSchedulerRelay(dataRoot, config.hostedScheduler) : undefined;
    this.scheduler = new DurableScheduler(dataRoot, this.supervisor, this.hostedScheduler);
    this.automations = new AutomationService(dataRoot, this.supervisor, this.scheduler);
    this.automationGitSync = new AutomationGitSyncService(dataRoot, this.hostedRepositories, this.automations, this.supervisor);
    this.automationResponders = new AutomationResponderService({ rootPath: dataRoot, credentials: this.credentials, automations: this.automations });
    this.sessionSearch = new SessionSearchService(this.supervisor);
    this.channels = new ChannelGateway(dataRoot, this.supervisor, {
      resolveAgentProfile: async (profileId, tenantId) => await this.agentProfiles.snapshot(profileId, tenantId),
    });
    this.outboundChannels = new ChannelAdapterRegistry();

    for (const capability of filesystemCapabilities()) this.capabilities.register(capability);
    for (const capability of memoryCapabilities(this.memory)) this.capabilities.register(capability);
    for (const capability of skillCapabilities(this.skills)) this.capabilities.register(capability);
    const sandboxFactory = createSandboxFactory(
      config.sandboxBackend,
      {
        ...(config.sshSandbox ? { ssh: config.sshSandbox } : {}),
        ...(config.singularitySandbox ? { singularity: config.singularitySandbox } : {}),
        ...(config.cloudSandbox ? { cloud: config.cloudSandbox } : {}),
        // Default resource hygiene for every command: a build that eats the host is not a build the
        // agent should be able to run. Operators can raise or clear these per installation.
        limits: config.sandboxLimits ?? { memoryMb: 4096, cpuSeconds: 900, fileSizeMb: 2048, processes: 512 },
      },
    );
    this.capabilities.register(processCapability(sandboxFactory));
    // A background shell is the same sandboxed execution path as `process.exec`; only the moment the
    // result arrives differs, so it reuses the factory rather than opening a second way to spawn.
    this.backgroundShells = new BackgroundShellService(sandboxFactory);
    // Verification runs the project's own commands through the same sandbox as everything else.
    this.verification = new VerificationService(dataRoot, sandboxFactory);
    for (const capability of verificationCapabilities(this.verification)) this.capabilities.register(capability);
    // Code intelligence: LSP when a server binary is installed and the engine
    // shares the workspace filesystem, toolchain diagnostics through the sandbox
    // regardless. LSP servers are read-only project processes with a scrubbed
    // environment, bounded count and graceful shutdown.
    this.codeIntelligence = new CodeIntelligenceService(dataRoot, sandboxFactory, {
      ...(config.codeIntelligence?.lsp === undefined
        ? { lsp: config.sandboxBackend === "local" }
        : { lsp: config.codeIntelligence.lsp }),
      ...(config.codeIntelligence?.serverBinaries ? { serverBinaries: config.codeIntelligence.serverBinaries } : {}),
      ...(config.codeIntelligence?.serverArgs ? { serverArgs: config.codeIntelligence.serverArgs } : {}),
      ...(config.codeIntelligence?.maxLspServers ? { maxLspServers: config.codeIntelligence.maxLspServers } : {}),
      ...(config.codeIntelligence?.toolchainTimeoutMs ? { toolchainTimeoutMs: config.codeIntelligence.toolchainTimeoutMs } : {}),
    });
    for (const capability of codeIntelligenceCapabilities(this.codeIntelligence)) this.capabilities.register(capability);
    for (const capability of backgroundShellCapabilities(this.backgroundShells)) this.capabilities.register(capability);
    for (const capability of autoApprovalCapabilities(this.autoApprovals)) this.capabilities.register(capability);
    for (const capability of sessionBudgetCapabilities({
      budgets: this.sessionBudgets, cost: async (sessionId) => await this.sessionLifecycle.cost(sessionId),
    })) this.capabilities.register(capability);
    for (const capability of gitCapabilities(sandboxFactory)) this.capabilities.register(capability);
    this.worktreeReview = new WorkingTreeReviewService(sandboxFactory);
    this.worktrees = new WorktreeService(sandboxFactory, workspaceRoot);
    this.capabilities.register(pythonCapability(this.kernels));
    for (const capability of agentCapabilities(this.supervisor)) this.capabilities.register(capability);
    for (const capability of goalCapabilities(this.supervisor)) this.capabilities.register(capability);
    for (const capability of taskCapabilities(this.supervisor)) this.capabilities.register(capability);
    for (const capability of channelCapabilities(this.outboundChannels)) this.capabilities.register(capability);
    for (const capability of webCapabilities()) this.capabilities.register(capability);
    if (this.webSearch.configured) this.capabilities.register(webSearchCapability(this.webSearch));
    if (this.browser.configured) {
      for (const capability of browserCapabilities(this.browser)) this.capabilities.register(capability);
    }
    if (this.audio) {
      for (const capability of audioCapabilities(this.audio)) this.capabilities.register(capability);
    }
    if (this.images.configured || this.images.upscaleConfigured) {
      for (const capability of imageCapabilities(this.images)) this.capabilities.register(capability);
    }
    if (this.video.configured) this.capabilities.register(videoCapability(this.video));
    if (this.video.upscaleConfigured) this.capabilities.register(videoUpscaleCapability(this.video));
    if (this.video.queueConfigured) for (const capability of mediaJobCapabilities(this.mediaJobs)) this.capabilities.register(capability);
    this.capabilities.register(sessionSearchCapability(this.sessionSearch));
    this.capabilities.register(knowledgeSearchCapability(this.knowledgeIndex));
    for (const capability of learningCapabilities(this.learning, this.refinements)) this.capabilities.register(capability);
    for (const capability of interactiveArtifactCapabilities(this.interactiveArtifacts)) this.capabilities.register(capability);
    for (const capability of hostedReviewCapabilities(this.hostedRepositories)) this.capabilities.register(capability);
    for (const capability of societyCapabilities(this.society)) this.capabilities.register(capability);
    for (const capability of cognitiveCapabilities(this.cognitive)) this.capabilities.register(capability);
    for (const capability of memoryGraphCapabilities(this.memoryGraph)) this.capabilities.register(capability);
    for (const capability of worldModelCapabilities(this.worldModel)) this.capabilities.register(capability);
    for (const capability of multiWorldCapabilities(this.multiWorld)) this.capabilities.register(capability);
    for (const capability of initiativeCapabilities(this.initiative)) this.capabilities.register(capability);
    for (const capability of userModelCapabilities(this.userModel)) this.capabilities.register(capability);
    for (const capability of evolutionCapabilities(this.evolution)) this.capabilities.register(capability);
    for (const capability of environmentCapabilities(this.environment)) this.capabilities.register(capability);
    this.delegation = new AuroraExecutionBridge(dataRoot, { planning: this.planning, society: this.society, evolution: this.evolution });
    this.roleAuthority = new RoleAuthorityService({ capabilities: this.capabilities, profiles: this.agentProfiles, society: this.society }, Date.now, dataRoot);
    // ACOS is constructed last: it composes every governed Aurora service into one control loop.
    this.acos = new CognitiveOrchestrator(dataRoot, {
      cognitive: this.cognitive,
      memoryGraph: this.memoryGraph,
      worldModel: this.worldModel,
      initiative: this.initiative,
      userModel: this.userModel,
      evolution: this.evolution,
      environment: this.environment,
      society: this.society,
      constitution: this.constitution,
      harness: this.harness,
      decisions: this.decisions,
      planning: this.planning,
    }, Date.now, {
      stuckSessions: async (tenantId) => {
        const sessions = (await this.supervisor.listSessions()).filter((item) => item.tenantId === tenantId && item.status !== "closed").slice(0, 20);
        const stuck: Array<{ sessionId: string; signature?: string; detail: string }> = [];
        for (const session of sessions) {
          const report = await this.stuckDetector.analyze(session.sessionId);
          if (!report.stuck) continue;
          stuck.push({
            sessionId: session.sessionId,
            ...(report.frictionSignature ? { signature: report.frictionSignature } : {}),
            detail: report.patterns.map((item) => `${item.code} x${item.occurrences}: ${item.detail}`).join(" | ").slice(0, 5000),
          });
        }
        return stuck;
      },
      delegation: async (tenantId) => await this.harvester.runCycle(tenantId),
      estimation: async (tenantId) => await this.estimation.ingest(tenantId),
      planFeedback: async (tenantId) => {
        const result = await this.planFeedback.reconcile({ tenantId });
        return { recorded: result.recorded.length, executedMarked: result.executedMarked.length };
      },
      integrity: async (tenantId) => {
        const report = await this.dataGovernance.selfCheck(tenantId);
        return {
          findings: report.findings.length,
          critical: report.findings.filter((item) => item.severity === "critical").length,
          score: report.score,
          details: report.findings.filter((item) => item.severity !== "info").map((item) => `${item.code}: ${item.detail}`),
        };
      },
    });
    for (const capability of constitutionCapabilities(this.constitution)) this.capabilities.register(capability);
    for (const capability of harnessCapabilities(this.harness)) this.capabilities.register(capability);
    for (const capability of microagentCapabilities(this.microagents)) this.capabilities.register(capability);
    for (const capability of riskCapabilities(this.riskAnalyzer)) this.capabilities.register(capability);
    for (const capability of stuckCapabilities(this.stuckDetector)) this.capabilities.register(capability);
    for (const capability of orchestratorCapabilities(this.acos)) this.capabilities.register(capability);
    for (const capability of insightCapabilities(this.memoryGraph)) this.capabilities.register(capability);
    this.distiller = new ExperienceDistiller(dataRoot, {
      events: this.events,
      harness: this.harness,
      microagents: this.microagents,
      evolution: this.evolution,
    });
    this.harvester = new AuroraOutcomeHarvester(dataRoot, {
      bridge: this.delegation,
      society: this.society,
      sessions: { session: async (sessionId: string) => await this.supervisor.getSession(sessionId) },
      events: this.events,
      evolution: this.evolution,
      distiller: this.distiller,
    });
    this.planFeedback = new AuroraPlanFeedback(dataRoot, {
      planning: this.planning, decisions: this.decisions, bridge: this.delegation, harvester: this.harvester,
      initiative: this.initiative,
    });
    this.estimation = new AuroraEstimationCalibrator(dataRoot, { planning: this.planning });
    this.autopilot = new AuroraAutopilot(dataRoot, { orchestrator: this.acos, initiative: this.initiative });
    this.auroraFleet = new AuroraFleetSupervisor(dataRoot, { autopilot: this.autopilot }, {
      ...(config.auroraFleet?.maxTenantsPerSweep !== undefined ? { maxTenantsPerSweep: config.auroraFleet.maxTenantsPerSweep } : {}),
      ...(config.auroraFleet?.maxSweepsPerDay !== undefined ? { maxSweepsPerDay: config.auroraFleet.maxSweepsPerDay } : {}),
    });
    this.provenance = new ProvenanceService({
      cognitive: this.cognitive,
      initiative: this.initiative,
      memoryGraph: this.memoryGraph,
      worldModel: this.worldModel,
      environment: this.environment,
      decisions: this.decisions,
      planning: this.planning,
      constitution: this.constitution,
    });
    for (const capability of decisionCapabilities(this.decisions)) this.capabilities.register(capability);
    for (const capability of planningCapabilities(this.planning)) this.capabilities.register(capability);
    for (const capability of distillerCapabilities(this.distiller)) this.capabilities.register(capability);
    for (const capability of autopilotCapabilities(this.autopilot)) this.capabilities.register(capability);
    for (const capability of fleetCapabilities(this.auroraFleet)) this.capabilities.register(capability);
    for (const capability of delegationCapabilities(this.delegation)) this.capabilities.register(capability);
    for (const capability of roleAuthorityCapabilities(this.roleAuthority)) this.capabilities.register(capability);
    for (const capability of harvestCapabilities(this.harvester)) this.capabilities.register(capability);
    for (const capability of planFeedbackCapabilities(this.planFeedback)) this.capabilities.register(capability);
    for (const capability of estimationCapabilities(this.estimation)) this.capabilities.register(capability);
    for (const capability of projectInstructionCapabilities(this.projectInstructions)) this.capabilities.register(capability);
    for (const capability of lifecycleHookCapabilities(this.lifecycleHooks)) this.capabilities.register(capability);
    for (const capability of sessionModeCapabilities(this.sessionModes)) this.capabilities.register(capability);
    for (const capability of repositoryCommandCapabilities(this.repositoryCommands)) this.capabilities.register(capability);
    for (const capability of reviewCapabilities(this.worktreeReview)) this.capabilities.register(capability);
    for (const capability of subagentCapabilities(this.subagents)) this.capabilities.register(capability);
    for (const capability of effortCapabilities(this.sessionEffort)) this.capabilities.register(capability);
    for (const capability of worktreeCapabilities(this.worktrees)) this.capabilities.register(capability);
    for (const capability of userQuestionCapabilities(this.userQuestions)) this.capabilities.register(capability);
    for (const capability of settingsCapabilities(this.settings)) this.capabilities.register(capability);
    for (const capability of backgroundTaskCapabilities({
      supervisor: this.supervisor, modes: this.sessionModes, effort: this.sessionEffort, questions: this.userQuestions,
      approvals: this.approvals,
    })) this.capabilities.register(capability);
    for (const capability of planModeCapabilities(this.sessionModes)) this.capabilities.register(capability);
    for (const capability of sessionLifecycleCapabilities(this.sessionLifecycle)) this.capabilities.register(capability);
    // Registered last so the catalog it searches already contains everything else.
    for (const capability of discoveryCapabilities(() => this.capabilities.list())) this.capabilities.register(capability);
    for (const capability of probationCapabilities(this.delegation)) this.capabilities.register(capability);
    this.auroraMetrics = new AuroraMetricsCollector({
      cognitive: this.cognitive, memoryGraph: this.memoryGraph, worldModel: this.worldModel,
      initiative: this.initiative, society: this.society, evolution: this.evolution,
      environment: this.environment, decisions: this.decisions, planning: this.planning,
      constitution: this.constitution, autopilot: this.autopilot, fleet: this.auroraFleet, acos: this.acos,
      delegation: this.delegation, roleAuthority: this.roleAuthority, harvester: this.harvester,
      planFeedback: this.planFeedback, estimation: this.estimation,
    });
    this.dataGovernance = new AuroraDataGovernanceService({
      cognitive: this.cognitive, memoryGraph: this.memoryGraph, worldModel: this.worldModel,
      initiative: this.initiative, userModel: this.userModel, evolution: this.evolution,
      environment: this.environment, society: this.society, constitution: this.constitution,
      harness: this.harness, microagents: this.microagents, decisions: this.decisions,
      planning: this.planning, acos: this.acos,
    });
    for (const capability of provenanceCapabilities(this.provenance)) this.capabilities.register(capability);
    for (const capability of checkpointCapabilities(this.checkpoints)) this.capabilities.register(capability);
    for (const capability of auroraMetricsCapabilities(this.auroraMetrics)) this.capabilities.register(capability);
    for (const capability of governanceCapabilities(this.dataGovernance)) this.capabilities.register(capability);
    if (config.auroraFleet?.enabled) {
      // Multi-tenant unattended operation: enroll the declared tenants, then start the bounded driver.
      const fleet = this.auroraFleet;
      void (async () => {
        for (const tenantId of config.auroraFleet?.tenantIds ?? ["local"]) await fleet.enroll({ tenantId });
        fleet.start(config.auroraFleet?.sweepIntervalMs ?? 60_000);
      })().catch(() => undefined);
    }
    if (config.autopilot?.enabled) {
      // Unattended operation is opt-in; the durable ledger and daily ceiling still bound it.
      void this.autopilot.configure({ tenantId: config.autopilot.tenantId ?? "local", enabled: true })
        .then(() => this.autopilot.start(config.autopilot?.tenantId ?? "local", config.autopilot?.driverIntervalMs ?? 60_000))
        .catch(() => undefined);
    }
  }

  registerModelProvider(provider: ModelProvider, makeDefault = false): void {
    this.models.register(provider, makeDefault);
  }

  activateCodexSubscription(input: { model: string; reasoningEffort?: "low" | "medium" | "high" | "max"; requestTimeoutMs?: number }): string {
    const model = input.model.trim();
    if (!model || model.length > 300) throw new Error("Codex model id is invalid.");
    if (!this.models.list().includes("openai-codex")) {
      this.models.register(new CodexSubscriptionProvider({
        model,
        oauth: this.codexAuth,
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        ...(input.requestTimeoutMs ? { requestTimeoutMs: input.requestTimeoutMs } : {}),
      }), false);
    }
    return `openai-codex:${model}`;
  }

  async createSession(input: { sessionId?: string; tenantId: string; name?: string; workspacePath?: string; agentProfileId?: string }): Promise<SessionSnapshot> {
    const agentProfile = input.agentProfileId ? await this.agentProfiles.snapshot(input.agentProfileId, input.tenantId) : undefined;
    return await this.supervisor.createSession({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      tenantId: input.tenantId,
      ...(input.name ? { name: input.name } : {}),
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
      ...(agentProfile ? { agentProfile } : {}),
    });
  }

  async importRepository(input: {
    tenantId: string;
    url: string;
    branch?: string;
    credentialSecretId?: string;
    credentialUsername?: string;
    name?: string;
    agentProfileId?: string;
  }): Promise<{ session: SessionSnapshot; repository: { origin: string; head: string; files: number; bytes: number } }> {
    const imported = await this.repositories.import({
      tenantId: input.tenantId,
      url: input.url,
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.credentialSecretId ? { credentialSecretId: input.credentialSecretId } : {}),
      ...(input.credentialUsername ? { credentialUsername: input.credentialUsername } : {}),
    });
    try {
      const session = await this.createSession({
        tenantId: input.tenantId,
        workspacePath: imported.workspacePath,
        ...(input.name ? { name: input.name } : {}),
        ...(input.agentProfileId ? { agentProfileId: input.agentProfileId } : {}),
      });
      return { session, repository: { origin: imported.origin, head: imported.head, files: imported.files, bytes: imported.bytes } };
    } catch (error) {
      await rm(imported.workspacePath, { recursive: true, force: true });
      throw error;
    }
  }

  async importHostedRepository(input: {
    tenantId: string;
    providerId: string;
    repositoryId: string;
    branch?: string;
    name?: string;
    agentProfileId?: string;
  }): Promise<{ session: SessionSnapshot; repository: { providerId: string; repositoryId: string; fullName: string; origin: string; head: string; files: number; bytes: number } }> {
    const selected = await this.hostedRepositories.resolveImport(input.providerId, input.tenantId, input.repositoryId);
    const imported = await this.importRepository({
      tenantId: input.tenantId,
      url: selected.repository.cloneUrl,
      ...(input.branch ? { branch: input.branch } : {}),
      credentialSecretId: selected.credentialSecretId,
      credentialUsername: selected.credentialUsername,
      name: input.name ?? selected.repository.fullName,
      ...(input.agentProfileId ? { agentProfileId: input.agentProfileId } : {}),
    });
    await this.hostedRepositories.linkSession({
      sessionId: imported.session.sessionId,
      tenantId: input.tenantId,
      providerId: input.providerId,
      repository: { ...selected.repository, defaultBranch: input.branch ?? selected.repository.defaultBranch },
      importedHead: imported.repository.head,
    });
    return {
      session: imported.session,
      repository: {
        providerId: input.providerId,
        repositoryId: selected.repository.repositoryId,
        fullName: selected.repository.fullName,
        ...imported.repository,
      },
    };
  }

  async command(command: CommandEnvelope): Promise<CommandResult> {
    // An archived session keeps everything it recorded and accepts nothing new. Restoring is an
    // explicit, audited act, so "tidy up my list" can never quietly become "keep working in here".
    if (command.sessionId && command.kind !== "session.close") {
      const archived = await this.sessionLifecycle.isArchived(command.tenantId, command.sessionId).catch(() => false);
      if (archived) throw new Error(`Session ${command.sessionId} is archived. Restore it before sending "${command.kind}".`);
    }
    // A spend cap refuses *new* work only. A turn already in flight finishes: cutting a half-applied
    // edit to save a few cents leaves a worse mess than the spend it avoided.
    if (command.sessionId && (command.kind === "session.prompt" || command.kind === "session.resume")) {
      const verdict = await this.budgetVerdict(command.tenantId, command.sessionId).catch(() => undefined);
      if (verdict?.blocked) throw new Error(verdict.message);
    }
    return await this.supervisor.dispatch(command);
  }

  /** What the session's budget looks like right now, priced from the same table the cost view uses. */
  async budgetVerdict(tenantId: string, sessionId: string) {
    const cost = await this.sessionLifecycle.cost(sessionId);
    return await this.sessionBudgets.evaluate({
      tenantId, sessionId, spentUsd: cost.costUsd, totalTokens: cost.usage.totalTokens, costSource: cost.costSource,
    });
  }

  async session(sessionId: string): Promise<SessionSnapshot> {
    return await this.supervisor.getSession(sessionId);
  }

  async sessions(tenantId?: string): Promise<SessionSnapshot[]> {
    return await this.supervisor.listSessions(tenantId);
  }

  async readEvents(sessionId: string, afterSequence = 0, limit = 1000): Promise<EventEnvelope[]> {
    return await this.events.read(sessionId, afterSequence, limit);
  }

  subscribe(sessionId: string, listener: (event: EventEnvelope) => void): () => void {
    return this.events.subscribe(sessionId, listener);
  }

  async schedule(input: { tenantId: string; sessionId: string; prompt: string; schedule: Schedule; label?: string }): Promise<ScheduledJob> {
    return await this.scheduler.create(input);
  }

  async activateModelConfiguration(id: string): Promise<string> {
    const configured = await this.modelConfigurations.materialize(id);
    if (this.models.list().includes(id)) this.models.unregister(id);
    this.models.register(configured.provider, false);
    return configured.modelName;
  }

  async setModelConfigurationEnabled(id: string, enabled: boolean) {
    const record = await this.modelConfigurations.setEnabled(id, enabled);
    if (enabled && record.configured) await this.activateModelConfiguration(id);
    else if (this.models.list().includes(id)) this.models.unregister(id);
    return record;
  }

  async removeModelConfiguration(id: string): Promise<boolean> {
    if (this.models.list().includes(id)) this.models.unregister(id);
    return await this.modelConfigurations.remove(id);
  }

  async initialize(): Promise<void> {
    await this.database?.ensureSchema();
    for (const configuration of await this.modelConfigurations.list()) {
      if (!configuration.enabled || !configuration.configured || this.models.list().includes(configuration.id)) continue;
      await this.activateModelConfiguration(configuration.id).catch(() => undefined);
    }
    if (this.natsEvents) await this.natsEvents.start();
    this.automaticRefinement.start();
    if (this.hostedScheduler) await this.hostedScheduler.reconcile(await this.scheduler.list());
  }

  start(): void {
    this.scheduler.start();
    this.otlp?.start();
    this.outboundChannels.startAll();
  }

  /**
   * Run a lifecycle-hook action through the normal capability path. Hook side effects are governed
   * like everything else: policy, approval and the effect journal all apply, and the synthetic
   * context is clearly labelled so an audit can tell hook traffic from agent traffic.
   */
  private async runHookCapability(call: { tenantId: string; capabilityId: string; input: Record<string, unknown>; reason: string }): Promise<unknown> {
    const callId = randomUUID();
    return await this.capabilities.execute(call.capabilityId, call.input, {
      tenantId: call.tenantId,
      sessionId: callId,
      familyId: callId,
      turnId: callId,
      toolCallId: callId,
      source: "scheduler",
      workspacePath: this.hookWorkspaceRoot,
      idempotencyKey: `lifecycle-hook:${call.capabilityId}:${callId}`,
    });
  }

  async shutdown(): Promise<void> {
    this.autopilot.stop();
    this.auroraFleet.stop();
    await this.scheduler.close();
    await this.automationResponders.close();
    await this.outboundChannels.closeAll();
    this.automaticRefinement.stop();
    await this.codeIntelligence.shutdown();
    this.otlp?.stop();
    this.natsEvents?.stop();
    this.natsCommands?.close();
    await this.mcp.closeAll();
    await this.mcpElicitations.close();
    await this.wasiPlugins?.closeAll();
    await this.browser.closeAll();
    await this.externalMemory.shutdown();
    await this.kernels.closeAll();
    await this.supervisor.shutdown();
    this.knowledgeIndexer.close();
    this.metrics.close();
    if (this.events instanceof PostgresEventStore) await this.events.close();
    await this.agentInbox.close?.();
    await this.nats?.close();
    await this.database?.close();
  }
}
