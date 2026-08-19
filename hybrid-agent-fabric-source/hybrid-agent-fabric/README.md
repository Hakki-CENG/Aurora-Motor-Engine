# Hybrid Agent Fabric

A single, durable agent engine combining the strongest architectural ideas from:

- **OpenHands Agent Canvas:** control-center UX, backend abstraction and ACP interoperability.
- **Prime Agent:** supervisor/session ownership, replay, idempotency, persistent RLM and subagents.
- **Hermes Agent:** governed capabilities, sandbox adapters, channels, MCP, memory, skills and security posture.

This repository is a new implementation, not a claim that three multi-million-line products can be safely concatenated. The engine is built around explicit control-plane, runtime-plane and execution-plane contracts so integrations can be ported without recreating a monolith.

## Current milestone — 1.38.0

The current code is a **working integrated runtime and control-center foundation**, not yet full current-upstream feature parity with all three products. The exact re-audit against their 2026-08-18 default branches is recorded in [`docs/upstream-gap-audit-2026-08-18.md`](docs/upstream-gap-audit-2026-08-18.md).

Implemented and tested:

- durable session actor and supervisor
- process-safe stale-lock-aware session leases
- append-only event store with generation/sequence metadata
- snapshots and reconnectable REST/SSE replay
- command idempotency journal and explicit uncertain outcomes
- effect journal preventing silent replay of non-idempotent side effects
- mock, OpenAI-compatible Chat Completions, native OpenAI Responses, ChatGPT Codex subscription, Anthropic and Gemini providers
- explicit per-session fallback chains with no replay after partial output
- same-provider credential pools plus persistent audience-bound server-side model configurations
- OpenAI, Azure OpenAI, AWS Bedrock, Anthropic, OpenRouter, Google AI Studio, Vertex AI, Groq, xAI, DeepSeek, Mistral and Ollama profiles
- policy/approval-controlled capability broker
- confined text/binary filesystem, bounded multimodal attachment upload, typed local Git operations and process capabilities
- local, hardened Docker and digest-pinned Singularity/Apptainer sandbox adapters
- persistent Python kernel with JSON-safe snapshots
- generation-fenced, cancellation-aware `haf.call(...)` host bridge from Python
- persistent child-agent admission, family roster, durable messaging and inherited least-privilege agent profiles
- persistent goals, bounded autonomous continuation and quality gates
- durable dependency-aware task board with model capabilities and Canvas panel
- packaged rolling micro-compaction plus intent-preserving projection that never silently drops older user instructions
- bounded HTTPS bootstrap plus hosted GitHub/GitLab account discovery, review metadata and linked sync status
- native GitHub App installation lifecycle with broker-confined RSA keys/installation IDs/tokens, rotation and verified webhooks
- per-session provider:model switching
- durable once/interval/cron scheduler
- declarative manual/schedule/webhook automations with run ledger and timeout cancellation
- server-side multi-backend registry and health checks
- candidate/promote local memory plus optional Honcho cross-session user modeling with bounded per-turn recall/writeback
- tenant-scoped cross-session search
- quarantined, scanned and hashed skill registry
- stdio and guarded Streamable HTTP MCP with restart-resumable broker-encrypted OAuth/PKCE coordination
- normalized channel gateway with authorization, message-id deduplication and tenant profile-routing rules
- Native bidirectional channel routing/verification for Telegram, Discord, Slack, WhatsApp, Matrix, Signal, Mattermost, LINE, Google Chat, Teams, Feishu/Lark and signed webhooks
- long-lived TLS-first IRC/IRCv3 with CAP, message tags, account/nickname allowlists, SASL and reconnect generations
- TLS-first SMTP/IMAP email with shared-header verification, durable UID cursors, bounded MIME and uncertain-reply journals
- signed bidirectional Twilio SMS with exact E.164 allowlists, MessageSid dedupe and uncertain-reply protection
- plan/apply hosted Git automation manifests with exact content hashes, bounded authority and managed provenance
- generic OIDC/PKCE model credentials with encrypted refresh rotation, exact resource audiences and pre-output-only retry
- restart-persistent same-provider cooldown/disable state plus explicit custom-route data-policy labels
- signed external automation responder heartbeats/events with health, dedupe and uncertain no-replay journals
- Aurora Society roles, task marketplace, reputation/resource budgets and dissent-preserving council consensus
- Aurora Global Workspace cognitive objects, P0-P4 goal arbitration, attention budgets, modes and loop detection
- AES-256-GCM/Vault/KMS credential brokers, scoped leases and pinned 1Password/Bitwarden/command secret sources
- SSRF-checked bounded public web fetch and normalized Brave/Tavily web search
- Playwright/CDP browser automation and browser-scoped computer-use
- SSH sandbox with strict host verification and rsync workspace synchronization
- workspace-confined speech-to-text and text-to-speech
- bounded multi-reference image/video, verified upscaling and restart-persistent asynchronous media jobs
- versioned JSON/Markdown and privacy-preserving training trajectory export
- governed learning, model-planned evidence-bound refinement reviews, candidate promotion and rollback
- content-free Prometheus and OTLP/HTTP operational metrics
- ACP-compatible adapter plus dedicated remote TUI, one-shot and JSON-RPC/stdio headless client
- typed plugin hooks plus user-preserving context-engine and additive memory-provider transforms
- REST control API, multi-panel embedded control center, isolated interactive artifacts and live Server-Sent Events
- deterministic CycloneDX/SPDX SBOM, in-toto/SLSA provenance, checksums and optional Ed25519 release attestations

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the exact completed and remaining scope.

## Architecture

```mermaid
flowchart LR
  CLIENTS[Canvas · CLI · Channels · ACP] --> API[Control API]
  API --> SUP[Supervisor]
  SUP --> SESSION[Session Actor]
  SESSION --> MODEL[Model Router]
  SESSION --> KERNEL[Persistent Python Kernel]
  SESSION --> BROKER[Capability Broker]
  BROKER --> POLICY[Policy + Approval]
  BROKER --> SBOX[Local · Docker · Singularity · Remote Sandboxes]
  BROKER --> MCP[MCP Servers]
  SESSION --> EVENTS[(Event Log + Snapshots)]
  SESSION --> CHILDREN[Child Agent Family]
  SCHED[Durable Scheduler] --> SUP
  CHANNELS[Channel Gateway] --> SUP
```

## Security model

> [!WARNING]
> `HAF_SANDBOX_BACKEND=local` is a trusted-development backend. It confines the working directory used by built-in file tools, but a shell/Python process running as your OS user is **not** a security sandbox.

For untrusted repositories or prompts:

- use the Docker/gVisor/Kata/VM execution profile;
- keep sandbox network disabled or route it through an allowlist proxy;
- never inject long-lived provider credentials into the kernel;
- keep `HAF_API_TOKEN` set before exposing the API;
- require explicit approvals for process/network/external side effects.

The engine treats prompt instructions, approval regexes and file-tool denylists as defense in depth, not as the security boundary.

## Requirements

- Node.js 20+
- Python 3.10+
- Docker when `HAF_SANDBOX_BACKEND=docker`
- Apptainer/Singularity when `HAF_SANDBOX_BACKEND=singularity`

## Install and run

```bash
npm install
cp .env.example .env
npm run check

# Development mode. Environment values can be exported or loaded by your shell.
HAF_API_TOKEN=local-secret \
HAF_AUTO_APPROVE_WORKSPACE=true \
HAF_ALLOW_PROCESS=true \
npm run dev
```

Control API: `http://localhost:8787`.

`HAF_AUTO_APPROVE_WORKSPACE` and `HAF_ALLOW_PROCESS` are convenience switches for a trusted development machine. Leave them false for the normal approval workflow.

## First session

```bash
TOKEN=local-secret
SESSION=$(curl -sS -X POST http://localhost:8787/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"local","name":"first-agent"}')

SID=$(printf '%s' "$SESSION" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["sessionId"])')

curl -sS -X POST "http://localhost:8787/v1/sessions/$SID/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId":"local",
    "kind":"session.prompt",
    "source":"api",
    "payload":{"text":"Inspect this workspace"}
  }'
```

