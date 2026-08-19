import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import staticPlugin from "@fastify/static";
import rawBody from "fastify-raw-body";
import formbody from "@fastify/formbody";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { dashboardHtml } from "./dashboard.js";
import { IdentityService, roleAllows, type Identity, type Role } from "./auth/identity-service.js";
import { allowlisted, PlatformJwtVerifier, verifyDiscordSignature, verifyFeishuSignature, verifyLineSignature, verifySharedSecret, verifySlackSignature, verifyWhatsAppSignature } from "./platforms/verification.js";
import {
  HybridAgentEngine,
  commandEnvelopeSchema,
  type EngineConfig,
  type AutomationTrigger,
  WorkerProcessManager,
  FleetMonitor,
  type WorkerProtocolClient,
  TelegramAdapter,
  DiscordBotAdapter,
  SlackAdapter,
  SignedWebhookAdapter,
  WhatsAppCloudAdapter,
  MatrixAdapter,
  SignalRestAdapter,
  MattermostAdapter,
  LineMessagingAdapter,
  GoogleChatAdapter,
  MicrosoftTeamsAdapter,
  FeishuAdapter,
  IrcChannelAdapter,
  EmailChannelAdapter,
  TwilioSmsAdapter,
  type CommandEnvelope,
  type InputSource,
  type JsonValue,
  type Schedule,
  type SessionSnapshot,
  transcriptAsJson,
  transcriptAsMarkdown,
  transcriptAsTrajectory,
  BrokerBackedMcpOAuthProvider,
  McpOAuthPendingNotFoundError,
  GitHubAppPendingNotFoundError,
  GitHubAppWebhookVerificationError,
  ModelOAuthPendingNotFoundError,
  ModelOAuthError,
} from "@haf/engine";

const defaultHomePath = fileURLToPath(new URL("../../../var", import.meta.url));
const defaultKernelScript = fileURLToPath(new URL("../../../python/kernel_server.py", import.meta.url));
const defaultWasiRunner = fileURLToPath(new URL("../../wasi-runner/dist/main.js", import.meta.url));
const defaultCanvasRoot = fileURLToPath(new URL("../../canvas-web/dist", import.meta.url));
const homePath = resolve(process.env.HAF_HOME ?? defaultHomePath);
const provider = process.env.HAF_MODEL_PROVIDER ?? "mock";
const parsedModelApiKeys = process.env.HAF_MODEL_API_KEYS_JSON
  ? z.array(z.union([
      z.string().min(1).transform((apiKey) => ({ apiKey })),
      z.object({ id: z.string().min(1).max(100).optional(), apiKey: z.string().min(1) }),
    ])).min(1).max(32).parse(JSON.parse(process.env.HAF_MODEL_API_KEYS_JSON))
  : undefined;
const modelApiKeys = parsedModelApiKeys?.map((credential) =>
  "id" in credential && credential.id ? { id: credential.id, apiKey: credential.apiKey } : { apiKey: credential.apiKey },
);
const modelFallbacks = (process.env.HAF_MODEL_FALLBACKS ?? "")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const environmentInteger = (name: string, fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).parse(process.env[name] ?? fallback);
const webSearchProvider = z.enum(["brave", "tavily"]).parse(process.env.HAF_WEB_SEARCH_PROVIDER ?? "brave");
const externalMemoryProvider = z.enum(["", "honcho"]).parse(process.env.HAF_MEMORY_PROVIDER ?? "");
if (provider === "openai-codex" && !process.env.HAF_MODEL_NAME) throw new Error("HAF_MODEL_NAME is required for openai-codex because the subscription catalog is account-specific.");
const model: NonNullable<EngineConfig["model"]> = provider === "mock"
  ? { provider: "mock", ...(process.env.HAF_MODEL_NAME ? { modelName: process.env.HAF_MODEL_NAME } : {}) }
  : provider === "openai-codex"
    ? {
        provider: "codex-subscription",
        modelName: process.env.HAF_MODEL_NAME!,
        ...(process.env.HAF_CODEX_REASONING_EFFORT ? { reasoningEffort: z.enum(["low", "medium", "high", "max"]).parse(process.env.HAF_CODEX_REASONING_EFFORT) } : {}),
        ...(process.env.HAF_CODEX_REQUEST_TIMEOUT_MS ? { requestTimeoutMs: environmentInteger("HAF_CODEX_REQUEST_TIMEOUT_MS", 180_000, 5_000, 600_000) } : {}),
      }
  : provider === "openai-compatible"
    ? {
        provider: "openai-compatible",
        baseUrl: process.env.HAF_MODEL_BASE_URL ?? "https://api.openai.com/v1",
        ...(process.env.HAF_MODEL_API_KEY ? { apiKey: process.env.HAF_MODEL_API_KEY } : {}),
        modelName: process.env.HAF_MODEL_NAME ?? "gpt-4.1-mini",
      }
    : {
        provider: "profile",
        profileId: provider,
        ...(process.env.HAF_MODEL_BASE_URL ? { baseUrl: process.env.HAF_MODEL_BASE_URL } : {}),
        ...(process.env.HAF_MODEL_API_KEY ? { apiKey: process.env.HAF_MODEL_API_KEY } : {}),
        ...(modelApiKeys?.length ? { apiKeys: modelApiKeys } : {}),
        ...(process.env.HAF_MODEL_NAME ? { modelName: process.env.HAF_MODEL_NAME } : {}),
        ...(process.env.HAF_MODEL_API_VERSION ? { apiVersion: process.env.HAF_MODEL_API_VERSION } : {}),
        ...(process.env.HAF_MODEL_REGION ? { region: process.env.HAF_MODEL_REGION } : {}),
      };

let learningTrustedKeys: Record<string, string> | undefined;
if (process.env.HAF_LEARNING_TRUSTED_KEYS_JSON) {
  const parsed = JSON.parse(process.env.HAF_LEARNING_TRUSTED_KEYS_JSON) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
    throw new Error("HAF_LEARNING_TRUSTED_KEYS_JSON must be a JSON object of key-id to Ed25519 public key.");
  }
  learningTrustedKeys = parsed as Record<string, string>;
}
let wasiTrustedKeys: Record<string, string> | undefined;
if (process.env.HAF_WASI_TRUSTED_KEYS_JSON) {
  const parsed = JSON.parse(process.env.HAF_WASI_TRUSTED_KEYS_JSON) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
    throw new Error("HAF_WASI_TRUSTED_KEYS_JSON must be a JSON object of key-id to Ed25519 public key.");
  }
  wasiTrustedKeys = parsed as Record<string, string>;
}
let otlpHeaders: Record<string, string> | undefined;
if (process.env.HAF_OTLP_HEADERS_JSON) {
  const parsed = JSON.parse(process.env.HAF_OTLP_HEADERS_JSON) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
    throw new Error("HAF_OTLP_HEADERS_JSON must be a JSON object of string headers.");
  }
  otlpHeaders = parsed as Record<string, string>;
}
const requestedSandbox = process.env.HAF_SANDBOX_BACKEND ?? "local";
const sandboxBackend: EngineConfig["sandboxBackend"] = (["local", "docker", "singularity", "ssh", "modal", "daytona", "vercel", "kubernetes"] as const).includes(requestedSandbox as any)
  ? requestedSandbox as EngineConfig["sandboxBackend"]
  : "local";
