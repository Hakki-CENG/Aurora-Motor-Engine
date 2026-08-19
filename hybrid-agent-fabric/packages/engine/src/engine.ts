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
import { DefaultPolicyEngine } from "./policy/policy-engine.js";
import { LayeredPolicyEngine, OpaPolicyEngine, type OpaPolicyOptions } from "./policy/opa-policy-engine.js";
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
import { Supervisor } from "./runtime/supervisor.js";
import { FileAgentInboxStore, PostgresAgentInboxStore, type AgentInboxStore } from "./runtime/agent-inbox.js";
import { filesystemCapabilities } from "./capabilities/filesystem.js";
import { memoryCapabilities } from "./capabilities/memory.js";
import { skillCapabilities } from "./capabilities/skills.js";
import { processCapability } from "./capabilities/process.js";
import { gitCapabilities } from "./capabilities/git.js";
import { pythonCapability } from "./capabilities/python.js";
import { agentCapabilities } from "./capabilities/agents.js";
import { goalCapabilities } from "./capabilities/goals.js";
import { taskCapabilities } from "./capabilities/tasks.js";
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
import { ContinualHarnessService } from "./harness/continual-harness-service.js";
import { MicroagentRegistry } from "./knowledge/microagent-registry.js";
import { RiskAnalyzerService } from "./policy/risk-analyzer.js";
import { StuckDetectorService } from "./runtime/stuck-detector.js";
import {
  constitutionCapabilities, harnessCapabilities, insightCapabilities, microagentCapabilities,
  orchestratorCapabilities, riskCapabilities, stuckCapabilities,
} from "./capabilities/aurora-core.js";
import { memoryGraphCapabilities } from "./capabilities/memory-graph.js";
import { multiWorldCapabilities, worldModelCapabilities } from "./capabilities/world-model.js";
import { initiativeCapabilities } from "./capabilities/initiative.js";
import { userModelCapabilities } from "./capabilities/user-model.js";
import { evolutionCapabilities } from "./capabilities/evolution.js";
import { environmentCapabilities } from "./capabilities/environment.js";

export interface EngineConfig {
  homePath: string;
  /** Aurora prompt context block: constitution, harness, microagent knowledge and memory recall. */
  auroraContext?: { enabled?: boolean; constitutionChars?: number; harnessChars?: number; knowledgeChars?: number; memoryChars?: number };
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
    const policy = config.opa
      ? new LayeredPolicyEngine([localPolicy, new OpaPolicyEngine(config.opa)])
      : localPolicy;
    this.capabilities = new CapabilityBroker(policy, this.approvals, effects, this.hooks);
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
    this.skillsHub = new SkillsHub(dataRoot, this.skills);
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
    this.constitution = new ConstitutionService(dataRoot);
    this.harness = new ContinualHarnessService(dataRoot);
    this.microagents = new MicroagentRegistry(dataRoot);
    this.memoryGraph = new MemoryGraphService(dataRoot);
    this.auroraContextComposer = config.auroraContext?.enabled === false
      ? undefined
      : new AuroraContextComposer(
        { constitution: this.constitution, harness: this.harness, microagents: this.microagents, memoryGraph: this.memoryGraph },
        {
          ...(config.auroraContext?.constitutionChars !== undefined ? { constitutionChars: config.auroraContext.constitutionChars } : {}),
          ...(config.auroraContext?.harnessChars !== undefined ? { harnessChars: config.auroraContext.harnessChars } : {}),
          ...(config.auroraContext?.knowledgeChars !== undefined ? { knowledgeChars: config.auroraContext.knowledgeChars } : {}),
          ...(config.auroraContext?.memoryChars !== undefined ? { memoryChars: config.auroraContext.memoryChars } : {}),
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
      ...(config.agentMessaging?.maxChars ? { agentMessageMaxChars: config.agentMessaging.maxChars } : {}),
      ...(config.agentMessaging?.maxPending ? { agentMessageMaxPending: config.agentMessaging.maxPending } : {}),
      ...(config.agentMessaging?.rateCapacity ? { agentMessageRateCapacity: config.agentMessaging.rateCapacity } : {}),
      ...(config.agentMessaging?.rateRefillMs ? { agentMessageRateRefillMs: config.agentMessaging.rateRefillMs } : {}),
      model: this.models,
      capabilities: this.capabilities,
      context,
      ...(modelName ? { modelName } : {}),
      ...(config.modelFallbacks?.length ? { modelFallbacks: config.modelFallbacks } : {}),
      onSessionClose: async (sessionId) => this.kernels.close(sessionId),
    });
    this.society = new AgentSocietyService(dataRoot, this.supervisor, this.agentProfiles, this.events);
    this.cognitive = new CognitiveWorkspaceService(dataRoot);
    this.worldModel = new WorldModelService(dataRoot);
    this.multiWorld = new MultiWorldModelService(dataRoot);
    this.userModel = new UserModelService(dataRoot);
    this.evolution = new SkillEvolutionService(dataRoot);
    this.environment = new EnvironmentAwarenessService(dataRoot);
    this.riskAnalyzer = new RiskAnalyzerService(dataRoot);
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
      },
    );
    this.capabilities.register(processCapability(sandboxFactory));
    for (const capability of gitCapabilities(sandboxFactory)) this.capabilities.register(capability);
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
    });
    for (const capability of constitutionCapabilities(this.constitution)) this.capabilities.register(capability);
    for (const capability of harnessCapabilities(this.harness)) this.capabilities.register(capability);
    for (const capability of microagentCapabilities(this.microagents)) this.capabilities.register(capability);
    for (const capability of riskCapabilities(this.riskAnalyzer)) this.capabilities.register(capability);
    for (const capability of stuckCapabilities(this.stuckDetector)) this.capabilities.register(capability);
    for (const capability of orchestratorCapabilities(this.acos)) this.capabilities.register(capability);
    for (const capability of insightCapabilities(this.memoryGraph)) this.capabilities.register(capability);
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
    return await this.supervisor.dispatch(command);
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

  async shutdown(): Promise<void> {
    await this.scheduler.close();
    await this.automationResponders.close();
    await this.outboundChannels.closeAll();
    this.automaticRefinement.stop();
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