Live events:

```bash
curl -N "http://localhost:8787/v1/sessions/$SID/events/stream?afterSequence=0" \
  -H "Authorization: Bearer $TOKEN"
```

### Mock-provider tool calls

The deterministic mock provider recognizes this test syntax:

```text
[tool filesystem.write {"path":"hello.txt","content":"hello"}]
```

It is used by integration tests to prove the model → policy → approval/effect journal → capability → event flow without spending model tokens.

## Approval flow

When policy returns `require_approval`, the command remains pending while the control plane stays responsive:

```bash
curl -sS http://localhost:8787/v1/approvals \
  -H "Authorization: Bearer $TOKEN"

curl -sS -X POST http://localhost:8787/v1/approvals/APPROVAL_ID/resolve \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approve_once"}'
```

Decisions: `approve_once`, `approve_session`, `deny`.

## Persistent Python/RLM

The model-facing capability is `python.execute`. State survives calls and JSON-safe values are snapshotted:

```python
items = [1, 2, 3]
sum(items)
```

Governed host actions use the bridge:

```python
haf.call("filesystem.write", {
    "path": "result.txt",
    "content": str(sum(items)),
})
```

The bridge re-enters the same policy, approval, idempotency and audit pipeline as a normal model tool call. Protocol v2 binds every host request to a kernel generation, execution ID, per-execution token and request ID. Duplicate request IDs replay the prior response; cancellation or timeout kills the synchronous kernel and aborts in-flight host capabilities so late frames cannot regain authority.

## MCP

Connect a stdio MCP server:

```bash
curl -X POST http://localhost:8787/v1/mcp/servers/stdio \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"my-server",
    "command":"npx",
    "args":["-y","@example/mcp-server"],
    "defaultRisk":"network"
  }'
```

Discovered tools become namespaced capabilities such as `mcp.my-server.search`; they do not bypass policy.

Streamable HTTP servers use `/v1/mcp/servers/http`. Credentials are referenced by environment-variable name rather than accepted as raw API values:

```json
{
  "name": "remote-tools",
  "url": "https://mcp.example.com/mcp",
  "bearerTokenEnvironmentVariable": "REMOTE_MCP_TOKEN",
  "tlsCertificatePathEnvironmentVariable": "REMOTE_MCP_CERT_PATH",
  "tlsPrivateKeyPathEnvironmentVariable": "REMOTE_MCP_KEY_PATH",
  "tlsCaPathEnvironmentVariable": "REMOTE_MCP_CA_PATH",
  "defaultRisk": "network"
}
```

OAuth variant:

```json
{
  "name": "oauth-tools",
  "tenantId": "local",
  "url": "https://mcp.example.com/mcp",
  "oauth": {
    "clientIdEnvironmentVariable": "REMOTE_MCP_CLIENT_ID",
    "clientSecretEnvironmentVariable": "REMOTE_MCP_CLIENT_SECRET",
    "scopes": ["mcp:tools"],
    "authorizationServerOrigins": ["https://login.example.com"]
  }
}
```

Remote MCP enforces public HTTPS, the configured MCP origin plus explicitly allowlisted OAuth origins, no redirects, no URL query credentials, bounded tool timeouts and a circuit breaker. Tool-list change notifications update projected capabilities transactionally and persist a content-only schema cache. Optional mutual TLS reads certificate/key/CA paths from environment-variable references, validates bounded PEM, keeps material out of API/list responses and uses strict server verification.

OAuth-enabled servers use Authorization Code + PKCE through the same endpoint by adding an `oauth` object. State, verifier, access/refresh tokens, dynamic client registration, discovery data and the short-lived pending transport descriptor are encrypted by the credential broker. With a persistent master key, Vault or KMS, `/auth/mcp/callback` can reconstruct and complete an in-flight authorization after control-process replacement; duplicate callbacks are serialized and one-time state is cleared on success, denial or expiry. Client IDs/secrets are referenced through server environment variables, cross-origin authorization/token servers require an exact `authorizationServerOrigins` allowlist, and the browser receives only the authorization URL. Tokens and pending credentials never enter cookies, localStorage, session snapshots, schema caches or API lists.

Connected MCP clients advertise bounded form and URL elicitation. Requests create a five-minute human promise visible in Canvas and `/v1/mcp/elicitations`; nothing is auto-filled or auto-accepted. Forms are reduced to primitive fields with strict required/type/enum/range validation, URL requests must resolve to public HTTP(S), and the user explicitly accepts, declines or cancels. Submitted form values are passed only to the waiting MCP transport and are never persisted in elicitation metadata, session transcripts, model context or schema cache.

## Remote TUI and headless client

Build and run the dedicated API client:

```bash
npm run build -w @haf/headless-client
HAF_URL=https://haf.example.com HAF_API_TOKEN=... haf-client tui
```

`haf-client rpc` exposes JSON-RPC 2.0 over newline-delimited stdio for session
create/get/list, prompts, generic commands, event subscriptions and approval
resolution. Subscription notifications carry the durable event sequence and
reconnect from the last observed cursor without replaying duplicates.

One-shot automation reads prompt content from bounded stdin and emits one JSON
result:

```bash
printf '%s' 'inspect the repository and run tests' | \
  HAF_URL=https://haf.example.com HAF_API_TOKEN=... haf-client run --name ci-run
```

The TUI supports `/new`, `/load`, `/sessions`, `/multi`, `/model`,
`/pause`, `/resume`, `/cancel`, `/compact`, `/approvals`, `/approve`, `/deny`
and live text/tool/status events. `HAF_API_TOKEN` is accepted only through the
environment; credentials and prompt text are intentionally not accepted as
process arguments. REST and SSE requests are exact-origin, redirect-denying and
bounded. Configuration keys are `HAF_URL`, `HAF_API_TOKEN`, `HAF_TENANT` and
`HAF_CLIENT_TIMEOUT_MS`.

## ACP mode

Run the engine as an ACP JSON-RPC/stdio agent:

```bash
npm run acp
```

Supported methods in this milestone:

- `initialize`
- `session/new`
- `session/load`
- `session/prompt`
- `session/cancel`
- `session/close`

HAF-specific state is emitted under `_meta["ai.hybrid-agent-fabric"]` so standard ACP clients can ignore it safely.

## Channel webhook

Set a separate webhook token:

```bash
export HAF_WEBHOOK_TOKEN=webhook-secret
```

Then send a normalized channel message:

```bash
curl -X POST http://localhost:8787/v1/channels/webhook/telegram \
  -H 'x-haf-webhook-token: webhook-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId":"local",
    "chatId":"123",
    "chatType":"dm",
    "userId":"456",
    "messageId":"789",
    "text":"hello"
  }'
```

Platform message IDs become command idempotency keys. Raw chat and user IDs are hashed in persisted route metadata.

`channel.send` accepts an optional confined `mediaPath`. HAF resolves the file
only at delivery time, refuses symlink/workspace escapes, caps it at 25 MiB and
recognizes raster image, MP4/WebM, MP3/M4A/OGG/WAV and PDF magic bytes. Telegram,
Discord, Slack, WhatsApp, Matrix, Signal, Mattermost and Feishu use native
upload/message contracts; signed webhooks receive an exact HMAC-covered base64
media envelope. LINE, Google Chat and Teams reject direct binary media rather
than inventing a public artifact URL. Mattermost thread roots, Google Chat
threads, Teams `chat:<id>` / `channel:<team>:<channel>` destinations and Feishu
reply IDs are supported. Shared channel HTTP handling rejects redirects, bounds
responses and redacts credential-shaped provider errors. Provider credentials
stay in adapter closures and are never embedded in payloads or capability
results.

Tenant administrators can define priority inbound routing rules matching
platform, chat type, exact chat/user IDs and bounded metadata. IDs are hashed
before rule/route persistence. Rules select per-chat, per-user or per-thread
session lanes and may freeze a tenant agent profile into newly admitted channel
sessions. Existing routes remain stable. `/v1/channel-routing-rules` and the
Canvas Channels panel manage rules; the same panel sends explicit text/media via
the selected outbound adapter.