const cloudSandbox = (["modal", "daytona", "vercel", "kubernetes"] as string[]).includes(sandboxBackend);
if (sandboxBackend === "ssh" && !process.env.HAF_SSH_HOST) throw new Error("HAF_SSH_HOST is required for the SSH sandbox.");
if (sandboxBackend === "singularity" && !process.env.HAF_SINGULARITY_IMAGE) throw new Error("HAF_SINGULARITY_IMAGE is required for the Singularity sandbox.");
if (cloudSandbox && !process.env.HAF_CLOUD_SANDBOX_GATEWAY) throw new Error("HAF_CLOUD_SANDBOX_GATEWAY is required for cloud sandbox backends.");
const engine = new HybridAgentEngine({
  homePath,
  kernelServerScript: resolve(process.env.HAF_KERNEL_SERVER ?? defaultKernelScript),
  sandboxBackend,
  ...(sandboxBackend === "ssh"
    ? {
        sshSandbox: {
          host: process.env.HAF_SSH_HOST!,
          ...(process.env.HAF_SSH_USER ? { user: process.env.HAF_SSH_USER } : {}),
          ...(process.env.HAF_SSH_PORT ? { port: Number(process.env.HAF_SSH_PORT) } : {}),
          ...(process.env.HAF_SSH_IDENTITY_FILE ? { identityFile: process.env.HAF_SSH_IDENTITY_FILE } : {}),
          ...(process.env.HAF_SSH_REMOTE_ROOT ? { remoteRoot: process.env.HAF_SSH_REMOTE_ROOT } : {}),
          syncFiles: process.env.HAF_SSH_SYNC_FILES !== "false",
        },
      }
    : {}),
  ...(sandboxBackend === "singularity"
    ? {
        singularitySandbox: {
          image: process.env.HAF_SINGULARITY_IMAGE!,
          ...(process.env.HAF_SINGULARITY_EXECUTABLE ? { executable: process.env.HAF_SINGULARITY_EXECUTABLE } : {}),
          ...(process.env.HAF_SINGULARITY_IMAGE_SHA256 ? { imageSha256: process.env.HAF_SINGULARITY_IMAGE_SHA256 } : {}),
          allowUnpinnedImage: process.env.HAF_SINGULARITY_ALLOW_UNPINNED === "true",
          network: process.env.HAF_SINGULARITY_NETWORK === "host" ? "host" : "none",
        },
      }
    : {}),
  ...(cloudSandbox
    ? {
        cloudSandbox: {
          provider: sandboxBackend as "modal" | "daytona" | "vercel" | "kubernetes",
          endpoint: process.env.HAF_CLOUD_SANDBOX_GATEWAY!,
          ...(process.env.HAF_CLOUD_SANDBOX_TOKEN ? { bearerToken: process.env.HAF_CLOUD_SANDBOX_TOKEN } : {}),
          ...(process.env.HAF_CLOUD_SANDBOX_TEMPLATE ? { template: process.env.HAF_CLOUD_SANDBOX_TEMPLATE } : {}),
          networkPolicy: (process.env.HAF_CLOUD_SANDBOX_NETWORK_POLICY as "none" | "allowlist" | "unrestricted" | undefined) ?? "none",
          ...(process.env.HAF_CLOUD_SANDBOX_ALLOWED_HOSTS ? { allowedHosts: process.env.HAF_CLOUD_SANDBOX_ALLOWED_HOSTS.split(",").map((value) => value.trim()).filter(Boolean) } : {}),
        },
      }
    : {}),
  autoApproveWorkspaceWrites: process.env.HAF_AUTO_APPROVE_WORKSPACE === "true",
  allowProcessExecution: process.env.HAF_ALLOW_PROCESS === "true",
  autoRefineEveryTurns: environmentInteger("HAF_AUTO_REFINE_EVERY_TURNS", 0, 0, 10_000),
  repositoryImport: {
    maxFiles: environmentInteger("HAF_REPOSITORY_MAX_FILES", 100_000, 1, 1_000_000),
    maxBytes: environmentInteger("HAF_REPOSITORY_MAX_BYTES", 2_147_483_648, 1_000_000, 20_000_000_000),
    timeoutMs: environmentInteger("HAF_REPOSITORY_TIMEOUT_MS", 300_000, 1000, 3_600_000),
  },
  agentMessaging: {
    maxChars: environmentInteger("HAF_AGENT_MESSAGE_MAX_CHARS", 16_384, 1, 100_000),
    maxPending: environmentInteger("HAF_AGENT_MESSAGE_MAX_PENDING", 20, 1, 1000),
    rateCapacity: environmentInteger("HAF_AGENT_MESSAGE_RATE_CAPACITY", 3, 1, 1000),
    rateRefillMs: environmentInteger("HAF_AGENT_MESSAGE_RATE_REFILL_MS", 1000, 10, 3_600_000),
  },
  ...(process.env.HAF_MODEL_OAUTH_REDIRECT_URI ? { modelOAuthRedirectUri: process.env.HAF_MODEL_OAUTH_REDIRECT_URI } : {}),
  context: {
    maxMessageChars: environmentInteger("HAF_CONTEXT_MAX_CHARS", 80_000, 10_000, 2_000_000),
    rollingMicroCompaction: process.env.HAF_ROLLING_MICRO_COMPACTION !== "false",
    microCompaction: {
      protectedTailChars: environmentInteger("HAF_MICRO_COMPACTION_TAIL_CHARS", 36_000, 1_000, 2_000_000),
      maxMessagesPerWindow: environmentInteger("HAF_MICRO_COMPACTION_WINDOW_MESSAGES", 12, 2, 100),
      maxSummaryChars: environmentInteger("HAF_MICRO_COMPACTION_SUMMARY_CHARS", 1_200, 300, 8_000),
      maxCachedWindows: environmentInteger("HAF_MICRO_COMPACTION_CACHE_WINDOWS", 500, 10, 2_000),
    },
  },
  ...(externalMemoryProvider === "honcho" ? {
    externalMemory: {
      provider: "honcho" as const,
      ...(process.env.HONCHO_API_KEY ? { apiKey: process.env.HONCHO_API_KEY } : {}),
      ...(process.env.HONCHO_URL ? { baseURL: process.env.HONCHO_URL } : {}),
      ...(process.env.HONCHO_WORKSPACE_ID ? { workspaceId: process.env.HONCHO_WORKSPACE_ID } : {}),
      ...(process.env.HAF_HONCHO_USER_PEER ? { userPeer: process.env.HAF_HONCHO_USER_PEER } : {}),
      ...(process.env.HAF_HONCHO_ASSISTANT_PEER ? { assistantPeer: process.env.HAF_HONCHO_ASSISTANT_PEER } : {}),
      recallMode: z.enum(["hybrid", "context", "tools"]).parse(process.env.HAF_HONCHO_RECALL_MODE ?? "hybrid"),
      contextTokens: environmentInteger("HAF_HONCHO_CONTEXT_TOKENS", 2_000, 100, 20_000),
      contextCadence: environmentInteger("HAF_HONCHO_CONTEXT_CADENCE", 1, 1, 100),
      messageMaxChars: environmentInteger("HAF_HONCHO_MESSAGE_MAX_CHARS", 25_000, 1_000, 25_000),
      timeoutMs: environmentInteger("HAF_HONCHO_TIMEOUT_MS", 8_000, 500, 60_000),
      maxRetries: environmentInteger("HAF_HONCHO_MAX_RETRIES", 0, 0, 5),
      allowSelfHosted: process.env.HAF_HONCHO_ALLOW_SELF_HOSTED === "true",
      allowPrivateBaseUrl: process.env.HAF_HONCHO_ALLOW_PRIVATE_BASE_URL === "true",
    },
  } : {}),
  ...(process.env.HAF_MASTER_KEY ? { masterKey: process.env.HAF_MASTER_KEY } : {}),
  ...(process.env.HAF_VAULT_ADDRESS && process.env.HAF_VAULT_TOKEN
    ? {
        vault: {
          address: process.env.HAF_VAULT_ADDRESS,
          token: process.env.HAF_VAULT_TOKEN,
          ...(process.env.HAF_VAULT_NAMESPACE ? { namespace: process.env.HAF_VAULT_NAMESPACE } : {}),
          ...(process.env.HAF_VAULT_MOUNT ? { mount: process.env.HAF_VAULT_MOUNT } : {}),
          ...(process.env.HAF_VAULT_PREFIX ? { prefix: process.env.HAF_VAULT_PREFIX } : {}),
        },
      }
    : {}),
  ...(process.env.HAF_EMBEDDING_API_KEY
    ? {
        embeddings: {
          apiKey: process.env.HAF_EMBEDDING_API_KEY,
          ...(process.env.HAF_EMBEDDING_BASE_URL ? { baseUrl: process.env.HAF_EMBEDDING_BASE_URL } : {}),
          ...(process.env.HAF_EMBEDDING_MODEL ? { model: process.env.HAF_EMBEDDING_MODEL } : {}),
          ...(process.env.HAF_EMBEDDING_DIMENSIONS ? { dimensions: Number(process.env.HAF_EMBEDDING_DIMENSIONS) } : {}),
        },
      }
    : {}),
  ...(process.env.HAF_POSTGRES_URL
    ? {
        postgres: {
          connectionString: process.env.HAF_POSTGRES_URL,
          schema: process.env.HAF_POSTGRES_SCHEMA ?? "haf",
          enableNotify: process.env.HAF_POSTGRES_NOTIFY !== "false",
          enableRls: process.env.HAF_POSTGRES_RLS === "true",
        },
      }
    : {}),
  ...(process.env.HAF_NATS_SERVERS
    ? {
        nats: {
          servers: process.env.HAF_NATS_SERVERS.split(",").map((value) => value.trim()).filter(Boolean),
          ...(process.env.HAF_NATS_TOKEN ? { token: process.env.HAF_NATS_TOKEN } : {}),
          ...(process.env.HAF_NATS_USER ? { user: process.env.HAF_NATS_USER } : {}),
          ...(process.env.HAF_NATS_PASS ? { pass: process.env.HAF_NATS_PASS } : {}),
          prefix: process.env.HAF_NATS_PREFIX ?? "haf",
        },
      }
    : {}),
  ...(learningTrustedKeys ? { learningTrustedKeys } : {}),
  ...(process.env.HAF_HOSTED_SCHEDULER_PORTAL_URL && process.env.HAF_HOSTED_SCHEDULER_ACCESS_TOKEN && process.env.HAF_HOSTED_SCHEDULER_CALLBACK_URL && process.env.HAF_HOSTED_SCHEDULER_AUDIENCE && process.env.HAF_HOSTED_SCHEDULER_ISSUER && process.env.HAF_HOSTED_SCHEDULER_JWKS_URL
    ? { hostedScheduler: {
        portalUrl: process.env.HAF_HOSTED_SCHEDULER_PORTAL_URL,
        accessToken: process.env.HAF_HOSTED_SCHEDULER_ACCESS_TOKEN,
        callbackUrl: process.env.HAF_HOSTED_SCHEDULER_CALLBACK_URL,
        expectedAudience: process.env.HAF_HOSTED_SCHEDULER_AUDIENCE,
        issuer: process.env.HAF_HOSTED_SCHEDULER_ISSUER,
        jwksUrl: process.env.HAF_HOSTED_SCHEDULER_JWKS_URL,
      } }
    : {}),
  ...(wasiTrustedKeys
    ? {
        wasiPlugins: {
          runnerPath: process.env.HAF_WASI_RUNNER_PATH ?? defaultWasiRunner,
          trustedPublicKeys: wasiTrustedKeys,
          defaultTimeoutMs: Number(process.env.HAF_WASI_TIMEOUT_MS ?? 5000),
          maxOutputBytes: Number(process.env.HAF_WASI_MAX_OUTPUT_BYTES ?? 1024 * 1024),
        },
      }
    : {}),
  ...(process.env.HAF_OPA_ENDPOINT
    ? {
        opa: {
          endpoint: process.env.HAF_OPA_ENDPOINT,
          ...(process.env.HAF_OPA_BEARER_TOKEN ? { bearerToken: process.env.HAF_OPA_BEARER_TOKEN } : {}),
          timeoutMs: Number(process.env.HAF_OPA_TIMEOUT_MS ?? 3000),
        },
      }
    : {}),
  ...(process.env.HAF_AUDIO_API_KEY
    ? {
        audio: {
          apiKey: process.env.HAF_AUDIO_API_KEY,
          ...(process.env.HAF_AUDIO_BASE_URL ? { baseUrl: process.env.HAF_AUDIO_BASE_URL } : {}),
          ...(process.env.HAF_STT_MODEL ? { transcriptionModel: process.env.HAF_STT_MODEL } : {}),
          ...(process.env.HAF_TTS_MODEL ? { speechModel: process.env.HAF_TTS_MODEL } : {}),
          ...(process.env.HAF_TTS_VOICE ? { defaultVoice: process.env.HAF_TTS_VOICE } : {}),
        },
      }
    : {}),
  ...(process.env.HAF_IMAGE_API_KEY
    ? {
        images: {
          apiKey: process.env.HAF_IMAGE_API_KEY,
          ...(process.env.HAF_IMAGE_BASE_URL ? { baseUrl: process.env.HAF_IMAGE_BASE_URL } : {}),
          ...(process.env.HAF_IMAGE_MODEL ? { model: process.env.HAF_IMAGE_MODEL } : {}),
          ...(process.env.HAF_IMAGE_QUALITY ? { quality: z.enum(["low", "medium", "high", "auto"]).parse(process.env.HAF_IMAGE_QUALITY) } : {}),
          ...(process.env.HAF_IMAGE_MAX_BYTES ? { maxImageBytes: Number(process.env.HAF_IMAGE_MAX_BYTES) } : {}),
          allowRemoteImageUrls: process.env.HAF_IMAGE_ALLOW_REMOTE_URLS === "true",
        },
      }
    : {}),
  ...(process.env.HAF_FAL_IMAGE_API_KEY && process.env.HAF_FAL_IMAGE_MODEL
    ? {
        falImages: {
          apiKey: process.env.HAF_FAL_IMAGE_API_KEY,
          model: process.env.HAF_FAL_IMAGE_MODEL,
          ...(process.env.HAF_FAL_IMAGE_EDIT_MODEL ? { editModel: process.env.HAF_FAL_IMAGE_EDIT_MODEL } : {}),
          ...(process.env.HAF_FAL_IMAGE_BASE_URL ? { baseUrl: process.env.HAF_FAL_IMAGE_BASE_URL } : {}),
        },
      }
    : {}),
  ...(process.env.HAF_IMAGE_UPSCALE_API_KEY && process.env.HAF_IMAGE_UPSCALE_MODEL
    ? {
        imageUpscale: {
          apiKey: process.env.HAF_IMAGE_UPSCALE_API_KEY,
          model: process.env.HAF_IMAGE_UPSCALE_MODEL,
          ...(process.env.HAF_IMAGE_UPSCALE_BASE_URL ? { baseUrl: process.env.HAF_IMAGE_UPSCALE_BASE_URL } : {}),
        },
      }
    : {}),
  ...(process.env.HAF_VIDEO_API_KEY && process.env.HAF_VIDEO_MODEL
    ? {
        video: {
          apiKey: process.env.HAF_VIDEO_API_KEY,
          model: process.env.HAF_VIDEO_MODEL,
          ...(process.env.HAF_VIDEO_BASE_URL ? { baseUrl: process.env.HAF_VIDEO_BASE_URL } : {}),
          ...(process.env.HAF_VIDEO_MAX_BYTES ? { maxVideoBytes: environmentInteger("HAF_VIDEO_MAX_BYTES", 104_857_600, 1_000_000, 1_000_000_000) } : {}),
          allowRemoteVideoUrls: process.env.HAF_VIDEO_ALLOW_REMOTE_URLS === "true",
        },
      }
    : {}),
  ...(process.env.HAF_VIDEO_UPSCALE_API_KEY && process.env.HAF_VIDEO_UPSCALE_MODEL
    ? {
        videoUpscale: {
          apiKey: process.env.HAF_VIDEO_UPSCALE_API_KEY,
          model: process.env.HAF_VIDEO_UPSCALE_MODEL,
          ...(process.env.HAF_VIDEO_UPSCALE_BASE_URL ? { baseUrl: process.env.HAF_VIDEO_UPSCALE_BASE_URL } : {}),
        },
      }
    : {}),
  ...(process.env.HAF_VIDEO_QUEUE_API_KEY && process.env.HAF_VIDEO_QUEUE_MODEL
    ? {
        queuedVideo: {
          apiKey: process.env.HAF_VIDEO_QUEUE_API_KEY,
          model: process.env.HAF_VIDEO_QUEUE_MODEL,
          ...(process.env.HAF_VIDEO_QUEUE_BASE_URL ? { baseUrl: process.env.HAF_VIDEO_QUEUE_BASE_URL } : {}),
        },
      }
    : {}),
  ...(process.env.HAF_WEB_SEARCH_API_KEY
    ? {
        webSearch: webSearchProvider === "tavily"
          ? {
              provider: "tavily" as const,
              apiKey: process.env.HAF_WEB_SEARCH_API_KEY,
              ...(process.env.HAF_WEB_SEARCH_BASE_URL ? { baseUrl: process.env.HAF_WEB_SEARCH_BASE_URL } : {}),
              searchDepth: process.env.HAF_WEB_SEARCH_DEPTH === "advanced" ? "advanced" as const : "basic" as const,
            }
          : {
              provider: "brave" as const,
              apiKey: process.env.HAF_WEB_SEARCH_API_KEY,
              ...(process.env.HAF_WEB_SEARCH_BASE_URL ? { baseUrl: process.env.HAF_WEB_SEARCH_BASE_URL } : {}),
              ...(process.env.HAF_WEB_SEARCH_COUNTRY ? { country: process.env.HAF_WEB_SEARCH_COUNTRY } : {}),
              ...(process.env.HAF_WEB_SEARCH_LANGUAGE ? { language: process.env.HAF_WEB_SEARCH_LANGUAGE } : {}),
            },
      }
    : {}),
  ...((process.env.HAF_BROWSER_CDP_ENDPOINT || process.env.HAF_BROWSER_EXECUTABLE_PATH)
    ? {
        browser: {
          ...(process.env.HAF_BROWSER_CDP_ENDPOINT ? { cdpEndpoint: process.env.HAF_BROWSER_CDP_ENDPOINT } : {}),
          ...(process.env.HAF_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.HAF_BROWSER_EXECUTABLE_PATH } : {}),
          headless: process.env.HAF_BROWSER_HEADLESS !== "false",
          allowPrivateCdpEndpoint: process.env.HAF_BROWSER_ALLOW_PRIVATE_CDP === "true",
        },
      }
    : {}),
  ...(process.env.HAF_OTLP_ENDPOINT
    ? {
        otlp: {
          endpoint: process.env.HAF_OTLP_ENDPOINT,
          ...(otlpHeaders ? { headers: otlpHeaders } : {}),
          intervalMs: Number(process.env.HAF_OTLP_INTERVAL_MS ?? 60_000),
          serviceVersion: "1.38.0",
        },
      }
    : {}),
  ...(modelFallbacks.length ? { modelFallbacks } : {}),
  model,
});
if (process.env.TELEGRAM_BOT_TOKEN) engine.outboundChannels.register(new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN));
if (process.env.DISCORD_BOT_TOKEN) engine.outboundChannels.register(new DiscordBotAdapter(process.env.DISCORD_BOT_TOKEN));
if (process.env.SLACK_BOT_TOKEN) engine.outboundChannels.register(new SlackAdapter(process.env.SLACK_BOT_TOKEN));
if (process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
  engine.outboundChannels.register(new WhatsAppCloudAdapter(process.env.WHATSAPP_CLOUD_TOKEN, process.env.WHATSAPP_PHONE_NUMBER_ID));
}
if (process.env.MATRIX_HOMESERVER && process.env.MATRIX_ACCESS_TOKEN) {
  engine.outboundChannels.register(new MatrixAdapter(process.env.MATRIX_HOMESERVER, process.env.MATRIX_ACCESS_TOKEN));
}
if (process.env.SIGNAL_REST_URL && process.env.SIGNAL_SENDER_NUMBER) {
  engine.outboundChannels.register(new SignalRestAdapter(
    process.env.SIGNAL_REST_URL,
    process.env.SIGNAL_SENDER_NUMBER,
    process.env.SIGNAL_REST_TOKEN,
  ));
}
if (process.env.MATTERMOST_URL && process.env.MATTERMOST_BOT_TOKEN) {
  engine.outboundChannels.register(new MattermostAdapter(process.env.MATTERMOST_URL, process.env.MATTERMOST_BOT_TOKEN, process.env.MATTERMOST_ALLOW_LOOPBACK_HTTP === "true"));
}
if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
  engine.outboundChannels.register(new LineMessagingAdapter(process.env.LINE_CHANNEL_ACCESS_TOKEN, process.env.LINE_API_BASE));
}
if (process.env.GOOGLE_CHAT_ACCESS_TOKEN) {
  engine.outboundChannels.register(new GoogleChatAdapter(process.env.GOOGLE_CHAT_ACCESS_TOKEN, process.env.GOOGLE_CHAT_API_BASE));
}
if (process.env.TEAMS_ACCESS_TOKEN) {
  engine.outboundChannels.register(new MicrosoftTeamsAdapter(process.env.TEAMS_ACCESS_TOKEN, process.env.TEAMS_GRAPH_BASE));
}
if (process.env.FEISHU_TENANT_ACCESS_TOKEN) {
  engine.outboundChannels.register(new FeishuAdapter(process.env.FEISHU_TENANT_ACCESS_TOKEN, process.env.FEISHU_API_BASE));
}
if (process.env.IRC_HOST) {
  if (!process.env.IRC_NICKNAME) throw new Error("IRC_NICKNAME is required when IRC_HOST is configured.");
  const channels = (process.env.IRC_CHANNELS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowedNicknames = (process.env.IRC_ALLOWED_NICKNAMES ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowedAccounts = (process.env.IRC_ALLOWED_ACCOUNTS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!channels.length) throw new Error("IRC_CHANNELS requires at least one channel.");
  if (!allowedNicknames.length && !allowedAccounts.length) throw new Error("IRC requires IRC_ALLOWED_NICKNAMES or IRC_ALLOWED_ACCOUNTS.");
  if (Boolean(process.env.IRC_SASL_ACCOUNT) !== Boolean(process.env.IRC_SASL_PASSWORD)) throw new Error("IRC SASL requires both IRC_SASL_ACCOUNT and IRC_SASL_PASSWORD.");
  let ircTlsCa: Buffer | undefined;
  if (process.env.IRC_TLS_CA_PATH) {
    ircTlsCa = await readFile(resolve(process.env.IRC_TLS_CA_PATH));
    if (ircTlsCa.length > 1024 * 1024 || !ircTlsCa.toString("utf8").includes("-----BEGIN CERTIFICATE-----")) throw new Error("IRC_TLS_CA_PATH must reference a bounded PEM certificate bundle.");
  }
  engine.outboundChannels.register(new IrcChannelAdapter({
    gateway: engine.channels,
    tenantId: process.env.IRC_TENANT_ID ?? "local",
    host: process.env.IRC_HOST,
    port: environmentInteger("IRC_PORT", process.env.IRC_TLS === "false" ? 6667 : 6697, 1, 65535),
    tls: process.env.IRC_TLS !== "false",
    allowPlaintext: process.env.IRC_ALLOW_PLAINTEXT === "true",
    allowPrivateHost: process.env.IRC_ALLOW_PRIVATE_HOST === "true",
    ...(ircTlsCa ? { tlsCa: ircTlsCa } : {}),
    nickname: process.env.IRC_NICKNAME,
    ...(process.env.IRC_USERNAME ? { username: process.env.IRC_USERNAME } : {}),
    ...(process.env.IRC_REAL_NAME ? { realName: process.env.IRC_REAL_NAME } : {}),
    channels,
    allowedNicknames,
    allowedAccounts,
    ...(process.env.IRC_SERVER_PASSWORD ? { serverPassword: process.env.IRC_SERVER_PASSWORD } : {}),
    ...(process.env.IRC_SASL_ACCOUNT && process.env.IRC_SASL_PASSWORD ? { sasl: { account: process.env.IRC_SASL_ACCOUNT, password: process.env.IRC_SASL_PASSWORD } } : {}),
    reconnectMinMs: environmentInteger("IRC_RECONNECT_MIN_MS", 1000, 100, 60_000),
    reconnectMaxMs: environmentInteger("IRC_RECONNECT_MAX_MS", 60_000, 100, 600_000),
    outboundIntervalMs: environmentInteger("IRC_OUTBOUND_INTERVAL_MS", 800, 0, 10_000),
  }));
}
const emailRequested = Boolean(process.env.EMAIL_SMTP_HOST || process.env.EMAIL_IMAP_HOST);
if (emailRequested) {
  for (const name of ["EMAIL_SMTP_HOST", "EMAIL_SMTP_USERNAME", "EMAIL_SMTP_PASSWORD", "EMAIL_FROM_ADDRESS"] as const) {
    if (!process.env[name]) throw new Error(`${name} is required when email transport is configured.`);
  }
  const allowedRecipients = (process.env.EMAIL_ALLOWED_RECIPIENTS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowedSenders = (process.env.EMAIL_ALLOWED_SENDERS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!allowedRecipients.length) throw new Error("EMAIL_ALLOWED_RECIPIENTS requires at least one address.");
  if (process.env.EMAIL_IMAP_HOST && (!process.env.EMAIL_IMAP_USERNAME || !process.env.EMAIL_IMAP_PASSWORD || !process.env.EMAIL_INBOUND_TOKEN || !allowedSenders.length)) {
    throw new Error("Inbound email requires IMAP username/password, EMAIL_INBOUND_TOKEN and EMAIL_ALLOWED_SENDERS.");
  }
  const readEmailCa = async (environmentVariable: string): Promise<Buffer | undefined> => {
    const path = process.env[environmentVariable];
    if (!path) return undefined;
    const data = await readFile(resolve(path));
    if (data.length > 1024 * 1024 || !data.toString("utf8").includes("-----BEGIN CERTIFICATE-----")) throw new Error(`${environmentVariable} must reference a bounded PEM certificate bundle.`);
    return data;
  };
  const smtpCa = await readEmailCa("EMAIL_SMTP_TLS_CA_PATH");
  const imapCa = await readEmailCa("EMAIL_IMAP_TLS_CA_PATH");
  const smtpSecure = process.env.EMAIL_SMTP_SECURE === "true";
  const imapSecure = process.env.EMAIL_IMAP_SECURE !== "false";
  engine.outboundChannels.register(new EmailChannelAdapter({
    stateRoot: resolve(homePath, "data"), gateway: engine.channels,
    tenantId: process.env.EMAIL_TENANT_ID ?? "local",
    smtp: {
      host: process.env.EMAIL_SMTP_HOST!,
      port: environmentInteger("EMAIL_SMTP_PORT", smtpSecure ? 465 : 587, 1, 65535),
      secure: smtpSecure, username: process.env.EMAIL_SMTP_USERNAME!, password: process.env.EMAIL_SMTP_PASSWORD!,
      fromAddress: process.env.EMAIL_FROM_ADDRESS!,
      ...(process.env.EMAIL_FROM_NAME ? { fromName: process.env.EMAIL_FROM_NAME } : {}),
      ...(smtpCa ? { tlsCa: smtpCa } : {}),
    },
    ...(process.env.EMAIL_IMAP_HOST ? { imap: {
      host: process.env.EMAIL_IMAP_HOST,
      port: environmentInteger("EMAIL_IMAP_PORT", imapSecure ? 993 : 143, 1, 65535),
      secure: imapSecure, username: process.env.EMAIL_IMAP_USERNAME!, password: process.env.EMAIL_IMAP_PASSWORD!,
      mailbox: process.env.EMAIL_IMAP_MAILBOX ?? "INBOX", inboundToken: process.env.EMAIL_INBOUND_TOKEN!,
      recipientAddresses: (process.env.EMAIL_INBOUND_RECIPIENTS ?? process.env.EMAIL_FROM_ADDRESS!).split(",").map((item) => item.trim()).filter(Boolean),
      initialSync: process.env.EMAIL_INITIAL_SYNC === "all" ? "all" as const : "latest" as const,
      ...(imapCa ? { tlsCa: imapCa } : {}),
    } } : {}),
    allowedRecipients, allowedSenders,
    allowPrivateHost: process.env.EMAIL_ALLOW_PRIVATE_HOST === "true",
    pollIntervalMs: environmentInteger("EMAIL_POLL_INTERVAL_MS", 30_000, 1000, 600_000),
    reconnectMinMs: environmentInteger("EMAIL_RECONNECT_MIN_MS", 1000, 100, 60_000),
    reconnectMaxMs: environmentInteger("EMAIL_RECONNECT_MAX_MS", 60_000, 100, 600_000),
    connectTimeoutMs: environmentInteger("EMAIL_CONNECT_TIMEOUT_MS", 15_000, 1000, 120_000),
    maxMessageBytes: environmentInteger("EMAIL_MAX_MESSAGE_BYTES", 2_097_152, 1024, 20_971_520),
    maxBodyChars: environmentInteger("EMAIL_MAX_BODY_CHARS", 20_000, 1000, 100_000),
    maxMessagesPerPoll: environmentInteger("EMAIL_MAX_MESSAGES_PER_POLL", 50, 1, 500),
    autoReply: process.env.EMAIL_AUTO_REPLY !== "false",
  }));
}
let twilioSmsAdapter: TwilioSmsAdapter | undefined;
const twilioRequested = Boolean(process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_FROM_NUMBER);
if (twilioRequested) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
    throw new Error("Twilio SMS requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.");
  }
  const allowedNumbers = (process.env.TWILIO_ALLOWED_NUMBERS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!allowedNumbers.length) throw new Error("TWILIO_ALLOWED_NUMBERS requires at least one E.164 number.");
  twilioSmsAdapter = new TwilioSmsAdapter({
    stateRoot: resolve(homePath, "data"), gateway: engine.channels,
    tenantId: process.env.TWILIO_TENANT_ID ?? "local",
    accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER, allowedNumbers,
    ...(process.env.TWILIO_WEBHOOK_URL ? { webhookUrl: process.env.TWILIO_WEBHOOK_URL } : {}),
    ...(process.env.TWILIO_API_BASE ? { apiBase: process.env.TWILIO_API_BASE } : {}),
  });
  engine.outboundChannels.register(twilioSmsAdapter);
}
if (process.env.HAF_OUTBOUND_WEBHOOK_URL && process.env.HAF_OUTBOUND_WEBHOOK_SECRET) {
  engine.outboundChannels.register(new SignedWebhookAdapter(
    "webhook",
    process.env.HAF_OUTBOUND_WEBHOOK_URL,
    process.env.HAF_OUTBOUND_WEBHOOK_SECRET,
  ));
}
await engine.initialize();
engine.start();
const detachedWorkerEntrypoint = fileURLToPath(new URL("../../session-worker/dist/main.js", import.meta.url));
const detachedWorkers = new WorkerProcessManager(resolve(homePath, "data", "worker-control"));
const fleetMonitor = new FleetMonitor(engine.metrics, engine.scheduler, engine.approvals, {
  workerProbe: async () => {
    const workers = await detachedWorkers.adoptAll(false);
    return {
      running: workers.filter((item) => item.status === "adopted").length,
      recovered: workers.filter((item) => item.status === "recovered").length,
      stale: workers.filter((item) => item.status === "stale").length,
      unreachable: 0,
    };
  },
  capabilityFailureRateWarning: Number(process.env.HAF_ALERT_CAPABILITY_FAILURE_RATE ?? 0.2),
  approvalAgeWarningSeconds: Number(process.env.HAF_ALERT_APPROVAL_AGE_SECONDS ?? 300),
});

const googleChatJwtVerifier = process.env.GOOGLE_CHAT_AUDIENCE
  ? new PlatformJwtVerifier({
      audience: process.env.GOOGLE_CHAT_AUDIENCE,
      issuers: ["https://accounts.google.com", "accounts.google.com"],
      jwksUrl: process.env.GOOGLE_CHAT_JWKS_URL ?? "https://www.googleapis.com/oauth2/v3/certs",
    })
  : undefined;
const teamsJwtVerifier = process.env.TEAMS_APP_ID && process.env.TEAMS_JWT_ISSUER && process.env.TEAMS_JWKS_URL
  ? new PlatformJwtVerifier({
      audience: process.env.TEAMS_APP_ID,
      issuers: process.env.TEAMS_JWT_ISSUER.split(",").map((item) => item.trim()).filter(Boolean),
      jwksUrl: process.env.TEAMS_JWKS_URL,
    })
  : undefined;
const app = Fastify({ logger: true, bodyLimit: 4 * 1024 * 1024 });
await app.register(cors, {
  origin: process.env.HAF_CORS_ORIGIN ? process.env.HAF_CORS_ORIGIN.split(",") : false,
  credentials: true,
});
await app.register(cookie);
await app.register(formbody, { bodyLimit: 1024 * 1024 });
await app.register(rawBody, { field: "rawBody", global: true, encoding: false, runFirst: true });
const canvasRoot = resolve(process.env.HAF_CANVAS_ROOT ?? defaultCanvasRoot);
await app.register(staticPlugin, {
  root: canvasRoot,
  prefix: "/canvas/",
  wildcard: false,
  index: ["index.html"],
  cacheControl: true,
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
});
app.addHook("onSend", async (request, reply, payload) => {
  if (request.url.startsWith("/canvas")) {
    reply.header("content-security-policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  }
  return payload;
});

const apiToken = process.env.HAF_API_TOKEN?.trim();
const oidcConfigured = Boolean(process.env.HAF_OIDC_ISSUER && process.env.HAF_OIDC_CLIENT_ID && process.env.HAF_OIDC_REDIRECT_URI);
const authDisabled = process.env.HAF_AUTH_DISABLED === "true" || (!apiToken && !oidcConfigured);
const sessionSecret = process.env.HAF_SESSION_SECRET ?? apiToken ?? (authDisabled ? "development-only-session-secret-change-me" : "");
if (!sessionSecret) throw new Error("HAF_SESSION_SECRET is required when authentication is enabled.");
const cookieName = process.env.HAF_SESSION_COOKIE_NAME ?? "haf_session";
const identityService = new IdentityService({
  sessionFile: resolve(homePath, "data", "auth", "sessions.enc"),
  sessionSecret,
  sessionTtlMs: Number(process.env.HAF_SESSION_TTL_MS ?? 8 * 60 * 60_000),
  ...(apiToken ? { apiToken } : {}),
  authDisabled,
  defaultTenant: process.env.HAF_DEFAULT_TENANT ?? "local",
  ...(oidcConfigured
    ? {
        oidc: {
          issuer: process.env.HAF_OIDC_ISSUER!,
          clientId: process.env.HAF_OIDC_CLIENT_ID!,
          ...(process.env.HAF_OIDC_CLIENT_SECRET ? { clientSecret: process.env.HAF_OIDC_CLIENT_SECRET } : {}),
          redirectUri: process.env.HAF_OIDC_REDIRECT_URI!,
          ...(process.env.HAF_OIDC_SCOPES ? { scopes: process.env.HAF_OIDC_SCOPES.split(" ").filter(Boolean) } : {}),
          ...(process.env.HAF_OIDC_TENANT_CLAIM ? { tenantClaim: process.env.HAF_OIDC_TENANT_CLAIM } : {}),
          ...(process.env.HAF_OIDC_ROLE_CLAIM ? { roleClaim: process.env.HAF_OIDC_ROLE_CLAIM } : {}),
        },
      }
    : {}),
});
const requestIdentity = new WeakMap<object, Identity>();
const requestWebSession = new WeakMap<object, Awaited<ReturnType<IdentityService["getSession"]>>>();
const publicWebhook = (url: string) =>
  /^\/v1\/automations\/[^/]+\/webhook(?:\?|$)/.test(url) ||
  /^\/v1\/automation-responders\/[^/]+\/(?:heartbeat|events)(?:\?|$)/.test(url) ||
  /^\/v1\/cron\/fire(?:\?|$)/.test(url) ||
  /^\/v1\/platforms\/(?:telegram|slack|discord|whatsapp|signal|matrix|mattermost|line|google-chat|teams|feishu|github-app|twilio)\/webhook(?:\?|$)/.test(url);
const publicRoute = (url: string) =>
  url === "/" || url.startsWith("/canvas") || url.startsWith("/health") || url.startsWith("/auth/") || publicWebhook(url);

app.addHook("onRequest", async (request, reply) => {
  const authorization = request.headers.authorization;
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  let identity = identityService.apiTokenIdentity(bearer);
  let webSession;
  if (!identity) {
    webSession = await identityService.getSession(request.cookies[cookieName]);
    identity = webSession?.identity;
  }
  identity ??= identityService.anonymousIdentity();
  if (identity) requestIdentity.set(request, identity);
  if (webSession) requestWebSession.set(request, webSession);
  if (!publicRoute(request.url) && !identity) {
    return await reply.code(401).send({ error: "unauthorized", login: oidcConfigured ? "/auth/oidc/start" : "/auth/login/token" });
  }
});

app.addHook("preHandler", async (request, reply) => {
  if (!request.url.startsWith("/v1") || publicWebhook(request.url)) return;
  const identity = requestIdentity.get(request);
  if (!identity) return await reply.code(401).send({ error: "unauthorized" });
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const query = request.query && typeof request.query === "object" ? request.query as Record<string, unknown> : {};
  let tenantId = String(request.headers["x-haf-tenant"] ?? body.tenantId ?? query.tenantId ?? process.env.HAF_DEFAULT_TENANT ?? "local");
  const sessionMatch = request.url.match(/^\/v1\/sessions\/([^/?]+)/);
  if (sessionMatch) tenantId = (await engine.session(decodeURIComponent(sessionMatch[1]!))).tenantId;
  const automationMatch = request.url.match(/^\/v1\/automations\/([^/?]+)/);
  if (automationMatch) tenantId = (await engine.automations.get(decodeURIComponent(automationMatch[1]!))).tenantId;
  const learningMatch = request.url.match(/^\/v1\/learning\/candidates\/([^/?]+)/);
  if (learningMatch) tenantId = (await engine.learning.get(decodeURIComponent(learningMatch[1]!))).tenantId;
  const refinementMatch = request.url.match(/^\/v1\/learning\/refinements\/([^/?]+)/);
  if (refinementMatch && refinementMatch[1] !== "plan") tenantId = (await engine.refinements.get(decodeURIComponent(refinementMatch[1]!))).tenantId;
  const agentProfileMatch = request.url.match(/^\/v1\/agent-profiles\/([^/?]+)/);
  if (agentProfileMatch) tenantId = (await engine.agentProfiles.get(decodeURIComponent(agentProfileMatch[1]!))).tenantId;
  const methodIsSafe = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
  const globalAdminPath = /^\/v1\/(?:backends|mcp|plugins|detached-workers|skills\/hub|model-configurations|model-auth|providers\/[^/]+\/credentials|secret-sources)/.test(request.url);
  if (globalAdminPath && !identity.systemAdmin) {
    return await reply.code(403).send({ error: "system_admin_required" });
  }
  const adminMutation = !methodIsSafe && /^\/v1\/(?:secrets|learning|agent-profiles|repositories|repository-providers|github-apps|model-oauth-sources|automation-git-sources|automation-responders|society|cognitive|channel-routing-rules)/.test(request.url);
  const required: Role = methodIsSafe ? "viewer" : adminMutation ? "admin" : "operator";
  if (!roleAllows(identityService.roleFor(identity, tenantId), required)) {
    return await reply.code(403).send({ error: "forbidden", tenantId, requiredRole: required });
  }
  const webSession = requestWebSession.get(request);
  if (!methodIsSafe && webSession && request.headers["x-haf-csrf"] !== webSession.csrfToken) {
    return await reply.code(403).send({ error: "csrf_validation_failed" });
  }
});

const sessionCookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.HAF_COOKIE_SECURE !== "false",
  maxAge: Math.floor(identityService.sessionTtlMs / 1000),
};

app.get("/auth/me", async (request, reply) => {
  const identity = requestIdentity.get(request);
  if (!identity) return await reply.code(401).send({ authenticated: false, oidcConfigured });
  const session = requestWebSession.get(request);
  return {
    authenticated: identity.authType !== "anonymous-dev",
    developmentMode: identity.authType === "anonymous-dev",
    identity,
    ...(session ? { csrfToken: session.csrfToken, expiresAt: session.expiresAt } : {}),
    oidcConfigured,
  };
});

app.post("/auth/login/token", async (request, reply) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(request.body);
  const identity = identityService.apiTokenIdentity(token);
  if (!identity) return await reply.code(401).send({ error: "invalid_token" });
  const session = await identityService.createSession(identity);
  reply.setCookie(cookieName, session.id, sessionCookieOptions);
  return { identity: session.identity, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
});

app.get("/auth/oidc/start", async (request, reply) => {
  const { returnTo } = z.object({ returnTo: z.string().optional() }).parse(request.query);
  const start = await identityService.oidcStart(returnTo ?? "/");
  return await reply.redirect(start.url);
});

app.get("/auth/oidc/callback", async (request, reply) => {
  const { code, state } = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);
  const result = await identityService.oidcCallback(code, state);
  reply.setCookie(cookieName, result.session.id, sessionCookieOptions);
  return await reply.redirect(result.returnTo);
});

app.get("/auth/mcp/callback", async (request, reply) => {
  const query = z.object({
    code: z.string().optional(),
    state: z.string().min(16),
    error: z.string().optional(),
  }).parse(request.query);
  if (query.error || !query.code) {
    const cancelled = await engine.mcp.cancelHttpOAuthByState(query.state);
    if (!cancelled) return await reply.code(400).send({ error: "mcp_oauth_state_missing_or_expired" });
    return await reply.redirect(`/canvas/?mcp_oauth=denied`);
  }
  try {
    await engine.mcp.finishHttpOAuthByState({ code: query.code, state: query.state });
    return await reply.redirect(`/canvas/?mcp_oauth=connected`);
  } catch (error) {
    if (error instanceof McpOAuthPendingNotFoundError) {
      return await reply.code(400).send({ error: "mcp_oauth_state_missing_or_expired" });
    }
    return await reply.redirect(`/canvas/?mcp_oauth=failed`);
  }
});

app.get("/auth/github-app/callback", async (request, reply) => {
  const query = z.object({
    state: z.string().min(16),
    installation_id: z.string().regex(/^\d{1,30}$/).optional(),
    setup_action: z.enum(["install", "update", "request"]).default("install"),
  }).parse(request.query);
  try {
    if (query.setup_action === "request") {
      const result = await engine.githubApps.markInstallationRequested(query.state);
      const returnTo = new URL(result.returnTo, "https://haf.invalid");
      returnTo.searchParams.set("github_app", "requested");
      return await reply.redirect(`${returnTo.pathname}${returnTo.search}${returnTo.hash}`);
    }
    if (!query.installation_id) return await reply.code(400).send({ error: "github_app_installation_id_missing" });
    const result = await engine.githubApps.finishInstallation({
      state: query.state, installationId: query.installation_id, setupAction: query.setup_action,
    });
    const returnTo = new URL(result.returnTo, "https://haf.invalid");
    returnTo.searchParams.set("github_app", "connected");
    returnTo.searchParams.set("installation", result.installation.id);
    return await reply.redirect(`${returnTo.pathname}${returnTo.search}${returnTo.hash}`);
  } catch (error) {
    if (error instanceof GitHubAppPendingNotFoundError) {
      return await reply.code(400).send({ error: "github_app_state_missing_or_expired" });
    }
    const fallback = new URL("/canvas/", "https://haf.invalid");
    fallback.searchParams.set("github_app", "failed");
    return await reply.redirect(`${fallback.pathname}${fallback.search}`);
  }
});

app.get("/auth/model-oauth/callback", async (request, reply) => {
  const query = z.object({ state: z.string().min(16), code: z.string().max(8192).optional(), error: z.string().max(500).optional() }).parse(request.query);
  try {
    const source = await engine.modelOAuth.finish({ state: query.state, ...(query.code ? { code: query.code } : {}), ...(query.error ? { error: query.error } : {}) });
    return await reply.redirect(`/canvas/?model_oauth=connected&source=${encodeURIComponent(source.id)}`);
  } catch (error) {
    if (error instanceof ModelOAuthPendingNotFoundError) return await reply.code(400).send({ error: "model_oauth_state_missing_or_expired" });
    if (error instanceof ModelOAuthError && error.code === "authorization_denied") return await reply.redirect("/canvas/?model_oauth=denied");
    return await reply.redirect("/canvas/?model_oauth=failed");
  }
});

app.post("/auth/logout", async (request, reply) => {
  const session = await identityService.getSession(request.cookies[cookieName]);
  if (session && request.headers["x-haf-csrf"] !== session.csrfToken) {
    return await reply.code(403).send({ error: "csrf_validation_failed" });
  }
  await identityService.logout(request.cookies[cookieName]);
  reply.clearCookie(cookieName, { path: "/" });
  return { loggedOut: true };
});

app.get("/canvas", async (_request, reply) => await reply.redirect("/canvas/"));
app.get("/canvas/*", async (_request, reply) => await reply.sendFile("index.html", canvasRoot));

app.get("/", async (_request, reply) => {
  return await reply
    .header("content-type", "text/html; charset=utf-8")
    .header("x-content-type-options", "nosniff")
    .header("referrer-policy", "no-referrer")
    .header("x-frame-options", "DENY")
    .send(dashboardHtml);
});

app.get("/health", async () => ({
  status: "ok",
  engine: "hybrid-agent-fabric",
  version: "1.38.0",
  provider: engine.models.list(),
  sandbox: engine.config.sandboxBackend,
  persistence: engine.database ? "postgres" : "file",
  nats: Boolean(engine.nats),
}));

app.get("/metrics", async (_request, reply) => {
  return await reply.type("text/plain; version=0.0.4; charset=utf-8").send(engine.metrics.prometheus());
});
app.get("/v1/metrics", async () => ({
  ...engine.metrics.snapshot(),
  ...(engine.otlp ? { otlp: engine.otlp.status() } : {}),
}));
app.get("/v1/fleet/status", async () => await fleetMonitor.snapshot());
app.get("/v1/fleet/alerts", async () => ({ alerts: (await fleetMonitor.snapshot()).alerts }));

app.get("/v1/capabilities", async () => ({ capabilities: engine.capabilities.list() }));
app.get("/v1/society/roles", async (request) => { const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query); return { roles: await engine.society.roles(tenantId) }; });
app.post("/v1/society/roles", async (request, reply) => { const body = z.object({ tenantId: z.string().default("local"), name: z.string().min(1).max(200), layer: z.enum(["prime","council","specialist","micro"]), purpose: z.string().min(1).max(2000), capabilityTags: z.array(z.string()).max(100), parentRoleId: z.string().optional(), agentProfileId: z.string().optional() }).parse(request.body); return await reply.code(201).send(await engine.society.addRole({ tenantId: body.tenantId, name: body.name, layer: body.layer, purpose: body.purpose, capabilityTags: body.capabilityTags, ...(body.parentRoleId ? { parentRoleId: body.parentRoleId } : {}), ...(body.agentProfileId ? { agentProfileId: body.agentProfileId } : {}) })); });
app.post("/v1/society/roles/:roleId/profile", async (request) => { const { roleId } = z.object({ roleId: z.string() }).parse(request.params); const body = z.object({ tenantId: z.string().default("local"), agentProfileId: z.string().nullable() }).parse(request.body); return await engine.society.bindProfile(body.tenantId, roleId, body.agentProfileId ?? undefined); });
app.post("/v1/society/budget", async (request) => { const body = z.object({ tenantId: z.string().default("local"), dailyTokenBudget: z.number().int().min(1000), maxConcurrentTasks: z.number().int().min(1).max(100) }).parse(request.body); return await engine.society.configureBudget(body.tenantId, body.dailyTokenBudget, body.maxConcurrentTasks); });
app.get("/v1/society/budget", async (request) => { const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query); return await engine.society.budget(tenantId); });
app.get("/v1/society/tasks", async (request) => { const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query); return { tasks: await engine.society.tasks(tenantId) }; });
app.post("/v1/society/tasks", async (request, reply) => { const body = z.object({ tenantId: z.string().default("local"), rootSessionId: z.string(), title: z.string().min(1).max(300), objective: z.string().min(1).max(50_000), requiredCapabilityTags: z.array(z.string()).max(100).default([]), priority: z.enum(["critical","high","normal","low"]).default("normal"), maxTokens: z.number().int().min(100).max(10_000_000).default(100_000), deadline: z.string().datetime().optional() }).parse(request.body); return await reply.code(201).send(await engine.society.postTask({ tenantId: body.tenantId, rootSessionId: body.rootSessionId, title: body.title, objective: body.objective, requiredCapabilityTags: body.requiredCapabilityTags, priority: body.priority, maxTokens: body.maxTokens, ...(body.deadline ? { deadline: body.deadline } : {}) })); });
app.post("/v1/society/tasks/:taskId/bids", async (request, reply) => { const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params); const body = z.object({ tenantId: z.string().default("local"), roleId: z.string(), confidence: z.number().min(0).max(1), estimatedTokens: z.number().int().positive(), estimatedDurationMs: z.number().int().positive(), rationale: z.string().min(1).max(2000) }).parse(request.body); return await reply.code(201).send(await engine.society.bid({ taskId, ...body })); });
app.post("/v1/society/tasks/:taskId/award", async (request) => { const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params); const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.body ?? {}); return await engine.society.award(tenantId, taskId); });
app.post("/v1/society/tasks/:taskId/execute", async (request) => { const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params); const body = z.object({ tenantId: z.string().default("local"), sessionId: z.string() }).parse(request.body); const task = await engine.society.getTask(body.tenantId, taskId); if (task.rootSessionId !== body.sessionId) throw new Error("Society task root session mismatch."); return await executeSessionCapability(body.sessionId, "society.task.execute", { taskId }, "web", request.headers["x-idempotency-key"] as string | undefined); });
app.post("/v1/society/tasks/:taskId/outcome", async (request) => { const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params); const body = z.object({ tenantId: z.string().default("local"), success: z.boolean(), quality: z.number().min(0).max(1), actualTokens: z.number().int().nonnegative(), evidenceEventIds: z.array(z.string()).min(1).max(200) }).parse(request.body); return await engine.society.recordOutcome({ taskId, ...body }); });
app.get("/v1/society/deliberations", async (request) => { const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query); return { deliberations: await engine.society.deliberations(tenantId) }; });
app.post("/v1/society/deliberations", async (request, reply) => { const body = z.object({ tenantId: z.string().default("local"), question: z.string().min(1).max(10_000), requiredRoleIds: z.array(z.string()).min(2).max(50), quorum: z.number().int().min(2).optional() }).parse(request.body); return await reply.code(201).send(await engine.society.createDeliberation({ tenantId: body.tenantId, question: body.question, requiredRoleIds: body.requiredRoleIds, ...(body.quorum !== undefined ? { quorum: body.quorum } : {}) })); });
app.post("/v1/society/deliberations/:id/perspectives", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = z.object({ tenantId: z.string().default("local"), roleId: z.string(), recommendation: z.enum(["approve","reject","abstain"]), confidence: z.number().min(0).max(1), summary: z.string().min(1).max(10_000), evidenceEventIds: z.array(z.string()).max(200).default([]) }).parse(request.body); return await reply.code(201).send(await engine.society.submitPerspective({ deliberationId: id, ...body })); });
app.post("/v1/society/deliberations/:id/resolve", async (request) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.body ?? {}); return await engine.society.resolveDeliberation(tenantId, id); });
app.get("/v1/cognitive/objects", async (request) => { const q=z.object({tenantId:z.string().default("local"),attentionState:z.enum(["queued","focused","deferred"]).optional()}).parse(request.query); return {objects:await engine.cognitive.objects(q.tenantId,q.attentionState)}; });
app.post("/v1/cognitive/objects", async (request,reply) => { const b=z.object({tenantId:z.string().default("local"),sessionId:z.string().optional(),kind:z.enum(["observation","problem","hypothesis","insight","risk","opportunity","decision"]),title:z.string().min(1).max(500),content:z.string().min(1).max(100000),sourceType:z.enum(["user","agent","event","memory","system"]),sourceId:z.string().max(500).optional(),confidence:z.number().min(0).max(1),importance:z.number().min(0).max(1),urgency:z.number().min(0).max(1),impact:z.number().min(0).max(1),userRelevance:z.number().min(0).max(1),horizon:z.enum(["reactive","tactical","strategic"]),goalId:z.string().uuid().optional(),requestedTokens:z.number().int().min(100).optional(),requestedTimeMs:z.number().int().min(1000).optional(),tags:z.array(z.string()).max(100).optional(),relations:z.array(z.string()).max(200).optional()}).parse(request.body); return await reply.code(201).send(await engine.cognitive.createObject({tenantId:b.tenantId,kind:b.kind,title:b.title,content:b.content,sourceType:b.sourceType,confidence:b.confidence,importance:b.importance,urgency:b.urgency,impact:b.impact,userRelevance:b.userRelevance,horizon:b.horizon,...(b.sessionId?{sessionId:b.sessionId}:{}),...(b.sourceId?{sourceId:b.sourceId}:{}),...(b.goalId?{goalId:b.goalId}:{}),...(b.requestedTokens!==undefined?{requestedTokens:b.requestedTokens}:{}),...(b.requestedTimeMs!==undefined?{requestedTimeMs:b.requestedTimeMs}:{}),...(b.tags?{tags:b.tags}:{}),...(b.relations?{relations:b.relations}:{})})); });
app.post("/v1/cognitive/attention/allocate", async (request) => { const {tenantId}=z.object({tenantId:z.string().default("local")}).parse(request.body??{}); return await engine.cognitive.allocateAttention(tenantId); });
app.post("/v1/cognitive/objects/:id/complete", async (request) => { const {id}=z.object({id:z.string().uuid()}).parse(request.params); const b=z.object({tenantId:z.string().default("local"),outcome:z.enum(["active","solved","blocked"]),actualTokens:z.number().int().nonnegative()}).parse(request.body); return await engine.cognitive.completeFocus(b.tenantId,id,b.outcome,b.actualTokens); });
app.post("/v1/cognitive/objects/:id/iterations", async (request) => { const {id}=z.object({id:z.string().uuid()}).parse(request.params); const b=z.object({tenantId:z.string().default("local"),result:z.string().min(1).max(100000)}).parse(request.body); return await engine.cognitive.recordIteration(b.tenantId,id,b.result); });
app.get("/v1/cognitive/goals", async (request) => { const {tenantId}=z.object({tenantId:z.string().default("local")}).parse(request.query); return {goals:await engine.cognitive.goals(tenantId)}; });
app.post("/v1/cognitive/goals", async (request,reply) => { const b=z.object({tenantId:z.string().default("local"),title:z.string().min(1).max(300),objective:z.string().min(1).max(10000),class:z.enum(["P0","P1","P2","P3","P4"]),importance:z.number().min(0).max(1),urgency:z.number().min(0).max(1),userRelevance:z.number().min(0).max(1)}).parse(request.body); return await reply.code(201).send(await engine.cognitive.createGoal(b)); });
app.post("/v1/cognitive/goals/arbitrate", async (request) => { const {tenantId}=z.object({tenantId:z.string().default("local")}).parse(request.body??{}); return await engine.cognitive.arbitrateGoals(tenantId); });
app.get("/v1/cognitive/budget", async (request) => { const {tenantId}=z.object({tenantId:z.string().default("local")}).parse(request.query); return await engine.cognitive.budget(tenantId); });
app.post("/v1/cognitive/budget", async (request) => { const b=z.object({tenantId:z.string().default("local"),dailyTokenBudget:z.number().int().min(1000),maxFocusedObjects:z.number().int().min(1).max(100)}).parse(request.body); return await engine.cognitive.configureBudget(b.tenantId,b.dailyTokenBudget,b.maxFocusedObjects); });
app.get("/v1/cognitive/mode", async (request) => { const {tenantId}=z.object({tenantId:z.string().default("local")}).parse(request.query); return await engine.cognitive.mode(tenantId); });
app.post("/v1/cognitive/mode", async (request) => { const b=z.object({tenantId:z.string().default("local"),mode:z.enum(["reactive","research","development","reflection","dream","emergency"]),reason:z.string().min(1).max(1000)}).parse(request.body); return await engine.cognitive.transitionMode(b.tenantId,b.mode,b.reason); });
app.get("/v1/cognitive/arbitrations", async (request) => { const {tenantId}=z.object({tenantId:z.string().default("local")}).parse(request.query); return {arbitrations:await engine.cognitive.arbitrations(tenantId)}; });
app.get("/v1/media/images/providers", async () => ({ providers: engine.images.list(), upscalers: engine.images.listUpscalers() }));
app.get("/v1/media/videos/providers", async () => ({ providers: engine.video.list(), queuedProviders: engine.video.listQueued(), upscalers: engine.video.listUpscalers() }));
app.get("/v1/web-search/providers", async () => ({ providers: engine.webSearch.list() }));
app.get("/v1/providers", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return {
  active: engine.models.list(),
  routes: engine.models.status(),
  profiles: engine.providerProfiles.list().map((profile) => ({
    ...profile,
    configured: profile.dataPolicy === "local" || profile.credentialMode === "aws-default" || Boolean(process.env[profile.apiKeyEnvironmentVariable]) || provider === profile.id,
  })),
  configurations: await engine.modelConfigurations.list(tenantId),
  };
});
app.post("/v1/providers/:providerId/credentials/reset", async (request) => {
  const { providerId } = z.object({ providerId: z.string().min(1).max(100) }).parse(request.params);
  const { credentialId } = z.object({ credentialId: z.string().min(1).max(100).optional() }).parse(request.body ?? {});
  return await engine.models.resetCredentialPool(providerId, credentialId);
});

