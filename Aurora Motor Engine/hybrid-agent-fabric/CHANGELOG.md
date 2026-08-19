# Changelog

## 1.36.0 — 2026-08-19

- Added signed external automation responder deployments bound to one tenant webhook automation and one Credential Broker secret reference.
- Added raw-body HMAC-SHA256 verification over timestamp + nonce + payload, five-minute replay windows, persistent nonce hashes and immediate event admission.
- Added responder heartbeats with content-free ready/degraded/stale health derivation, version/capability inventory and one-way instance projection.
- Added asynchronous event dispatch with event-ID deduplication and content-free processing/delivered/failed/uncertain journals; interrupted or unknown outcomes are never replayed.
- Added credential rotation, enable/disable/remove lifecycle and exact event-type authority inherited from the bound automation.
- Added public heartbeat/event routes plus tenant-admin management REST and Canvas responder deployment/health controls.
- Added heartbeat health, signature/timestamp/tamper/event-type/rotation, dedupe, uncertain no-replay and state-redaction tests.

## 1.35.0 — 2026-08-19

- Added restart-persistent content-free state for same-provider credential pools: cooldowns, disablement, failure counts/codes and last-use timestamps survive control-process replacement.
- Pool state is keyed by runtime/provider and credential IDs only; API key values are never written. Removed credentials are ignored and newly added credentials start clean.
- A rejected credential remains disabled until an explicit system-admin reset; expired cooldowns become available without bypassing active retry windows.
- Failure-state persistence is fail-closed before trying another credential, while a persistence failure after successful model output cannot invalidate the already-delivered generation.
- Added model-router and REST reset controls plus Canvas per-credential state/cooldown/failure inspection and reset actions.
- Custom model origins now require an explicit `provider`, `aggregator`, or `local` data-policy label; tenant-aware configuration views surface the label.
- Added restart cooldown/disable/reset/redaction/stale-entry tests and explicit custom-origin data-policy tests.

## 1.34.0 — 2026-08-19

- Added generic tenant-scoped OIDC Authorization Code + PKCE credential sources for model providers, using only operator-registered client IDs instead of impersonating third-party public clients.
- Added exact issuer discovery, authorization/token/JWKS origin allowlists, SSRF checks, redirect denial, nonce/state/audience/issuer ID-token verification and bounded JSON/JWKS parsing.
- Access/rotating refresh tokens, PKCE verifier, nonce, discovery data and optional client-secret references remain Credential Broker-encrypted; list/status surfaces expose projections and timestamps only.
- Added public and confidential client methods (`none`, `client_secret_basic`, `client_secret_post`), refresh-before-expiry, local logout, source lifecycle and exact model resource-origin audiences.
- Model configurations can bind an OAuth source instead of an environment key. A dynamic bearer wrapper materializes fresh same-provider clients and performs one forced refresh only after a pre-output 401/403; partial output is never retried.
- Added tenant-aware model configuration lists, REST/Canvas OAuth source registration/authorization/logout and model-route binding.
- Added restart/PKCE/rotation/encryption/poisoned-discovery/confidential-secret/audience/pre-output-retry/no-partial-retry tests.

## 1.33.0 — 2026-08-19

- Added explicit plan/apply automation synchronization from bounded hosted GitHub/GitLab JSON manifests.
- Added authenticated hosted-file retrieval with exact provider/repository/ref/path boundaries, base64/size/UTF-8 checks and content SHA-256.
- Git sources bind one authoritative tenant session, administrator-supplied webhook-secret environment reference and exact model-route allowlist; remote manifests cannot choose broader authority.
- Plans expose create/update/unchanged/disable summaries and expire after 15 minutes. Apply re-fetches and requires the exact planned content hash, so branch movement forces a new review.
- Added managed automation provenance, schedule reconciliation, removed-key disable semantics and explicit succeeded/failed/partial/restart-during-apply states without claiming atomic external effects.
- Git source state persists hashes/status/provenance only, not prompts or manifest content; Canvas and REST gained source, plan and exact-hash apply workflows.
- Added create/update/disable, branch-race, authority, traversal, duplicate-key, expired-schedule and content-free-state tests.

## 1.32.0 — 2026-08-19