### Long-lived IRC/IRCv3

Set `IRC_HOST`, `IRC_NICKNAME`, `IRC_CHANNELS` and at least one of
`IRC_ALLOWED_NICKNAMES` / `IRC_ALLOWED_ACCOUNTS` to activate the native IRC
transport. It participates in the same Channel Gateway lanes, frozen profile
routing, model turns and outbound `channel.send` adapter as webhook platforms.
The adapter performs IRCv3 CAP negotiation for message tags, server time and
account tags, answers PING immediately, joins only configured channels and
limits concurrent inbound turns.

TLS with normal certificate verification is the default. A bounded PEM CA bundle
may be referenced with `IRC_TLS_CA_PATH`. Private-address infrastructure requires
`IRC_ALLOW_PRIVATE_HOST=true`; plaintext additionally requires
`IRC_ALLOW_PLAINTEXT=true` and is rejected whenever PASS or SASL credentials are
configured. DNS is resolved before every connection and every returned address
must satisfy the selected public/private policy.

Optional `IRC_SASL_ACCOUNT` plus `IRC_SASL_PASSWORD` enable SASL PLAIN only over
verified TLS. Credentials remain in the transport closure and are absent from
status, session, model and persistence surfaces. Nickname or authentication
failure blocks reconnect until operator intervention; ordinary transport loss
uses bounded exponential jitter and increments a connection generation.

Inbound channel, nickname/account and direct-message targets are exact allowlists.
CTCP and IRC formatting controls are removed or rejected. Outbound text is split
on UTF-8 code-point boundaries into frames no larger than IRC's 512-byte wire
limit, destination-confined and rate-spaced. A successful socket write is
reported as accepted (`202`), not exactly-once delivery. `/v1/channels/adapters`
and Canvas expose content-free long-lived state, generation, TLS, joined-channel
counts and bounded error codes.

### TLS-first SMTP/IMAP email

`EMAIL_SMTP_*` enables outbound email through implicit TLS or mandatory STARTTLS.
The from address is fixed server-side; destinations must match an exact recipient
or authorized-sender allowlist. Text and already-confined `channel.send` media
bytes are handed to Nodemailer with URL/file access disabled. Header fields,
message IDs, filenames, body size and recipient count are independently bounded.
SMTP acceptance is reported as `202`; transport ambiguity is never described as
exactly-once delivery.

Optional `EMAIL_IMAP_*` keeps a TLS/STARTTLS IMAP connection open, selects one
read-only mailbox and polls a bounded UID range. First boot defaults to `latest`
so an existing mailbox is not replayed; `EMAIL_INITIAL_SYNC=all` is an explicit
bootstrap option. UIDVALIDITY and the last handled UID are stored without email
content. Mailbox replacement starts at its current tail rather than replaying an
unrelated UID namespace.

Inbound email must satisfy all three checks before dispatch: exact sender
allowlist, exact configured recipient, and a constant-time matching
`X-HAF-Email-Token` header. Auto-submitted/bulk/list messages and mail from the
configured HAF address are ignored to prevent loops. Subject/body are wrapped as
untrusted email data; sender IDs and subjects are hash-projected in routing
metadata.

The built-in bounded MIME parser handles folded headers, encoded words,
multipart nesting, base64 and quoted-printable text. MIME depth/part/header/body
and source bytes are capped; attachment bytes are omitted from model context.
Inbound state stores only UID/event/sender hashes and explicit
`processing/responding/done/ignored/failed/uncertain` outcomes. If a process
stops after a reply may have entered SMTP, the event becomes uncertain and that
reply is not automatically replayed. `/v1/channels/adapters` and Canvas show only
content-free UID/outcome/generation counters.

### Signed Twilio SMS

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` and exact
`TWILIO_ALLOWED_NUMBERS` enable native outbound SMS. Requests use Twilio's
form-encoded Messages endpoint, fixed `From`, E.164 validation, exact API-origin
checks, manual redirects and bounded JSON responses. Basic credentials remain in
the Authorization header. Workspace media is rejected rather than converted to
an implicit public MMS URL.

Inbound SMS uses `/v1/platforms/twilio/webhook`. `TWILIO_WEBHOOK_URL` must equal
the exact public HTTPS URL configured at Twilio; HAF never reconstructs it from
an untrusted Host/proxy header. Before acknowledging, HAF verifies
`X-Twilio-Signature` in constant time over that URL plus the case-sorted decoded
form fields, binds `AccountSid`, requires the configured recipient number and an
exact sender allowlist, and validates MessageSid/body/media-count bounds.

The route immediately returns empty TwiML after verification and durable
admission. Agent work continues asynchronously through Channel Gateway, with
MessageSid as command idempotency. A content-free journal stores only event and
phone projections plus `processing/responding/done/failed/uncertain`. Duplicate
webhooks do not dispatch or reply again. State is written as `responding` before
outbound SMS; restart or any ambiguous REST outcome becomes `uncertain` and is
never automatically replayed. REST/Canvas status shows only counts.

## Durable schedules

```bash
curl -X POST http://localhost:8787/v1/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"tenantId\":\"local\",
    \"sessionId\":\"$SID\",
    \"prompt\":\"Run the periodic check\",
    \"schedule\":{\"kind\":\"cron\",\"expression\":\"0 9 * * 1-5\",\"timezone\":\"Europe/Istanbul\"}
  }"