app.get("/v1/agent-profiles", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { profiles: await engine.agentProfiles.list(tenantId) };
});
app.post("/v1/agent-profiles", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    instructions: z.string().min(1).max(50_000),
    allowedCapabilityIds: z.array(z.string()).max(500).optional(),
    modelRoute: z.string().max(300).optional(),
    fallbackModels: z.array(z.string()).max(8).optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.agentProfiles.add({
    tenantId: body.tenantId,
    name: body.name,
    instructions: body.instructions,
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.allowedCapabilityIds ? { allowedCapabilityIds: body.allowedCapabilityIds } : {}),
    ...(body.modelRoute ? { modelRoute: body.modelRoute } : {}),
    ...(body.fallbackModels ? { fallbackModels: body.fallbackModels } : {}),
  }));
});
app.patch("/v1/agent-profiles/:profileId", async (request) => {
  const { profileId } = z.object({ profileId: z.string() }).parse(request.params);
  const body = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    instructions: z.string().min(1).max(50_000).optional(),
    allowedCapabilityIds: z.array(z.string()).max(500).nullable().optional(),
    modelRoute: z.string().max(300).nullable().optional(),
    fallbackModels: z.array(z.string()).max(8).optional(),
    enabled: z.boolean().optional(),
  }).parse(request.body);
  return await engine.agentProfiles.update(profileId, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
    ...(body.allowedCapabilityIds !== undefined ? { allowedCapabilityIds: body.allowedCapabilityIds } : {}),
    ...(body.modelRoute !== undefined ? { modelRoute: body.modelRoute } : {}),
    ...(body.fallbackModels !== undefined ? { fallbackModels: body.fallbackModels } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
  });
});
app.delete("/v1/agent-profiles/:profileId", async (request, reply) => {
  const { profileId } = z.object({ profileId: z.string() }).parse(request.params);
  const removed = await engine.agentProfiles.remove(profileId);
  return removed ? await reply.code(204).send() : await reply.code(404).send({ error: "agent_profile_not_found" });
});