- Added native bidirectional Twilio SMS through the existing Channel Gateway and governed `channel.send` capability.
- Added exact E.164 sender/recipient allowlists, fixed configured Twilio number and account-SID binding.
- Added mandatory constant-time `X-Twilio-Signature` HMAC-SHA1 verification over the exact operator-configured public URL and sorted form parameters.
- Added immediate TwiML acknowledgment followed by asynchronous, MessageSid-idempotent agent processing and outbound reply.
- Added a content-free restart-safe SMS event journal; interrupted processing or ambiguous outbound reply becomes `uncertain` and is never automatically replayed.
- Added exact-origin, redirect-denying, bounded Twilio REST transport with Basic auth confined to headers and no binary MMS URL invention.
- Added REST/Canvas status, environment wiring, signed-ingress/tamper/dedupe/uncertainty/redaction/outbound contract tests and zero audit findings.

## 1.31.0 — 2026-08-19

- Added TLS-first SMTP outbound email with exact recipient confinement, bounded text/media attachments and STARTTLS or implicit-TLS enforcement.
- Added persistent IMAP inbound polling with public-DNS/private-network policy, TLS verification, mailbox UIDVALIDITY and restart-safe UID cursors.
- Added mandatory exact sender/recipient allowlists plus constant-time `X-HAF-Email-Token` verification before any email reaches a model turn.
- Added a bounded dependency-free MIME parser for folded headers, encoded words, multipart bodies, base64/quoted-printable text and attachment omission.
- Added content-free inbound journals with processing/responding/done/ignored/failed/uncertain outcomes; an interrupted/ambiguous SMTP reply is never automatically replayed.
- Added loop suppression, untrusted-email fencing, reply threading, reconnect generations, lifecycle status and Canvas email transport counters.
- Added real certificate-verified SMTP plus fake-IMAP restart/UID/token/uncertainty/MIME/security tests with zero npm audit findings.

## 1.30.0 — 2026-08-19

- Added a real long-lived IRC/IRCv3 transport integrated with the Channel Gateway and outbound `channel.send` registry.
- Added public-DNS enforcement, TLS certificate verification by default, optional bounded custom CA bundles and explicit private/plaintext development switches.
- Added IRCv3 CAP negotiation, message tags, server time/account tags, PING/PONG and TLS-only SASL PLAIN authentication.
- Added exact channel plus nickname/account allowlists, CTCP/formatting rejection, bounded parsing, 512-byte UTF-8-safe outbound framing and destination confinement.
- Added exponential jittered reconnect, generation tracking, registration timeouts, bounded in-flight turns and content-free transport status in API/Canvas.
- Added real local TCP/TLS IRC servers in tests covering CAP, allowlists, ingress/reply, PING, UTF-8 splitting, SASL credential isolation, reconnect and injection/private-network guards.

## 1.29.0 — 2026-08-19

- Added tenant-scoped GitHub App registration and restart-persistent installation/setup-state coordination with verified app-owned installation metadata.
- Added RS256 app JWT minting with current GitHub claim rules, primary/secondary private-key rotation, deterministic disable semantics and 401/403 key failover.
- Added on-demand one-hour installation-token mint/refresh and direct integration as a hosted repository credential source for catalogs, imports and governed PR operations.
- Raw installation IDs and access tokens are Credential Broker-encrypted; list/state surfaces contain only opaque IDs and keyed projections.
- Added raw-body SHA-256 GitHub webhook verification, rotating webhook secrets, delivery deduplication and installation/repository/pull-request lifecycle projections.
- Added GitHub App REST/Canvas registration, install, installation binding and lifecycle controls plus fake-GitHub RSA/rotation/restart/webhook/secret-redaction tests.

## 1.28.0 — 2026-08-19

- Added governed GitHub pull-request and GitLab merge-request create/comment/close/merge operations.
- Added mandatory session capability routing, external-side-effect approvals and required request idempotency keys for every hosted write.
- Added SHA-pinned merges: GitHub/GitLab merge calls require the caller's expected remote review HEAD and never enable deferred pipeline merge or branch deletion.
- Added durable content-free operation journals with input/idempotency hashes, remote IDs and explicit pending/succeeded/failed/uncertain outcomes.
- Transport ambiguity, 408/409/425/429/5xx and redirects become uncertain and are never automatically replayed; deterministic 4xx outcomes become failed.
- Added REST/model capabilities, Canvas review controls and GitHub/GitLab/idempotency/uncertain/failure/secret-redaction tests.

## 1.27.0 — 2026-08-19

- Added standalone `video.upscale` with native FAL 2x/4x provider configuration and workspace-confined MP4/WebM inputs.
- Added bounded data-URI upload, exact HTTPS endpoint/redirect handling and credential-free request bodies.
- Added MP4 box traversal (`moov`/`trak`/`tkhd`) and bounded WebM PixelWidth/PixelHeight extraction.
- Upscale success now requires output width and height at least the requested factor; unverifiable or undersized outputs fail closed.
- Added validated artifact dimensions to REST/capability results and Canvas video upscaler controls.
- Added FAL auth/body, output materialization, false-scale, path escape, redirect and unsafe-model tests.