```

The next occurrence is advanced durably before prompt dispatch, preventing an uncertain fire from being replayed after a crash.

## Commands

```bash
npm run dev        # control API
npm run acp        # ACP stdio adapter
npm run build
npm run typecheck
npm test
npm run check      # typecheck + tests
```

## Repository layout

```text
apps/control-api/       REST + SSE control plane
apps/acp-server/        ACP JSON-RPC/stdio adapter
packages/engine/        runtime, policy, tools, memory, scheduler, channels, MCP
python/kernel_server.py persistent Python protocol process
var/                    local durable state and workspaces
docs/adr/               architecture decisions
```

## License and upstream relationship

MIT. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). This is currently an independent implementation informed by the three upstream repositories. Any later verbatim source port must retain the upstream copyright/license header.

## Provider profiles and per-session switching

Set `HAF_MODEL_PROVIDER` to `openai`, `openai-responses`, `openai-codex`, `azure-openai`,
`aws-bedrock`, `anthropic`, `openrouter`, `google`, `vertex`, `groq`, `xai`, `deepseek`,
`mistral` or `ollama`. The corresponding standard
credential variable is resolved only by the server-side provider registry.

```bash
HAF_MODEL_PROVIDER=anthropic \
ANTHROPIC_API_KEY=... \
HAF_MODEL_NAME=claude-sonnet-4-5-20250929 \
npm run dev
```

When several standard key environment variables are present, their providers
are registered concurrently. Select a model for one session with the
`model.select` command and a `provider:model` value. Provider keys are held in
provider closures and never persisted in session snapshots or passed to the
Python kernel. `google` uses Gemini's native GenerateContent API rather than the
OpenAI compatibility endpoint. `azure-openai` uses Azure's deployment-scoped
`api-key` endpoint; set `HAF_MODEL_BASE_URL` to the Azure resource endpoint and
`HAF_MODEL_NAME` to the deployment name. `vertex` uses native Gemini
GenerateContent with a server-side `GOOGLE_VERTEX_ACCESS_TOKEN` and requires a
full Vertex publisher base URL ending at `/publishers/google`. `aws-bedrock`
uses the native Bedrock Converse API and the standard AWS credential chain
(environment, profile, workload/instance role); it never accepts model API-key
pools. Set `HAF_MODEL_NAME` to the Bedrock model/inference-profile ID and
`HAF_MODEL_REGION` or `AWS_REGION` to the target region.

`openai-codex` is the native ChatGPT subscription route, not the public OpenAI
API. Start device authorization from the Canvas Models panel or
`POST /v1/model-auth/codex/start`, enter the returned code at OpenAI, then poll
`POST /v1/model-auth/codex/poll`. Access and rotating refresh tokens, pending
device state, expiry and cooldown are Credential Broker-encrypted. The account
catalog is read from `GET /v1/model-auth/codex/models`; HAF does not invent or
silently substitute model slugs. `POST /v1/model-auth/codex/activate` hot-adds
the selected `openai-codex:<model>` route. Requests use the confirmed Codex
Responses SSE contract, exact first-party origin/header set, Harmony-token
neutralization and no body-level token. One pre-output 401 can refresh/retry;
once any model event is emitted there is no retry or fallback.

### Generic OIDC model credentials

`HAF_MODEL_OAUTH_REDIRECT_URI` enables tenant-scoped model credential sources
through `/v1/model-oauth-sources` and the Canvas Models panel. Sources use OIDC
Authorization Code + PKCE S256 and require an operator-registered client ID. HAF
does not embed or impersonate another product's public OAuth client. Public
clients use `none`; confidential clients reference an existing Credential Broker
secret and explicitly choose `client_secret_basic` or `client_secret_post`.

Registration pins an HTTPS issuer, exact authorization-server origins, scopes
(including `openid`), and exact model resource origins. Discovery must return the
same issuer; authorization, token and JWKS endpoints are rechecked against the
allowlist and SSRF policy. Redirects are forbidden. State, PKCE verifier, nonce,
discovery metadata, access/rotating refresh tokens and account subject stay in
Credential Broker-encrypted state. ID tokens are verified for signature, issuer,
audience, expiration and nonce; status exposes only a one-way subject projection.

A model configuration may set `credentialOAuthSourceId` instead of an environment
key. Its base URL origin must be one of that source's explicit resource origins.
At model-call time HAF obtains or refreshes the bearer token and materializes the
same provider profile dynamically. One 401/403 may force refresh and retry only
if no model event has been emitted; once text, reasoning, tool or usage output
starts, there is no retry or fallback replay. Source disable/logout/removal makes
bound routes unavailable without exposing token values.

Configure an explicit fallback chain with `HAF_MODEL_FALLBACKS`, or pass
`fallbackModels` with `model.select`:

```json
{
  "kind": "model.select",
  "payload": {
    "model": "anthropic:claude-sonnet-4-5-20250929",
    "fallbackModels": ["google:gemini-pro-latest", "openai:gpt-4.1-mini"]
  }
}
```

Fallback never crosses providers unless listed, and never restarts after partial
model output. `HAF_MODEL_API_KEYS_JSON` configures a same-provider credential
pool. Pool status exposes opaque IDs/cooldowns only, never key material.

Same-provider pool health is persisted under content-free runtime state. A 401/403
disables only the rejected credential; retry-class failures store bounded
exponential/provider cooldowns. Failure count/code and last-use time survive
process replacement, while raw keys never enter the state file. Credentials no
longer present in the configured pool are ignored on restore; new IDs start
clean. System administrators can reset one or all entries with
`POST /v1/providers/:providerId/credentials/reset`, and Canvas Models exposes the
same explicit reset. Active cooldown windows are never bypassed implicitly.

Every custom model origin must now declare `dataPolicy` as `provider`,
`aggregator`, or `local`; built-in origins inherit their profile's label. The
label is persisted and shown in tenant-aware route inventories so an explicit
fallback cannot hide that it crosses a provider/data-residency boundary.

System administrators can persist custom routes through `/v1/model-configurations`
or the Canvas Models panel. Records contain provider/model/base URL and
environment-variable references only. A credential used with a custom endpoint
requires an exact `credentialAudienceOrigin` match, preventing a standard
provider key from being silently sent to another origin. Configurations can be
hot-enabled, disabled, removed and selected per session as
`model-<uuid>:model-id`.

## Agent profiles

Tenant administrators can create versioned profiles through `/v1/agent-profiles`
or the Canvas Profiles panel. A profile freezes supplemental instructions,
default model/fallback routes and an optional exact capability allowlist into
each new session. Updating or deleting the source profile never mutates already
running sessions.

Capability restrictions are enforced in three places: model tool projection,
normal tool dispatch and nested Python `haf.call(...)`. Child agents and session
forks inherit the parent's frozen profile, so delegation cannot recover hidden
capabilities. Profiles may specialize behavior but cannot weaken policy,
approvals, effect journals, sandbox or credential isolation.

## Aurora Agent Society

The 125-page Aurora architecture is tracked in
[`docs/aurora-pdf-feature-audit.md`](docs/aurora-pdf-feature-audit.md). Phase A
adds an organizational substrate above the existing Prime supervisor rather than
replacing it. Each tenant receives Aurora Prime, seven executive directors and
the research/coding/debug/architecture/planning/reflection/creativity/
opportunity/risk/communication/guardian/project/knowledge/simulation/skill
specialists described by the PDF. Roles carry bounded capability tags,
reputation and optional tenant agent-profile bindings; Prime synthesizes and
cannot be retired.

The durable task marketplace accepts a root session, objective, required tags,
priority, deadline and token ceiling. Active roles bid with confidence, token and
time estimates. Awarding is deterministic over tag coverage, reputation,
confidence and relative cost, while daily token reservations and concurrent-task
limits fail closed. Execution spawns an isolated child session with the role's
purpose and profile. A role profile may narrow parent authority but cannot add a
capability outside the parent's frozen allowlist.

Task completion requires real child-session event IDs. Verified quality updates
the assigned role's reputation, releases reserved tokens and records actual use;
failed tasks lower reputation rather than relying on self-reported success.
Council deliberations require a declared role set and quorum. Each role submits
approve/reject/abstain, confidence, summary and evidence references. Resolution
weights confidence by role reputation, preserves every perspective/dissent and
returns `uncertain` when the decisive margin is too small instead of fabricating
consensus.

Governed `society.*` capabilities and `/v1/society/*` REST routes expose roles,
budgets, marketplace tasks and deliberations. Spawning a specialist remains a
privileged capability and crosses normal policy/approval/effect-journal paths.
Canvas includes a Society panel for tasks, bids, awards, execution, reputation,
budget and council outcomes.

## Aurora Global Workspace and cognitive control

Aurora PDF Phase B introduces first-class cognitive objects rather than treating
every thought as transient chat text. Observation, problem, hypothesis, insight,
risk, opportunity and decision objects carry source type/ID, confidence,
importance, urgency, impact, user relevance, reactive/tactical/strategic horizon,
goal relation, tags, relations and bounded token/time requests. Objects remain in
a durable Global Workspace queue until explicit attention allocation.

Tenant cognitive goals use constitutional P0–P4 classes. Arbitration always
ranks the class before importance × urgency × user relevance, so a high-scoring
research goal cannot silently outrank user safety. Near-equal goals in the same
class are preserved as conflicts. Object attention priority additionally uses
importance × urgency × impact × confidence × user relevance and the goal-class
weight.

The Attention Allocation Engine reserves a daily token budget and one of a
bounded number of focused slots. Objects that do not fit are marked deferred,
not dropped. Completion releases reservations and records actual use; day
rollover clears stale reservations and safely requeues focused work.

The cognitive state machine supports reactive, research, development,
reflection, dream and emergency modes through an explicit transition graph and
durable reason/history. Arbitrary transitions fail closed. Thought iterations
store SHA-256 only; three consecutive identical results block the object and
release attention, preventing infinite reasoning loops without persisting raw
iteration output.

Governed `cognitive.*` capabilities and `/v1/cognitive/*` routes expose goals,
objects, attention, modes, arbitration and loop records. Privileged goal,
attention and mode changes still cross policy/approval. Canvas's Cognitive panel
shows the Global Workspace, priorities, confidence, horizons, focused/deferred
state, daily budget and operating mode.

## Repository bootstrap

`POST /v1/repositories/import` creates a new session from a credential-free
HTTPS Git URL. URLs are public-address checked, redirects and embedded/query
credentials are forbidden, and clones are shallow, no-tags and blob-filtered.
Optional private-repository tokens are referenced by Credential Broker secret ID,
leased to the exact repository origin and supplied only through an ephemeral
owner-only askpass helper—never URL, process arguments, logs, session state or
model context. File/byte/timeout limits and verified HEAD capture run before the
session is admitted; failures remove the workspace. Canvas exposes branch,
profile and secret-ID bootstrap controls.

## Persistent goals and autonomous gates

Create a bounded goal:

```json
{
  "kind": "goal.set",
  "payload": {
    "objective": "Implement and verify the migration",
    "tokenBudget": 200000,
    "maxContinuations": 10
  }
}
```

Configure autonomous quality gates:

```json
{
  "kind": "autonomous.configure",
  "payload": {
    "enabled": true,
    "maxContinuations": 8,
    "maxTurns": 30,
    "maxTokens": 200000,
    "timeoutMs": 3600000,
    "gates": ["npm test", "npm run typecheck"],
    "gateMaxRetries": 3
  }
}
```

A failed gate is returned to the model as bounded evidence. If the workspace
has not changed, the same command is not repeatedly executed. Passing a gate
proves only that gate; successful goal completion still requires
`goal.complete`.

## Durable task board

Session snapshots carry a dependency-aware task board. The model and API use
`task.list`, `task.create` and `task.update`; dependency cycles are rejected,
unfinished prerequisites force a blocked state, and dependants become ready
when prerequisites complete. Open tasks are projected into model context and
rendered in the Canvas Tasks panel.

## Durable agent messaging

`agent.roster` exposes only the current agent's direct parent, siblings and children. `agent.send` supports `auto`, `steer` and `follow_up`, plus family-scoped broadcast. Sender identity is host-derived; family reach, message size, rate and pending limits are enforced before enqueue.

Inbox rows are durable in files or PostgreSQL with `pending`, `claimed`, `delivered` and `uncertain` states; PostgreSQL uses content-free LISTEN/NOTIFY to wake the current session owner. Busy `auto` deliveries become steering messages and enter at a model boundary; idle and follow-up deliveries run as serialized prompts. A claim lost across a crash becomes explicit `uncertain` rather than being silently replayed. Canvas shows the family roster and can send through the same API.

## Encrypted secrets and scoped leases

`POST /v1/secrets` is write-only for values; list responses contain metadata
only. The local broker encrypts values with AES-256-GCM. Set `HAF_MASTER_KEY`
for restart-stable decryption. Capability workers receive a short-lived,
audience- and capability-bound lease rather than a raw long-lived secret.

The REST API deliberately does not expose lease redemption. In production the
same interface is intended to use Vault/KMS.

System administrators can register pinned external secret sources for generic
commands, 1Password CLI or Bitwarden CLI. Records contain only absolute
executable path, SHA-256, environment-variable names and redacted item metadata.
Each refresh re-resolves and hashes the executable, runs without a shell in a
clean allowlisted environment, bounds output/time and imports values directly
into Credential Broker. References, command arguments and values are omitted
from list/refresh responses. Canvas's Secrets panel shows metadata and provides
write-only manual entry plus explicit source refresh.

## Server-side backend registry

Remote/cloud backend metadata is stored by the control plane, not browser
`localStorage`. Auth configuration references an environment variable name;
the credential value is resolved only for server-side health/proxy calls.
Click a backend in the control center to run its health check.

## Declarative automations

Automations bind a session and prompt to one of three closed trigger kinds:

- `manual`
- `schedule` using the durable once/interval/cron scheduler
- `webhook` with an environment-referenced secret

Manual and webhook executions produce durable run records. A process restart
turns an in-flight run into `uncertain` rather than replaying it. Webhook event
JSON is fenced as untrusted data and dispatched with the restricted `webhook`
source policy. The control center can create, enable/disable and dispatch manual
automations.

### Hosted Git automation synchronization

Tenant administrators can register `/v1/automation-git-sources` against an
existing hosted GitHub/GitLab provider, repository ID, branch/ref, JSON manifest
path and one authoritative HAF session. A source may additionally carry one
administrator-selected webhook-secret environment-variable reference and an
exact model-route allowlist. The remote manifest cannot select another session,
credential reference, provider account or unapproved model route.

A version-1 manifest contains at most 100 strict automation definitions with a
stable key, bounded name/prompt, enabled state and manual, schedule or webhook
trigger. Webhook entries inherit the source's server-side secret reference;
schedule intervals, future one-shot times, cron expressions and timezones are
validated during planning. Hosted retrieval accepts one bounded base64 UTF-8
JSON file with a validated remote blob version.

Synchronization is deliberately two-phase. `POST .../:id/plan` fetches and
validates the manifest, computes create/update/unchanged/disable actions and
issues a 15-minute content SHA-256. It does not mutate automations. Apply
re-fetches the file and requires that exact planned hash; branch movement forces
a new plan. Canvas exposes the same Plan then Apply exact hash workflow.

Applied automations retain source/key/entry/manifest-hash provenance. Changed
schedule jobs are cancelled and recreated; keys removed from Git are disabled,
not deleted. Source state stores only repository references, hashes, status and
error code—never prompt or manifest contents. A process interruption while
applying becomes `partial` and is not silently replayed; this flow does not claim
atomic or exactly-once external scheduler effects.

### Signed external automation responders

`/v1/automation-responders` registers an external deployment against exactly one
tenant webhook automation and one existing Credential Broker secret. The remote
process sends JSON heartbeats and events to the responder-specific public URLs.
It signs the exact raw body with HMAC-SHA256 over
`timestamp + "." + nonce + "." + body` using `X-HAF-Responder-*` headers.
Timestamps must be within five minutes; nonce hashes are persisted and replayed
nonces are acknowledged without reprocessing.

Heartbeats carry bounded instance ID, version, reported ready/degraded status and
capability names. Raw instance identity and secret are never listed; Canvas and
REST expose a one-way instance projection and derive pending/healthy/degraded/
stale from the administrator-selected heartbeat interval.

Events must match the bound automation's exact event type. After signature and
JSON depth/size/prototype checks, HAF durably records a hash-only `processing`
entry and immediately acknowledges. Dispatch continues asynchronously through
the existing webhook automation policy. Event IDs deduplicate retries; records
contain only event hash/type, run ID, status and error code. Process replacement
or unknown dispatch outcome becomes `uncertain` and is never automatically
replayed. Credential rotation invalidates prior signatures and clears nonce
history without returning either secret.

## Content-free monitoring

`GET /metrics` exposes Prometheus counters and gauges for process uptime,
events, sessions by bounded state, model calls, token classes and capabilities.
No prompt, message, path, tenant ID, session ID, tool arguments or results are
exported. When `HAF_API_TOKEN` is configured, the metrics endpoint requires the
same bearer credential.

## Browser and computer use

Browser tools are registered only when either `HAF_BROWSER_CDP_ENDPOINT` or
`HAF_BROWSER_EXECUTABLE_PATH` is configured. The engine exposes navigation,
bounded text/element snapshots, stable-per-snapshot refs, click, fill, key
press, screenshot, coordinate click, typing and scrolling. Every top-level and
subresource HTTP(S) URL is checked against private/special-use destinations.
A private CDP endpoint requires the explicit operator switch
`HAF_BROWSER_ALLOW_PRIVATE_CDP=true`.

## SSH execution profile

`HAF_SANDBOX_BACKEND=ssh` runs process capabilities on a strict-host-key-checked
remote machine and synchronizes the assigned workspace with rsync before and
after execution. Host, user, port, remote root and cwd are validated before any
process starts. The local Python kernel is disabled in SSH mode so a model
cannot silently bypass the remote execution boundary.

`HAF_SANDBOX_BACKEND=singularity` targets Apptainer/Singularity clusters. Local
SIF files require `HAF_SINGULARITY_IMAGE_SHA256`; remote image URIs require an
`@sha256:` pin unless an administrator explicitly enables the unpinned escape
hatch. The adapter uses a clean contained environment, network `none` by
default, and disables the host Python kernel.

## Governed learning

Learning proposals are scanned and carry evidence event IDs, expected outcome,
scope, risk and provenance. Agent-created proposals require evidence. Promotion
requires evaluation; user/org/high-risk changes also require explicit human
approval. Promoted memory, skill, prompt addendum and subagent artifacts can be
rolled back. Prompt/subagent artifacts enter only a newly frozen session
context, preserving prompt-cache stability for already running sessions.

`learning.refine` groups one to eight small edits into a continual-harness batch.
Agent batches must reference real events from the same session log; every edit is
scanned and remains a candidate, so the batch cannot self-evaluate or
self-promote. Batch history tracks partial rejection/promotion and can roll back
all promoted members in reverse order.

`RefinementPlanner` can now review an untrusted trajectory excerpt with the
session's selected model and strict JSON output. It binds every proposed edit to
real event-log evidence and creates governed candidates only—never promotion or
direct prompt mutation. `HAF_AUTO_REFINE_EVERY_TURNS=0` keeps automation off by
default; a positive cadence enables single-flight interval reviews. Manual plans,
review history, candidate evaluation/promotion and rollback are exposed in the
Canvas Learning panel. Scope/risk and explicit human-approval rules still apply.

## STT and TTS

When `HAF_AUDIO_API_KEY` is configured, `audio.transcribe` accepts only bounded
workspace files and `audio.synthesize` writes only inside the workspace.
Provider credentials remain inside the audio service and never enter model,
session or Python-kernel state.

When `HAF_IMAGE_API_KEY` is configured, `image.generate` requests base64 output
from an OpenAI-compatible image endpoint and materializes 1–4 owner-only raster
artifacts under `.haf/artifacts/images/`. One `sourcePath` or up to eight
`sourcePaths` route to the multipart edit endpoint; multi-reference providers
must advertise support and references have a 40 MiB aggregate bound. Optional
FAL generation/editing uses `HAF_FAL_IMAGE_*`. `image.upscale` and an optional
generate→upscale chain use `HAF_IMAGE_UPSCALE_*` with 2x/4x factors. HAF parses
source/result dimensions and rejects a provider that returns less than the
requested scale. Pipeline provider/model/operation provenance is returned with
the artifact. PNG/JPEG/WebP/GIF magic/byte checks remain mandatory and remote
provider URLs are rejected by default.

Raster attachments uploaded from Canvas can be projected as structured image
parts instead of text-only paths. Session snapshots store only confined relative
path, MIME type, optional alt text and SHA-256—not base64 bytes. Immediately
before a model request, HAF resolves the file under the workspace, verifies
magic bytes/MIME/hash and enforces a 10 MiB per-image limit. OpenAI Chat and
Responses, Azure OpenAI, Anthropic, Gemini/Vertex and Bedrock receive their
native image block shape. A prompt is limited to eight images.

When `HAF_VIDEO_API_KEY` and `HAF_VIDEO_MODEL` are configured, `video.generate`
provides normalized text-to-video and confined generation from up to four
reference images through FAL's synchronous endpoint. Providers must explicitly
advertise multi-reference support and references share a 40 MiB aggregate bound.
Inputs are bounded to 30 seconds; output is materialized
under `.haf/artifacts/videos/` only after MP4/WebM magic-byte and byte-limit
validation. Remote result URLs are disabled by default and require
`HAF_VIDEO_ALLOW_REMOTE_URLS=true`; every hop is rechecked for SSRF. Canvas's
Media panel exposes configured image/video providers without moving provider
credentials into the browser. `HAF_VIDEO_UPSCALE_*` enables `video.upscale` for
workspace-confined MP4/WebM inputs. HAF parses MP4 `tkhd` fixed-point dimensions
or bounded WebM PixelWidth/PixelHeight elements before and after the provider
call; a claimed 2x/4x result is rejected unless both dimensions meet the factor.
The result includes verified width/height and is materialized only after normal
video magic/byte checks.

`HAF_VIDEO_QUEUE_API_KEY` plus `HAF_VIDEO_QUEUE_MODEL` enables durable FAL Queue
jobs. `video.job.submit/status/cancel/list` and `/v1/media/jobs` expose explicit
`submitting`, `queued`, `running`, `succeeded`, `failed`, `cancelling`,
`cancelled` and `uncertain` states. Only provider/model/status, tenant/session,
reference count and a validated final artifact are persisted—never prompt,
workspace path, input image bytes, credentials or provider result URLs. A
submission or cancellation interrupted after dispatch becomes `uncertain` and
is not replayed automatically. Client idempotency keys are stored only as
SHA-256 projections. Polling constructs exact FAL Queue URLs from the validated
model/request ID and materializes MP4/WebM only after bounded result and magic
checks.

When `HAF_WEB_SEARCH_API_KEY` is configured, `web.search` uses the selected
Brave or Tavily provider and returns normalized title, public provenance URL,
snippet and optional publication metadata. Provider credentials remain
server-side, fields are bounded, and private/special-use result URLs are dropped
before reaching the model.

## OPA/Rego organization policy

Set `HAF_OPA_ENDPOINT` to layer an organization policy decision over the local
least-privilege policy. Secret-like argument keys are redacted before the OPA
request. Local denial cannot be weakened by OPA; `require_approval` remains
stronger than `allow`. Timeout, unavailable service, non-2xx response or invalid
result all deny execution rather than falling back open.

## Detached resident session workers

The `@haf/session-worker` process owns a root session family independently from
the web control plane. It publishes an owner-only descriptor and listens on a
mode-0600 Unix socket using an authenticated binary frame protocol:

```text
4-byte JSON header length
4-byte opaque payload length
small JSON routing header
opaque payload bytes
```

Events carry worker generation and sequence cursors. Reconnecting supervisors
request bounded replay; a generation change or evicted replay interval causes a
chunked snapshot resync. A slow attachment is marked for resync instead of
building an unbounded queue or blocking the worker and other clients.

Control-plane shutdown closes only client attachments. Resident workers remain
alive, are reparented by the OS and are adopted from descriptors by the next
control-plane process. Worker stdout/stderr is retained in a per-worker forensic
log. The control center and `/v1/detached-workers` API expose create, status,
command, event stream, approval and stop operations without exposing the worker
authentication token.

## PostgreSQL and NATS distributed profile

The default remains the zero-dependency local file profile. Set
`HAF_POSTGRES_URL` to move session events, snapshots, command/effect journals
and leases to PostgreSQL. Migrations are idempotent and recorded in
`haf.schema_migrations` (or the configured schema).

PostgreSQL event delivery uses `LISTEN/NOTIFY` only as a wake-up signal; the
authoritative event is read from the table by event ID. Event IDs and
`(session_id, sequence)` are unique. Snapshot upserts reject generation/sequence
regression. Command and effect journals persist an execution owner so a second
runtime can distinguish its own insertion from another process's in-flight
operation and return `uncertain` instead of replaying it.

Session leases carry owner and expiration, are renewed by heartbeat and can be
taken over only after expiry or explicit release.

Set `HAF_NATS_SERVERS` to publish normalized events and enable typed worker
request/reply subjects. Tenant IDs are SHA-256 projected into subjects rather
than exposed raw. NATS is transport; PostgreSQL remains authoritative state.

```bash
HAF_POSTGRES_URL=postgresql://haf:haf@localhost:5432/haf \
HAF_NATS_SERVERS=nats://localhost:4222 \
npm run dev
```

## Branch-preserving session tree

Every message is a tree entry with a parent, labels and active-leaf state.
Branching changes only the active projection; abandoned alternatives remain
addressable. The Control Center Tree tab can label entries and continue from any
prior point. Compaction writes a `contextReset` summary entry followed by cloned
recent context, so the model stops walking older ancestors while the complete
pre-compaction tree remains available.

Commands:

- `session.tree.get`
- `session.tree.branch`
- `session.tree.label`

## Hybrid full-text and vector retrieval

The persistent knowledge index combines a BM25-style lexical score with cosine
vector similarity. Default vectors are deterministic and local, requiring no
external service. `HAF_EMBEDDING_API_KEY` enables an OpenAI-compatible embedding
provider. Tenant filtering occurs before scoring. Live `message.created` events
are indexed automatically; manual reindex covers restored sessions. Governed
learning promotion indexes memory, skills, prompt addenda and subagent specs,
and rollback removes the promoted search document.

Use `knowledge.search` from an agent or `/v1/knowledge/search` from the API.

## Skills Hub

Skills Hub sources publish a version-1 JSON index with name, version,
description, bundle URL and SHA-256. HAF validates source and bundle URLs against
SSRF, bounds index/archive/extracted size and entry count, verifies SHA-256,
rejects absolute/traversal paths and links, requires exactly one `SKILL.md` root,
then imports into the existing quarantine scanner. A clean download is still
not active until explicit promotion. Every source refresh, failure, hash
mismatch and quarantine result is appended to an owner-only JSONL audit log.

## Web sessions, OIDC and tenant RBAC

Browser authentication uses a random HttpOnly, SameSite=Strict cookie. Session
identity and CSRF values live only in an AES-256-GCM encrypted server-side
store. Cookie-authenticated mutations require `x-haf-csrf`. API bearer tokens
remain available for headless automation and map to a system administrator.

OIDC uses discovery, Authorization Code, PKCE S256, state, nonce, issuer,
audience and remote-JWKS verification. `haf_tenants` (configurable claim) maps
tenant names to `viewer`, `operator` or `admin`; undeclared tenants receive no
access. `haf:system-admin` is separate from a tenant admin. Session, automation
and learning IDs are resolved to their authoritative tenant before access is
checked, preventing a forged body/query tenant from crossing boundaries.

Roles:

- viewer: safe reads
- operator: normal session/agent/automation mutations
- admin: tenant secrets and governed-learning decisions
- system admin: backend, MCP, detached-worker and Skills-Hub administration

When no API token or OIDC provider is configured, the server enters an explicit
anonymous development-admin mode. Production should set `HAF_AUTH_DISABLED=false`,
`HAF_SESSION_SECRET`, secure cookies and either OIDC or an API token.

## Native inbound platform verification

Inbound endpoints validate the platform transport before channel authorization:

- Telegram: Bot API secret token plus user/chat allowlists
- Slack: raw-body v0 HMAC, five-minute replay window, user/channel allowlists
- Discord: Ed25519 signature over timestamp plus raw body, user/channel allowlists
- WhatsApp Cloud: hub challenge, raw-body SHA-256 HMAC, phone allowlists
- Signal REST bridge: shared secret and number allowlist
- Matrix bridge: shared secret and sender/room allowlists
- Mattermost outgoing webhook: constant-time token plus user/channel allowlists
- LINE Messaging: raw-body HMAC-SHA256/base64 plus user/chat allowlists
- Google Chat: bounded exact-origin JWKS, issuer/audience JWT and user/space allowlists
- Microsoft Teams: operator-configured issuer/JWKS, app-audience JWT and user/conversation allowlists
- Feishu/Lark: verification token plus optional timestamp/nonce/encrypt-key signature and user/chat allowlists

Google/Teams JWKS responses are capped at 1 MiB, redirect-denying and cached for
one hour. LINE/Feishu signatures operate on exact raw request bytes; Feishu and
Slack-style timestamp windows reject five-minute replays. New platform handlers
acknowledge authenticated events before long agent work and dispatch responses
through the configured outbound adapter. Platform event/message IDs become command idempotency keys. Discord interactions
are acknowledged immediately and completed through the outbound adapter so a
long agent turn does not exceed Discord's interaction deadline.

## Vault and KMS credential backends

All credential implementations share the same metadata and scoped-lease
contract. `HAF_VAULT_ADDRESS` plus `HAF_VAULT_TOKEN` selects Vault KV v2. Values
are written under a tenant/name path; API lists return only metadata. Lease
redemption reads Vault only after tenant, capability, audience, expiry and use
count match.

The KMS envelope backend requests a new 256-bit data key per secret, encrypts the
value with AES-256-GCM, stores only the KMS-encrypted data key and ciphertext,
and zeroes plaintext key buffers after use. Cloud-specific KMS clients implement
the `KmsProvider` interface without changing the broker or capability workers.

## PostgreSQL row-level security

`HAF_POSTGRES_RLS=true` enables tenant policies on events, snapshots and
command/effect journals. Policies accept either an explicit system bypass or a
matching `haf.tenant_id`. `withTenant()` opens a transaction, disables bypass
and sets the tenant with transaction-local `set_config`; `withSystemBypass()` is
separate for internal maintenance. Application RBAC remains mandatory and RLS
acts as defense in depth.

## Cloud sandbox gateways

`HAF_SANDBOX_BACKEND` accepts `modal`, `daytona`, `vercel` or `kubernetes` when
`HAF_CLOUD_SANDBOX_GATEWAY` is set. All four use one versioned gateway contract:
provision with workspace/resource/network policy, bounded exec, snapshot and
destroy. Provider credentials stay in the gateway. The agent receives no cloud
credential. Local Python is disabled for cloud profiles so it cannot bypass the
remote execution boundary.

## Signed out-of-process WASI plugins

A plugin consists of `plugin.json` plus a SHA-256-pinned `.wasm` module. The
canonical manifest is Ed25519 signed by a configured trusted key. Installation
verifies API/schema version, identity, hash and signature before registration.
Capabilities are namespaced as `plugin.<plugin-id>.<capability>`; hooks retain
observer fail-open, guard fail-closed and transform fallback semantics.

Each invocation launches a separate WASI runner process. WASI Preview1 receives
only a read-only plugin preopen and a per-invocation scratch directory. No
network socket API or host credentials are imported. Input arrives on stdin,
JSON output is bounded, timeout kills the process, and non-zero/invalid output
fails the invocation. Uninstall unregisters every capability/hook and removes
installed files.

Before plugin transforms, the packaged rolling micro-compactor replaces only
older contiguous assistant/tool windows with bounded SHA-256-bound summaries.
Summaries remain assistant-role, explicitly untrusted derived data; original
user/system messages, the protected recent tail and the durable transcript are
unchanged. Its tenant/session cache is atomic, bounded to 2 MiB and fail-open.
Configure it with `HAF_CONTEXT_MAX_CHARS`, `HAF_ROLLING_MICRO_COMPACTION`,
`HAF_MICRO_COMPACTION_TAIL_CHARS`, `HAF_MICRO_COMPACTION_WINDOW_MESSAGES`,
`HAF_MICRO_COMPACTION_SUMMARY_CHARS` and `HAF_MICRO_COMPACTION_CACHE_WINDOWS`.

Set `HAF_MEMORY_PROVIDER=honcho` to add Honcho user modeling alongside local
governed memory. Recall is fetched once per non-trivial user message and inserted
as a separate assistant-role, explicitly untrusted projection immediately before
the unchanged user message; it is never persisted in the session transcript.
Successful turns are sent through a content-free sync journal with
`pending`/`delivered`/`uncertain` outcomes and no automatic replay after an
uncertain external effect. Cross-session profile, search, context, dialectic
reasoning and conclusion tools are exposed as governed `memory.honcho.*`
capabilities. `GET /v1/memory/providers/status` returns content-free health and
outcome counters. Honcho Cloud uses `HONCHO_API_KEY`; custom `HONCHO_URL` values
require explicit self-hosting flags. SDK traffic is exact-origin, SSRF-checked,
manual-redirect and credential values remain server-side.

Signed plugins may implement `context_projection` transforms over model-facing
messages. The immutable system/security prompt is assembled outside the hook;
all original user messages must remain byte-equivalent, so a transform can
compact derived assistant/tool material but cannot erase or rewrite user intent.
Invalid or timed-out output preserves the built-in projection. `memory_context`
transforms may append up to 100 bounded entries; local governed memory is never
replaced and provider additions are wrapped as explicitly untrusted external
data.

## Automated evaluation, signed promotion and canary

A learning release binds a candidate to bounded evaluation commands. Results
store exit codes, output hashes and bounded previews. Only a fully passing
release can be signed. Ed25519 signatures cover candidate, tenant, session,
commands, evaluation evidence and canary policy. High-risk/user/org candidates
still require human review before signature acceptance.

A verified release enters canary state. Success/failure outcomes are counted
until `minSamples`; meeting `requiredSuccessRate` promotes through Learning
Governor, while failure blocks promotion. Promoted releases can rollback the
underlying memory, skill, prompt or subagent artifact and remove its search
index document.

## Hosted GitHub and GitLab accounts

Tenant administrators can bind a GitHub or GitLab account to an existing
Credential Broker secret through `/v1/repository-providers` or the Canvas
Hosted Accounts controls. Provider records contain only the secret ID, API
base, clone origin, auth style and account mode; tokens never enter registry
files, API lists, model context or clone arguments.

GitHub supports user and installation-token repository catalogs. GitLab uses
membership-scoped project discovery with bearer or `PRIVATE-TOKEN`
authentication. HAF normalizes repository visibility/default branch/clone URL,
open pull-request or merge-request metadata and provider web URLs. Hosted import
resolves the clone URL from provider metadata, revalidates its exact configured
origin, and then enters the existing bounded askpass importer.

GitHub App registrations can instead reference one or more RSA private-key
secrets already held by Credential Broker. `POST /v1/github-apps/:id/installations/start`
creates a 15-minute high-entropy install state and returns the official
`/apps/{slug}/installations/new` URL. Configure the GitHub App setup callback as
`/auth/github-app/callback` and its webhook as
`/v1/platforms/github-app/webhook`. A callback installation ID is never trusted
on its own: HAF verifies it through the app-authenticated
`GET /app/installations/{id}` endpoint before admission.

App JWTs use RS256, a 60-second backdated `iat`, an expiration under ten minutes
and the configured client ID (recommended) or numeric app ID as `iss`.
Installation access tokens are minted from
`POST /app/installations/{id}/access_tokens`, encrypted in Credential Broker,
and refreshed before their one-hour expiry. Up to 25 private-key references can
be rotated; a rejected primary key may fail over only on app-auth 401/403, and
the last active key cannot be disabled while the app is enabled. Raw installation
IDs are also broker-encrypted; API/state lists expose only opaque record IDs and
keyed projections.

GitHub App webhooks require `X-Hub-Signature-256` over the exact raw body. Multiple
webhook secrets permit no-downtime rotation, `X-GitHub-Delivery` is deduplicated,
and normalized installation/repository/pull-request events contain hashes and
bounded synchronization metadata rather than payload bodies. Signed install,
suspend, unsuspend, delete and repository-selection events update the local
installation lifecycle; deletion/suspension clears cached access credentials.

Imported sessions receive a persistent provider/repository link. The
`/v1/sessions/:sessionId/repository-sync` read-only endpoint compares imported,
local and remote branch HEADs and returns `up_to_date`, `local_changed`,
`remote_changed` or `diverged_or_advanced`. It never performs an implicit
fetch, pull, push or merge. API requests are public-address checked per call,
redirect-denying, bounded to 8 MiB and use one-use exact-audience credential
leases.

Governed `repository.review.create/comment/close/merge` capabilities provide
write-side GitHub PR and GitLab MR workflows. Every REST mutation is tied to an
authoritative session, crosses the external-side-effect approval/effect journal,
and requires `x-idempotency-key`. Create/comment content and raw keys are not
persisted; the hosted operation journal stores SHA-256 projections, status,
review number and remote ID only. Merge requires an explicit expected review
HEAD SHA and disables deferred pipeline merge and source-branch deletion.
Ambiguous network/redirect/408/409/425/429/5xx outcomes become `uncertain` and
are not replayed; deterministic 4xx responses become `failed`.

## Hosted scale-to-zero scheduling

`HostedSchedulerRelay` implements provision, cancel, boot reconciliation and
external fire handling. Provisioning sends only job ID, fire time, callback URL
and dedup key—never the prompt. Inbound fire JWTs are verified against remote
JWKS for issuer, audience, expiration, purpose, job ID and fire time. Body and
JWT must agree. A persisted claim ledger accepts each `(job, fireAt)` once.
Scheduler state advances before prompt dispatch; recurring jobs are re-armed
after outcome persistence. The public callback returns 202 after cryptographic
verification and completes the agent turn in background.

## Fleet status and CI security gates

The fleet projection exports only bounded counts: session states, model/tool
counters, schedule states/overdue count, pending approval age and resident
worker health. Alert codes cover capability failure rate, approval wait,
scheduler overdue and unreachable workers without including tenant/session/job
identifiers or content. `/v1/fleet/status` and `/v1/fleet/alerts` feed the Control
Center.

CI runs normal tests plus explicit `test:adversarial` and `test:chaos` gates.
The adversarial gate covers SSRF, path/symlink escape, webhook least privilege,
malicious skill archives, plugin signatures, OPA fail-closed and credential
scope. Chaos covers worker death/adoption, child rehydration, binary replay,
PostgreSQL journals/leases and NATS request/reply.

## SBOM, provenance and release verification

`@haf/release-tool` creates deterministic release metadata without requiring a
hosted CI service:

```bash
SOURCE_DATE_EPOCH=1700000000 npm run release:prepare -- \
  --artifact ../hybrid-agent-fabric-source.tar.gz
npm run release:verify
```

The bundle under `release-metadata/` contains `source-manifest.json`, CycloneDX
1.5 and SPDX 2.3 SBOMs, an in-toto Statement carrying SLSA provenance v1,
`SHA256SUMS`, copied release artifacts and an optional Ed25519 attestation.
Source walking excludes runtime state, dependency/build/cache trees, `.env`,
credential/session files and private-key material. Prompt/config secrets are
never read into metadata.

Set `HAF_RELEASE_SIGNING_KEY` to an Ed25519 PKCS#8 PEM only in the release-tool
environment to sign. The private key is never accepted as a command-line flag or
written to the bundle. `SOURCE_DATE_EPOCH` fixes timestamps and invocation IDs.
`release:verify` rehashes every metadata/artifact file, rejects traversal entries
and verifies payload hash, public-key identity and signature.

## Isolated interactive artifacts

`artifact.publish` turns a workspace HTML file into a hash-bound interactive
artifact. Sources must remain workspace-confined UTF-8 HTML under 2 MiB and
carry an exact 1–32 action allowlist. Any source change invalidates the frame
until republished.

Canvas opens artifacts in an iframe with `sandbox="allow-scripts"` and no
`allow-same-origin`. The frame response also enforces CSP `sandbox allow-scripts`,
`default-src 'none'`, no connect/frame/form/object/base targets, and only inline
scripts/styles plus data/blob media. A 15-minute in-memory channel grants at
most 100 interactions. The injected, non-configurable `hafArtifact.emit()` /
`hafArtifact.request()` bridge communicates only through structured
`postMessage`; Canvas validates `event.source`, channel, interaction ID and the
server-side action allowlist before dispatch.

Artifact actions run as `artifact.interaction` hidden model turns. Their
user/assistant/tool messages remain in internal model continuity, but public
session snapshots, tree projections, REST/SSE events, ACP updates, Markdown,
JSON/trajectory exports, session search, knowledge indexing and external-memory
sync omit them. The interaction journal stores action, payload/response hashes,
status and error code—never raw payload or model response. Electron additionally
blocks every subframe navigation except the exact same-origin artifact-frame
route.

## HAF Canvas

The production React/Vite control center is served at `/canvas/`. It uses the
same HttpOnly session, CSRF and tenant RBAC as the API. Panels include durable
conversation/SSE streaming, approval decisions, child navigation, terminal,
workspace file tree/editor, Git status/diff/branch/create/switch/commit controls,
browser/computer-use, branch-preserving tree, durable tasks, model routes, versioned agent profiles and automations. The conversation composer can upload a
bounded binary attachment into `.haf/uploads/` through the policy/effect path and
adds its workspace path to the prompt. Markdown and `haf.trajectory.v1` training
exports are available from the session header; trajectory export excludes hidden
system messages and workspace paths. Every file/process/browser action calls a BFF capability
endpoint and therefore still crosses policy, OPA, approval and effect journals.
The earlier dependency-free console remains at `/` for recovery/diagnostics.

## Electron desktop

`@haf/desktop` wraps the Canvas URL in a hardened Electron BrowserWindow:
context isolation, Chromium sandbox, no Node integration, web security,
navigation-origin restriction, denied webviews, allowlisted permissions and
external HTTPS links through the OS browser. electron-builder targets DMG/ZIP,
NSIS/ZIP, AppImage and DEB. Desktop packaging requires Node 22.12+; the server
runtime remains compatible with Node 20+.