app.get("/v1/model-auth/codex/status", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return await engine.codexAuth.status(tenantId);
});
app.get("/v1/model-auth/codex/models", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { models: await engine.codexAuth.listModels(tenantId) };
});
app.post("/v1/model-auth/codex/start", async (request, reply) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.body ?? {});
  return await reply.code(201).send(await engine.codexAuth.startDeviceFlow(tenantId));
});
app.post("/v1/model-auth/codex/poll", async (request, reply) => {
  const body = z.object({ tenantId: z.string().default("local"), flowId: z.string().uuid() }).parse(request.body);
  const result = await engine.codexAuth.pollDeviceFlow(body.tenantId, body.flowId);
  return await reply.code(result.status === "pending" ? 202 : 200).send(result);
});
app.post("/v1/model-auth/codex/activate", async (request) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    model: z.string().min(1).max(300),
    reasoningEffort: z.enum(["low", "medium", "high", "max"]).optional(),
    requestTimeoutMs: z.number().int().min(5_000).max(600_000).optional(),
  }).parse(request.body);
  const status = await engine.codexAuth.status(body.tenantId);
  if (!status.authenticated) throw new Error("Codex subscription authentication is required before activation.");
  return { route: engine.activateCodexSubscription({ model: body.model, ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort } : {}), ...(body.requestTimeoutMs ? { requestTimeoutMs: body.requestTimeoutMs } : {}) }) };
});
app.delete("/v1/model-auth/codex", async (request, reply) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  await engine.codexAuth.logout(tenantId);
  return await reply.code(204).send();
});

app.get("/v1/model-oauth-sources", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { sources: await engine.modelOAuth.list(tenantId) };
});
app.post("/v1/model-oauth-sources", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"), name: z.string().min(1).max(200), issuer: z.string().url(),
    clientId: z.string().min(1).max(500), clientSecretId: z.string().optional(),
    clientAuthMethod: z.enum(["none", "client_secret_basic", "client_secret_post"]).optional(),
    scopes: z.array(z.string().min(1).max(200)).min(1).max(50),
    authorizationServerOrigins: z.array(z.string().url()).max(20).optional(),
    resourceOrigins: z.array(z.string().url()).min(1).max(20),
    authorizeParameters: z.record(z.string(), z.string()).optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.modelOAuth.register({
    tenantId: body.tenantId, name: body.name, issuer: body.issuer, clientId: body.clientId,
    ...(body.clientSecretId ? { clientSecretId: body.clientSecretId } : {}),
    ...(body.clientAuthMethod ? { clientAuthMethod: body.clientAuthMethod } : {}),
    scopes: body.scopes,
    ...(body.authorizationServerOrigins ? { authorizationServerOrigins: body.authorizationServerOrigins } : {}),
    resourceOrigins: body.resourceOrigins,
    ...(body.authorizeParameters ? { authorizeParameters: body.authorizeParameters } : {}),
  }));
});
app.patch("/v1/model-oauth-sources/:sourceId", async (request) => {
  const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.modelOAuth.setEnabled(sourceId, body.tenantId, body.enabled);
});
app.post("/v1/model-oauth-sources/:sourceId/start", async (request, reply) => {
  const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), returnTo: z.string().max(2000).default("/canvas/") }).parse(request.body ?? {});
  return await reply.code(201).send(await engine.modelOAuth.start(sourceId, body.tenantId, body.returnTo));
});
app.post("/v1/model-oauth-sources/:sourceId/logout", async (request) => {
  const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.body ?? {});
  return await engine.modelOAuth.logout(sourceId, tenantId);
});
app.delete("/v1/model-oauth-sources/:sourceId", async (request, reply) => {
  const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return await engine.modelOAuth.remove(sourceId, tenantId) ? await reply.code(204).send() : await reply.code(404).send({ error: "model_oauth_source_not_found" });
});

app.get("/v1/model-configurations", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().optional() }).parse(request.query);
  return { configurations: await engine.modelConfigurations.list(tenantId) };
});
app.post("/v1/model-configurations", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    name: z.string().min(1).max(200),
    baseProfileId: z.string().min(1),
    model: z.string().min(1).max(300),
    dataPolicy: z.enum(["provider", "aggregator", "local"]).optional(),
    baseUrl: z.string().url().optional(),
    credentialEnvironmentVariable: z.string().regex(/^[A-Z_][A-Z0-9_]{0,199}$/).optional(),
    credentialOAuthSourceId: z.string().uuid().optional(),
    credentialAudienceOrigin: z.string().url().optional(),
    headerEnvironmentVariables: z.record(z.string(), z.string()).optional(),
  }).parse(request.body);
  const configuration = await engine.modelConfigurations.add({
    tenantId: body.tenantId,
    name: body.name,
    baseProfileId: body.baseProfileId,
    model: body.model,
    ...(body.dataPolicy ? { dataPolicy: body.dataPolicy } : {}),
    ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
    ...(body.credentialEnvironmentVariable ? { credentialEnvironmentVariable: body.credentialEnvironmentVariable } : {}),
    ...(body.credentialOAuthSourceId ? { credentialOAuthSourceId: body.credentialOAuthSourceId } : {}),
    ...(body.credentialAudienceOrigin ? { credentialAudienceOrigin: body.credentialAudienceOrigin } : {}),
    ...(body.headerEnvironmentVariables ? { headerEnvironmentVariables: body.headerEnvironmentVariables } : {}),
  });
  if (configuration.configured) await engine.activateModelConfiguration(configuration.id);
  return await reply.code(201).send({ configuration, route: `${configuration.id}:${configuration.model}` });
});
app.patch("/v1/model-configurations/:configurationId", async (request) => {
  const { configurationId } = z.object({ configurationId: z.string() }).parse(request.params);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
  return await engine.setModelConfigurationEnabled(configurationId, enabled);
});
app.delete("/v1/model-configurations/:configurationId", async (request, reply) => {
  const { configurationId } = z.object({ configurationId: z.string() }).parse(request.params);
  const removed = await engine.removeModelConfiguration(configurationId);
  return removed ? await reply.code(204).send() : await reply.code(404).send({ error: "model_configuration_not_found" });
});

app.get("/v1/secret-sources", async () => ({ sources: await engine.secretSources.list() }));
app.post("/v1/secret-sources", async (request, reply) => {
  const body = z.object({
    name: z.string().min(1).max(200),
    kind: z.enum(["command", "onepassword", "bitwarden"]),
    executable: z.string().min(1),
    executableSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    args: z.array(z.string()).max(100).optional(),
    environmentVariables: z.array(z.string()).max(100).optional(),
    items: z.array(z.object({ secretName: z.string(), reference: z.string(), description: z.string().max(500).optional() })).min(1).max(200),
  }).parse(request.body);
  return await reply.code(201).send(await engine.secretSources.add({
    name: body.name, kind: body.kind, executable: body.executable, executableSha256: body.executableSha256,
    ...(body.args ? { args: body.args } : {}),
    ...(body.environmentVariables ? { environmentVariables: body.environmentVariables } : {}),
    items: body.items.map((item) => ({ secretName: item.secretName, reference: item.reference, ...(item.description ? { description: item.description } : {}) })),
  }));
});
app.patch("/v1/secret-sources/:sourceId", async (request) => {
  const { sourceId } = z.object({ sourceId: z.string() }).parse(request.params);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
  return await engine.secretSources.setEnabled(sourceId, enabled);
});
app.post("/v1/secret-sources/:sourceId/refresh", async (request) => {
  const { sourceId } = z.object({ sourceId: z.string() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.body ?? {});
  return await engine.secretSources.refresh(sourceId, tenantId);
});
app.delete("/v1/secret-sources/:sourceId", async (request, reply) => {
  const { sourceId } = z.object({ sourceId: z.string() }).parse(request.params);
  return await engine.secretSources.remove(sourceId) ? await reply.code(204).send() : await reply.code(404).send({ error: "secret_source_not_found" });
});

app.get("/v1/memory/providers/status", async () => await engine.externalMemory.status());

app.get("/v1/secrets", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { persistentAcrossRestart: engine.credentials.persistentAcrossRestart, secrets: await engine.credentials.list(tenantId) };
});
app.post("/v1/secrets", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    name: z.string(),
    value: z.string().min(1),
    description: z.string().max(500).optional(),
  }).parse(request.body);
  const metadata = await engine.credentials.put({
    tenantId: body.tenantId,
    name: body.name,
    value: body.value,
    ...(body.description ? { description: body.description } : {}),
  });
  return await reply.code(201).send(metadata);
});
app.delete("/v1/secrets/:secretId", async (request, reply) => {
  const { secretId } = z.object({ secretId: z.string() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  const removed = await engine.credentials.remove(tenantId, secretId);
  return removed ? await reply.code(204).send() : await reply.code(404).send({ error: "secret_not_found" });
});

app.get("/v1/backends", async () => ({ backends: await engine.backends.list() }));
app.post("/v1/backends", async (request, reply) => {
  const authSchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }),
    z.object({ mode: z.literal("bearer-env"), environmentVariable: z.string() }),
    z.object({ mode: z.literal("session-key-env"), environmentVariable: z.string() }),
  ]);
  const body = z.object({
    name: z.string().min(1),
    kind: z.enum(["remote", "cloud"]),
    baseUrl: z.string().url(),
    auth: authSchema,
  }).parse(request.body);
  return await reply.code(201).send(await engine.backends.add(body));
});
app.get("/v1/backends/:backendId/health", async (request) => {
  const { backendId } = z.object({ backendId: z.string() }).parse(request.params);
  return await engine.backends.health(backendId);
});
app.patch("/v1/backends/:backendId", async (request) => {
  const { backendId } = z.object({ backendId: z.string() }).parse(request.params);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
  return await engine.backends.setEnabled(backendId, enabled);
});
app.delete("/v1/backends/:backendId", async (request, reply) => {
  const { backendId } = z.object({ backendId: z.string() }).parse(request.params);
  const removed = await engine.backends.remove(backendId);
  return removed ? await reply.code(204).send() : await reply.code(404).send({ error: "backend_not_found" });
});

function requiredExternalIdempotency(request: any): string {
  const value = request.headers["x-idempotency-key"];
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{8,200}$/.test(value)) throw new Error("x-idempotency-key is required for hosted review mutations.");
  return value;
}