## 1.26.0 — 2026-08-18

- Added workspace-confined, hash-bound interactive HTML artifacts with exact action allowlists and 2 MiB UTF-8 limits.
- Added opaque-origin `sandbox="allow-scripts"` frames, defense-in-depth CSP sandboxing, no network/forms/objects/base URLs and short-lived in-memory frame channels.
- Added a frozen `hafArtifact.emit/request` postMessage bridge with source/channel/interaction validation, payload depth/size/prototype guards and 100-interaction grants.
- Added hidden artifact model turns: internal user/assistant/tool events remain in model continuity but are removed from REST snapshots, SSE/events, exports, search, external memory and ACP updates.
- Added content-free interaction journals containing hashes/status only, duplicate interaction IDs and uncertain/failed delivery outcomes.
- Added Canvas Artifacts management and Electron subframe navigation restrictions plus registry/hidden-turn/export/search/desktop tests.

## 1.25.0 — 2026-08-18

- Added a dedicated `haf-release` application for deterministic source manifests, CycloneDX 1.5 and SPDX 2.3 SBOMs, SHA-256 checksums and in-toto/SLSA v1 provenance.
- Added bounded release artifact copying and provenance subjects with exact inspected upstream revisions and source-manifest material hashes.
- Added optional Ed25519 checksum attestations using an environment-only private key; bundles contain public verification material but never private keys.
- Added release verification for every metadata/artifact checksum, signature payload/key identity and traversal-safe checksum entries.
- Added SOURCE_DATE_EPOCH reproducibility, generated/sensitive/cache/runtime exclusions and deterministic canonical JSON/invocation IDs.
- Added `release:prepare` / `release:verify` scripts and deterministic, tamper, signing, escape and duplicate-artifact tests.

## 1.24.0 — 2026-08-18

- Added inbound Mattermost, LINE Messaging, Google Chat, Microsoft Teams and Feishu/Lark webhook routes wired into durable channel routing.
- Added LINE raw-body base64 HMAC and Feishu timestamp/nonce/encrypt-key SHA-256 verification with five-minute replay windows.
- Added bounded exact-origin JWKS caching and audience/issuer JWT verification for Google Chat and Teams.
- Added sender/chat/space/conversation allowlists, platform event-ID idempotency and asynchronous response dispatch through configured outbound adapters.
- Added challenge/ignored-event handling, content-free background errors and no-token/body persistence.
- Added cryptographic HMAC/replay/JWT/JWKS redirect/cache tests and integrated platform route type/build validation.

## 1.23.0 — 2026-08-18

- Added restart-persistent asynchronous video jobs with explicit submitting/queued/running/succeeded/failed/cancelling/cancelled/uncertain states.
- Added native FAL Queue submit, status, result and cancellation transport with exact-origin URL construction, bounded JSON and no trusted provider-returned callback URLs.
- Added content-free job persistence: prompts, workspace paths, credentials, source images and provider result URLs are never written to the job registry or list API.
- Submission/cancellation ambiguity becomes `uncertain` and is never automatically replayed; hashed idempotency keys deduplicate confirmed and uncertain submissions.
- Added `video.job.submit/status/cancel/list`, REST job APIs and Canvas async job controls with validated artifact materialization on completion.
- Added queue contract, restart recovery, idempotency, successful materialization, redirect and uncertain-outcome tests.

## 1.22.0 — 2026-08-18

- Added up to eight confined image references and four image-to-video references with provider feature negotiation and aggregate byte limits.
- Added native FAL image generation/editing and FAL 2x/4x upscale providers with server-side data-URI inputs and bounded response contracts.
- Added standalone `image.upscale` plus optional generate→upscale chains with per-stage provider/model provenance.
- Upscale completion now requires validated raster magic bytes and dimensions at least the requested factor; a provider cannot claim 2x/4x while returning the original size.
- Added multi-reference/upscale REST, capability and Canvas controls, explicit duplicate/reference bounds and FAL redirect denial.
- Added focused multipart, FAL body/auth, chained/direct upscale, false-upscale rejection and multi-reference video tests.

## 1.21.0 — 2026-08-18