app.get("/v1/github-apps", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { apps: await engine.githubApps.list(tenantId) };
});
app.post("/v1/github-apps", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"), name: z.string().min(1).max(200),
    appId: z.string().regex(/^\d{1,30}$/), clientId: z.string().regex(/^[A-Za-z0-9_.-]{5,200}$/).optional(),
    appSlug: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
    privateKeySecretIds: z.array(z.string().min(8).max(200)).min(1).max(25),
    webhookSecretIds: z.array(z.string().min(8).max(200)).max(25).optional(),
    apiBase: z.string().url().optional(), webBase: z.string().url().optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.githubApps.register({
    tenantId: body.tenantId, name: body.name, appId: body.appId, appSlug: body.appSlug,
    privateKeySecretIds: body.privateKeySecretIds,
    ...(body.clientId ? { clientId: body.clientId } : {}),
    ...(body.webhookSecretIds ? { webhookSecretIds: body.webhookSecretIds } : {}),
    ...(body.apiBase ? { apiBase: body.apiBase } : {}), ...(body.webBase ? { webBase: body.webBase } : {}),
  }));
});
app.patch("/v1/github-apps/:appConfigId", async (request) => {
  const { appConfigId } = z.object({ appConfigId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.githubApps.setEnabled(appConfigId, body.tenantId, body.enabled);
});
app.post("/v1/github-apps/:appConfigId/private-keys", async (request, reply) => {
  const { appConfigId } = z.object({ appConfigId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), secretId: z.string().min(8).max(200), makePrimary: z.boolean().default(true) }).parse(request.body);
  return await reply.code(201).send(await engine.githubApps.rotatePrivateKey({ appConfigId, tenantId: body.tenantId, secretId: body.secretId, makePrimary: body.makePrimary }));
});
app.patch("/v1/github-apps/:appConfigId/private-keys/:keyId", async (request) => {
  const { appConfigId, keyId } = z.object({ appConfigId: z.string().uuid(), keyId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.githubApps.setPrivateKeyEnabled({ appConfigId, keyId, tenantId: body.tenantId, enabled: body.enabled });
});
app.post("/v1/github-apps/:appConfigId/webhook-secrets", async (request, reply) => {
  const { appConfigId } = z.object({ appConfigId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), secretId: z.string().min(8).max(200), makePrimary: z.boolean().default(true) }).parse(request.body);
  return await reply.code(201).send(await engine.githubApps.rotateWebhookSecret({ appConfigId, tenantId: body.tenantId, secretId: body.secretId, makePrimary: body.makePrimary }));
});
app.patch("/v1/github-apps/:appConfigId/webhook-secrets/:keyId", async (request) => {
  const { appConfigId, keyId } = z.object({ appConfigId: z.string().uuid(), keyId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.githubApps.setWebhookSecretEnabled({ appConfigId, keyId, tenantId: body.tenantId, enabled: body.enabled });
});
app.post("/v1/github-apps/:appConfigId/installations/start", async (request, reply) => {
  const { appConfigId } = z.object({ appConfigId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), returnTo: z.string().max(2000).default("/canvas/") }).parse(request.body ?? {});
  return await reply.code(201).send(await engine.githubApps.startInstallation({ appConfigId, tenantId: body.tenantId, returnTo: body.returnTo }));
});
app.get("/v1/github-apps/installations", async (request) => {
  const query = z.object({ tenantId: z.string().default("local"), appConfigId: z.string().uuid().optional() }).parse(request.query);
  return { installations: await engine.githubApps.installations(query.tenantId, query.appConfigId) };
});
app.patch("/v1/github-apps/installations/:installationId", async (request) => {
  const { installationId } = z.object({ installationId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.githubApps.setInstallationEnabled(installationId, body.tenantId, body.enabled);
});
app.delete("/v1/github-apps/installations/:installationId", async (request, reply) => {
  const { installationId } = z.object({ installationId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return await engine.githubApps.removeInstallation(installationId, tenantId)
    ? await reply.code(204).send()
    : await reply.code(404).send({ error: "github_app_installation_not_found" });
});
app.get("/v1/github-apps/events", async (request) => {
  const query = z.object({ tenantId: z.string().default("local"), appConfigId: z.string().uuid().optional() }).parse(request.query);
  return { events: await engine.githubApps.webhookEvents(query.tenantId, query.appConfigId) };
});

app.get("/v1/repository-providers", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { providers: await engine.hostedRepositories.list(tenantId) };
});
app.post("/v1/repository-providers", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    name: z.string().min(1).max(200),
    kind: z.enum(["github", "gitlab"]),
    credentialSecretId: z.string().min(1).optional(),
    githubAppInstallationId: z.string().uuid().optional(),
    apiBase: z.string().url().optional(),
    cloneOrigin: z.string().url().optional(),
    authStyle: z.enum(["bearer", "private-token"]).optional(),
    githubAccountMode: z.enum(["user", "installation"]).optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.hostedRepositories.add({
    tenantId: body.tenantId, name: body.name, kind: body.kind,
    ...(body.credentialSecretId ? { credentialSecretId: body.credentialSecretId } : {}),
    ...(body.githubAppInstallationId ? { githubAppInstallationId: body.githubAppInstallationId } : {}),
    ...(body.apiBase ? { apiBase: body.apiBase } : {}),
    ...(body.cloneOrigin ? { cloneOrigin: body.cloneOrigin } : {}),
    ...(body.authStyle ? { authStyle: body.authStyle } : {}),
    ...(body.githubAccountMode ? { githubAccountMode: body.githubAccountMode } : {}),
  }));
});
app.patch("/v1/repository-providers/:providerId", async (request) => {
  const { providerId } = z.object({ providerId: z.string() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.hostedRepositories.setEnabled(providerId, body.tenantId, body.enabled);
});
app.delete("/v1/repository-providers/:providerId", async (request, reply) => {
  const { providerId } = z.object({ providerId: z.string() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return await engine.hostedRepositories.remove(providerId, tenantId)
    ? await reply.code(204).send()
    : await reply.code(404).send({ error: "repository_provider_not_found" });
});
app.get("/v1/repository-providers/:providerId/repositories", async (request) => {
  const { providerId } = z.object({ providerId: z.string() }).parse(request.params);
  const query = z.object({ tenantId: z.string().default("local"), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(request.query);
  return { repositories: await engine.hostedRepositories.repositories(providerId, query.tenantId, query.limit) };
});
app.get("/v1/repository-providers/:providerId/repositories/:repositoryId/reviews", async (request) => {
  const { providerId, repositoryId } = z.object({ providerId: z.string(), repositoryId: z.string() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { reviews: await engine.hostedRepositories.reviews(providerId, tenantId, repositoryId) };
});
app.post("/v1/repository-providers/:providerId/repositories/:repositoryId/reviews", async (request) => {
  const { providerId, repositoryId } = z.object({ providerId: z.string(), repositoryId: z.string() }).parse(request.params);
  const body = z.object({ sessionId: z.string(), title: z.string().min(1).max(300), body: z.string().max(100_000).optional(), sourceBranch: z.string().min(1).max(200), targetBranch: z.string().min(1).max(200), draft: z.boolean().default(false) }).parse(request.body);
  return await executeSessionCapability(body.sessionId, "repository.review.create", {
    providerId, repositoryId, title: body.title, sourceBranch: body.sourceBranch, targetBranch: body.targetBranch, draft: body.draft,
    ...(body.body ? { body: body.body } : {}),
  }, "web", requiredExternalIdempotency(request));
});
app.post("/v1/repository-providers/:providerId/repositories/:repositoryId/reviews/:reviewNumber/comments", async (request) => {
  const { providerId, repositoryId, reviewNumber } = z.object({ providerId: z.string(), repositoryId: z.string(), reviewNumber: z.coerce.number().int().positive() }).parse(request.params);
  const body = z.object({ sessionId: z.string(), body: z.string().min(1).max(100_000) }).parse(request.body);
  return await executeSessionCapability(body.sessionId, "repository.review.comment", { providerId, repositoryId, reviewNumber, body: body.body }, "web", requiredExternalIdempotency(request));
});
app.post("/v1/repository-providers/:providerId/repositories/:repositoryId/reviews/:reviewNumber/close", async (request) => {
  const { providerId, repositoryId, reviewNumber } = z.object({ providerId: z.string(), repositoryId: z.string(), reviewNumber: z.coerce.number().int().positive() }).parse(request.params);
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.body);
  return await executeSessionCapability(sessionId, "repository.review.close", { providerId, repositoryId, reviewNumber }, "web", requiredExternalIdempotency(request));
});
app.post("/v1/repository-providers/:providerId/repositories/:repositoryId/reviews/:reviewNumber/merge", async (request) => {
  const { providerId, repositoryId, reviewNumber } = z.object({ providerId: z.string(), repositoryId: z.string(), reviewNumber: z.coerce.number().int().positive() }).parse(request.params);
  const body = z.object({ sessionId: z.string(), expectedHeadSha: z.string().regex(/^[a-f0-9]{40,64}$/i), method: z.enum(["merge", "squash", "rebase"]).default("merge") }).parse(request.body);
  return await executeSessionCapability(body.sessionId, "repository.review.merge", { providerId, repositoryId, reviewNumber, expectedHeadSha: body.expectedHeadSha, method: body.method }, "web", requiredExternalIdempotency(request));
});
app.get("/v1/repository-providers/:providerId/operations", async (request) => {
  const { providerId } = z.object({ providerId: z.string() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { operations: await engine.hostedRepositories.listOperations(tenantId, providerId) };
});

app.post("/v1/repository-providers/:providerId/import", async (request, reply) => {
  const { providerId } = z.object({ providerId: z.string() }).parse(request.params);
  const body = z.object({
    tenantId: z.string().default("local"), repositoryId: z.string().min(1), branch: z.string().max(200).optional(),
    name: z.string().min(1).max(200).optional(), agentProfileId: z.string().optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.importHostedRepository({
    providerId, tenantId: body.tenantId, repositoryId: body.repositoryId,
    ...(body.branch ? { branch: body.branch } : {}),
    ...(body.name ? { name: body.name } : {}),
    ...(body.agentProfileId ? { agentProfileId: body.agentProfileId } : {}),
  }));
});
app.get("/v1/sessions/:sessionId/repository-sync", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const session = await engine.session(sessionId);
  return await engine.hostedRepositories.syncStatus(sessionId, session.tenantId, session.workspacePath);
});

app.post("/v1/repositories/import", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    url: z.string().url(),
    branch: z.string().max(200).optional(),
    credentialSecretId: z.string().optional(),
    credentialUsername: z.string().max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    agentProfileId: z.string().optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.importRepository({
    tenantId: body.tenantId,
    url: body.url,
    ...(body.branch ? { branch: body.branch } : {}),
    ...(body.credentialSecretId ? { credentialSecretId: body.credentialSecretId } : {}),
    ...(body.credentialUsername ? { credentialUsername: body.credentialUsername } : {}),
    ...(body.name ? { name: body.name } : {}),
    ...(body.agentProfileId ? { agentProfileId: body.agentProfileId } : {}),
  }));
});

function publicSessionSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  const value = structuredClone(snapshot);
  value.messages = value.messages.filter((message) => !message.hidden);
  if (value.tree) {
    const original = value.tree.entries;
    const byId = new Map(original.map((entry) => [entry.id, entry]));
    const visible = original.filter((entry) => !entry.message.hidden);
    for (const entry of visible) {
      let parentId = entry.parentId;
      while (parentId && byId.get(parentId)?.message.hidden) parentId = byId.get(parentId)?.parentId;
      if (parentId) entry.parentId = parentId; else delete entry.parentId;
    }
    value.tree.entries = visible;
    if (value.tree.activeLeafId && !visible.some((entry) => entry.id === value.tree!.activeLeafId)) {
      let active = byId.get(value.tree.activeLeafId)?.parentId;
      while (active && byId.get(active)?.message.hidden) active = byId.get(active)?.parentId;
      const fallback = active ?? visible.at(-1)?.id;
      if (fallback) value.tree.activeLeafId = fallback; else delete value.tree.activeLeafId;
    }
  }
  return value;
}

const createSessionSchema = z.object({
  tenantId: z.string().min(1).default("local"),
  name: z.string().min(1).max(200).optional(),
  workspacePath: z.string().optional(),
  agentProfileId: z.string().optional(),
});
app.post("/v1/sessions", async (request, reply) => {
  const body = createSessionSchema.parse(request.body ?? {});
  const session = await engine.createSession({
    tenantId: body.tenantId,
    ...(body.name ? { name: body.name } : {}),
    ...(body.workspacePath ? { workspacePath: body.workspacePath } : {}),
    ...(body.agentProfileId ? { agentProfileId: body.agentProfileId } : {}),
  });
  return await reply.code(201).send(publicSessionSnapshot(session));
});

app.get("/v1/knowledge/search", async (request) => {
  const query = z.object({
    tenantId: z.string().default("local"),
    q: z.string().min(1),
    kinds: z.string().optional(),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }).parse(request.query);
  const kinds = query.kinds?.split(",").filter((kind): kind is "session_message" | "memory" | "skill" | "artifact" =>
    ["session_message", "memory", "skill", "artifact"].includes(kind));
  return { hits: await engine.knowledgeIndex.search({ tenantId: query.tenantId, query: query.q, ...(kinds?.length ? { kinds } : {}), limit: query.limit }) };
});
app.post("/v1/knowledge/reindex", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.body ?? {});
  let indexed = 0;
  for (const session of await engine.sessions(tenantId)) indexed += await engine.knowledgeIndexer.indexSession(session);
  return { indexed, total: await engine.knowledgeIndex.count(tenantId) };
});

app.get("/v1/session-search", async (request) => {
  const query = z.object({
    tenantId: z.string().default("local"),
    q: z.string().min(1),
    limit: z.coerce.number().int().positive().max(50).default(20),
  }).parse(request.query);
  return { hits: await engine.sessionSearch.search(query.tenantId, query.q, query.limit) };
});

app.get("/v1/sessions", async (request) => {
  const query = z.object({ tenantId: z.string().optional() }).parse(request.query);
  return { sessions: (await engine.sessions(query.tenantId)).map(publicSessionSnapshot) };
});

app.get("/v1/sessions/:sessionId", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  return publicSessionSnapshot(await engine.session(sessionId));
});

app.get("/v1/sessions/:sessionId/roster", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  return { currentSessionId: sessionId, agents: await engine.supervisor.familyRoster(sessionId) };
});

app.get("/v1/sessions/:sessionId/inbox", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const { states } = z.object({ states: z.string().optional() }).parse(request.query);
  const parsedStates = states?.split(",").filter((state): state is "pending" | "claimed" | "delivered" | "uncertain" =>
    ["pending", "claimed", "delivered", "uncertain"].includes(state));
  return { messages: await engine.supervisor.listAgentInbox(sessionId, parsedStates?.length ? parsedStates : undefined) };
});

app.post("/v1/sessions/:sessionId/messages", async (request, reply) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({
    message: z.string().min(1).max(16_384),
    mode: z.enum(["auto", "steer", "follow_up"]).default("auto"),
    targetSessionId: z.string().optional(),
    receiverRole: z.enum(["parent", "sibling", "child"]).optional(),
    receiverName: z.string().min(1).max(200).optional(),
    broadcast: z.boolean().default(false),
  }).parse(request.body);
  const result = await engine.supervisor.sendAgentMessage({
    senderSessionId: sessionId,
    message: body.message,
    mode: body.mode,
    ...(body.targetSessionId ? { targetSessionId: body.targetSessionId } : {}),
    ...(body.receiverRole ? { receiverRole: body.receiverRole } : {}),
    ...(body.receiverName ? { receiverName: body.receiverName } : {}),
    broadcast: body.broadcast,
  });
  return await reply.code(result.receipts.every((receipt) => receipt.deliveryStatus === "delivered") ? 200 : 202).send(result);
});

app.get("/v1/sessions/:sessionId/export", async (request, reply) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const { format } = z.object({ format: z.enum(["json", "markdown", "trajectory"]).default("markdown") }).parse(request.query);
  const session = await engine.session(sessionId);
  const safeName = session.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "session";
  if (format === "trajectory") {
    return await reply
      .header("content-disposition", `attachment; filename="${safeName}-${session.sessionId.slice(0, 8)}.trajectory.json"`)
      .type("application/json; charset=utf-8")
      .send(transcriptAsTrajectory(session));
  }
  if (format === "json") {
    return await reply
      .header("content-disposition", `attachment; filename="${safeName}-${session.sessionId.slice(0, 8)}.json"`)
      .type("application/json; charset=utf-8")
      .send(transcriptAsJson(session));
  }
  return await reply
    .header("content-disposition", `attachment; filename="${safeName}-${session.sessionId.slice(0, 8)}.md"`)
    .type("text/markdown; charset=utf-8")
    .send(transcriptAsMarkdown(session));
});

app.post("/v1/sessions/:sessionId/fork", async (request, reply) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({
    messageId: z.string().optional(),
    name: z.string().min(1).max(200).optional(),
    includeAbandonedBranchSummary: z.boolean().default(false),
  }).parse(request.body ?? {});
  const forked = await engine.supervisor.forkSession({
    sourceSessionId: sessionId,
    ...(body.messageId ? { messageId: body.messageId } : {}),
    ...(body.name ? { name: body.name } : {}),
    includeAbandonedBranchSummary: body.includeAbandonedBranchSummary,
  });
  return await reply.code(201).send(forked);
});

const commandBodySchema = z.object({
  commandId: z.string().optional(),
  clientId: z.string().default("control-api"),
  tenantId: z.string().default("local"),
  expectedGeneration: z.number().int().nonnegative().optional(),
  kind: z.enum([
    "session.prompt", "session.cancel", "session.pause", "session.resume", "session.close", "session.compact",
    "session.tree.get", "session.tree.branch", "session.tree.label",
    "goal.set", "goal.pause", "goal.resume", "goal.complete", "goal.clear", "autonomous.configure", "model.select", "agent.message",
    "task.list", "task.create", "task.update",
  ]),
  source: z.enum(["web", "cli", "api", "scheduler", "agent", "telegram", "discord", "slack", "webhook"]).default("api"),
  payload: z.unknown().default({}),
});
app.post("/v1/sessions/:sessionId/commands", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = commandBodySchema.parse(request.body ?? {});
  const raw = {
    protocolVersion: 1,
    commandId: body.commandId ?? randomUUID(),
    clientId: body.clientId,
    tenantId: body.tenantId,
    sessionId,
    ...(body.expectedGeneration !== undefined ? { expectedGeneration: body.expectedGeneration } : {}),
    kind: body.kind,
    source: body.source,
    issuedAt: new Date().toISOString(),
    payload: body.payload,
  };
  const parsed = commandEnvelopeSchema.parse(raw);
  return await engine.command(parsed as CommandEnvelope);
});

async function executeSessionCapability(
  sessionId: string,
  capabilityId: string,
  input: unknown,
  source: "web" | "api" = "web",
  idempotencyKey?: string,
) {
  const session = await engine.session(sessionId);
  return await engine.capabilities.execute(capabilityId, input, {
    tenantId: session.tenantId,
    sessionId: session.sessionId,
    familyId: session.familyId,
    turnId: `bff:${randomUUID()}`,
    toolCallId: randomUUID(),
    source,
    workspacePath: session.workspacePath,
    idempotencyKey: idempotencyKey && /^[A-Za-z0-9_.:-]{8,200}$/.test(idempotencyKey)
      ? `bff:${sessionId}:${capabilityId}:${idempotencyKey}`
      : `bff:${sessionId}:${capabilityId}:${randomUUID()}`,
  });
}

app.get("/v1/sessions/:sessionId/files", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const query = z.object({ path: z.string().default("."), maxEntries: z.coerce.number().int().positive().max(5000).default(1000) }).parse(request.query);
  return await executeSessionCapability(sessionId, "filesystem.list", query);
});
app.get("/v1/sessions/:sessionId/file", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const query = z.object({ path: z.string().min(1), maxChars: z.coerce.number().int().positive().max(1_000_000).default(300_000) }).parse(request.query);
  return await executeSessionCapability(sessionId, "filesystem.read", query);
});
app.put("/v1/sessions/:sessionId/file", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({ path: z.string().min(1), content: z.string().max(2_000_000) }).parse(request.body);
  return await executeSessionCapability(sessionId, "filesystem.write", body, "web", request.headers["x-idempotency-key"] as string | undefined);
});
app.post("/v1/sessions/:sessionId/attachments", async (request, reply) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(200).default("application/octet-stream"),
    base64: z.string().min(1).max(3_900_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  }).parse(request.body);
  const safeName = body.fileName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "attachment.bin";
  const path = `.haf/uploads/${Date.now()}-${randomUUID()}-${safeName}`;
  const artifact = await executeSessionCapability(sessionId, "filesystem.write_binary", {
    path,
    base64: body.base64,
    ...(body.sha256 ? { expectedSha256: body.sha256 } : {}),
  }, "web", request.headers["x-idempotency-key"] as string | undefined);
  return await reply.code(201).send({ ...artifact as object, fileName: safeName, mimeType: body.mimeType });
});

app.get("/v1/sessions/:sessionId/artifacts", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const session = await engine.session(sessionId);
  return { artifacts: await engine.interactiveArtifacts.list(session.tenantId, sessionId) };
});
app.post("/v1/sessions/:sessionId/artifacts", async (request, reply) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const session = await engine.session(sessionId);
  const body = z.object({ name: z.string().min(1).max(200), sourcePath: z.string().min(1), allowedActions: z.array(z.string().min(1).max(100)).min(1).max(32) }).parse(request.body);
  return await reply.code(201).send(await engine.interactiveArtifacts.publish({
    tenantId: session.tenantId, sessionId, workspacePath: session.workspacePath,
    name: body.name, sourcePath: body.sourcePath, allowedActions: body.allowedActions,
  }));
});
app.post("/v1/artifacts/:artifactId/frame", async (request) => {
  const { artifactId } = z.object({ artifactId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), sessionId: z.string() }).parse(request.body);
  const artifact = await engine.interactiveArtifacts.get(artifactId, body.tenantId);
  if (artifact.sessionId !== body.sessionId) throw new Error("Artifact/session mismatch.");
  const grant = await engine.interactiveArtifacts.createFrame({ id: artifactId, tenantId: body.tenantId, sessionId: body.sessionId });
  return { ...grant, frameUrl: `/v1/artifacts/${artifactId}/frame?tenantId=${encodeURIComponent(body.tenantId)}&sessionId=${encodeURIComponent(body.sessionId)}&channel=${encodeURIComponent(grant.channel)}` };
});
app.get("/v1/artifacts/:artifactId/frame", async (request, reply) => {
  const { artifactId } = z.object({ artifactId: z.string().uuid() }).parse(request.params);
  const query = z.object({ tenantId: z.string().default("local"), sessionId: z.string(), channel: z.string() }).parse(request.query);
  const session = await engine.session(query.sessionId);
  if (session.tenantId !== query.tenantId) return await reply.code(403).send({ error: "tenant_mismatch" });
  const html = await engine.interactiveArtifacts.renderFrame({
    id: artifactId, tenantId: query.tenantId, sessionId: query.sessionId, workspacePath: session.workspacePath, channel: query.channel,
  });
  return await reply
    .header("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'; object-src 'none'; sandbox allow-scripts")
    .header("x-content-type-options", "nosniff")
    .header("referrer-policy", "no-referrer")
    .header("cache-control", "no-store")
    .type("text/html; charset=utf-8")
    .send(html);
});
app.post("/v1/artifacts/:artifactId/interactions", async (request, reply) => {
  const { artifactId } = z.object({ artifactId: z.string().uuid() }).parse(request.params);
  const body = z.object({
    tenantId: z.string().default("local"), sessionId: z.string(), channel: z.string(),
    interactionId: z.string().min(8).max(200), action: z.string().min(1).max(100), payload: z.unknown().default(null),
  }).parse(request.body);
  const accepted = await engine.interactiveArtifacts.acceptInteraction({
    artifactId, tenantId: body.tenantId, sessionId: body.sessionId, channel: body.channel,
    interactionId: body.interactionId, action: body.action, payload: body.payload as JsonValue,
  });
  if (accepted.duplicate) return { ok: accepted.interaction.status === "delivered", duplicate: true, status: accepted.interaction.status };
  try {
    const result = await engine.command({
      protocolVersion: 1, commandId: `artifact:${artifactId}:${body.interactionId}`, clientId: `artifact:${artifactId}`,
      tenantId: body.tenantId, sessionId: body.sessionId, kind: "artifact.interaction", source: "web",
      issuedAt: new Date().toISOString(), payload: { text: accepted.prompt },
    });
    const finalText = typeof (result.result as any)?.finalText === "string" ? String((result.result as any).finalText) : "";
    const status = result.status === "completed" ? "delivered" : result.status === "uncertain" ? "uncertain" : "failed";
    await engine.interactiveArtifacts.completeInteraction(body.interactionId, body.tenantId, {
      status, ...(finalText ? { response: finalText } : {}), ...(result.error?.code ? { errorCode: result.error.code } : {}),
    });
    return await reply.code(result.status === "completed" ? 200 : result.status === "uncertain" ? 202 : 422).send({
      ok: result.status === "completed", status, result: finalText.slice(0, 100_000), ...(result.error ? { error: result.error.code } : {}),
    });
  } catch (error) {
    await engine.interactiveArtifacts.completeInteraction(body.interactionId, body.tenantId, { status: "failed", errorCode: "dispatch_failed" });
    throw error;
  }
});
app.get("/v1/sessions/:sessionId/artifact-interactions", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const session = await engine.session(sessionId);
  return { interactions: await engine.interactiveArtifacts.interactions(session.tenantId, sessionId) };
});
app.patch("/v1/artifacts/:artifactId", async (request) => {
  const { artifactId } = z.object({ artifactId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.interactiveArtifacts.setEnabled(artifactId, body.tenantId, body.enabled);
});
app.delete("/v1/artifacts/:artifactId", async (request, reply) => {
  const { artifactId } = z.object({ artifactId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return await engine.interactiveArtifacts.remove(artifactId, tenantId) ? await reply.code(204).send() : await reply.code(404).send({ error: "artifact_not_found" });
});

app.post("/v1/sessions/:sessionId/terminal", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({ command: z.string().min(1).max(50_000), cwd: z.string().optional(), timeoutMs: z.number().int().positive().max(600_000).optional() }).parse(request.body);
  return await executeSessionCapability(sessionId, "process.exec", {
    command: body.command,
    ...(body.cwd ? { cwd: body.cwd } : {}),
    ...(body.timeoutMs ? { timeoutMs: body.timeoutMs } : {}),
    maxOutputChars: 500_000,
  }, "web", request.headers["x-idempotency-key"] as string | undefined);
});
app.get("/v1/sessions/:sessionId/changes", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const [status, diff] = await Promise.all([
    executeSessionCapability(sessionId, "git.status", {}),
    executeSessionCapability(sessionId, "git.diff", { staged: false }),
  ]) as [any, any];
  return { status: status.output, diff: diff.output, stdout: `${status.output}\n---DIFF---\n${diff.output}` };
});
app.get("/v1/sessions/:sessionId/git/branches", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  return await executeSessionCapability(sessionId, "git.branch.list", {});
});
app.post("/v1/sessions/:sessionId/git/branches", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({ name: z.string().min(1).max(200), startPoint: z.string().min(1).max(200).optional() }).parse(request.body);
  return await executeSessionCapability(sessionId, "git.branch.create", body, "web", request.headers["x-idempotency-key"] as string | undefined);
});
app.post("/v1/sessions/:sessionId/git/switch", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({ name: z.string().min(1).max(200) }).parse(request.body);
  return await executeSessionCapability(sessionId, "git.branch.switch", body, "web", request.headers["x-idempotency-key"] as string | undefined);
});
app.post("/v1/sessions/:sessionId/git/commit", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({
    message: z.string().min(1).max(10_000),
    paths: z.array(z.string().min(1).max(1000)).min(1).max(200),
    authorName: z.string().min(1).max(200).optional(),
    authorEmail: z.string().email().max(320).optional(),
  }).parse(request.body);
  return await executeSessionCapability(sessionId, "git.commit", body, "web", request.headers["x-idempotency-key"] as string | undefined);
});
app.post("/v1/sessions/:sessionId/channels/send", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({
    platform: z.string().min(1), destination: z.string().min(1), text: z.string().min(1).max(100_000),
    threadId: z.string().optional(), mediaPath: z.string().optional(),
  }).parse(request.body);
  return await executeSessionCapability(sessionId, "channel.send", body, "web", request.headers["x-idempotency-key"] as string | undefined);
});

app.post("/v1/sessions/:sessionId/media/video", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({
    prompt: z.string().min(1).max(20_000),
    aspectRatio: z.enum(["landscape", "square", "portrait"]).default("landscape"),
    durationSeconds: z.number().int().min(1).max(30).optional(),
    sourcePath: z.string().optional(),
    sourcePaths: z.array(z.string().min(1)).max(4).optional(),
    providerId: z.string().optional(),
  }).parse(request.body);
  return await executeSessionCapability(sessionId, "video.generate", body, "web", request.headers["x-idempotency-key"] as string | undefined);
});
app.post("/v1/sessions/:sessionId/media/video/upscale", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({ sourcePath: z.string().min(1), providerId: z.string().min(1), scale: z.union([z.literal(2), z.literal(4)]) }).parse(request.body);
  return await executeSessionCapability(sessionId, "video.upscale", body, "web", request.headers["x-idempotency-key"] as string | undefined);
});
app.post("/v1/sessions/:sessionId/media/video/jobs", async (request, reply) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const session = await engine.session(sessionId);
  const body = z.object({
    providerId: z.string().min(1), prompt: z.string().min(1).max(20_000),
    aspectRatio: z.enum(["landscape", "square", "portrait"]).default("landscape"),
    durationSeconds: z.number().int().min(1).max(30).optional(),
    sourcePath: z.string().optional(), sourcePaths: z.array(z.string().min(1)).max(4).optional(),
  }).parse(request.body);
  return await reply.code(202).send(await engine.mediaJobs.submitVideo({
    tenantId: session.tenantId, sessionId, workspacePath: session.workspacePath,
    providerId: body.providerId, prompt: body.prompt, aspectRatio: body.aspectRatio,
    ...(body.durationSeconds ? { durationSeconds: body.durationSeconds } : {}),
    ...(body.sourcePath ? { sourcePath: body.sourcePath } : {}),
    ...(body.sourcePaths?.length ? { sourcePaths: body.sourcePaths } : {}),
    idempotencyKey: typeof request.headers["x-idempotency-key"] === "string" ? request.headers["x-idempotency-key"] : randomUUID(),
  }));
});
app.get("/v1/media/jobs", async (request) => {
  const query = z.object({ tenantId: z.string().default("local"), sessionId: z.string().optional() }).parse(request.query);
  return { jobs: await engine.mediaJobs.list(query.tenantId, query.sessionId) };
});
app.get("/v1/media/jobs/:jobId", async (request) => {
  const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return await engine.mediaJobs.get(jobId, tenantId);
});
app.post("/v1/media/jobs/:jobId/poll", async (request) => {
  const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.body ?? {});
  const job = await engine.mediaJobs.get(jobId, tenantId);
  const session = await engine.session(job.sessionId);
  if (session.tenantId !== tenantId) throw new Error("Media job/session tenant mismatch.");
  return await engine.mediaJobs.poll({ id: jobId, tenantId, workspacePath: session.workspacePath });
});
app.post("/v1/media/jobs/:jobId/cancel", async (request) => {
  const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.body ?? {});
  return await engine.mediaJobs.cancel({ id: jobId, tenantId });
});
app.post("/v1/sessions/:sessionId/media/image", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({
    prompt: z.string().min(1).max(20_000),
    aspectRatio: z.enum(["landscape", "square", "portrait"]).default("landscape"),
    count: z.number().int().min(1).max(4).default(1),
    sourcePath: z.string().optional(),
    sourcePaths: z.array(z.string().min(1)).max(8).optional(),
    upscale: z.object({ providerId: z.string().min(1), scale: z.union([z.literal(2), z.literal(4)]) }).optional(),
    providerId: z.string().optional(),
    model: z.string().optional(),
  }).parse(request.body);
  return await executeSessionCapability(sessionId, "image.generate", body, "web", request.headers["x-idempotency-key"] as string | undefined);
});
app.post("/v1/sessions/:sessionId/media/image/upscale", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({
    sourcePath: z.string().min(1), providerId: z.string().min(1), scale: z.union([z.literal(2), z.literal(4)]),
  }).parse(request.body);
  return await executeSessionCapability(sessionId, "image.upscale", body, "web", request.headers["x-idempotency-key"] as string | undefined);
});

app.post("/v1/sessions/:sessionId/browser", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.discriminatedUnion("action", [
    z.object({ action: z.literal("navigate"), url: z.string().url() }),
    z.object({ action: z.literal("snapshot") }),
    z.object({ action: z.literal("click"), ref: z.string() }),
    z.object({ action: z.literal("type"), ref: z.string(), text: z.string(), submit: z.boolean().default(false) }),
    z.object({ action: z.literal("press"), key: z.string() }),
  ]).parse(request.body);
  const mapping = { navigate: "browser.navigate", snapshot: "browser.snapshot", click: "browser.click", type: "browser.type", press: "browser.press" } as const;
  const { action, ...input } = body;
  return await executeSessionCapability(sessionId, mapping[action], input, "web", request.headers["x-idempotency-key"] as string | undefined);
});

app.get("/v1/sessions/:sessionId/events", async (request) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const query = z.object({ afterSequence: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().positive().max(5000).default(1000) }).parse(request.query);
  return { events: (await engine.readEvents(sessionId, query.afterSequence, query.limit)).filter((event) => event.visibility !== "internal") };
});

app.get("/v1/sessions/:sessionId/events/stream", async (request, reply) => {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params);
  const query = z.object({ afterSequence: z.coerce.number().int().nonnegative().default(0) }).parse(request.query);
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (event: any) => {
    if (event?.visibility === "internal") return;
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  for (const event of await engine.readEvents(sessionId, query.afterSequence, 5000)) send(event);
  const unsubscribe = engine.subscribe(sessionId, send);
  const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    reply.raw.end();
  });
});

app.post("/v1/detached-workers", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    name: z.string().min(1).max(200).optional(),
  }).parse(request.body ?? {});
  const workerId = randomUUID();
  const client = await detachedWorkers.spawn({
    workerId,
    entrypoint: detachedWorkerEntrypoint,
    env: {
      HAF_WORKER_HOME: resolve(homePath, "detached", workerId),
      HAF_WORKER_TENANT_ID: body.tenantId,
      HAF_WORKER_SESSION_NAME: body.name ?? `detached-${workerId.slice(0, 8)}`,
    },
    startupTimeoutMs: 30_000,
  });
  const state = JSON.parse((await client.command("state")).toString("utf8"));
  return await reply.code(201).send({ workerId, state, cursor: client.cursor });
});

app.get("/v1/detached-workers", async () => {
  const adopted = await detachedWorkers.adoptAll(true);
  const workers = [];
  for (const item of adopted) {
    if (item.status === "stale" || !item.client) {
      workers.push({ workerId: item.workerId, status: "stale" });
      continue;
    }
    try {
      const state = JSON.parse((await item.client.command("state", Buffer.alloc(0), 5000)).toString("utf8"));
      workers.push({
        workerId: item.workerId,
        status: item.status === "recovered" ? "recovered" : "running",
        state,
        cursor: item.client.cursor,
      });
    } catch {
      workers.push({ workerId: item.workerId, status: "unreachable" });
    }
  }
  return { workers };
});

app.get("/v1/detached-workers/:workerId", async (request) => {
  const { workerId } = z.object({ workerId: z.string() }).parse(request.params);
  const client = await detachedWorkers.adopt(workerId);
  return {
    workerId,
    state: JSON.parse((await client.command("state")).toString("utf8")),
    cursor: client.cursor,
  };
});

app.post("/v1/detached-workers/:workerId/commands", async (request) => {
  const { workerId } = z.object({ workerId: z.string() }).parse(request.params);
  const body = commandBodySchema.parse(request.body ?? {});
  const raw = {
    protocolVersion: 1,
    commandId: body.commandId ?? randomUUID(),
    clientId: body.clientId,
    tenantId: body.tenantId,
    sessionId: workerId,
    ...(body.expectedGeneration !== undefined ? { expectedGeneration: body.expectedGeneration } : {}),
    kind: body.kind,
    source: body.source,
    issuedAt: new Date().toISOString(),
    payload: body.payload,
  };
  const command = commandEnvelopeSchema.parse(raw) as CommandEnvelope;
  const client = await detachedWorkers.adopt(workerId);
  return JSON.parse((await client.command("dispatch", command)).toString("utf8"));
});

app.get("/v1/detached-workers/:workerId/events/stream", async (request, reply) => {
  const { workerId } = z.object({ workerId: z.string() }).parse(request.params);
  const query = z.object({
    generation: z.coerce.number().int().nonnegative().default(0),
    sequence: z.coerce.number().int().nonnegative().default(0),
  }).parse(request.query);
  const client = await detachedWorkers.adopt(workerId);
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  const unsubscribeEvent = client.onEvent((event) => {
    let payload: unknown = event.payload.toString("utf8");
    try { payload = JSON.parse(payload as string); } catch {}
    send({ type: event.eventType, cursor: event.cursor, payload });
  });
  const unsubscribeResync = client.onResyncRequired((cursor) => send({ type: "resync_required", cursor }));
  try {
    const attached = await client.attach({ generation: query.generation, sequence: query.sequence });
    send({
      type: "attached",
      replay: attached.replay,
      cursor: attached.cursor,
      ...(attached.snapshot ? { snapshot: JSON.parse(attached.snapshot.toString("utf8")) } : {}),
    });
  } catch (error) {
    send({ type: "attach_error", error: error instanceof Error ? error.message : String(error) });
  }
  const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribeEvent();
    unsubscribeResync();
    reply.raw.end();
  });
});

app.get("/v1/detached-workers/:workerId/approvals", async (request) => {
  const { workerId } = z.object({ workerId: z.string() }).parse(request.params);
  const client = await detachedWorkers.adopt(workerId);
  return JSON.parse((await client.command("approvals_list")).toString("utf8"));
});
app.post("/v1/detached-workers/:workerId/approvals/:approvalId/resolve", async (request) => {
  const { workerId, approvalId } = z.object({ workerId: z.string(), approvalId: z.string() }).parse(request.params);
  const { decision } = z.object({ decision: z.enum(["approve_once", "approve_session", "deny"]) }).parse(request.body);
  const client = await detachedWorkers.adopt(workerId);
  return JSON.parse((await client.command("approval_resolve", { id: approvalId, decision })).toString("utf8"));
});
app.delete("/v1/detached-workers/:workerId", async (request, reply) => {
  const { workerId } = z.object({ workerId: z.string() }).parse(request.params);
  await detachedWorkers.stop(workerId);
  return await reply.code(204).send();
});

app.get("/v1/approvals", async (request) => {
  const query = z.object({ sessionId: z.string().optional() }).parse(request.query);
  return { approvals: engine.approvals.list(query.sessionId) };
});

app.post("/v1/approvals/:approvalId/resolve", async (request) => {
  const { approvalId } = z.object({ approvalId: z.string() }).parse(request.params);
  const { decision } = z.object({ decision: z.enum(["approve_once", "approve_session", "deny"]) }).parse(request.body);
  return engine.approvals.resolve(approvalId, decision);
});

const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), at: z.string().datetime() }),
  z.object({ kind: z.literal("interval"), everyMs: z.number().int().min(1000) }),
  z.object({ kind: z.literal("cron"), expression: z.string().min(1), timezone: z.string().optional() }),
]);
app.post("/v1/schedules", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    sessionId: z.string(),
    prompt: z.string().min(1),
    schedule: scheduleSchema,
    label: z.string().optional(),
  }).parse(request.body);
  const schedule = body.schedule.kind === "cron"
    ? { kind: "cron" as const, expression: body.schedule.expression, ...(body.schedule.timezone ? { timezone: body.schedule.timezone } : {}) }
    : body.schedule;
  return await reply.code(201).send(await engine.schedule({
    tenantId: body.tenantId,
    sessionId: body.sessionId,
    prompt: body.prompt,
    schedule,
    ...(body.label ? { label: body.label } : {}),
  }));
});

app.get("/v1/schedules", async (request) => {
  const query = z.object({ tenantId: z.string().optional() }).parse(request.query);
  return { jobs: await engine.scheduler.list(query.tenantId) };
});

app.post("/v1/schedules/:jobId/status", async (request) => {
  const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
  const { status } = z.object({ status: z.enum(["active", "paused", "cancelled"]) }).parse(request.body);
  return await engine.scheduler.setStatus(jobId, status);
});

app.post("/v1/cron/fire", async (request, reply) => {
  if (!engine.hostedScheduler) return await reply.code(503).send({ error: "hosted_scheduler_not_configured" });
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return await reply.code(401).send({ error: "missing_cron_fire_token" });
  const body = z.object({ job_id: z.string(), fire_at: z.string().datetime() }).parse(request.body);
  const claims = await engine.hostedScheduler.verifyFire(token);
  if (claims.jobId !== body.job_id || claims.fireAt !== body.fire_at) return await reply.code(401).send({ error: "cron_fire_claim_mismatch" });
  void engine.hostedScheduler.handleFire(token, body, engine.scheduler).catch((error) => {
    app.log.error({ errorClass: error instanceof Error ? error.name : "unknown" }, "hosted cron fire failed");
  });
  return await reply.code(202).send({ status: "accepted", jobId: body.job_id });
});

const automationTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("schedule"), schedule: scheduleSchema }),
  z.object({ kind: z.literal("webhook"), eventType: z.string().min(1), secretEnvironmentVariable: z.string().optional() }),
]);
app.get("/v1/automation-responders", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { responders: await engine.automationResponders.list(tenantId) };
});
app.post("/v1/automation-responders", async (request, reply) => {
  const body = z.object({ tenantId: z.string().default("local"), name: z.string().min(1).max(200), automationId: z.string().uuid(), credentialSecretId: z.string().min(1), heartbeatIntervalMs: z.number().int().min(10_000).max(3_600_000).optional() }).parse(request.body);
  return await reply.code(201).send(await engine.automationResponders.add({ tenantId: body.tenantId, name: body.name, automationId: body.automationId, credentialSecretId: body.credentialSecretId, ...(body.heartbeatIntervalMs ? { heartbeatIntervalMs: body.heartbeatIntervalMs } : {}) }));
});
app.patch("/v1/automation-responders/:responderId", async (request) => {
  const { responderId } = z.object({ responderId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.automationResponders.setEnabled(responderId, body.tenantId, body.enabled);
});
app.post("/v1/automation-responders/:responderId/credential", async (request) => {
  const { responderId } = z.object({ responderId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), credentialSecretId: z.string().min(1) }).parse(request.body);
  return await engine.automationResponders.rotateCredential(responderId, body.tenantId, body.credentialSecretId);
});
app.delete("/v1/automation-responders/:responderId", async (request, reply) => {
  const { responderId } = z.object({ responderId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return await engine.automationResponders.remove(responderId, tenantId) ? await reply.code(204).send() : await reply.code(404).send({ error: "automation_responder_not_found" });
});
function responderHeaders(request: any) {
  const timestamp = request.headers["x-haf-responder-timestamp"] as string | undefined;
  const nonce = request.headers["x-haf-responder-nonce"] as string | undefined;
  const signature = request.headers["x-haf-responder-signature"] as string | undefined;
  return { ...(timestamp ? { timestamp } : {}), ...(nonce ? { nonce } : {}), ...(signature ? { signature } : {}) };
}
app.post("/v1/automation-responders/:responderId/heartbeat", async (request, reply) => {
  const { responderId } = z.object({ responderId: z.string().uuid() }).parse(request.params);
  const raw = (request as any).rawBody as Buffer | undefined;
  if (!raw) throw new Error("Automation responder raw body is unavailable.");
  try { return await engine.automationResponders.acceptHeartbeat(responderId, raw, responderHeaders(request), request.body); }
  catch { return await reply.code(401).send({ accepted: false, error: "automation_responder_verification_failed" }); }
});
app.post("/v1/automation-responders/:responderId/events", async (request, reply) => {
  const { responderId } = z.object({ responderId: z.string().uuid() }).parse(request.params);
  const raw = (request as any).rawBody as Buffer | undefined;
  if (!raw) throw new Error("Automation responder raw body is unavailable.");
  try { return await reply.code(202).send(await engine.automationResponders.acceptEvent(responderId, raw, responderHeaders(request), request.body)); }
  catch { return await reply.code(401).send({ accepted: false, error: "automation_responder_verification_failed" }); }
});

app.get("/v1/automation-git-sources", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { sources: await engine.automationGitSync.list(tenantId) };
});
app.post("/v1/automation-git-sources", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"), name: z.string().min(1).max(200),
    providerId: z.string().min(1), repositoryId: z.string().min(1),
    manifestPath: z.string().min(1).max(500), ref: z.string().min(1).max(200), sessionId: z.string().min(1),
    webhookSecretEnvironmentVariable: z.string().regex(/^[A-Z_][A-Z0-9_]{0,199}$/).optional(),
    allowedModels: z.array(z.string().min(1).max(300)).max(20).optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.automationGitSync.add({
    tenantId: body.tenantId, name: body.name, providerId: body.providerId,
    repositoryId: body.repositoryId, manifestPath: body.manifestPath, ref: body.ref, sessionId: body.sessionId,
    ...(body.webhookSecretEnvironmentVariable ? { webhookSecretEnvironmentVariable: body.webhookSecretEnvironmentVariable } : {}),
    ...(body.allowedModels ? { allowedModels: body.allowedModels } : {}),
  }));
});
app.patch("/v1/automation-git-sources/:sourceId", async (request) => {
  const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.automationGitSync.setEnabled(sourceId, body.tenantId, body.enabled);
});
app.delete("/v1/automation-git-sources/:sourceId", async (request, reply) => {
  const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return await engine.automationGitSync.remove(sourceId, tenantId)
    ? await reply.code(204).send()
    : await reply.code(404).send({ error: "automation_git_source_not_found" });
});
app.post("/v1/automation-git-sources/:sourceId/plan", async (request) => {
  const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.body ?? {});
  return await engine.automationGitSync.plan(sourceId, tenantId);
});
app.post("/v1/automation-git-sources/:sourceId/apply", async (request) => {
  const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(request.body);
  return await engine.automationGitSync.apply(sourceId, body.tenantId, body.expectedManifestSha256);
});

app.get("/v1/automations", async (request) => {
  const query = z.object({ tenantId: z.string().optional() }).parse(request.query);
  return { automations: await engine.automations.list(query.tenantId) };
});
app.post("/v1/automations", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    name: z.string().min(1),
    description: z.string().optional(),
    sessionId: z.string(),
    prompt: z.string().min(1),
    trigger: automationTriggerSchema,
    enabled: z.boolean().default(true),
    timeoutMs: z.number().int().positive().optional(),
    model: z.string().optional(),
  }).parse(request.body);
  let trigger: AutomationTrigger;
  if (body.trigger.kind === "manual") trigger = { kind: "manual" };
  else if (body.trigger.kind === "webhook") {
    trigger = {
      kind: "webhook",
      eventType: body.trigger.eventType,
      ...(body.trigger.secretEnvironmentVariable ? { secretEnvironmentVariable: body.trigger.secretEnvironmentVariable } : {}),
    };
  } else if (body.trigger.schedule.kind === "cron") {
    trigger = {
      kind: "schedule",
      schedule: {
        kind: "cron",
        expression: body.trigger.schedule.expression,
        ...(body.trigger.schedule.timezone ? { timezone: body.trigger.schedule.timezone } : {}),
      },
    };
  } else trigger = { kind: "schedule", schedule: body.trigger.schedule };
  return await reply.code(201).send(await engine.automations.create({
    tenantId: body.tenantId,
    name: body.name,
    ...(body.description ? { description: body.description } : {}),
    sessionId: body.sessionId,
    prompt: body.prompt,
    trigger,
    enabled: body.enabled,
    ...(body.timeoutMs ? { timeoutMs: body.timeoutMs } : {}),
    ...(body.model ? { model: body.model } : {}),
  }));
});
app.get("/v1/automations/:automationId", async (request) => {
  const { automationId } = z.object({ automationId: z.string() }).parse(request.params);
  return await engine.automations.get(automationId);
});
app.patch("/v1/automations/:automationId", async (request) => {
  const { automationId } = z.object({ automationId: z.string() }).parse(request.params);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
  return await engine.automations.setEnabled(automationId, enabled);
});
app.post("/v1/automations/:automationId/dispatch", async (request) => {
  const { automationId } = z.object({ automationId: z.string() }).parse(request.params);
  return await engine.automations.dispatch(automationId, "manual");
});
app.get("/v1/automations/:automationId/runs", async (request) => {
  const { automationId } = z.object({ automationId: z.string() }).parse(request.params);
  const { limit } = z.object({ limit: z.coerce.number().int().positive().max(1000).default(100) }).parse(request.query);
  return { runs: await engine.automations.listRuns(automationId, limit) };
});
app.post("/v1/automations/:automationId/webhook", async (request, reply) => {
  const { automationId } = z.object({ automationId: z.string() }).parse(request.params);
  const automation = await engine.automations.get(automationId);
  if (automation.trigger.kind !== "webhook") return await reply.code(409).send({ error: "not_webhook_automation" });
  const environmentVariable = automation.trigger.secretEnvironmentVariable;
  if (!environmentVariable || !process.env[environmentVariable]) return await reply.code(503).send({ error: "webhook_secret_not_configured" });
  if (request.headers["x-haf-automation-secret"] !== process.env[environmentVariable]) {
    return await reply.code(401).send({ error: "invalid_webhook_secret" });
  }
  return await engine.automations.dispatch(automationId, "webhook", request.body as JsonValue);
});

app.get("/v1/learning/refinement-reviews", async (request) => {
  const query = z.object({ tenantId: z.string().default("local"), sessionId: z.string().optional() }).parse(request.query);
  return { reviews: await engine.refinementPlanner.list(query.tenantId, query.sessionId) };
});
app.post("/v1/learning/refinements/plan", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    sessionId: z.string(),
    instructions: z.string().max(5000).optional(),
  }).parse(request.body);
  const session = await engine.session(body.sessionId);
  if (session.tenantId !== body.tenantId) return await reply.code(403).send({ error: "tenant_mismatch" });
  try {
    return await engine.refinementPlanner.plan(body.sessionId, "manual", body.instructions);
  } catch (error) {
    return await reply.code(422).send({
      error: "refinement_planner_rejected_output",
      message: error instanceof Error ? error.message.slice(0, 1000) : "Refinement planner failed.",
    });
  }
});