- Added tenant-scoped hosted GitHub and GitLab account registries backed by Credential Broker secret references.
- Added GitHub user/installation repository discovery, GitLab membership discovery and normalized account repository metadata.
- Added open pull-request/merge-request metadata, safe hosted repository import and immutable session-to-provider links.
- Added local/imported/remote HEAD comparison with explicit up-to-date/local-changed/remote-changed/diverged status and no implicit pull/push.
- Enforced public exact API/clone origins, per-request credential leases, manual redirects, bounded JSON and token-free persistence/list responses.
- Added Hosted Accounts controls in Canvas and focused GitHub/GitLab/redirect/tenant/clone-substitution tests.

## 1.20.0 — 2026-08-18

- Added native outbound Mattermost, LINE Messaging, Google Chat, Microsoft Teams and Feishu/Lark adapters.
- Added Mattermost and Feishu bounded binary media upload paths; platforms without a safe direct-upload contract reject media explicitly instead of inventing public URLs.
- Added Mattermost thread roots, Google Chat threads, Teams chat/channel destination routing and Feishu reply semantics.
- Hardened the shared channel HTTP boundary with manual redirects, bounded provider responses and credential-shaped error redaction.
- Added server-side environment registration, Canvas auto-discovery and focused text/media/redirect/redaction contract tests.

## 1.19.0 — 2026-08-18

- Added a dedicated remote `haf-client` application with interactive terminal, one-shot stdin automation and JSON-RPC 2.0 stdio modes.
- Added exact-origin REST transport with environment-only bearer credentials, bounded response/error handling, redirect denial and command idempotency IDs.
- Added reconnecting SSE subscriptions with monotonic sequence cursors, replay deduplication, exponential backoff and abortable unsubscribe.
- Added JSON-RPC session lifecycle, generic command, event subscription and approval methods with standard parse/request/method/params errors.
- Added TUI session navigation, live text/tool/status rendering, multiline prompts, model switching, cancellation and approval controls.
- Prompt text and credentials are intentionally rejected as command-line flags; one-shot prompts arrive through bounded stdin.

## 1.18.0 — 2026-08-18

- Added native ChatGPT Codex subscription mode against the confirmed device-auth, token-refresh, model-catalog and `/backend-api/codex/responses` contracts.
- Added restart-persistent Credential Broker storage for device authorization, access/rotating refresh tokens, expiry, cooldown and content-free account projections.
- Added account-specific model discovery without synthetic model slugs, plus hot route activation and Canvas device-login/model-picker controls.
- Added first-party Codex headers, exact-origin/manual-redirect transport, Harmony control-token neutralization, prompt-cache routing and SSE text/reasoning/tool/usage projection.
- A pre-output 401 may trigger one refresh/retry; no retry or provider fallback is allowed after partial model output.
- Added focused OAuth restart/rotation/encryption, transport, catalog, truncation and full engine-route tests.

## 1.17.0 — 2026-08-18

- Added a one-external-provider memory orchestration boundary that preserves local governed memory and injects bounded per-turn recall without mutating transcripts or user messages.
- Added native Honcho SDK integration with tenant-projected peer/session identities, session summaries, user representations, peer cards, cadence and chunked post-turn synchronization.
- Added governed `memory.honcho.profile`, `search`, `context`, `reason` and `conclude` capabilities with untrusted output labels and external-side-effect approval boundaries.
- Added content-free `pending`/`delivered`/`uncertain` synchronization journals; uncertain writes are never automatically replayed or described as exactly-once.
- Hardened Honcho SDK requests to exact configured origins with SSRF checks, manual redirects, bounded timeouts and no credential projection.
- Added environment configuration, content-free provider status API and full manager/adapter/engine lifecycle tests.

## 1.16.0 — 2026-08-18

- Added a packaged deterministic rolling micro-compaction engine ahead of the existing intent-preserving context projection.
- Older contiguous assistant/tool windows become bounded, hash-bound, explicitly untrusted derived summaries while user/system messages and the recent tail remain exact.
- Added tenant/session-scoped bounded observer caches with atomic writes, cache reuse telemetry and fail-open recovery from missing, malformed or oversized cache files.
- Tool arguments/results are represented by hashes, status, shapes and key names rather than copied values; durable transcripts remain authoritative and unchanged.
- Added environment/config controls and focused preservation, secret-shape, cache-hit and corruption-recovery tests.

## 1.15.0 — 2026-08-18

- Added restart-resumable in-flight MCP OAuth coordination using encrypted, expiring Credential Broker descriptors rather than plaintext callback maps.
- OAuth callbacks now resolve directly from one-way state digests, rebuild SDK transport/provider state after control-process replacement and serialize duplicate completion/denial races.
- Pending state, PKCE verifier and encrypted transport credentials are cleared on success, denial or expiry; graceful shutdown suspends rather than cancels browser authorization.
- Added exact authorization-server origin allowlists for cross-origin OAuth discovery/token/authorization endpoints, with SSRF checks and redirect denial on every server-side request.
- Added full local OAuth/MCP restart, concurrent replay and denial-cleanup tests.