app.get("/v1/learning/refinements", async (request) => {
  const query = z.object({ tenantId: z.string().default("local"), sessionId: z.string().optional() }).parse(request.query);
  return { batches: await engine.refinements.list(query.tenantId, query.sessionId) };
});
app.post("/v1/learning/refinements", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    sessionId: z.string(),
    trigger: z.string().min(1).max(1000),
    rationale: z.string().min(1).max(5000),
    scope: z.enum(["session", "project", "user", "org"]).default("session"),
    evidenceEventIds: z.array(z.string()).max(200).default([]),
    edits: z.array(z.object({
      kind: z.enum(["memory", "skill", "prompt_addendum", "subagent_spec"]),
      title: z.string().min(1).max(300),
      content: z.string().min(1).max(100_000),
      expectedOutcome: z.string().min(1).max(5000),
      risk: z.enum(["low", "medium", "high"]).optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    })).min(1).max(8),
  }).parse(request.body);
  return await reply.code(201).send(await engine.refinements.create({
    tenantId: body.tenantId,
    sessionId: body.sessionId,
    trigger: body.trigger,
    rationale: body.rationale,
    scope: body.scope,
    evidenceEventIds: body.evidenceEventIds,
    edits: body.edits.map((edit) => ({
      kind: edit.kind,
      title: edit.title,
      content: edit.content,
      expectedOutcome: edit.expectedOutcome,
      ...(edit.payload ? { payload: edit.payload as Record<string, JsonValue> } : {}),
      ...(edit.risk ? { risk: edit.risk } : {}),
    })),
    createdBy: "user",
  }));
});
app.post("/v1/learning/refinements/:refinementId/rollback", async (request) => {
  const { refinementId } = z.object({ refinementId: z.string() }).parse(request.params);
  return await engine.refinements.rollback(refinementId);
});

app.get("/v1/learning/candidates", async (request) => {
  const query = z.object({
    tenantId: z.string().default("local"),
    status: z.enum(["candidate", "scanned", "evaluated", "approved", "promoted", "rejected", "rolled_back"]).optional(),
  }).parse(request.query);
  return { candidates: await engine.learning.list(query.tenantId, query.status) };
});
app.post("/v1/learning/candidates", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"),
    sessionId: z.string(),
    kind: z.enum(["memory", "skill", "prompt_addendum", "subagent_spec"]),
    scope: z.enum(["session", "project", "user", "org"]).default("session"),
    title: z.string(),
    content: z.string(),
    payload: z.record(z.any()).optional(),
    evidenceEventIds: z.array(z.string()).default([]),
    expectedOutcome: z.string(),
    risk: z.enum(["low", "medium", "high"]).optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.learning.propose({
    tenantId: body.tenantId,
    sessionId: body.sessionId,
    kind: body.kind,
    scope: body.scope,
    title: body.title,
    content: body.content,
    payload: (body.payload ?? {}) as Record<string, JsonValue>,
    evidenceEventIds: body.evidenceEventIds,
    expectedOutcome: body.expectedOutcome,
    ...(body.risk ? { risk: body.risk } : {}),
    createdBy: "user",
  }));
});
app.post("/v1/learning/candidates/:candidateId/evaluation", async (request) => {
  const { candidateId } = z.object({ candidateId: z.string() }).parse(request.params);
  const body = z.object({ passed: z.boolean(), checks: z.array(z.string()).default([]), summary: z.string() }).parse(request.body);
  return await engine.learning.recordEvaluation(candidateId, body);
});
app.post("/v1/learning/candidates/:candidateId/review", async (request) => {
  const { candidateId } = z.object({ candidateId: z.string() }).parse(request.params);
  const body = z.object({ decision: z.enum(["approve", "reject"]), reviewer: z.string().min(1), reason: z.string().optional() }).parse(request.body);
  return await engine.learning.review(candidateId, {
    decision: body.decision,
    reviewer: body.reviewer,
    ...(body.reason ? { reason: body.reason } : {}),
  });
});
app.post("/v1/learning/candidates/:candidateId/promote", async (request) => {
  const { candidateId } = z.object({ candidateId: z.string() }).parse(request.params);
  return await engine.learning.promote(candidateId);
});
app.post("/v1/learning/candidates/:candidateId/rollback", async (request) => {
  const { candidateId } = z.object({ candidateId: z.string() }).parse(request.params);
  return await engine.learning.rollback(candidateId);
});