## 1.14.0 — 2026-08-18

- Added tenant-scoped priority inbound channel routing rules over platform, chat type, hashed chat/user IDs and bounded metadata equality.
- Added per-chat/per-user/per-thread lane selection and immutable agent-profile assignment for newly admitted channel sessions.
- Raw chat/user IDs are hashed before persistence/list projection; rule/profile tenant mismatch fails closed.
- Added rule CRUD APIs, outbound text/media BFF and a Canvas Channels panel for routing and adapter delivery.

## 1.13.0 — 2026-08-18

- Added workspace-confined native outbound media delivery with 25 MiB bounds and image/video/audio/PDF magic-byte detection.
- Added native media contracts for Telegram, Discord, Slack, WhatsApp Cloud, Matrix and Signal, plus HMAC-signed webhook base64 envelopes.
- Added media upload/ID flows where required, captions/thread routing, no-credential payload projection and `channel.send.mediaPath`.

## 1.12.0 — 2026-08-18

- Added pinned external secret-source registry with generic command, 1Password CLI and Bitwarden CLI adapters.
- Added absolute executable/SHA-256 verification, clean environment allowlists, fixed argument contracts, bounded output/time and per-item failure isolation.
- Imported values enter Credential Broker without appearing in source lists, refresh results, arguments, model/session state or Canvas; source references are redacted from list APIs.
- Added secret-source CRUD/refresh APIs and a Canvas Secrets panel with write-only manual secret entry and metadata-only inventories.

## 1.11.0 — 2026-08-18

- Added asynchronous `context_projection` transform hooks for signed plugins while preserving immutable system prompt construction and exact user-message content.
- Invalid, timed-out or user-dropping context transforms fall back to the last good intent-preserving projection.
- Added bounded `memory_context` augmentation hooks that preserve local memory and label provider additions as untrusted external data.
- Added focused tests for derived-message compaction, user-intent invariants and local-plus-provider memory assembly.

## 1.10.0 — 2026-08-18

- Added bounded HTTPS repository import with SSRF checks, redirect denial, shallow/blob-filtered cloning and post-clone file/byte limits.
- Added credential-broker leases scoped to the repository origin and an ephemeral askpass channel so tokens never enter clone URLs, arguments, logs, sessions or model state.
- Added automatic cleanup on clone/session failures, verified HEAD capture, optional branch/profile selection, repository import API and Canvas bootstrap controls.

## 1.9.0 — 2026-08-18

- Added model-planned continual-harness review with strict JSON parsing, untrusted-trajectory fencing and real event-log evidence binding.
- Planner output creates scanned/evaluated candidates only; it cannot edit the immutable prompt, self-promote or bypass the Learning Governor.
- Added optional single-flight turn-interval review cadence, durable review history, manual plan/review APIs and a Canvas Learning governance panel.
- Added Canvas candidate evaluation/promotion/rollback workflows while retaining scope/risk/human-approval enforcement.

## 1.8.0 — 2026-08-18

- Added pluggable text-to-video and image-to-video services with a native FAL synchronous adapter.
- Added confined source-image materialization, normalized aspect/duration inputs, bounded base64/remote retrieval and MP4/WebM magic-byte validation.
- Added `video.generate`, image/video BFF endpoints, server-side provider inventory and a Canvas Media panel.
- Remote video URL materialization remains explicitly disabled by default and generated artifacts are owner-only workspace files.

## 1.7.0 — 2026-08-18

- Added native AWS Bedrock Converse routing with standard AWS credential-chain authentication, system/tool history translation, cache usage and Bedrock retry/error classification.
- Added workspace-confined multimodal image message parts with MIME/magic-byte/SHA-256 validation and no base64 persistence in session state.
- Added native image projection for OpenAI Chat/Responses, Azure OpenAI, Anthropic Messages, Gemini/Vertex and AWS Bedrock.
- Added Canvas image chips, up to eight images per prompt, structured image metadata in transcript/trajectory exports and restoration on failed sends.

## 1.6.0 — 2026-08-18

- Added MCP form and URL elicitation capabilities with a five-minute human-response promise and no automatic submission.
- Added bounded primitive-only form schema sanitization, tenant isolation, strict response validation, public-URL checks and no-content persistence.
- Added restart/timeout expiration semantics, resolve/list APIs and Canvas human-input cards with explicit accept/decline/cancel actions.
- Elicited values remain in live request memory only and are never written to session transcripts, audit metadata, schema cache or model context.
- Added native Azure OpenAI deployment routing with `api-key` authentication, explicit API versioning and tool/usage normalization.
- Added native Vertex AI Gemini routing through resource-scoped publisher paths and OAuth bearer tokens, reusing Gemini tool/usage translation without API-key leakage.

## 1.5.0 — 2026-08-18

- Added broker-encrypted MCP OAuth state, PKCE verifiers, access/refresh tokens, dynamic client registration data and discovery cache.
- Added short-lived, state-validated OAuth connection coordination, public callback completion, denial/cancellation handling and pending-flow cleanup.
- Added server-side environment references for OAuth client IDs/secrets and a Canvas MCP manager for static bearer, OAuth/PKCE and mTLS connections.
- OAuth tokens and client secrets remain outside MCP lists, schema cache, session snapshots, model context and browser storage.

## 1.4.0 — 2026-08-18

- Added tenant-scoped persistent agent profiles with immutable per-session version snapshots, supplemental instructions, default model/fallback routes and enable/update/delete lifecycle.
- Added profile capability allowlists enforced in model tool projection, direct tool execution and nested Python `haf.call(...)`, preventing subagents or the kernel from escalating beyond profile visibility.
- Child agents and forks inherit the frozen parent profile, preserving least privilege across the session family.
- Added resource-derived RBAC Agent Profile APIs, Canvas Profiles manager, creation-time profile picker and runtime profile inspection.

## 1.3.0 — 2026-08-18

- Added typed sandbox-aware Git status/diff/branch/create/switch/commit capabilities and Canvas controls; commit hooks are disabled and no remote push capability is exposed.
- Forced composite TypeScript application builds so missing excluded `dist` directories are always re-emitted despite stale incremental metadata.
- Added server-side environment-referenced MCP mutual TLS with bounded PEM validation, strict certificate verification and no-secret API/list surfaces.
- Added persistent content-only MCP schema cache and an administrative cache-inspection endpoint; cache failures remain observer-only and fail open.
- Added persistent server-side custom model configurations with environment credential/header references, exact credential-audience binding, hot enable/disable/remove, session route selection and a Canvas Models panel.

## 1.2.0 — 2026-08-18

- Added a durable PostgreSQL/file-backed agent inbox with explicit pending, claimed, delivered and uncertain states.
- Added direct family-reach authorization, sibling-scoped names, family roster, bounded broadcast, token-bucket rate limiting and pending limits.
- Added `auto`, `steer` and `follow_up` delivery modes with immediate receipts; busy `auto` messages enter the active turn at a model boundary.
- Added agent roster/inbox/message APIs and Canvas family messaging controls.
- Upgraded the Python bridge to protocol v2 with execution IDs, kernel generations, per-execution host tokens, duplicate request replay, bounded request counts and stable idempotency keys.
- Kernel cancellation/timeout now kills synchronous execution, aborts in-flight host capabilities and prevents late frames from regaining currentness.
- Added same-origin, SSRF-guarded Streamable HTTP MCP with server-side environment headers, redirect rejection, tool timeouts, circuit breaking and dynamic tool-list refresh.
- Added native OpenAI Responses API message/tool translation with server-side storage disabled.
- Added Brave/Tavily-backed normalized `web.search` with bounded fields, provenance URLs and unsafe-result filtering.
- Added confined single-source image editing through OpenAI-compatible multipart image edit endpoints.
- Added PostgreSQL RLS and LISTEN/NOTIFY owner wake-up for durable agent inbox rows.
- Added privacy-preserving `haf.trajectory.v1` training export with structured tool calls/results and no hidden system prompt or workspace path.
- Added bounded SHA-256-verifiable binary workspace attachments and a Canvas upload-to-prompt workflow.
- Added evidence-validated continual-harness refinement batches with governed candidate edits, persistent history, promotion-state refresh and reverse-order batch rollback.
- Fixed `agent.spawn` invoked from inside a parent model turn so child linking does not re-enter and deadlock the parent actor mutex.

## 1.1.0 — 2026-08-18