app.get("/v1/learning/releases", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { releases: await engine.learningRollouts.list(tenantId) };
});
app.post("/v1/learning/releases", async (request, reply) => {
  const body = z.object({
    candidateId: z.string(), evalCommands: z.array(z.string()).min(1),
    canaryPercentage: z.number().min(1).max(100).optional(),
    minSamples: z.number().int().positive().optional(),
    requiredSuccessRate: z.number().min(0.5).max(1).optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.learningRollouts.create({
    candidateId: body.candidateId,
    evalCommands: body.evalCommands,
    ...(body.canaryPercentage !== undefined ? { canaryPercentage: body.canaryPercentage } : {}),
    ...(body.minSamples !== undefined ? { minSamples: body.minSamples } : {}),
    ...(body.requiredSuccessRate !== undefined ? { requiredSuccessRate: body.requiredSuccessRate } : {}),
  }));
});
app.post("/v1/learning/releases/:releaseId/evaluate", async (request) => {
  const { releaseId } = z.object({ releaseId: z.string() }).parse(request.params);
  return await engine.learningRollouts.runEvaluation(releaseId);
});
app.post("/v1/learning/releases/:releaseId/sign", async (request) => {
  const { releaseId } = z.object({ releaseId: z.string() }).parse(request.params);
  const body = z.object({ keyId: z.string(), signature: z.string() }).parse(request.body);
  return await engine.learningRollouts.submitSignature(releaseId, body);
});
app.post("/v1/learning/releases/:releaseId/outcomes", async (request) => {
  const { releaseId } = z.object({ releaseId: z.string() }).parse(request.params);
  const { success } = z.object({ success: z.boolean() }).parse(request.body);
  return await engine.learningRollouts.recordOutcome(releaseId, success);
});
app.post("/v1/learning/releases/:releaseId/rollback", async (request) => {
  const { releaseId } = z.object({ releaseId: z.string() }).parse(request.params);
  return await engine.learningRollouts.rollback(releaseId);
});

app.post("/v1/memories/:memoryId/promote", async (request) => {
  const { memoryId } = z.object({ memoryId: z.string() }).parse(request.params);
  return await engine.memory.promote(memoryId);
});

app.post("/v1/platforms/twilio/webhook", async (request, reply) => {
  if (!twilioSmsAdapter || !process.env.TWILIO_WEBHOOK_URL) return await reply.code(503).send({ error: "twilio_sms_webhook_not_configured" });
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) return await reply.code(400).send({ error: "twilio_sms_form_body_required" });
  try {
    await twilioSmsAdapter.acceptInbound(request.body as Record<string, unknown>, request.headers["x-twilio-signature"] as string | undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return await reply.code(message.includes("signature") ? 401 : 403).send({ error: message.includes("signature") ? "invalid_twilio_signature" : "twilio_sms_not_allowed" });
  }
  return await reply.type("text/xml; charset=utf-8").send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

app.post("/v1/platforms/github-app/webhook", async (request, reply) => {
  const raw = (request as any).rawBody as Buffer | undefined;
  if (!raw) return await reply.code(400).send({ error: "github_app_raw_body_missing" });
  try {
    return await engine.githubApps.ingestWebhook({
      rawBody: raw,
      signature: request.headers["x-hub-signature-256"] as string | undefined,
      deliveryId: request.headers["x-github-delivery"] as string | undefined,
      event: request.headers["x-github-event"] as string | undefined,
      payload: request.body,
    });
  } catch (error) {
    if (error instanceof GitHubAppWebhookVerificationError) return await reply.code(401).send({ error: "invalid_github_app_webhook_signature" });
    throw error;
  }
});

app.post("/v1/platforms/telegram/webhook", async (request, reply) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return await reply.code(503).send({ error: "telegram_webhook_not_configured" });
  if (request.headers["x-telegram-bot-api-secret-token"] !== expectedSecret) {
    return await reply.code(401).send({ error: "invalid_telegram_webhook_secret" });
  }
  const update = request.body as any;
  const message = update?.message ?? update?.edited_message ?? update?.channel_post;
  if (!message?.chat?.id || !message?.from?.id || typeof message?.text !== "string") {
    return { ok: true, ignored: true };
  }
  const userId = String(message.from.id);
  const chatId = String(message.chat.id);
  const allowedUsers = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const allowedChats = new Set((process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowedUsers.size && !allowedChats.size) return await reply.code(503).send({ error: "telegram_allowlist_not_configured" });
  const authorized = allowedUsers.has(userId) || allowedChats.has(chatId);
  if (!authorized) return await reply.code(403).send({ error: "telegram_sender_not_allowed" });
  const delivery = await engine.channels.ingest({
    tenantId: process.env.TELEGRAM_TENANT_ID ?? "local",
    platform: "telegram",
    chatId,
    chatType: message.chat.type === "private" ? "dm" : message.message_thread_id ? "thread" : "group",
    userId,
    text: message.text,
    messageId: String(message.message_id ?? update.update_id),
    authorized: true,
    ...(message.message_thread_id ? { threadId: String(message.message_thread_id) } : {}),
    metadata: { username: String(message.from.username ?? "") },
  });
  if (engine.outboundChannels.list().includes("telegram") && delivery.text) {
    await engine.outboundChannels.send("telegram", {
      destination: chatId,
      text: delivery.text,
      ...(message.message_thread_id ? { threadId: String(message.message_thread_id) } : {}),
    });
  }
  return { ok: true, sessionId: delivery.sessionId, status: delivery.status };
});

app.post("/v1/platforms/slack/webhook", async (request, reply) => {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const raw = (request as any).rawBody as Buffer | undefined;
  if (!signingSecret || !raw) return await reply.code(503).send({ error: "slack_webhook_not_configured" });
  if (!verifySlackSignature({
    rawBody: raw,
    timestamp: request.headers["x-slack-request-timestamp"] as string | undefined,
    signature: request.headers["x-slack-signature"] as string | undefined,
    signingSecret,
  })) return await reply.code(401).send({ error: "invalid_slack_signature" });
  const body = request.body as any;
  if (body?.type === "url_verification") return { challenge: body.challenge };
  const event = body?.event;
  if (!event || event.bot_id || event.subtype === "bot_message" || typeof event.text !== "string") return { ok: true, ignored: true };
  const userId = String(event.user ?? "");
  const channelId = String(event.channel ?? "");
  if (!allowlisted(userId, process.env.SLACK_ALLOWED_USER_IDS) && !allowlisted(channelId, process.env.SLACK_ALLOWED_CHANNEL_IDS)) {
    return await reply.code(403).send({ error: "slack_sender_not_allowed" });
  }
  const delivery = await engine.channels.ingest({
    tenantId: process.env.SLACK_TENANT_ID ?? "local",
    platform: "slack",
    chatId: channelId,
    chatType: event.thread_ts ? "thread" : "channel",
    userId,
    text: event.text,
    messageId: String(body.event_id ?? event.client_msg_id ?? event.ts),
    authorized: true,
    ...(event.thread_ts ? { threadId: String(event.thread_ts) } : {}),
  });
  if (engine.outboundChannels.list().includes("slack") && delivery.text) {
    await engine.outboundChannels.send("slack", { destination: channelId, text: delivery.text, ...(event.thread_ts ? { threadId: String(event.thread_ts) } : {}) });
  }
  return { ok: true, sessionId: delivery.sessionId };
});

app.post("/v1/platforms/discord/webhook", async (request, reply) => {
  const publicKey = process.env.DISCORD_APPLICATION_PUBLIC_KEY;
  const raw = (request as any).rawBody as Buffer | undefined;
  if (!publicKey || !raw) return await reply.code(503).send({ error: "discord_webhook_not_configured" });
  if (!verifyDiscordSignature({
    rawBody: raw,
    signature: request.headers["x-signature-ed25519"] as string | undefined,
    timestamp: request.headers["x-signature-timestamp"] as string | undefined,
    publicKeyHex: publicKey,
  })) return await reply.code(401).send({ error: "invalid_discord_signature" });
  const body = request.body as any;
  if (body?.type === 1) return { type: 1 };
  const userId = String(body?.member?.user?.id ?? body?.user?.id ?? "");
  const channelId = String(body?.channel_id ?? "");
  if (!allowlisted(userId, process.env.DISCORD_ALLOWED_USER_IDS) && !allowlisted(channelId, process.env.DISCORD_ALLOWED_CHANNEL_IDS)) {
    return await reply.code(403).send({ error: "discord_sender_not_allowed" });
  }
  const optionText = Array.isArray(body?.data?.options) ? body.data.options.map((option: any) => `${option.name}=${option.value}`).join(" ") : "";
  const text = String(body?.data?.name ? `/${body.data.name} ${optionText}` : body?.message?.content ?? body?.data?.custom_id ?? "").trim();
  if (!text) return { type: 4, data: { content: "No actionable text was supplied.", flags: 64 } };
  void engine.channels.ingest({
    tenantId: process.env.DISCORD_TENANT_ID ?? "local",
    platform: "discord",
    chatId: channelId,
    chatType: body?.guild_id ? "channel" : "dm",
    userId,
    text,
    messageId: String(body.id),
    authorized: true,
  }).then(async (delivery) => {
    if (engine.outboundChannels.list().includes("discord") && delivery.text) {
      await engine.outboundChannels.send("discord", { destination: channelId, text: delivery.text });
    }
  }).catch((error) => app.log.error({ errorClass: error instanceof Error ? error.name : "unknown" }, "discord background delivery failed"));
  return { type: 5 };
});

app.get("/v1/platforms/whatsapp/webhook", async (request, reply) => {
  const query = request.query as Record<string, string | undefined>;
  if (query["hub.mode"] === "subscribe" && verifySharedSecret(query["hub.verify_token"], process.env.WHATSAPP_VERIFY_TOKEN)) {
    return await reply.type("text/plain").send(query["hub.challenge"] ?? "");
  }
  return await reply.code(403).send({ error: "whatsapp_verification_failed" });
});
app.post("/v1/platforms/whatsapp/webhook", async (request, reply) => {
  const raw = (request as any).rawBody as Buffer | undefined;
  if (!raw || !process.env.WHATSAPP_APP_SECRET) return await reply.code(503).send({ error: "whatsapp_webhook_not_configured" });
  if (!verifyWhatsAppSignature(raw, request.headers["x-hub-signature-256"] as string | undefined, process.env.WHATSAPP_APP_SECRET)) {
    return await reply.code(401).send({ error: "invalid_whatsapp_signature" });
  }
  const body = request.body as any;
  const messages = (body?.entry ?? []).flatMap((entry: any) => (entry.changes ?? []).flatMap((change: any) => change?.value?.messages ?? []));
  for (const message of messages) {
    const userId = String(message.from ?? "");
    if (!allowlisted(userId, process.env.WHATSAPP_ALLOWED_PHONE_NUMBERS)) continue;
    const text = String(message?.text?.body ?? message?.button?.text ?? message?.interactive?.button_reply?.title ?? "");
    if (!text) continue;
    const delivery = await engine.channels.ingest({
      tenantId: process.env.WHATSAPP_TENANT_ID ?? "local", platform: "whatsapp", chatId: userId,
      chatType: "dm", userId, text, messageId: String(message.id), authorized: true,
    });
    if (engine.outboundChannels.list().includes("whatsapp") && delivery.text) {
      await engine.outboundChannels.send("whatsapp", { destination: userId, text: delivery.text });
    }
  }
  return { ok: true };
});

app.post("/v1/platforms/signal/webhook", async (request, reply) => {
  if (!verifySharedSecret(request.headers["x-haf-signal-secret"] as string | undefined, process.env.SIGNAL_WEBHOOK_SECRET)) {
    return await reply.code(401).send({ error: "invalid_signal_secret" });
  }
  const body = request.body as any;
  const envelope = body?.envelope ?? body;
  const userId = String(envelope?.sourceNumber ?? envelope?.source ?? "");
  if (!allowlisted(userId, process.env.SIGNAL_ALLOWED_NUMBERS)) return await reply.code(403).send({ error: "signal_sender_not_allowed" });
  const text = String(envelope?.dataMessage?.message ?? envelope?.message ?? "");
  if (!text) return { ok: true, ignored: true };
  const delivery = await engine.channels.ingest({
    tenantId: process.env.SIGNAL_TENANT_ID ?? "local", platform: "signal", chatId: userId,
    chatType: "dm", userId, text, messageId: String(envelope?.timestamp ?? randomUUID()), authorized: true,
  });
  if (engine.outboundChannels.list().includes("signal") && delivery.text) await engine.outboundChannels.send("signal", { destination: userId, text: delivery.text });
  return { ok: true, sessionId: delivery.sessionId };
});

app.post("/v1/platforms/matrix/webhook", async (request, reply) => {
  if (!verifySharedSecret(request.headers["x-haf-matrix-secret"] as string | undefined, process.env.MATRIX_WEBHOOK_SECRET)) {
    return await reply.code(401).send({ error: "invalid_matrix_secret" });
  }
  const event = request.body as any;
  const userId = String(event?.sender ?? "");
  const roomId = String(event?.room_id ?? "");
  if (!allowlisted(userId, process.env.MATRIX_ALLOWED_USER_IDS) && !allowlisted(roomId, process.env.MATRIX_ALLOWED_ROOM_IDS)) {
    return await reply.code(403).send({ error: "matrix_sender_not_allowed" });
  }
  const text = String(event?.content?.body ?? "");
  if (!text || event?.content?.msgtype !== "m.text") return { ok: true, ignored: true };
  const delivery = await engine.channels.ingest({
    tenantId: process.env.MATRIX_TENANT_ID ?? "local", platform: "matrix", chatId: roomId,
    chatType: "channel", userId, text, messageId: String(event?.event_id ?? randomUUID()), authorized: true,
  });
  if (engine.outboundChannels.list().includes("matrix") && delivery.text) await engine.outboundChannels.send("matrix", { destination: roomId, text: delivery.text });
  return { ok: true, sessionId: delivery.sessionId };
});

app.post("/v1/platforms/mattermost/webhook", async (request, reply) => {
  const expected = process.env.MATTERMOST_WEBHOOK_TOKEN;
  if (!expected) return await reply.code(503).send({ error: "mattermost_webhook_not_configured" });
  const body = request.body as any;
  const provided = (request.headers["x-mattermost-token"] as string | undefined) ?? (typeof body?.token === "string" ? body.token : undefined);
  if (!verifySharedSecret(provided, expected)) return await reply.code(401).send({ error: "invalid_mattermost_token" });
  const userId = String(body?.user_id ?? ""), channelId = String(body?.channel_id ?? ""), text = String(body?.text ?? "").trim();
  if (!allowlisted(userId, process.env.MATTERMOST_ALLOWED_USER_IDS) && !allowlisted(channelId, process.env.MATTERMOST_ALLOWED_CHANNEL_IDS)) return await reply.code(403).send({ error: "mattermost_sender_not_allowed" });
  if (!text) return { ok: true, ignored: true };
  void engine.channels.ingest({
    tenantId: process.env.MATTERMOST_TENANT_ID ?? "local", platform: "mattermost", chatId: channelId,
    chatType: body?.root_id ? "thread" : "channel", userId, text,
    messageId: String(body?.post_id ?? randomUUID()), authorized: true,
    ...(body?.root_id ? { threadId: String(body.root_id) } : {}),
  }).then(async (delivery) => {
    if (engine.outboundChannels.list().includes("mattermost") && delivery.text) await engine.outboundChannels.send("mattermost", { destination: channelId, text: delivery.text, ...(body?.root_id ? { threadId: String(body.root_id) } : {}) });
  }).catch((error) => app.log.error({ errorClass: error instanceof Error ? error.name : "unknown" }, "mattermost background delivery failed"));
  return { ok: true };
});

app.post("/v1/platforms/line/webhook", async (request, reply) => {
  const raw = (request as any).rawBody as Buffer | undefined;
  if (!raw || !process.env.LINE_CHANNEL_SECRET) return await reply.code(503).send({ error: "line_webhook_not_configured" });
  if (!verifyLineSignature(raw, request.headers["x-line-signature"] as string | undefined, process.env.LINE_CHANNEL_SECRET)) return await reply.code(401).send({ error: "invalid_line_signature" });
  const events = Array.isArray((request.body as any)?.events) ? (request.body as any).events.slice(0, 100) : [];
  for (const event of events) {
    if (event?.type !== "message" || event?.message?.type !== "text") continue;
    const userId = String(event?.source?.userId ?? "");
    const chatId = String(event?.source?.groupId ?? event?.source?.roomId ?? userId);
    if (!allowlisted(userId, process.env.LINE_ALLOWED_USER_IDS) && !allowlisted(chatId, process.env.LINE_ALLOWED_CHAT_IDS)) continue;
    void engine.channels.ingest({
      tenantId: process.env.LINE_TENANT_ID ?? "local", platform: "line", chatId,
      chatType: event?.source?.type === "user" ? "dm" : "group", userId,
      text: String(event.message.text), messageId: String(event?.webhookEventId ?? event?.message?.id ?? randomUUID()), authorized: true,
    }).then(async (delivery) => {
      if (engine.outboundChannels.list().includes("line") && delivery.text) await engine.outboundChannels.send("line", { destination: chatId, text: delivery.text });
    }).catch((error) => app.log.error({ errorClass: error instanceof Error ? error.name : "unknown" }, "line background delivery failed"));
  }
  return { ok: true };
});

app.post("/v1/platforms/google-chat/webhook", async (request, reply) => {
  if (!googleChatJwtVerifier) return await reply.code(503).send({ error: "google_chat_webhook_not_configured" });
  try { await googleChatJwtVerifier.verify(request.headers.authorization); }
  catch { return await reply.code(401).send({ error: "invalid_google_chat_token" }); }
  const body = request.body as any;
  if (String(body?.type ?? "").toUpperCase() !== "MESSAGE") return { ok: true, ignored: true };
  const userId = String(body?.user?.name ?? body?.message?.sender?.name ?? "");
  const spaceId = String(body?.space?.name ?? body?.message?.space?.name ?? "");
  if (!allowlisted(userId, process.env.GOOGLE_CHAT_ALLOWED_USER_IDS) && !allowlisted(spaceId, process.env.GOOGLE_CHAT_ALLOWED_SPACE_IDS)) return await reply.code(403).send({ error: "google_chat_sender_not_allowed" });
  const text = String(body?.message?.argumentText ?? body?.message?.text ?? "").trim();
  if (!text) return { ok: true, ignored: true };
  const threadId = body?.message?.thread?.name ? String(body.message.thread.name) : undefined;
  void engine.channels.ingest({
    tenantId: process.env.GOOGLE_CHAT_TENANT_ID ?? "local", platform: "google-chat", chatId: spaceId,
    chatType: threadId ? "thread" : "channel", userId, text,
    messageId: String(body?.message?.name ?? randomUUID()), authorized: true, ...(threadId ? { threadId } : {}),
  }).then(async (delivery) => {
    if (engine.outboundChannels.list().includes("google-chat") && delivery.text) await engine.outboundChannels.send("google-chat", { destination: spaceId, text: delivery.text, ...(threadId ? { threadId } : {}) });
  }).catch((error) => app.log.error({ errorClass: error instanceof Error ? error.name : "unknown" }, "google chat background delivery failed"));
  return { ok: true };
});

app.post("/v1/platforms/teams/webhook", async (request, reply) => {
  if (!teamsJwtVerifier) return await reply.code(503).send({ error: "teams_webhook_not_configured" });
  try { await teamsJwtVerifier.verify(request.headers.authorization); }
  catch { return await reply.code(401).send({ error: "invalid_teams_token" }); }
  const activity = request.body as any;
  if (activity?.type !== "message") return { ok: true, ignored: true };
  const userId = String(activity?.from?.id ?? ""), conversationId = String(activity?.conversation?.id ?? "");
  if (!allowlisted(userId, process.env.TEAMS_ALLOWED_USER_IDS) && !allowlisted(conversationId, process.env.TEAMS_ALLOWED_CONVERSATION_IDS)) return await reply.code(403).send({ error: "teams_sender_not_allowed" });
  const text = String(activity?.text ?? "").replace(/<at>[^<]*<\/at>/gi, "").trim();
  if (!text) return { ok: true, ignored: true };
  const threadId = activity?.replyToId ? String(activity.replyToId) : undefined;
  void engine.channels.ingest({
    tenantId: process.env.TEAMS_TENANT_ID ?? "local", platform: "teams", chatId: conversationId,
    chatType: threadId ? "thread" : "channel", userId, text, messageId: String(activity?.id ?? randomUUID()),
    authorized: true, ...(threadId ? { threadId } : {}), metadata: { channelId: String(activity?.channelId ?? "") },
  }).then(async (delivery) => {
    if (engine.outboundChannels.list().includes("teams") && delivery.text) await engine.outboundChannels.send("teams", { destination: `chat:${conversationId}`, text: delivery.text });
  }).catch((error) => app.log.error({ errorClass: error instanceof Error ? error.name : "unknown" }, "teams background delivery failed"));
  return { ok: true };
});

app.post("/v1/platforms/feishu/webhook", async (request, reply) => {
  const raw = (request as any).rawBody as Buffer | undefined;
  const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
  if (!raw || !verificationToken) return await reply.code(503).send({ error: "feishu_webhook_not_configured" });
  if (process.env.FEISHU_ENCRYPT_KEY && !verifyFeishuSignature({
    rawBody: raw,
    timestamp: request.headers["x-lark-request-timestamp"] as string | undefined,
    nonce: request.headers["x-lark-request-nonce"] as string | undefined,
    signature: request.headers["x-lark-signature"] as string | undefined,
    encryptKey: process.env.FEISHU_ENCRYPT_KEY,
  })) return await reply.code(401).send({ error: "invalid_feishu_signature" });
  const body = request.body as any;
  const suppliedToken = String(body?.header?.token ?? body?.token ?? "");
  if (!verifySharedSecret(suppliedToken, verificationToken)) return await reply.code(401).send({ error: "invalid_feishu_token" });
  if (body?.type === "url_verification") return { challenge: body.challenge };
  if (body?.header?.event_type !== "im.message.receive_v1") return { ok: true, ignored: true };
  const event = body?.event;
  const userId = String(event?.sender?.sender_id?.open_id ?? event?.sender?.sender_id?.user_id ?? "");
  const chatId = String(event?.message?.chat_id ?? "");
  if (!allowlisted(userId, process.env.FEISHU_ALLOWED_USER_IDS) && !allowlisted(chatId, process.env.FEISHU_ALLOWED_CHAT_IDS)) return await reply.code(403).send({ error: "feishu_sender_not_allowed" });
  let content: any = {};
  try { content = JSON.parse(String(event?.message?.content ?? "{}")); } catch {}
  const text = String(content?.text ?? "").trim();
  if (!text) return { ok: true, ignored: true };
  const threadId = event?.message?.root_id ? String(event.message.root_id) : undefined;
  void engine.channels.ingest({
    tenantId: process.env.FEISHU_TENANT_ID ?? "local", platform: "feishu", chatId,
    chatType: threadId ? "thread" : event?.message?.chat_type === "p2p" ? "dm" : "group",
    userId, text, messageId: String(body?.header?.event_id ?? event?.message?.message_id ?? randomUUID()), authorized: true,
    ...(threadId ? { threadId } : {}),
  }).then(async (delivery) => {
    if (engine.outboundChannels.list().includes("feishu") && delivery.text) await engine.outboundChannels.send("feishu", { destination: chatId, text: delivery.text, ...(event?.message?.message_id ? { threadId: String(event.message.message_id) } : {}) });
  }).catch((error) => app.log.error({ errorClass: error instanceof Error ? error.name : "unknown" }, "feishu background delivery failed"));
  return { ok: true };
});

app.get("/v1/channel-routing-rules", async (request) => {
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return { rules: await engine.channels.listRoutingRules(tenantId) };
});
app.post("/v1/channel-routing-rules", async (request, reply) => {
  const body = z.object({
    tenantId: z.string().default("local"), name: z.string().min(1).max(200),
    priority: z.number().int().min(-10000).max(10000).optional(),
    platforms: z.array(z.string()).max(50).optional(),
    chatTypes: z.array(z.enum(["dm", "group", "channel", "thread"])).max(4).optional(),
    chatIds: z.array(z.string()).max(500).optional(), userIds: z.array(z.string()).max(500).optional(),
    metadataEquals: z.record(z.string(), z.string()).optional(),
    sessionScope: z.enum(["chat", "user", "thread"]).default("chat"),
    agentProfileId: z.string().optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.channels.addRoutingRule({
    tenantId: body.tenantId,
    name: body.name,
    sessionScope: body.sessionScope,
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.platforms ? { platforms: body.platforms } : {}),
    ...(body.chatTypes ? { chatTypes: body.chatTypes } : {}),
    ...(body.chatIds ? { chatIds: body.chatIds } : {}),
    ...(body.userIds ? { userIds: body.userIds } : {}),
    ...(body.metadataEquals ? { metadataEquals: body.metadataEquals } : {}),
    ...(body.agentProfileId ? { agentProfileId: body.agentProfileId } : {}),
  }));
});
app.patch("/v1/channel-routing-rules/:ruleId", async (request) => {
  const { ruleId } = z.object({ ruleId: z.string() }).parse(request.params);
  const body = z.object({ tenantId: z.string().default("local"), enabled: z.boolean() }).parse(request.body);
  return await engine.channels.setRoutingRuleEnabled(ruleId, body.tenantId, body.enabled);
});
app.delete("/v1/channel-routing-rules/:ruleId", async (request, reply) => {
  const { ruleId } = z.object({ ruleId: z.string() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  return await engine.channels.removeRoutingRule(ruleId, tenantId) ? await reply.code(204).send() : await reply.code(404).send({ error: "routing_rule_not_found" });
});

app.get("/v1/channels/adapters", async () => ({ adapters: engine.outboundChannels.list(), statuses: engine.outboundChannels.statuses() }));
app.get("/v1/channels/routes", async (request) => {
  const query = z.object({ tenantId: z.string().optional() }).parse(request.query);
  return { routes: await engine.channels.listRoutes(query.tenantId) };
});
app.post("/v1/channels/webhook/:platform", async (request, reply) => {
  const expected = process.env.HAF_WEBHOOK_TOKEN;
  if (!expected) return await reply.code(503).send({ error: "webhook_not_configured" });
  if (request.headers["x-haf-webhook-token"] !== expected) return await reply.code(401).send({ error: "unauthorized_webhook" });
  const { platform } = z.object({ platform: z.string().min(1) }).parse(request.params);
  const body = z.object({
    tenantId: z.string().default("local"),
    chatId: z.string().min(1),
    chatType: z.enum(["dm", "group", "channel", "thread"]).default("dm"),
    userId: z.string().min(1),
    text: z.string().min(1),
    threadId: z.string().optional(),
    messageId: z.string().optional(),
    metadata: z.record(z.string()).optional(),
  }).parse(request.body);
  return await engine.channels.ingest({
    tenantId: body.tenantId,
    platform,
    chatId: body.chatId,
    chatType: body.chatType,
    userId: body.userId,
    text: body.text,
    authorized: true,
    ...(body.threadId ? { threadId: body.threadId } : {}),
    ...(body.messageId ? { messageId: body.messageId } : {}),
    ...(body.metadata ? { metadata: body.metadata } : {}),
  });
});

app.get("/v1/plugins/wasi", async () => ({ configured: Boolean(engine.wasiPlugins), plugins: engine.wasiPlugins?.list() ?? [] }));
app.post("/v1/plugins/wasi", async (request, reply) => {
  if (!engine.wasiPlugins) return await reply.code(409).send({ error: "wasi_plugins_not_configured" });
  const { sourceDirectory } = z.object({ sourceDirectory: z.string().min(1) }).parse(request.body);
  return await reply.code(201).send(await engine.wasiPlugins.install(sourceDirectory));
});
app.delete("/v1/plugins/wasi/:pluginId", async (request, reply) => {
  if (!engine.wasiPlugins) return await reply.code(409).send({ error: "wasi_plugins_not_configured" });
  const { pluginId } = z.object({ pluginId: z.string() }).parse(request.params);
  await engine.wasiPlugins.uninstall(pluginId);
  return await reply.code(204).send();
});

app.get("/v1/mcp/elicitations", async (request) => {
  const query = z.object({
    tenantId: z.string().default("local"),
    status: z.enum(["pending", "accepted", "declined", "cancelled", "expired"]).default("pending"),
  }).parse(request.query);
  return { elicitations: await engine.mcpElicitations.list(query.tenantId, query.status) };
});
app.post("/v1/mcp/elicitations/:elicitationId/resolve", async (request, reply) => {
  const { elicitationId } = z.object({ elicitationId: z.string() }).parse(request.params);
  const body = z.object({
    tenantId: z.string().default("local"),
    action: z.enum(["accept", "decline", "cancel"]),
    content: z.record(z.string(), z.unknown()).optional(),
  }).parse(request.body);
  try {
    return await engine.mcpElicitations.resolve(body.tenantId, elicitationId, {
      action: body.action,
      ...(body.content ? { content: body.content as Record<string, JsonValue> } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missing = message.includes("missing, expired") || message.includes("no live transport");
    return await reply.code(missing ? 409 : 400).send({ error: "mcp_elicitation_resolution_failed", message });
  }
});

app.get("/v1/mcp/servers", async () => ({ servers: engine.mcp.list() }));
app.get("/v1/mcp/schema-cache", async () => ({ schemas: await engine.mcp.listCachedSchemas() }));
app.post("/v1/mcp/servers/stdio", async (request, reply) => {
  const body = z.object({
    name: z.string().min(1),
    tenantId: z.string().default("local"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    defaultRisk: z.enum(["pure", "workspace_read", "workspace_write", "process", "network", "external_side_effect", "privileged"]).optional(),
  }).parse(request.body);
  return await reply.code(201).send(await engine.mcp.connectStdio({
    name: body.name,
    tenantId: body.tenantId,
    command: body.command,
    ...(body.args ? { args: body.args } : {}),
    ...(body.cwd ? { cwd: body.cwd } : {}),
    ...(body.env ? { env: body.env } : {}),
    ...(body.defaultRisk ? { defaultRisk: body.defaultRisk } : {}),
  }));
});
app.post("/v1/mcp/servers/http", async (request, reply) => {
  const body = z.object({
    name: z.string().min(1),
    tenantId: z.string().default("local"),
    url: z.string().url(),
    defaultRisk: z.enum(["pure", "workspace_read", "workspace_write", "process", "network", "external_side_effect", "privileged"]).optional(),
    bearerTokenEnvironmentVariable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    headerEnvironmentVariables: z.record(z.string().regex(/^[A-Za-z0-9-]{1,100}$/), z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).optional(),
    tlsCertificatePathEnvironmentVariable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    tlsPrivateKeyPathEnvironmentVariable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    tlsCaPathEnvironmentVariable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    tlsServerName: z.string().max(253).optional(),
    oauth: z.object({
      clientIdEnvironmentVariable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
      clientSecretEnvironmentVariable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
      scopes: z.array(z.string().min(1).max(200)).max(50).optional(),
      authorizationServerOrigins: z.array(z.string().url().max(8192)).max(20).optional(),
    }).optional(),
    allowPlainHttp: z.boolean().default(false),
    toolTimeoutMs: z.number().int().min(1000).max(600_000).optional(),
  }).parse(request.body);
  const headers: Record<string, string> = {};
  if (body.bearerTokenEnvironmentVariable) {
    const token = process.env[body.bearerTokenEnvironmentVariable];
    if (!token) throw new Error(`MCP bearer token environment variable ${body.bearerTokenEnvironmentVariable} is not set.`);
    headers.authorization = `Bearer ${token}`;
  }
  for (const [header, environmentVariable] of Object.entries(body.headerEnvironmentVariables ?? {})) {
    const value = process.env[environmentVariable];
    if (!value) throw new Error(`MCP header environment variable ${environmentVariable} is not set.`);
    headers[header] = value;
  }
  const hasAnyTls = Boolean(body.tlsCertificatePathEnvironmentVariable || body.tlsPrivateKeyPathEnvironmentVariable || body.tlsCaPathEnvironmentVariable);
  if (hasAnyTls && (!body.tlsCertificatePathEnvironmentVariable || !body.tlsPrivateKeyPathEnvironmentVariable)) {
    throw new Error("MCP mTLS requires both certificate and private-key path environment variables.");
  }
  const readTlsFile = async (environmentVariable: string): Promise<Buffer> => {
    const path = process.env[environmentVariable];
    if (!path) throw new Error(`MCP TLS path environment variable ${environmentVariable} is not set.`);
    const data = await readFile(path);
    if (data.length > 1024 * 1024) throw new Error(`MCP TLS file referenced by ${environmentVariable} exceeds 1 MiB.`);
    return data;
  };
  const tls = hasAnyTls ? {
    certificate: await readTlsFile(body.tlsCertificatePathEnvironmentVariable!),
    privateKey: await readTlsFile(body.tlsPrivateKeyPathEnvironmentVariable!),
    ...(body.tlsCaPathEnvironmentVariable ? { certificateAuthority: await readTlsFile(body.tlsCaPathEnvironmentVariable) } : {}),
    ...(body.tlsServerName ? { serverName: body.tlsServerName } : {}),
  } : undefined;
  if (body.oauth && body.bearerTokenEnvironmentVariable) throw new Error("MCP OAuth cannot be combined with a static bearer token.");
  let oauthProvider: BrokerBackedMcpOAuthProvider | undefined;
  if (body.oauth) {
    const redirectUrl = process.env.HAF_MCP_OAUTH_REDIRECT_URI;
    if (!redirectUrl) throw new Error("HAF_MCP_OAUTH_REDIRECT_URI is required for MCP OAuth.");
    const clientId = body.oauth.clientIdEnvironmentVariable ? process.env[body.oauth.clientIdEnvironmentVariable] : undefined;
    const clientSecret = body.oauth.clientSecretEnvironmentVariable ? process.env[body.oauth.clientSecretEnvironmentVariable] : undefined;
    if (body.oauth.clientIdEnvironmentVariable && !clientId) throw new Error(`MCP OAuth client ID environment variable ${body.oauth.clientIdEnvironmentVariable} is not set.`);
    if (body.oauth.clientSecretEnvironmentVariable && !clientSecret) throw new Error(`MCP OAuth client secret environment variable ${body.oauth.clientSecretEnvironmentVariable} is not set.`);
    if (clientSecret && !clientId) throw new Error("MCP OAuth client secret requires a client ID.");
    oauthProvider = new BrokerBackedMcpOAuthProvider({
      tenantId: body.tenantId,
      serverUrl: body.url,
      redirectUrl,
      ...(clientId ? { clientId } : {}),
      ...(clientSecret ? { clientSecret } : {}),
      ...(body.oauth.scopes ? { scopes: body.oauth.scopes } : {}),
      ...(body.oauth.authorizationServerOrigins ? { authorizationServerOrigins: body.oauth.authorizationServerOrigins } : {}),
      broker: engine.credentials,
    });
  }
  const connection = await engine.mcp.connectHttp({
    name: body.name,
    tenantId: body.tenantId,
    url: body.url,
    ...(body.defaultRisk ? { defaultRisk: body.defaultRisk } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(tls ? { tls } : {}),
    ...(oauthProvider ? { oauthProvider } : {}),
    allowPlainHttp: body.allowPlainHttp,
    ...(body.toolTimeoutMs ? { toolTimeoutMs: body.toolTimeoutMs } : {}),
  });
  if (connection.authorizationRequired && connection.oauthConnectionId && connection.authorizationUrl && oauthProvider) {
    return await reply.code(202).send(connection);
  }
  return await reply.code(201).send(connection);
});

app.delete("/v1/mcp/servers/:name", async (request, reply) => {
  const { name } = z.object({ name: z.string() }).parse(request.params);
  await engine.mcp.disconnect(name);
  return await reply.code(204).send();
});

app.get("/v1/skills/hub/sources", async () => ({ sources: await engine.skillsHub.listSources() }));
app.post("/v1/skills/hub/sources", async (request, reply) => {
  const body = z.object({ id: z.string(), indexUrl: z.string().url(), trust: z.enum(["trusted", "community"]).default("community") }).parse(request.body);
  return await reply.code(201).send(await engine.skillsHub.addSource(body));
});
app.post("/v1/skills/hub/refresh", async (request) => {
  const body = z.object({ sourceId: z.string().optional() }).parse(request.body ?? {});
  return await engine.skillsHub.refresh(body.sourceId);
});
app.get("/v1/skills/hub/search", async (request) => {
  const query = z.object({ q: z.string().default(""), sourceId: z.string().optional(), limit: z.coerce.number().int().positive().max(100).default(50) }).parse(request.query);
  return { entries: await engine.skillsHub.search(query.q, { ...(query.sourceId ? { sourceId: query.sourceId } : {}), limit: query.limit }) };
});
app.post("/v1/skills/hub/install", async (request, reply) => {
  const body = z.object({ sourceId: z.string(), name: z.string(), version: z.string().optional() }).parse(request.body);
  return await reply.code(201).send(await engine.skillsHub.install({
    sourceId: body.sourceId,
    name: body.name,
    ...(body.version ? { version: body.version } : {}),
  }));
});

app.get("/v1/skills", async () => ({ skills: await engine.skills.list() }));
app.post("/v1/skills/candidates", async (request, reply) => {
  const body = z.object({ name: z.string(), description: z.string(), content: z.string(), source: z.string().default("control-api") }).parse(request.body);
  return await reply.code(201).send(await engine.skills.createCandidate({ ...body, createdBy: "user" }));
});
app.post("/v1/skills/candidates/:directory/promote", async (request) => {
  const { directory } = z.object({ directory: z.string() }).parse(request.params);
  const { tenantId } = z.object({ tenantId: z.string().default("local") }).parse(request.query);
  const manifest = await engine.skills.promote(directory);
  const skill = await engine.skills.get(manifest.name);
  await engine.knowledgeIndex.upsert({
    id: `skill:${manifest.name}`,
    tenantId,
    kind: "skill",
    text: `${manifest.name}\n${manifest.description}\n${skill.content}`,
    metadata: { skillName: manifest.name, version: manifest.version },
  });
  return manifest;
});

app.setErrorHandler(async (error, _request, reply) => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const status = normalized instanceof z.ZodError ? 400 : /does not exist|not found/i.test(normalized.message) ? 404 : 500;
  return await reply.code(status).send({
    error: normalized.name,
    message: normalized.message,
    ...(normalized instanceof z.ZodError ? { issues: normalized.issues } : {}),
  });
});

const host = process.env.HAF_HOST ?? "0.0.0.0";
const port = Number(process.env.HAF_PORT ?? 8787);
await app.listen({ host, port });

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  detachedWorkers.closeAttachments(); // Workers intentionally survive control-plane shutdown.
  await engine.shutdown();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