- Re-audited current OpenHands, Prime Agent and Hermes Agent default branches at exact recorded revisions.
- Added native Gemini GenerateContent translation, including Gemini 3 tool-call IDs, reasoning events and usage normalization.
- Added explicit per-session provider fallback chains with safe route audit events and no fallback after partial output.
- Added same-provider credential pools with opaque inventory, round-robin selection, cooldowns and rejected-credential disablement.
- Added bounded/redacted provider error classification.
- Replaced left-truncating context selection with non-destructive intent-preserving projection.
- Added a durable dependency-aware task board, model capabilities, session commands and Canvas panel.
- Added versioned JSON/Markdown transcript export and Canvas download.
- Added bounded OpenAI-compatible image generation with raster magic-byte validation and workspace artifact materialization.
- Added a digest-pinned Singularity/Apptainer sandbox adapter with containment and network-off defaults.
- Added focused tests for model routing, credentials, Gemini, context projection, tasks, exports, images and Singularity.
- Added a transparent current-upstream gap backlog instead of extending the old “complete” claim.

## 0.1.0 — 2026-08-15

- Initial durable session engine and supervisor.
- Event/snapshot, command/effect journals and leases.
- Model router, governed capabilities, approvals and sandbox adapters.
- Persistent Python bridge, memory, skills, subagents, scheduler and channels.
- MCP stdio bridge, ACP adapter and REST/SSE control API.
- Plugin hook failure semantics and first integration test suite.

## 0.2.0 — 2026-08-15

- Added persistent goals and model-callable goal completion.
- Added bounded autonomous continuations, token/turn/time limits and quality gates.
- Added unchanged-workspace gate retry suppression.
- Added isolated session forks and optional abandoned-branch summaries.
- Added per-session provider:model selection.
- Added provider profiles for OpenAI, Anthropic, OpenRouter, Google, Groq, xAI, DeepSeek, Mistral and Ollama.
- Added native Anthropic Messages transport.
- Added Telegram, Discord, Slack and signed-webhook outbound adapters.
- Added content-free operational metrics and Prometheus projection.
- Added AES-256-GCM local credential broker with scoped, expiring, bounded-use leases.
- Added SSRF-checked bounded public web fetch capability.
- Expanded the embedded control center for sessions, chat, events, goals, autonomy, approvals, children, forks, automations, schedules, providers, backends, search and metrics.
- Added server-side multi-backend registry with environment-only credential references and health checks.
- Added declarative manual/schedule/webhook automations with run ledger and timeout cancellation.
- Added tenant-scoped cross-session search.
- Added Docker-isolated persistent Python kernels when the Docker sandbox profile is selected.
- Added allowlist- and secret-protected native Telegram webhook ingress.

## 0.3.0 — 2026-08-15

- Added fail-open OTLP/HTTP JSON metrics exporter with content-free payloads and status accounting.
- Added WhatsApp Cloud, Matrix and Signal REST outbound channel adapters.
- Added SSH sandbox with strict host checking, bounded execution and bidirectional rsync workspace synchronization.
- Disabled local Python execution in SSH mode to prevent execution-boundary bypass.
- Added Playwright/CDP browser navigation, bounded snapshots, element refs, click/type/press/screenshot and coordinate computer-use controls.
- Added per-subresource SSRF enforcement in browser contexts.
- Added OpenAI-compatible speech-to-text and text-to-speech with workspace confinement.
- Added Learning Governor with evidence, scanning, evaluation, human review, scope/risk gates, promotion and rollback.
- Added governed learning artifacts to frozen prompt context.
- Added learning candidate control-center workflows.
- Added layered OPA/Rego policy decisions with secret redaction and fail-closed timeout/network/schema handling.

## 0.4.0 — 2026-08-16

- Added length-prefixed private worker frames with bounded JSON routing headers and opaque payload bytes.
- Added authenticated Unix-domain worker sockets and owner-only descriptors.
- Added generation/sequence event replay, replay-capacity detection and snapshot fallback.
- Added chunked snapshots and attachment-local backpressure/resync signaling.
- Added detached worker process manager with stale descriptor cleanup, logs, stop and adoption.
- Added a real resident HAF session-worker process owning root session, kernel, children and approvals.
- Added Control API endpoints for resident worker create/list/adopt/state/commands/events/approvals/stop.
- Control-plane graceful shutdown now closes attachments without terminating resident workers.
- Added control-center resident worker management.
- Added secret-filtered launch manifests and same-ID worker respawn after process death.
- Session-worker recovery reloads durable snapshots with a new generation while preserving transcript state.

## 0.5.0 — 2026-08-16

- Added versioned PostgreSQL schema migrations.
- Added PostgreSQL event store with idempotent event IDs, sequence constraints and LISTEN/NOTIFY fan-out.
- Added PostgreSQL atomic snapshot upserts.
- Added cross-process PostgreSQL command/effect journals with explicit execution ownership and uncertain outcomes.
- Added TTL/heartbeat distributed session leases.
- Added complete PostgreSQL engine vertical-slice configuration.
- Added NATS event bridge with opaque tenant subjects.
- Added NATS typed request/reply command bus for workers.
- Session workers can serve NATS commands and publish events when configured.
- Added file/PostgreSQL and local/NATS runtime profile selection through environment configuration.

## 0.6.0 — 2026-08-18

- Added persistent branch-preserving in-session message trees with active leaf and labels.
- Added branch commands and a Control Center Tree view.
- Compaction now creates context-reset entries while retaining abandoned branches.
- Added persistent BM25-style lexical plus cosine-vector hybrid retrieval.
- Added deterministic local hash embeddings and optional OpenAI-compatible embeddings.
- Added live event-to-index session message ingestion and reindex APIs.
- Learning promotion now indexes memory, skill, prompt and subagent artifacts; rollback removes them.
- Added remote Skills Hub sources, catalog refresh/search and bounded bundle downloads.
- Added SHA-256 verification, tar traversal/link/bomb controls, quarantine import and audit logs.
- Skills Hub installation requires explicit promotion after quarantine.

## 0.7.0 — 2026-08-18

- Added encrypted server-side web sessions with random HttpOnly cookie IDs and CSRF tokens.
- Added API-token-to-cookie login, logout and identity introspection.
- Added OIDC discovery, Authorization Code + PKCE, nonce/state validation and JWKS ID-token verification.
- Added tenant claim mapping and admin/operator/viewer RBAC.
- Added resource-derived tenant authorization for sessions, automations and learning candidates.
- Added system-admin-only backend, MCP, detached-worker and Skills-Hub management.
- Added Slack raw-body HMAC verification with replay window and user/channel allowlists.
- Added Discord Ed25519 interaction verification and deferred background execution.
- Added WhatsApp Cloud HMAC verification, challenge flow and sender allowlists.
- Added Signal and Matrix shared-secret plus sender/room allowlists.
- Added Control Center cookie login and CSRF-aware API requests.

## 0.8.0 — 2026-08-18

- Added a common credential broker interface.
- Added HashiCorp Vault KV v2 secret storage with metadata-only lists and scoped leases.
- Added KMS envelope encryption with per-secret data keys and zeroed plaintext key buffers.
- Added tenant columns and optional PostgreSQL RLS policies for events, snapshots and journals.
- Added request-scoped tenant and system-bypass PostgreSQL transaction helpers.
- Added Modal, Daytona, Vercel and Kubernetes serverless sandbox gateway adapters.
- Added cloud sandbox provision/exec/snapshot/destroy lifecycle, resource limits and network policy contracts.
- Disabled local Python kernels for every remote/cloud execution backend to prevent boundary bypass.

## 0.9.0 — 2026-08-18

- Added Ed25519-signed, SHA-256-pinned WASI plugin manifests.
- Added a separate WASI runner process with no network imports and constrained read-only/scratch preopens.
- Added plugin capability and observer/guard/transform hook registration with bounded output and timeouts.
- Added automated learning command evaluation and output hashes.
- Added Ed25519-signed learning releases and trusted-key verification.
- Added canary percentage/sample/success thresholds, outcome accounting, automatic promotion and rollback.
- Added Control API and Control Center management for WASI plugins and signed learning rollouts.

## 0.10.0 — 2026-08-18

- Added external scheduler provider support to DurableScheduler.
- Added hosted scale-to-zero provision/cancel/reconcile and external-fire execution.
- Added JWKS-backed short-lived cron-fire JWT verification for issuer, audience, purpose, job and fire time.
- Added persisted at-most-once fire claims, duplicate suppression and recurring re-arm.
- Added content-free fleet snapshots and threshold-based alerts for capability failures, approvals, overdue jobs and workers.
- Added Fleet status/alerts APIs and Control Center counters.
- Added dedicated adversarial and worker/persistence chaos CI commands and gates.

## 1.0.0 — 2026-08-18

- Added React/Vite HAF Canvas served under `/canvas/`.
- Added Conversation, Terminal, Files/editor, Git Changes, Browser/computer-use, Tree and Automations panels.
- Added policy-governed workspace BFF endpoints for files, terminal, changes and browser actions.
- Added cookie/CSRF-aware Canvas login, SSE updates, approvals, child navigation and fleet indicators.
- Added secure Electron desktop shell with context isolation, sandbox, navigation restrictions and external-link handling.
- Added cross-platform electron-builder targets for macOS, Windows and Linux.
