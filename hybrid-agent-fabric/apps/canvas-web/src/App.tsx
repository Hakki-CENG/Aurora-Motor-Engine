import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Bot, Boxes, Brain, CheckCircle2, ChevronRight, Code2, Download, FileCode2, Files, GitBranch,
  Globe2, ImageIcon, KeyRound, ListTodo, Loader2, MessageSquare, Paperclip, Play, Plus, RefreshCw, Save, Video,
  Send, ShieldCheck, SquareTerminal, Workflow, XCircle,
} from "lucide-react";

type Role = "system" | "user" | "assistant" | "tool";
type Message = { id: string; role: Role; timestamp: string; content: Array<any> };
type Session = {
  sessionId: string; name: string; status: string; generation: number; lastSequence: number;
  modelName?: string; modelFallbacks?: string[]; agentProfile?: {id:string;name:string;version:number;allowedCapabilityIds?:string[]}; messages: Message[]; childSessionIds: string[]; workspacePath: string;
  tasks?: Array<{id:string;title:string;description?:string;status:string;priority:string;dependsOn:string[];assigneeSessionId?:string;updatedAt:string}>;
  tree?: { activeLeafId?: string; entries: Array<{ id: string; parentId?: string; message: Message; labels: string[]; contextReset?: boolean }> };
  totalUsage: { inputTokens: number; outputTokens: number };
};
type Tab = "chat" | "terminal" | "files" | "changes" | "browser" | "media" | "artifacts" | "tree" | "tasks" | "society" | "cognitive" | "aurora" | "models" | "profiles" | "mcp" | "secrets" | "channels" | "learning" | "automations";

let csrfToken: string | null = null;
async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(csrfToken ? { "x-haf-csrf": csrfToken } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: any; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.message ?? body?.error ?? `HTTP ${response.status}`);
  return body as T;
}

function textOf(message: Message): string {
  return message.content.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "image") return `🖼 ${part.alt || part.path} (${part.mimeType})`;
    if (part.type === "tool_call") return `→ ${part.name}\n${JSON.stringify(part.arguments, null, 2)}`;
    if (part.type === "tool_result") return `← ${part.name}\n${JSON.stringify(part.result, null, 2)}`;
    return "";
  }).join("\n");
}

export function App() {
  const [identity, setIdentity] = useState<any>(null);
  const [token, setToken] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<any[]>([]);
  const [selectedAgentProfile, setSelectedAgentProfile] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryBranch, setRepositoryBranch] = useState("");
  const [repositorySecretId, setRepositorySecretId] = useState("");
  const [hostedProviders, setHostedProviders] = useState<any[]>([]);
  const [hostedProviderId, setHostedProviderId] = useState("");
  const [hostedRepositories, setHostedRepositories] = useState<any[]>([]);
  const [hostedRepositoryId, setHostedRepositoryId] = useState("");
  const [hostedKind, setHostedKind] = useState("github");
  const [hostedName, setHostedName] = useState("");
  const [hostedSecretId, setHostedSecretId] = useState("");
  const [githubApps, setGithubApps] = useState<any[]>([]);
  const [githubAppId, setGithubAppId] = useState("");
  const [githubInstallations, setGithubInstallations] = useState<any[]>([]);
  const [githubInstallationId, setGithubInstallationId] = useState("");
  const [githubAppName, setGithubAppName] = useState("");
  const [githubNumericId, setGithubNumericId] = useState("");
  const [githubClientId, setGithubClientId] = useState("");
  const [githubSlug, setGithubSlug] = useState("");
  const [githubPrivateKeySecretId, setGithubPrivateKeySecretId] = useState("");
  const [githubWebhookSecretId, setGithubWebhookSecretId] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [prompt, setPrompt] = useState("");
  const [promptImages, setPromptImages] = useState<Array<{path:string;mimeType:string;sha256:string;fileName:string}>>([]);
  const [familyMessage, setFamilyMessage] = useState("");
  const [familyTarget, setFamilyTarget] = useState("");
  const [familyMode, setFamilyMode] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [roster, setRoster] = useState<any[]>([]);
  const [inbox, setInbox] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const streamAbort = useRef<AbortController | null>(null);

  const showError = (value: unknown) => {
    setError(value instanceof Error ? value.message : String(value));
    window.setTimeout(() => setError(null), 5000);
  };
  const loadIdentity = useCallback(async () => {
    try {
      const me = await api<any>("/auth/me"); csrfToken = me.csrfToken ?? null; setIdentity(me); return me;
    } catch { setIdentity({ authenticated: false }); return null; }
  }, []);
  const loadSessions = useCallback(async () => {
    const body = await api<{ sessions: Session[] }>("/v1/sessions?tenantId=local"); setSessions(body.sessions);
  }, []);
  const loadAgentProfiles = useCallback(async () => {
    const body = await api<{ profiles: any[] }>("/v1/agent-profiles?tenantId=local"); setAgentProfiles(body.profiles.filter(profile=>profile.enabled));
  }, []);
  const loadHostedProviders = useCallback(async () => {
    const body = await api<{ providers: any[] }>("/v1/repository-providers?tenantId=local");
    setHostedProviders(body.providers);
    setHostedProviderId(current=>body.providers.some(item=>item.id===current)?current:(body.providers[0]?.id??""));
  }, []);
  const loadGithubApps = useCallback(async () => {
    const body = await api<{ apps: any[] }>("/v1/github-apps?tenantId=local");
    setGithubApps(body.apps);
    setGithubAppId(current=>body.apps.some(item=>item.id===current)?current:(body.apps[0]?.id??""));
  }, []);
  const loadSession = useCallback(async (id = activeId) => {
    if (!id) return; const value = await api<Session>(`/v1/sessions/${id}`); setSession(value);
  }, [activeId]);
  const loadSideData = useCallback(async () => {
    try {
      const [a, m, r, i] = await Promise.all([
        api<any>(`/v1/approvals${activeId ? `?sessionId=${activeId}` : ""}`),
        api<any>("/v1/fleet/status"),
        activeId ? api<any>(`/v1/sessions/${activeId}/roster`) : Promise.resolve({ agents: [] }),
        activeId ? api<any>(`/v1/sessions/${activeId}/inbox?states=pending,claimed,uncertain`) : Promise.resolve({ messages: [] }),
      ]);
      setApprovals(a.approvals); setMetrics(m); setRoster(r.agents); setInbox(i.messages);
    } catch (cause) { showError(cause); }
  }, [activeId]);

  useEffect(() => { void loadIdentity().then((me) => { if (me?.authenticated || me?.developmentMode) void Promise.all([loadSessions(), loadAgentProfiles(), loadHostedProviders(), loadGithubApps(), loadSideData()]); }); }, []);
  useEffect(() => {
    if (!hostedProviderId) { setHostedRepositories([]); setHostedRepositoryId(""); return; }
    void api<any>(`/v1/repository-providers/${hostedProviderId}/repositories?tenantId=local&limit=200`).then(body=>{setHostedRepositories(body.repositories??[]);setHostedRepositoryId(current=>(body.repositories??[]).some((item:any)=>item.repositoryId===current)?current:(body.repositories?.[0]?.repositoryId??""))}).catch(showError);
  }, [hostedProviderId]);
  useEffect(() => {
    if (!githubAppId) { setGithubInstallations([]); setGithubInstallationId(""); return; }
    void api<any>(`/v1/github-apps/installations?tenantId=local&appConfigId=${encodeURIComponent(githubAppId)}`).then(body=>{const items=body.installations??[];setGithubInstallations(items);setGithubInstallationId(current=>items.some((item:any)=>item.id===current)?current:(items.find((item:any)=>item.status==="active")?.id??items[0]?.id??""))}).catch(showError);
  }, [githubAppId]);
  useEffect(() => { if (activeId) { void loadSession(activeId); void loadSideData(); } }, [activeId]);
  useEffect(() => { if (!roster.some(item=>item.sessionId===familyTarget)) setFamilyTarget(roster[0]?.sessionId??""); }, [roster, familyTarget]);
  useEffect(() => {
    streamAbort.current?.abort();
    if (!activeId) return;
    const controller = new AbortController(); streamAbort.current = controller;
    void (async () => {
      try {
        const response = await fetch(`/v1/sessions/${activeId}/events/stream?afterSequence=${session?.lastSequence ?? 0}`, { credentials: "same-origin", signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`Event stream HTTP ${response.status}`);
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
        while (true) {
          const item = await reader.read(); if (item.done) break; buffer += decoder.decode(item.value, { stream: true });
          const frames = buffer.split("\n\n"); buffer = frames.pop() ?? "";
          for (const frame of frames) if (frame.startsWith("data: ")) {
            const event = JSON.parse(frame.slice(6));
            if (["message.created", "session.status.changed", "model.selected", "session.tree.branched", "session.compacted"].includes(event.type) || event.type.startsWith("task.")) void loadSession(activeId);
            if (event.type === "message.created" || event.type.startsWith("capability.") || event.type.startsWith("agent.message")) void loadSideData();
          }
        }
      } catch (cause: any) { if (cause.name !== "AbortError") showError(cause); }
    })();
    return () => controller.abort();
  }, [activeId]);

  const login = async () => {
    try {
      const result = await api<any>("/auth/login/token", { method: "POST", body: JSON.stringify({ token }) });
      csrfToken = result.csrfToken; setToken(""); await loadIdentity(); await Promise.all([loadSessions(), loadAgentProfiles()]);
    } catch (cause) { showError(cause); }
  };
  const createSession = async () => {
    try {
      const value = await api<Session>("/v1/sessions", { method: "POST", body: JSON.stringify({ tenantId: "local", name: `agent-${Date.now().toString(36)}`, ...(selectedAgentProfile ? { agentProfileId: selectedAgentProfile } : {}) }) });
      await loadSessions(); setActiveId(value.sessionId);
    } catch (cause) { showError(cause); }
  };
  const importRepository = async () => {
    if (!repositoryUrl.trim()) return;
    try {
      const value = await api<any>("/v1/repositories/import", { method: "POST", body: JSON.stringify({
        tenantId: "local", url: repositoryUrl.trim(),
        ...(repositoryBranch.trim() ? { branch: repositoryBranch.trim() } : {}),
        ...(repositorySecretId.trim() ? { credentialSecretId: repositorySecretId.trim() } : {}),
        ...(selectedAgentProfile ? { agentProfileId: selectedAgentProfile } : {}),
      }) });
      setRepositoryUrl(""); setRepositoryBranch(""); setRepositorySecretId("");
      await loadSessions(); setActiveId(value.session.sessionId);
    } catch (cause) { showError(cause); }
  };
  const addHostedProvider = async () => {
    if (!hostedName.trim() || !hostedSecretId.trim()) return;
    try {
      const created = await api<any>("/v1/repository-providers", { method: "POST", body: JSON.stringify({
        tenantId: "local", name: hostedName.trim(), kind: hostedKind, credentialSecretId: hostedSecretId.trim(),
        ...(hostedKind==="gitlab"?{authStyle:"private-token"}:{githubAccountMode:"user"}),
      }) });
      setHostedName(""); setHostedSecretId(""); await loadHostedProviders(); setHostedProviderId(created.id);
    } catch (cause) { showError(cause); }
  };
  const registerGithubApp = async () => {
    if (!githubAppName.trim()||!githubNumericId.trim()||!githubSlug.trim()||!githubPrivateKeySecretId.trim()) return;
    try {
      const created=await api<any>("/v1/github-apps",{method:"POST",body:JSON.stringify({
        tenantId:"local",name:githubAppName.trim(),appId:githubNumericId.trim(),appSlug:githubSlug.trim(),
        privateKeySecretIds:[githubPrivateKeySecretId.trim()],
        ...(githubClientId.trim()?{clientId:githubClientId.trim()}:{}),
        ...(githubWebhookSecretId.trim()?{webhookSecretIds:[githubWebhookSecretId.trim()]}:{}),
      })});
      setGithubAppName("");setGithubNumericId("");setGithubClientId("");setGithubSlug("");setGithubPrivateKeySecretId("");setGithubWebhookSecretId("");
      await loadGithubApps();setGithubAppId(created.id);
    } catch(cause){showError(cause)}
  };
  const startGithubInstallation = async () => {
    if(!githubAppId)return;
    try{const result=await api<any>(`/v1/github-apps/${githubAppId}/installations/start`,{method:"POST",body:JSON.stringify({tenantId:"local",returnTo:"/canvas/"})});window.open(result.installationUrl,"_blank","noopener,noreferrer")}catch(cause){showError(cause)}
  };
  const bindGithubInstallation = async () => {
    const installation=githubInstallations.find(item=>item.id===githubInstallationId);
    if(!installation||installation.status!=="active")return;
    try{const created=await api<any>("/v1/repository-providers",{method:"POST",body:JSON.stringify({tenantId:"local",name:`${installation.accountLogin??"GitHub App"} installation`,kind:"github",githubAppInstallationId:installation.id})});await loadHostedProviders();setHostedProviderId(created.id)}catch(cause){showError(cause)}
  };
  const importHostedRepository = async () => {
    if (!hostedProviderId || !hostedRepositoryId) return;
    try {
      const value = await api<any>(`/v1/repository-providers/${hostedProviderId}/import`, { method: "POST", body: JSON.stringify({
        tenantId: "local", repositoryId: hostedRepositoryId,
        ...(repositoryBranch.trim()?{branch:repositoryBranch.trim()}:{}),
        ...(selectedAgentProfile?{agentProfileId:selectedAgentProfile}:{}),
      }) });
      await loadSessions(); setActiveId(value.session.sessionId);
    } catch (cause) { showError(cause); }
  };
  const command = async (kind: string, payload: any = {}) => {
    if (!activeId) return;
    return await api(`/v1/sessions/${activeId}/commands`, { method: "POST", body: JSON.stringify({ tenantId: "local", kind, source: "web", payload }) });
  };
  const sendPrompt = async () => {
    if (!prompt.trim() || !activeId) return; const value = prompt, images = promptImages; setPrompt(""); setPromptImages([]); setBusy(true);
    try { await command("session.prompt", { text: value, ...(images.length ? { attachments: images.map(({path,mimeType,sha256})=>({path,mimeType,sha256})) } : {}) }); await loadSession(); } catch (cause) { setPrompt(value); setPromptImages(images); showError(cause); } finally { setBusy(false); }
  };
  const resolveApproval = async (id: string, decision: string) => {
    try { await api(`/v1/approvals/${id}/resolve`, { method: "POST", body: JSON.stringify({ decision }) }); await loadSideData(); } catch (cause) { showError(cause); }
  };
  const sendFamilyMessage = async () => {
    if (!activeId || !familyTarget || !familyMessage.trim()) return;
    try {
      await api(`/v1/sessions/${activeId}/messages`, { method: "POST", body: JSON.stringify({ targetSessionId: familyTarget, message: familyMessage.trim(), mode: familyMode }) });
      setFamilyMessage(""); await loadSideData();
    } catch (cause) { showError(cause); }
  };

  const tabs: Array<[Tab, any, string]> = [
    ["chat", MessageSquare, "Conversation"], ["terminal", SquareTerminal, "Terminal"], ["files", Files, "Files"],
    ["changes", GitBranch, "Changes"], ["browser", Globe2, "Browser"], ["media", Video, "Media"], ["artifacts", Boxes, "Artifacts"], ["tree", Workflow, "Tree"], ["tasks", ListTodo, "Tasks"], ["society", Boxes, "Society"], ["cognitive", Workflow, "Cognitive"], ["aurora", Brain, "Aurora"], ["models", Code2, "Models"], ["profiles", Bot, "Profiles"], ["mcp", Workflow, "MCP"], ["secrets", KeyRound, "Secrets"], ["channels", Send, "Channels"], ["learning", RefreshCw, "Learning"], ["automations", Boxes, "Automations"],
  ];

  return <div className="canvas">
    <header className="topbar">
      <div className="wordmark"><span>HAF</span> Canvas</div>
      <div className={`health ${metrics?.alerts?.length ? "warn" : ""}`}>{metrics ? `${metrics.workers.running} workers · ${metrics.alerts.length} alerts` : "connecting"}</div>
      <div className="top-spacer" />
      {identity?.developmentMode ? <span className="dev-badge">development admin</span> : identity?.identity ? <span className="identity"><ShieldCheck size={14}/>{identity.identity.email ?? identity.identity.subject}</span> : <><input className="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="API token"/><button onClick={login}><KeyRound size={15}/> Login</button></>}
    </header>
    <aside className="sidebar">
      <select className="profile-select" value={selectedAgentProfile} onChange={e=>setSelectedAgentProfile(e.target.value)}><option value="">No agent profile</option>{agentProfiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name} · v{profile.version}</option>)}</select>
      <button className="new-agent" onClick={createSession}><Plus size={16}/> New agent</button>
      <details className="repo-import"><summary>Import repository</summary><input value={repositoryUrl} onChange={e=>setRepositoryUrl(e.target.value)} placeholder="https://github.com/org/repo.git"/><input value={repositoryBranch} onChange={e=>setRepositoryBranch(e.target.value)} placeholder="branch (optional)"/><input value={repositorySecretId} onChange={e=>setRepositorySecretId(e.target.value)} placeholder="credential secret ID (optional)"/><button disabled={!repositoryUrl.trim()} onClick={importRepository}><GitBranch size={14}/>Clone + create agent</button><small>Credentials are redeemed server-side and never placed in the URL.</small><hr/><b>Hosted accounts</b><select value={hostedProviderId} onChange={e=>setHostedProviderId(e.target.value)}><option value="">Select account</option>{hostedProviders.map(item=><option key={item.id} value={item.id}>{item.name} · {item.kind}</option>)}</select><select value={hostedRepositoryId} onChange={e=>setHostedRepositoryId(e.target.value)}><option value="">Select repository</option>{hostedRepositories.map(item=><option key={item.repositoryId} value={item.repositoryId}>{item.fullName}</option>)}</select><button disabled={!hostedProviderId||!hostedRepositoryId} onClick={importHostedRepository}><GitBranch size={14}/>Import hosted repo</button><select value={hostedKind} onChange={e=>setHostedKind(e.target.value)}><option value="github">GitHub</option><option value="gitlab">GitLab</option></select><input value={hostedName} onChange={e=>setHostedName(e.target.value)} placeholder="account display name"/><input value={hostedSecretId} onChange={e=>setHostedSecretId(e.target.value)} placeholder="credential secret ID"/><button disabled={!hostedName.trim()||!hostedSecretId.trim()} onClick={addHostedProvider}>Add token account</button><hr/><b>GitHub App installations</b><select value={githubAppId} onChange={e=>setGithubAppId(e.target.value)}><option value="">Select GitHub App</option>{githubApps.map(item=><option key={item.id} value={item.id}>{item.name} · {item.enabled?"enabled":"disabled"}</option>)}</select><button disabled={!githubAppId} onClick={startGithubInstallation}>Install selected App</button><select value={githubInstallationId} onChange={e=>setGithubInstallationId(e.target.value)}><option value="">Select verified installation</option>{githubInstallations.map(item=><option key={item.id} value={item.id}>{item.accountLogin??item.installationProjection.slice(0,12)} · {item.status}</option>)}</select><button disabled={!githubInstallations.some(item=>item.id===githubInstallationId&&item.status==="active")} onClick={bindGithubInstallation}>Bind installation as account</button><small>Setup callback: /auth/github-app/callback · webhook: /v1/platforms/github-app/webhook</small><input value={githubAppName} onChange={e=>setGithubAppName(e.target.value)} placeholder="GitHub App display name"/><input value={githubNumericId} onChange={e=>setGithubNumericId(e.target.value)} placeholder="numeric App ID"/><input value={githubClientId} onChange={e=>setGithubClientId(e.target.value)} placeholder="client ID (recommended JWT issuer)"/><input value={githubSlug} onChange={e=>setGithubSlug(e.target.value)} placeholder="public App slug"/><input value={githubPrivateKeySecretId} onChange={e=>setGithubPrivateKeySecretId(e.target.value)} placeholder="RSA private-key secret ID"/><input value={githubWebhookSecretId} onChange={e=>setGithubWebhookSecretId(e.target.value)} placeholder="webhook-secret ID (optional)"/><button disabled={!githubAppName.trim()||!githubNumericId.trim()||!githubSlug.trim()||!githubPrivateKeySecretId.trim()} onClick={registerGithubApp}>Register GitHub App</button></details>
      <div className="side-title">Agents</div>
      <div className="session-list">{sessions.map((item) => <button key={item.sessionId} className={`session-row ${activeId === item.sessionId ? "active" : ""}`} onClick={() => setActiveId(item.sessionId)}>
        <span className={`status-dot ${item.status}`}/><span><b>{item.name}</b><small>{item.status} · {item.sessionId.slice(0,8)}</small></span><ChevronRight size={14}/>
      </button>)}</div>
      <div className="sidebar-bottom"><button onClick={() => void Promise.all([loadSessions(), loadAgentProfiles(), loadHostedProviders(), loadGithubApps(), loadSideData()])}><RefreshCw size={14}/> Refresh</button></div>
    </aside>
    <nav className="tabs">{tabs.map(([id, Icon, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} disabled={!session}><Icon size={16}/>{label}</button>)}</nav>
    <main className="workspace">
      {!session ? <div className="welcome"><Bot size={52}/><h1>Durable agent control center</h1><p>Create or select an agent to open conversation, terminal, files, changes, browser and automation panels.</p></div> : <>
        <div className="session-head"><div><h2>{session.name}</h2><p>{session.status} · generation {session.generation} · {session.totalUsage.inputTokens + session.totalUsage.outputTokens} tokens</p></div><code>{session.workspacePath}</code><div className="export-actions"><a className="export-link" href={`/v1/sessions/${session.sessionId}/export?format=markdown`} download><Download size={14}/>Markdown</a><a className="export-link" href={`/v1/sessions/${session.sessionId}/export?format=trajectory`} download><Code2 size={14}/>Trajectory</a></div></div>
        {tab === "chat" && <ChatPanel session={session} prompt={prompt} setPrompt={setPrompt} images={promptImages} setImages={setPromptImages} send={sendPrompt} busy={busy} showError={showError}/>} 
        {tab === "terminal" && <TerminalPanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "files" && <FilesPanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "changes" && <ChangesPanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "browser" && <BrowserPanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "media" && <MediaPanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "artifacts" && <ArtifactsPanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "tree" && <TreePanel session={session} command={command} reload={loadSession} showError={showError}/>} 
        {tab === "tasks" && <TasksPanel session={session} command={command} reload={loadSession} showError={showError}/>} 
        {tab === "society" && <SocietyPanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "cognitive" && <CognitivePanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "aurora" && <AuroraPanel showError={showError}/>} 
        {tab === "models" && <ModelsPanel session={session} command={command} reload={loadSession} showError={showError}/>} 
        {tab === "profiles" && <AgentProfilesPanel reloadGlobal={loadAgentProfiles} showError={showError}/>} 
        {tab === "mcp" && <McpPanel showError={showError}/>} 
        {tab === "secrets" && <SecretsPanel showError={showError}/>} 
        {tab === "channels" && <ChannelsPanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "learning" && <LearningPanel sessionId={session.sessionId} showError={showError}/>} 
        {tab === "automations" && <AutomationsPanel sessionId={session.sessionId} showError={showError}/>} 
      </>}
    </main>
    <aside className="inspector">
      <section><h3>Approvals</h3>{approvals.length ? approvals.map((item) => <div className="approval" key={item.id}><b>{item.capabilityId}</b><small>{item.risk}</small><pre>{JSON.stringify(item.argumentsPreview,null,2)}</pre><div><button onClick={() => resolveApproval(item.id,"approve_once")}><CheckCircle2 size={13}/>Once</button><button onClick={() => resolveApproval(item.id,"deny")} className="danger"><XCircle size={13}/>Deny</button></div></div>) : <p className="muted">No pending approvals.</p>}</section>
      <section><h3>Agent family</h3>{roster.length ? <>{roster.map((item) => <button className="child" key={item.sessionId} onClick={() => setActiveId(item.sessionId)}><Bot size={14}/><span><b>{item.name}</b><small>{item.relationship} · {item.status}</small></span></button>)}<div className="family-composer"><select value={familyTarget} onChange={e=>setFamilyTarget(e.target.value)}>{roster.map(item=><option key={item.sessionId} value={item.sessionId}>{item.relationship}: {item.name}</option>)}</select><select value={familyMode} onChange={e=>setFamilyMode(e.target.value)}><option value="auto">Auto</option><option value="steer">Steer</option><option value="follow_up">Follow up</option></select><textarea value={familyMessage} onChange={e=>setFamilyMessage(e.target.value)} placeholder="Message a reachable agent…"/><button onClick={sendFamilyMessage} disabled={!familyMessage.trim()||!familyTarget}><Send size={13}/>Send</button></div></> : <p className="muted">No directly reachable agents.</p>}{inbox.length>0&&<p className="inbox-warning"><MessageSquare size={13}/>{inbox.length} queued or uncertain messages</p>}</section>
      <section><h3>Runtime</h3><dl><dt>Profile</dt><dd>{session?.agentProfile?`${session.agentProfile.name} v${session.agentProfile.version}`:"none"}</dd><dt>Model</dt><dd>{session?.modelName ?? "default"}</dd><dt>Fallbacks</dt><dd>{session?.modelFallbacks?.length ?? 0}</dd><dt>Open tasks</dt><dd>{session?.tasks?.filter(task=>!["done","cancelled"].includes(task.status)).length ?? 0}</dd><dt>Sequence</dt><dd>{session?.lastSequence ?? 0}</dd><dt>Fleet events</dt><dd>{metrics?.eventsTotal ?? 0}</dd></dl></section>
    </aside>
    {error && <div className="toast"><XCircle size={16}/>{error}</div>}
  </div>;
}

function ChatPanel({ session, prompt, setPrompt, images, setImages, send, busy, showError }: {session:Session;prompt:string;setPrompt:Dispatch<SetStateAction<string>>;images:Array<{path:string;mimeType:string;sha256:string;fileName:string}>;setImages:Dispatch<SetStateAction<Array<{path:string;mimeType:string;sha256:string;fileName:string}>>>;send:()=>void;busy:boolean;showError:(e:any)=>void}) {
  const end = useRef<HTMLDivElement>(null), fileInput=useRef<HTMLInputElement>(null); const [uploading,setUploading]=useState(false); useEffect(() => end.current?.scrollIntoView({ behavior:"smooth" }), [session.messages.length]);
  const attach=async(file?:File)=>{if(!file)return;if(file.size>2_800_000){showError(new Error("Attachment exceeds 2.8 MB."));return}setUploading(true);try{const dataUrl=await new Promise<string>((resolvePromise,reject)=>{const reader=new FileReader();reader.onload=()=>resolvePromise(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});const base64=dataUrl.slice(dataUrl.indexOf(",")+1);const result=await api<any>(`/v1/sessions/${session.sessionId}/attachments`,{method:"POST",body:JSON.stringify({fileName:file.name,mimeType:file.type||"application/octet-stream",base64})});if(["image/png","image/jpeg","image/webp","image/gif"].includes(result.mimeType)){if(images.length>=8)throw new Error("A prompt supports at most 8 images.");setImages(previous=>[...previous,{path:result.path,mimeType:result.mimeType,sha256:result.sha256,fileName:result.fileName}])}else setPrompt(previous=>`${previous}${previous.trim()?"\n\n":""}Attached workspace file: ${result.path}\nUse filesystem tools to inspect it.`)}catch(e){showError(e)}finally{setUploading(false);if(fileInput.current)fileInput.current.value=""}};
  return <div className="panel chat-panel"><div className="messages">{session.messages.map((message) => <article key={message.id} className={`message ${message.role}`}><header><b>{message.role}</b><time>{new Date(message.timestamp).toLocaleTimeString()}</time></header><pre>{textOf(message)}</pre></article>)}<div ref={end}/></div><div className="composer"><input ref={fileInput} className="hidden-file" type="file" onChange={e=>void attach(e.target.files?.[0])}/>{images.length>0&&<div className="attachment-chips">{images.map((image,index)=><span key={image.path}><b>{image.fileName}</b><small>{image.mimeType}</small><button onClick={()=>setImages(current=>current.filter((_,item)=>item!==index))}><XCircle size={12}/></button></span>)}</div>}<button className="attach-button" disabled={uploading} onClick={()=>fileInput.current?.click()}>{uploading?<Loader2 className="spin" size={17}/>:<Paperclip size={17}/>}</button><textarea value={prompt} onChange={(e)=>setPrompt(e.target.value)} onKeyDown={(e)=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter")send()}} placeholder="Message the agent…"/><button disabled={busy||!prompt.trim()} onClick={send}>{busy?<Loader2 className="spin" size={17}/>:<Send size={17}/>}Send</button></div></div>;
}

function TerminalPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [command,setCommand]=useState("pwd && ls -la"); const [history,setHistory]=useState<Array<{command:string;output:string;exitCode:any}>>([]); const [busy,setBusy]=useState(false);
  const run=async()=>{setBusy(true);try{const r=await api<any>(`/v1/sessions/${sessionId}/terminal`,{method:"POST",body:JSON.stringify({command})});setHistory((h)=>[...h,{command,output:r.stdout,exitCode:r.exitCode}])}catch(e){showError(e)}finally{setBusy(false)}};
  return <div className="panel terminal-panel"><div className="terminal-output">{history.map((h,i)=><div key={i}><div className="terminal-command">$ {h.command}</div><pre>{h.output}</pre><span className={h.exitCode===0?"exit-ok":"exit-bad"}>exit {String(h.exitCode)}</span></div>)}</div><div className="terminal-input"><span>$</span><input value={command} onChange={e=>setCommand(e.target.value)} onKeyDown={e=>e.key==="Enter"&&run()}/><button onClick={run} disabled={busy}><Play size={15}/></button></div></div>;
}

function FilesPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [files,setFiles]=useState<any[]>([]),[selected,setSelected]=useState<string|null>(null),[content,setContent]=useState("");
  const load=async()=>{try{const r=await api<any>(`/v1/sessions/${sessionId}/files?path=.&maxEntries=2000`);setFiles(r.entries.filter((x:any)=>x.type==="file"))}catch(e){showError(e)}};
  useEffect(()=>{void load()},[sessionId]); const open=async(path:string)=>{try{const r=await api<any>(`/v1/sessions/${sessionId}/file?path=${encodeURIComponent(path)}`);setSelected(path);setContent(r.content)}catch(e){showError(e)}};
  const save=async()=>{if(!selected)return;try{await api(`/v1/sessions/${sessionId}/file`,{method:"PUT",body:JSON.stringify({path:selected,content})})}catch(e){showError(e)}};
  return <div className="panel files-panel"><div className="file-tree"><div className="panel-toolbar"><b>Workspace</b><button onClick={load}><RefreshCw size={14}/></button></div>{files.map(f=><button key={f.path} className={selected===f.path?"active":""} onClick={()=>open(f.path)}><FileCode2 size={14}/>{f.path}<small>{f.size}</small></button>)}</div><div className="editor"><div className="panel-toolbar"><code>{selected??"Select a file"}</code><button disabled={!selected} onClick={save}><Save size={14}/>Save</button></div><textarea spellCheck={false} value={content} onChange={e=>setContent(e.target.value)}/></div></div>;
}

function ChangesPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [output,setOutput]=useState(""),[branches,setBranches]=useState<any[]>([]),[selectedBranch,setSelectedBranch]=useState(""),[newBranch,setNewBranch]=useState(""),[commitMessage,setCommitMessage]=useState(""),[commitPaths,setCommitPaths]=useState("."),[sync,setSync]=useState<any>(),[reviews,setReviews]=useState<any[]>([]),[reviewTitle,setReviewTitle]=useState(""),[sourceBranch,setSourceBranch]=useState(""),[targetBranch,setTargetBranch]=useState("main");
  const load=async()=>{try{const [changes,branchList,syncStatus]=await Promise.all([api<any>(`/v1/sessions/${sessionId}/changes`),api<any>(`/v1/sessions/${sessionId}/git/branches`),api<any>(`/v1/sessions/${sessionId}/repository-sync`).catch(()=>({linked:false}))]);setOutput(changes.stdout);setBranches(branchList.branches);const current=branchList.branches.find((item:any)=>item.current)?.name??branchList.branches[0]?.name??"";setSelectedBranch(current);setSourceBranch(value=>value||current);setSync(syncStatus);if(syncStatus.linked){const result=await api<any>(`/v1/repository-providers/${syncStatus.providerId}/repositories/${syncStatus.repositoryId}/reviews?tenantId=local`);setReviews(result.reviews??[]);setTargetBranch(value=>value||syncStatus.branch||"main")}else setReviews([])}catch(e){showError(e)}};
  useEffect(()=>{void load()},[sessionId]);
  const createBranch=async()=>{if(!newBranch.trim())return;try{await api(`/v1/sessions/${sessionId}/git/branches`,{method:"POST",body:JSON.stringify({name:newBranch.trim()})});setNewBranch("");await load()}catch(e){showError(e)}};
  const switchBranch=async()=>{if(!selectedBranch)return;try{await api(`/v1/sessions/${sessionId}/git/switch`,{method:"POST",body:JSON.stringify({name:selectedBranch})});await load()}catch(e){showError(e)}};
  const commit=async()=>{if(!commitMessage.trim())return;try{await api(`/v1/sessions/${sessionId}/git/commit`,{method:"POST",body:JSON.stringify({message:commitMessage.trim(),paths:commitPaths.split(",").map(value=>value.trim()).filter(Boolean),authorName:"HAF Agent",authorEmail:"haf-agent@localhost.invalid"})});setCommitMessage("");await load()}catch(e){showError(e)}};
  const mutate=async(path:string,body:any)=>{try{await api(path,{method:"POST",headers:{"x-idempotency-key":crypto.randomUUID()},body:JSON.stringify({sessionId,...body})});await load()}catch(e){showError(e)}};
  const createReview=async()=>{if(!sync?.linked||!reviewTitle.trim()||!sourceBranch||!targetBranch)return;await mutate(`/v1/repository-providers/${sync.providerId}/repositories/${sync.repositoryId}/reviews`,{title:reviewTitle.trim(),sourceBranch,targetBranch,draft:false});setReviewTitle("")};
  const comment=async(review:any)=>{const body=window.prompt("Review comment");if(body?.trim())await mutate(`/v1/repository-providers/${sync.providerId}/repositories/${sync.repositoryId}/reviews/${review.number}/comments`,{body:body.trim()})};
  return <div className="panel changes-panel"><div className="panel-toolbar"><b>Git changes</b><button onClick={load}><RefreshCw size={14}/></button></div><div className="git-controls"><select value={selectedBranch} onChange={e=>setSelectedBranch(e.target.value)}>{branches.map(branch=><option key={branch.name} value={branch.name}>{branch.current?"● ":""}{branch.name}</option>)}</select><button onClick={switchBranch}>Switch</button><input value={newBranch} onChange={e=>setNewBranch(e.target.value)} placeholder="new branch"/><button onClick={createBranch}>Create</button><input value={commitPaths} onChange={e=>setCommitPaths(e.target.value)} placeholder="paths, comma separated"/><input value={commitMessage} onChange={e=>setCommitMessage(e.target.value)} placeholder="commit message"/><button onClick={commit}>Commit</button></div><pre>{output||"Clean worktree or not a git repository."}</pre>{sync?.linked&&<section className="hosted-reviews"><h3>Hosted reviews · {sync.fullName} · {sync.state}</h3><div className="git-controls"><input value={reviewTitle} onChange={e=>setReviewTitle(e.target.value)} placeholder="pull/merge request title"/><input value={sourceBranch} onChange={e=>setSourceBranch(e.target.value)} placeholder="source branch"/><input value={targetBranch} onChange={e=>setTargetBranch(e.target.value)} placeholder="target branch"/><button onClick={createReview}>Create review</button></div>{reviews.map(review=><article key={review.id}><b>#{review.number} {review.title}</b><small>{review.sourceBranch} → {review.targetBranch} · {review.state}{review.draft?" · draft":""}</small><div><button onClick={()=>comment(review)}>Comment</button><button className="danger" onClick={()=>mutate(`/v1/repository-providers/${sync.providerId}/repositories/${sync.repositoryId}/reviews/${review.number}/close`,{})}>Close</button>{review.headSha&&<button onClick={()=>mutate(`/v1/repository-providers/${sync.providerId}/repositories/${sync.repositoryId}/reviews/${review.number}/merge`,{expectedHeadSha:review.headSha,method:"merge"})}>Merge exact HEAD</button>}</div></article>)}</section>}</div>
}

function BrowserPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) { const [url,setUrl]=useState("https://example.com"),[snapshot,setSnapshot]=useState<any>(null);const act=async(body:any)=>{try{setSnapshot(await api(`/v1/sessions/${sessionId}/browser`,{method:"POST",body:JSON.stringify(body)}))}catch(e){showError(e)}};return <div className="panel browser-panel"><div className="browser-bar"><input value={url} onChange={e=>setUrl(e.target.value)}/><button onClick={()=>act({action:"navigate",url})}><Globe2 size={15}/>Go</button><button onClick={()=>act({action:"snapshot"})}>Snapshot</button></div>{snapshot?<><h3>{snapshot.title}</h3><code>{snapshot.url}</code><pre>{snapshot.text}</pre><div className="browser-elements">{snapshot.elements?.map((e:any)=><button key={e.ref} onClick={()=>act({action:"click",ref:e.ref})}>{e.ref} · {e.name||e.tag}</button>)}</div></>:<div className="welcome"><Globe2 size={40}/><p>Browser backend is not configured or no page is open.</p></div>}</div> }

function MediaPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [kind,setKind]=useState<"image"|"video">("image"),[prompt,setPrompt]=useState(""),[aspectRatio,setAspectRatio]=useState("landscape"),[sourcePath,setSourcePath]=useState(""),[duration,setDuration]=useState(5),[providers,setProviders]=useState<any>({images:[],videos:[],upscalers:[],queuedVideos:[],videoUpscalers:[]}),[upscaler,setUpscaler]=useState(""),[videoUpscaler,setVideoUpscaler]=useState(""),[scale,setScale]=useState<2|4>(2),[results,setResults]=useState<any[]>([]),[jobs,setJobs]=useState<any[]>([]),[busy,setBusy]=useState(false);
  const loadJobs=async()=>{const value=await api<any>(`/v1/media/jobs?tenantId=local&sessionId=${sessionId}`);setJobs(value.jobs??[])};
  useEffect(()=>{void Promise.all([api<any>("/v1/media/images/providers"),api<any>("/v1/media/videos/providers"),loadJobs()]).then(([images,videos])=>{setProviders({images:images.providers,videos:videos.providers,upscalers:images.upscalers??[],queuedVideos:videos.queuedProviders??[],videoUpscalers:videos.upscalers??[]});setUpscaler((images.upscalers??[])[0]?.id??"");setVideoUpscaler((videos.upscalers??[])[0]?.id??"")}).catch(showError)},[]);
  const references=()=>sourcePath.split(",").map(value=>value.trim()).filter(Boolean);
  const generate=async()=>{if(!prompt.trim())return;setBusy(true);try{const refs=references();const body={prompt:prompt.trim(),aspectRatio,...(refs.length?{sourcePaths:refs}:{}),...(kind==="video"?{durationSeconds:duration}:{count:1,...(upscaler?{upscale:{providerId:upscaler,scale}}:{})})};const result=await api<any>(`/v1/sessions/${sessionId}/media/${kind}`,{method:"POST",body:JSON.stringify(body)});const artifacts=kind==="video"?[result.video]:result.images;setResults(current=>[...artifacts.map((artifact:any)=>({kind,...artifact,model:result.model,provider:result.provider,modality:result.modality,pipeline:result.pipeline})),...current]);setPrompt("")}catch(e){showError(e)}finally{setBusy(false)}};
  const upscaleOnly=async()=>{const refs=references();if(!refs[0]||!upscaler)return;setBusy(true);try{const result=await api<any>(`/v1/sessions/${sessionId}/media/image/upscale`,{method:"POST",body:JSON.stringify({sourcePath:refs[0],providerId:upscaler,scale})});setResults(current=>[{kind:"image",...result.image,model:result.model,provider:result.provider,modality:"upscale"},...current])}catch(e){showError(e)}finally{setBusy(false)}};
  const upscaleVideo=async()=>{const refs=references();if(!refs[0]||!videoUpscaler)return;setBusy(true);try{const result=await api<any>(`/v1/sessions/${sessionId}/media/video/upscale`,{method:"POST",body:JSON.stringify({sourcePath:refs[0],providerId:videoUpscaler,scale})});setResults(current=>[{kind:"video",...result.video,model:result.model,provider:result.provider,modality:"upscale"},...current])}catch(e){showError(e)}finally{setBusy(false)}};
  const submitJob=async()=>{if(!prompt.trim()||!providers.queuedVideos[0])return;setBusy(true);try{const refs=references();await api(`/v1/sessions/${sessionId}/media/video/jobs`,{method:"POST",headers:{"x-idempotency-key":crypto.randomUUID()},body:JSON.stringify({providerId:providers.queuedVideos[0].id,prompt:prompt.trim(),aspectRatio,durationSeconds:duration,...(refs.length?{sourcePaths:refs}:{})})});setPrompt("");await loadJobs()}catch(e){showError(e)}finally{setBusy(false)}};
  const pollJob=async(id:string)=>{try{await api(`/v1/media/jobs/${id}/poll`,{method:"POST",body:JSON.stringify({tenantId:"local"})});await loadJobs()}catch(e){showError(e)}};
  const cancelJob=async(id:string)=>{try{await api(`/v1/media/jobs/${id}/cancel`,{method:"POST",body:JSON.stringify({tenantId:"local"})});await loadJobs()}catch(e){showError(e)}};
  const configured=kind==="image"?providers.images.length>0:providers.videos.length>0;
  return <div className="panel media-panel"><div className="media-form"><select value={kind} onChange={e=>setKind(e.target.value as "image"|"video")}><option value="image">Image</option><option value="video">Video</option></select><select value={aspectRatio} onChange={e=>setAspectRatio(e.target.value)}><option value="landscape">Landscape</option><option value="square">Square</option><option value="portrait">Portrait</option></select>{kind==="video"&&<input type="number" min={1} max={30} value={duration} onChange={e=>setDuration(Number(e.target.value))}/>}<input value={sourcePath} onChange={e=>setSourcePath(e.target.value)} placeholder={`workspace reference paths, comma separated (max ${kind==="image"?8:4})`}/>{kind==="image"&&providers.upscalers.length>0&&<><select value={upscaler} onChange={e=>setUpscaler(e.target.value)}><option value="">No upscale</option>{providers.upscalers.map((item:any)=><option key={item.id} value={item.id}>{item.id}</option>)}</select><select value={scale} onChange={e=>setScale(Number(e.target.value) as 2|4)}><option value={2}>2x</option><option value={4}>4x</option></select><button disabled={busy||!references()[0]||!upscaler} onClick={upscaleOnly}>Upscale source only</button></>}{kind==="video"&&providers.videoUpscalers.length>0&&<><select value={videoUpscaler} onChange={e=>setVideoUpscaler(e.target.value)}>{providers.videoUpscalers.map((item:any)=><option key={item.id} value={item.id}>{item.id}</option>)}</select><select value={scale} onChange={e=>setScale(Number(e.target.value) as 2|4)}><option value={2}>2x</option><option value={4}>4x</option></select><button disabled={busy||!references()[0]||!videoUpscaler} onClick={upscaleVideo}>Upscale video</button></>}<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={`${kind} generation prompt`}/><button disabled={busy||!configured||!prompt.trim()} onClick={generate}>{busy?<Loader2 className="spin" size={15}/>:kind==="image"?<ImageIcon size={15}/>:<Video size={15}/>}Generate</button>{kind==="video"&&providers.queuedVideos.length>0&&<button disabled={busy||!prompt.trim()} onClick={submitJob}>Submit async job</button>}{!configured&&kind!=="video"&&<small>No {kind} provider configured on the server.</small>}</div><div className="media-results">{jobs.map(job=><article key={job.id}><header><Video size={18}/><b>async video</b><small>{job.providerId} · {job.status}</small></header><code>{job.id}</code>{job.artifact&&<code>{job.artifact.path}</code>}<div>{["queued","running"].includes(job.status)&&<button onClick={()=>pollJob(job.id)}>Poll</button>}{["queued","running"].includes(job.status)&&<button className="danger" onClick={()=>cancelJob(job.id)}>Cancel</button>}</div></article>)}{results.map((result,index)=><article key={`${result.path}-${index}`}><header>{result.kind==="image"?<ImageIcon size={18}/>:<Video size={18}/>}<b>{result.kind}</b><small>{result.provider}/{result.model} · {result.modality}</small></header><code>{result.path}</code><small>{result.mimeType} · {result.bytes} bytes{result.pipeline?` · ${result.pipeline.map((item:any)=>item.operation).join(" → ")}`:""}</small></article>)}</div></div>
}

function ArtifactsPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [artifacts,setArtifacts]=useState<any[]>([]),[interactions,setInteractions]=useState<any[]>([]),[name,setName]=useState(""),[sourcePath,setSourcePath]=useState(""),[actions,setActions]=useState("select,submit"),[frame,setFrame]=useState<any>(),[selected,setSelected]=useState<any>(),[busy,setBusy]=useState(false);
  const iframeRef=useRef<HTMLIFrameElement|null>(null);
  const load=async()=>{try{const [a,i]=await Promise.all([api<any>(`/v1/sessions/${sessionId}/artifacts`),api<any>(`/v1/sessions/${sessionId}/artifact-interactions`)]);setArtifacts(a.artifacts??[]);setInteractions(i.interactions??[])}catch(e){showError(e)}};
  useEffect(()=>{void load()},[sessionId]);
  const publish=async()=>{try{await api(`/v1/sessions/${sessionId}/artifacts`,{method:"POST",body:JSON.stringify({name,sourcePath,allowedActions:actions.split(",").map(value=>value.trim()).filter(Boolean)})});setName("");setSourcePath("");await load()}catch(e){showError(e)}};
  const open=async(artifact:any)=>{try{const value=await api<any>(`/v1/artifacts/${artifact.id}/frame`,{method:"POST",body:JSON.stringify({tenantId:"local",sessionId})});setSelected(artifact);setFrame(value)}catch(e){showError(e)}};
  const toggle=async(artifact:any)=>{try{await api(`/v1/artifacts/${artifact.id}`,{method:"PATCH",body:JSON.stringify({tenantId:"local",enabled:!artifact.enabled})});if(artifact.enabled)setFrame(undefined);await load()}catch(e){showError(e)}};
  const remove=async(id:string)=>{try{await api(`/v1/artifacts/${id}?tenantId=local`,{method:"DELETE"});setFrame(undefined);setSelected(undefined);await load()}catch(e){showError(e)}};
  useEffect(()=>{
    if(!frame||!selected)return;
    const listener=async(event:MessageEvent)=>{
      if(event.source!==iframeRef.current?.contentWindow)return;
      const data=event.data;
      if(!data||data.hafArtifact!==true||data.channel!==frame.channel||typeof data.interactionId!=="string"||typeof data.action!=="string")return;
      setBusy(true);
      try{const result=await api<any>(`/v1/artifacts/${selected.id}/interactions`,{method:"POST",body:JSON.stringify({tenantId:"local",sessionId,channel:frame.channel,interactionId:data.interactionId,action:data.action,payload:data.payload??null})});iframeRef.current?.contentWindow?.postMessage({hafArtifactResult:true,channel:frame.channel,interactionId:data.interactionId,ok:result.ok,result:result.result,error:result.error},"*");await load()}
      catch(error){iframeRef.current?.contentWindow?.postMessage({hafArtifactResult:true,channel:frame.channel,interactionId:data.interactionId,ok:false,error:error instanceof Error?error.message:"Interaction failed"},"*");showError(error)}finally{setBusy(false)}
    };
    window.addEventListener("message",listener);return()=>window.removeEventListener("message",listener);
  },[frame,selected,sessionId]);
  return <div className="panel artifacts-panel"><div className="artifact-toolbar"><input value={name} onChange={e=>setName(e.target.value)} placeholder="artifact name"/><input value={sourcePath} onChange={e=>setSourcePath(e.target.value)} placeholder="workspace HTML path"/><input value={actions} onChange={e=>setActions(e.target.value)} placeholder="allowed actions, comma separated"/><button disabled={!name.trim()||!sourcePath.trim()||!actions.trim()} onClick={publish}><Plus size={14}/>Publish</button>{busy&&<Loader2 className="spin" size={15}/>}</div><div className="artifact-layout"><section className="artifact-list">{artifacts.map(item=><article className="artifact-card" key={item.id}><b>{item.name}</b><code>{item.sourcePath}</code><small>{item.bytes} bytes · {item.allowedActions.join(", ")} · {item.enabled?"enabled":"disabled"}</small><div><button disabled={!item.enabled} onClick={()=>open(item)}>Open isolated frame</button><button onClick={()=>toggle(item)}>{item.enabled?"Disable":"Enable"}</button><button className="danger" onClick={()=>remove(item.id)}>Delete</button></div></article>)}</section><section className="artifact-frame">{frame&&selected?<><header><b>{selected.name}</b><small>sandbox=allow-scripts · expires {new Date(frame.expiresAt).toLocaleTimeString()}</small></header><iframe ref={iframeRef} src={frame.frameUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" title={selected.name}/></>:<div className="welcome"><Boxes size={38}/><p>Publish and open a confined HTML artifact.</p></div>}</section><section className="artifact-interactions"><h3>Hidden interactions</h3>{interactions.slice(-20).reverse().map(item=><article key={item.id}><b>{item.action}</b><small>{item.status} · {item.payloadSha256.slice(0,12)}</small></article>)}</section></div></div>
}

function TreePanel({session,command,reload,showError}:{session:Session;command:(k:string,p:any)=>Promise<any>;reload:()=>Promise<void>;showError:(e:any)=>void}) { const entries=session.tree?.entries??[];const children=useMemo(()=>{const m=new Map<string,any[]>();for(const e of entries){const k=e.parentId??"root",a=m.get(k)??[];a.push(e);m.set(k,a)}return m},[entries]);const active=new Set<string>();let cur=entries.find(e=>e.id===session.tree?.activeLeafId);while(cur){active.add(cur.id);cur=entries.find(e=>e.id===cur?.parentId)};const render=(parent:string,depth:number):any=>(children.get(parent)??[]).map(e=><div key={e.id}><div className={`tree-entry ${active.has(e.id)?"active":""}`} style={{marginLeft:Math.min(depth*18,180)}}><GitBranch size={14}/><div><b>{e.message.role}</b><p>{textOf(e.message).slice(0,180)}</p><small>{e.id.slice(0,8)}{e.contextReset?" · context reset":""}{e.labels.length?` · ${e.labels.join(", ")}`:""}</small></div><button onClick={async()=>{try{await command("session.tree.branch",{entryId:e.id});await reload()}catch(x){showError(x)}}}>Branch</button></div>{render(e.id,depth+1)}</div>);return <div className="panel tree-panel">{render("root",0)}</div> }

function TasksPanel({session,command,reload,showError}:{session:Session;command:(k:string,p:any)=>Promise<any>;reload:()=>Promise<void>;showError:(e:any)=>void}) {
  const [title,setTitle]=useState(""),[priority,setPriority]=useState("normal"),[filter,setFilter]=useState("open");
  const create=async()=>{if(!title.trim())return;try{await command("task.create",{title:title.trim(),priority,status:"ready"});setTitle("");await reload()}catch(e){showError(e)}};
  const update=async(id:string,status:string)=>{try{await command("task.update",{id,status});await reload()}catch(e){showError(e)}};
  const tasks=(session.tasks??[]).filter(task=>filter==="all"||(filter==="open"?!["done","cancelled"].includes(task.status):task.status===filter));
  return <div className="panel tasks-panel"><div className="task-toolbar"><input value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void create()} placeholder="Add a durable task…"/><select value={priority} onChange={e=>setPriority(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select><button onClick={create}><Plus size={14}/>Add</button><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="open">Open</option><option value="all">All</option><option value="backlog">Backlog</option><option value="ready">Ready</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">Review</option><option value="done">Done</option></select></div><div className="task-grid">{tasks.map(task=><article className={`task-card ${task.status}`} key={task.id}><div className="task-meta"><span className={`task-priority ${task.priority}`}>{task.priority}</span><code>{task.id.slice(0,8)}</code></div><h3>{task.title}</h3>{task.description&&<p>{task.description}</p>}<small>{task.status}{task.dependsOn.length?` · ${task.dependsOn.length} dependencies`:""}{task.assigneeSessionId?` · ${task.assigneeSessionId.slice(0,8)}`:""}</small><div className="task-actions">{task.status!=="in_progress"&&!["done","cancelled"].includes(task.status)&&<button onClick={()=>update(task.id,"in_progress")}>Start</button>}{task.status==="in_progress"&&<button onClick={()=>update(task.id,"review")}>Review</button>}{!["done","cancelled"].includes(task.status)&&<button onClick={()=>update(task.id,"done")}><CheckCircle2 size={13}/>Done</button>}{task.status!=="cancelled"&&task.status!=="done"&&<button className="danger" onClick={()=>update(task.id,"cancelled")}>Cancel</button>}</div></article>)}</div>{!tasks.length&&<div className="welcome"><ListTodo size={38}/><p>No tasks in this view.</p></div>}</div>
}

/**
 * Aurora substrate console: memory pyramid health, world-model calibration, multi-perspective
 * consensus, proactive initiative queue with trust feedback, governed user model, evolution index
 * and environment inventory. Every mutation goes through the audited Control API routes.
 */
function AuroraPanel({ showError }: { showError: (cause: unknown) => void }) {
  const [section, setSection] = useState<"memory"|"world"|"initiative"|"user"|"evolution"|"environment">("memory");
  const [memoryHealth, setMemoryHealth] = useState<any>(null);
  const [anchors, setAnchors] = useState<any[]>([]);
  const [calibration, setCalibration] = useState<any>(null);
  const [inconsistencies, setInconsistencies] = useState<any[]>([]);
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [perspectives, setPerspectives] = useState<any[]>([]);
  const [initiatives, setInitiatives] = useState<any[]>([]);
  const [initiativeBudget, setInitiativeBudget] = useState<any>(null);
  const [digest, setDigest] = useState<any>(null);
  const [userId, setUserId] = useState("primary");
  const [userSummary, setUserSummary] = useState<any>(null);
  const [userState, setUserState] = useState<any>(null);
  const [gaps, setGaps] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [evolutionIndex, setEvolutionIndex] = useState<any>(null);
  const [inventory, setInventory] = useState<any>(null);
  const [resources, setResources] = useState<any[]>([]);
  const [unverified, setUnverified] = useState<any[]>([]);
  const [question, setQuestion] = useState("");

  const load = useCallback(async () => {
    try {
      const [health, anchorList, calib, consistency, analysisList, perspectiveList, initiativeList, budget, summary, estimate, gapList, candidateList, index, inv, resourceList, unverifiedList] = await Promise.all([
        api<any>("/v1/memory-graph/health?tenantId=local"),
        api<any>("/v1/memory-graph/anchors?tenantId=local"),
        api<any>("/v1/world/calibration?tenantId=local"),
        api<any>("/v1/world/consistency?tenantId=local"),
        api<any>("/v1/multiworld/analyses?tenantId=local"),
        api<any>("/v1/multiworld/perspectives?tenantId=local"),
        api<any>("/v1/initiative/initiatives?tenantId=local&limit=50"),
        api<any>("/v1/initiative/budget?tenantId=local"),
        api<any>(`/v1/user-model/${encodeURIComponent(userId)}?tenantId=local`),
        api<any>(`/v1/user-model/${encodeURIComponent(userId)}/state?tenantId=local`),
        api<any>("/v1/evolution/gaps?tenantId=local"),
        api<any>("/v1/evolution/candidates?tenantId=local"),
        api<any>("/v1/evolution/index?tenantId=local"),
        api<any>("/v1/environment/inventory?tenantId=local"),
        api<any>("/v1/environment/resources?tenantId=local"),
        api<any>("/v1/environment/actions?tenantId=local&unverified=true"),
      ]);
      setMemoryHealth(health); setAnchors(anchorList.anchors); setCalibration(calib); setInconsistencies(consistency.inconsistencies);
      setAnalyses(analysisList.analyses); setPerspectives(perspectiveList.perspectives); setInitiatives(initiativeList.initiatives);
      setInitiativeBudget(budget); setUserSummary(summary); setUserState(estimate); setGaps(gapList.gaps); setCandidates(candidateList.candidates);
      setEvolutionIndex(index); setInventory(inv); setResources(resourceList.resources); setUnverified(unverifiedList.actions);
    } catch (cause) { showError(cause); }
  }, [showError, userId]);
  useEffect(() => { void load(); }, [load]);

  const consolidate = async () => { try { await api("/v1/memory-graph/consolidate", { method: "POST", body: JSON.stringify({ tenantId: "local" }) }); await load(); } catch (cause) { showError(cause); } };
  const scanContradictions = async () => { try { await api("/v1/memory-graph/contradictions", { method: "POST", body: JSON.stringify({ tenantId: "local" }) }); await load(); } catch (cause) { showError(cause); } };
  const evaluateInitiatives = async () => { try { await api("/v1/initiative/evaluate", { method: "POST", body: JSON.stringify({ tenantId: "local" }) }); await load(); } catch (cause) { showError(cause); } };
  const buildDigest = async (period: string) => { try { setDigest(await api("/v1/initiative/digests", { method: "POST", body: JSON.stringify({ tenantId: "local", period }) })); await load(); } catch (cause) { showError(cause); } };
  const feedback = async (id: string, useful: boolean) => { try { await api(`/v1/initiative/initiatives/${id}/feedback`, { method: "POST", body: JSON.stringify({ tenantId: "local", useful, actedOn: useful }) }); await load(); } catch (cause) { showError(cause); } };
  const deliver = async (id: string) => { try { await api(`/v1/initiative/initiatives/${id}/delivered`, { method: "POST", body: JSON.stringify({ tenantId: "local", channel: "canvas" }) }); await load(); } catch (cause) { showError(cause); } };
  const forgetUser = async () => { try { await api(`/v1/user-model/${encodeURIComponent(userId)}?tenantId=local`, { method: "DELETE" }); await load(); } catch (cause) { showError(cause); } };
  const openAnalysis = async () => { if (!question.trim()) return; try { await api("/v1/multiworld/analyses", { method: "POST", body: JSON.stringify({ tenantId: "local", question: question.trim(), problemType: "general" }) }); setQuestion(""); await load(); } catch (cause) { showError(cause); } };
  const retirementSweep = async () => { try { await api("/v1/evolution/retirement-sweep", { method: "POST", body: JSON.stringify({ tenantId: "local" }) }); await load(); } catch (cause) { showError(cause); } };

  return <div className="panel tasks-panel">
    <div className="task-toolbar">
      <b>Aurora substrate</b>
      {(["memory","world","initiative","user","evolution","environment"] as const).map(item => <button key={item} className={section===item?"active":""} onClick={()=>setSection(item)}>{item}</button>)}
      <button onClick={()=>void load()}><RefreshCw size={13}/>Refresh</button>
    </div>
    {section === "memory" && <>
      <div className="task-toolbar"><small>health {memoryHealth ? memoryHealth.healthScore.toFixed(3) : "—"} · {memoryHealth?.total ?? 0} objects · {memoryHealth?.contradicted?.length ?? 0} contradicted · {memoryHealth?.stale?.length ?? 0} stale</small><button onClick={consolidate}>Consolidate episodes</button><button onClick={scanContradictions}>Scan contradictions</button></div>
      <div className="task-grid">{anchors.map(anchor => <article className="task-card" key={anchor.id}><h3>anchor · {anchor.title}</h3><p>{anchor.question}</p><small>{anchor.status} · importance {anchor.importance} · confidence {anchor.confidence} · next review {anchor.nextReviewAt.slice(0,10)}</small><code>next step: {anchor.nextStep}</code></article>)}</div>
    </>}
    {section === "world" && <>
      <div className="task-toolbar"><small>calibration accuracy {calibration ? calibration.accuracy.toFixed(3) : "—"} · Brier {calibration ? calibration.brierMean.toFixed(3) : "—"} · {calibration?.resolved ?? 0} resolved · {inconsistencies.length} inconsistencies · {perspectives.length} perspectives</small><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="multi-perspective question"/><button disabled={!question.trim()} onClick={openAnalysis}>Open analysis</button></div>
      <div className="task-grid">
        {inconsistencies.map(item => <article className="task-card failed" key={`${item.entityId}-${item.key}`}><h3>conflict · {item.key}</h3><p>{item.recommendation}</p><small>{item.conflicting.length} competing claims</small></article>)}
        {analyses.map(item => <article className="task-card" key={item.id}><h3>{item.problemType} · {item.question}</h3><p>{item.consensus ? `${item.consensus.decision} (score ${item.consensus.score}, agreement ${item.consensus.agreement})` : `${item.views.length}/${item.perspectiveIds.length} perspectives submitted`}</p><small>{item.status} · dissent {item.consensus?.dissentPerspectiveIds?.length ?? 0} · conflicts {item.conflicts.length} · scenarios {item.scenarios.length}</small></article>)}
      </div>
    </>}
    {section === "initiative" && <>
      <div className="task-toolbar"><small>trust {initiativeBudget ? initiativeBudget.trustScore.toFixed(2) : "—"} · immediate {initiativeBudget?.usedImmediate ?? 0}/{initiativeBudget?.dailyImmediateLimit ?? 0} · messages {initiativeBudget?.usedMessage ?? 0}/{initiativeBudget?.dailyMessageLimit ?? 0}</small><button onClick={evaluateInitiatives}>Evaluate queue</button><button onClick={()=>void buildDigest("daily")}>Daily briefing</button><button onClick={()=>void buildDigest("weekly")}>Weekly review</button></div>
      {digest && <div className="task-toolbar"><small><b>{digest.title}</b> · {digest.sections.map((s:any)=>`${s.heading}: ${s.items.length}`).join(" · ") || "nothing worth reporting"}</small></div>}
      <div className="task-grid">{initiatives.map(item => <article className={`task-card ${item.state}`} key={item.id}><h3>{item.priority} · {item.title}</h3><p>{item.message}</p><small>{item.kind} · {item.mode} · worthiness {item.worthiness} · {item.state} → {item.channel}{item.suppressionReason?` (${item.suppressionReason})`:""}</small><div>{item.state==="queued"&&<button onClick={()=>void deliver(item.id)}>Mark delivered</button>}{(item.state==="delivered"||item.state==="digested")&&!item.feedback&&<><button onClick={()=>void feedback(item.id,true)}><CheckCircle2 size={13}/>Useful</button><button className="danger" onClick={()=>void feedback(item.id,false)}><XCircle size={13}/>Noise</button></>}</div></article>)}</div>
    </>}
    {section === "user" && <>
      <div className="task-toolbar"><input value={userId} onChange={e=>setUserId(e.target.value)} placeholder="user id"/><small>state {userState?.state ?? "unknown"} (estimate, confidence {userState ? userState.confidence.toFixed(2) : "—"}) · frustration {userSummary ? userSummary.frustrationRisk : "—"} · advice score {userSummary ? userSummary.adviceEffectiveness.score : "—"}</small><button className="danger" onClick={forgetUser}>Delete every inference</button></div>
      <div className="task-grid">
        {Object.entries(userSummary?.claims ?? {}).map(([category, values]) => <article className="task-card" key={category}><h3>{category}</h3>{(values as any[]).map((claim, position) => <p key={position}>{claim.key}: {claim.value} <small>({claim.status}, {claim.source}, {claim.confidence})</small></p>)}</article>)}
        {(userSummary?.goals ?? []).map((goal: any) => <article className="task-card" key={goal.id}><h3>{goal.horizon} goal · {goal.title}</h3><p>{goal.description || "no description"}</p><small>progress {goal.progress} · importance {goal.importance} · {goal.status}</small></article>)}
      </div>
    </>}
    {section === "evolution" && <>
      <div className="task-toolbar"><small>evolution index {evolutionIndex ? evolutionIndex.index.toFixed(3) : "—"} (Δ {evolutionIndex?.delta ?? 0}) · production {evolutionIndex?.productionSkills ?? 0} · beta {evolutionIndex?.betaSkills ?? 0} · gap closure {evolutionIndex?.gapClosureRate ?? 0}</small><button onClick={retirementSweep}>Retirement sweep</button></div>
      <div className="task-grid">
        {gaps.map(gap => <article className="task-card" key={gap.id}><h3>{gap.kind} · ×{gap.occurrences}</h3><p>{gap.description}</p><small>{gap.status} · severity {gap.severity}</small></article>)}
        {candidates.map(candidate => <article className="task-card" key={candidate.id}><h3>{candidate.stage} · {candidate.name} v{candidate.version}</h3><p>{candidate.purpose}</p><small>composite {candidate.scores.composite} · accuracy {candidate.scores.accuracy} · safety {candidate.scores.safety} · uses {candidate.usage.invocations}</small></article>)}
      </div>
    </>}
    {section === "environment" && <>
      <div className="task-toolbar"><small>{inventory?.totals?.resources ?? 0} resources · {inventory?.totals?.degraded ?? 0} degraded · verification debt {inventory?.unverifiedActions ?? 0} · unexpected {inventory?.unexpectedOutcomes ?? 0}</small></div>
      <div className="task-grid">
        {resources.map(resource => <article className={`task-card ${resource.status}`} key={resource.id}><h3>zone {resource.zone} · {resource.name}</h3><p>{resource.kind}{resource.requiresApproval?" · approval required":""}</p><small>{resource.status} · reputation {resource.health.reputation} · {resource.health.successes}/{resource.health.successes+resource.health.failures} successful</small></article>)}
        {unverified.map(action => <article className="task-card failed" key={action.id}><h3>unverified · {action.action}</h3><p>{action.goal}</p><small>zone {action.zone} · {action.result?.summary ?? "no result"}</small></article>)}
      </div>
    </>}
  </div>;
}

function CognitivePanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [objects,setObjects]=useState<any[]>([]),[goals,setGoals]=useState<any[]>([]),[budget,setBudget]=useState<any>(),[mode,setMode]=useState<any>(),[title,setTitle]=useState(""),[content,setContent]=useState(""),[kind,setKind]=useState("observation"),[goalId,setGoalId]=useState(""),[goalTitle,setGoalTitle]=useState(""),[goalObjective,setGoalObjective]=useState(""),[goalClass,setGoalClass]=useState("P3");
  const load=async()=>{try{const [o,g,b,m]=await Promise.all([api<any>("/v1/cognitive/objects?tenantId=local"),api<any>("/v1/cognitive/goals?tenantId=local"),api<any>("/v1/cognitive/budget?tenantId=local"),api<any>("/v1/cognitive/mode?tenantId=local")]);setObjects(o.objects);setGoals(g.goals);setBudget(b);setMode(m)}catch(e){showError(e)}};useEffect(()=>{void load()},[]);
  const addGoal=async()=>{try{await api("/v1/cognitive/goals",{method:"POST",body:JSON.stringify({tenantId:"local",title:goalTitle,objective:goalObjective,class:goalClass,importance:.8,urgency:.5,userRelevance:.9})});setGoalTitle("");setGoalObjective("");await load()}catch(e){showError(e)}};
  const addObject=async()=>{try{await api("/v1/cognitive/objects",{method:"POST",body:JSON.stringify({tenantId:"local",sessionId,kind,title,content,sourceType:"user",confidence:.8,importance:.8,urgency:.5,impact:.7,userRelevance:.9,horizon:"tactical",requestedTokens:10000,...(goalId?{goalId}:{})})});setTitle("");setContent("");await load()}catch(e){showError(e)}};
  const allocate=async()=>{try{await api("/v1/cognitive/attention/allocate",{method:"POST",body:JSON.stringify({tenantId:"local"})});await load()}catch(e){showError(e)}};
  const transition=async(next:string)=>{try{await api("/v1/cognitive/mode",{method:"POST",body:JSON.stringify({tenantId:"local",mode:next,reason:"Explicit Canvas operator transition"})});await load()}catch(e){showError(e)}};
  return <div className="panel tasks-panel"><div className="task-toolbar"><b>Global Workspace</b><small>mode {mode?.mode??"reactive"} · budget {budget?.usedTokens??0}+{budget?.reservedTokens??0}/{budget?.dailyTokenBudget??0}</small><button onClick={allocate}>Allocate attention</button><select value={mode?.mode??"reactive"} onChange={e=>transition(e.target.value)}><option value="reactive">Reactive</option><option value="research">Research</option><option value="development">Development</option><option value="reflection">Reflection</option><option value="dream">Dream</option><option value="emergency">Emergency</option></select></div><div className="task-toolbar"><input value={goalTitle} onChange={e=>setGoalTitle(e.target.value)} placeholder="constitutional goal"/><input value={goalObjective} onChange={e=>setGoalObjective(e.target.value)} placeholder="goal objective"/><select value={goalClass} onChange={e=>setGoalClass(e.target.value)}><option>P0</option><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select><button disabled={!goalTitle||!goalObjective} onClick={addGoal}>Create goal</button></div><div className="task-toolbar"><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="cognitive object title"/><select value={kind} onChange={e=>setKind(e.target.value)}><option value="observation">Observation</option><option value="problem">Problem</option><option value="hypothesis">Hypothesis</option><option value="insight">Insight</option><option value="risk">Risk</option><option value="opportunity">Opportunity</option><option value="decision">Decision</option></select><select value={goalId} onChange={e=>setGoalId(e.target.value)}><option value="">No goal</option>{goals.filter(g=>g.state==="active").map(g=><option key={g.id} value={g.id}>{g.class} · {g.title}</option>)}</select><textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="sourced content"/><button disabled={!title||!content} onClick={addObject}>Queue object</button></div><div className="task-grid">{objects.map(item=><article className={`task-card ${item.state}`} key={item.id}><h3>{item.kind} · {item.title}</h3><p>{item.content}</p><small>{item.state} · {item.attentionState} · priority {item.priorityScore.toFixed(4)} · confidence {item.confidence.toFixed(2)} · {item.horizon}</small><code>{item.tags.join(", ")||"no tags"}{item.repeatedIterationCount>1?` · repeat ${item.repeatedIterationCount}`:""}</code></article>)}</div></div>
}

function SocietyPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [roles,setRoles]=useState<any[]>([]),[tasks,setTasks]=useState<any[]>([]),[deliberations,setDeliberations]=useState<any[]>([]),[budget,setBudget]=useState<any>(),[title,setTitle]=useState(""),[objective,setObjective]=useState(""),[tags,setTags]=useState("planning"),[bidRole,setBidRole]=useState("planner-agent"),[question,setQuestion]=useState(""),[councilRoles,setCouncilRoles]=useState("planning-director,security-director,user-director");
  const load=async()=>{try{const [r,t,d,b]=await Promise.all([api<any>("/v1/society/roles?tenantId=local"),api<any>("/v1/society/tasks?tenantId=local"),api<any>("/v1/society/deliberations?tenantId=local"),api<any>("/v1/society/budget?tenantId=local")]);setRoles(r.roles);setTasks(t.tasks.filter((x:any)=>x.rootSessionId===sessionId));setDeliberations(d.deliberations);setBudget(b)}catch(e){showError(e)}};useEffect(()=>{void load()},[sessionId]);
  const post=async()=>{try{await api("/v1/society/tasks",{method:"POST",body:JSON.stringify({tenantId:"local",rootSessionId:sessionId,title,objective,requiredCapabilityTags:tags.split(",").map(x=>x.trim()).filter(Boolean),priority:"normal",maxTokens:100000})});setTitle("");setObjective("");await load()}catch(e){showError(e)}};
  const bid=async(task:any)=>{try{await api(`/v1/society/tasks/${task.id}/bids`,{method:"POST",body:JSON.stringify({tenantId:"local",roleId:bidRole,confidence:.8,estimatedTokens:Math.min(task.maxTokens,50000),estimatedDurationMs:3600000,rationale:"Role capability tags match the marketplace request."})});await load()}catch(e){showError(e)}};
  const award=async(id:string)=>{try{await api(`/v1/society/tasks/${id}/award`,{method:"POST",body:JSON.stringify({tenantId:"local"})});await load()}catch(e){showError(e)}};
  const execute=async(id:string)=>{try{await api(`/v1/society/tasks/${id}/execute`,{method:"POST",body:JSON.stringify({tenantId:"local",sessionId})});await load()}catch(e){showError(e)}};
  const createDeliberation=async()=>{try{await api("/v1/society/deliberations",{method:"POST",body:JSON.stringify({tenantId:"local",question,requiredRoleIds:councilRoles.split(",").map(x=>x.trim()).filter(Boolean)})});setQuestion("");await load()}catch(e){showError(e)}};
  return <div className="panel tasks-panel"><div className="task-toolbar"><b>Aurora Society</b><small>{roles.length} roles · budget {budget?.usedTokens??0}+{budget?.reservedTokens??0}/{budget?.dailyTokenBudget??0} · max {budget?.maxConcurrentTasks??0} concurrent</small></div><div className="task-toolbar"><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="marketplace task title"/><input value={tags} onChange={e=>setTags(e.target.value)} placeholder="required capability tags"/><select value={bidRole} onChange={e=>setBidRole(e.target.value)}>{roles.filter(r=>r.status==="active").map(r=><option key={r.id} value={r.id}>{r.name} · {r.reputation.toFixed(2)}</option>)}</select><textarea value={objective} onChange={e=>setObjective(e.target.value)} placeholder="bounded objective"/><button disabled={!title||!objective} onClick={post}>Post task</button></div><div className="task-grid">{tasks.map(task=><article className={`task-card ${task.status}`} key={task.id}><h3>{task.title}</h3><p>{task.objective}</p><small>{task.status} · {task.priority} · {task.requiredCapabilityTags.join(", ")} · {task.bids.length} bids{task.assignedRoleId?` · ${task.assignedRoleId}`:""}</small><div className="task-actions">{task.status==="open"&&<button onClick={()=>bid(task)}>Bid selected role</button>}{task.status==="open"&&task.bids.length>0&&<button onClick={()=>award(task.id)}>Award</button>}{task.status==="assigned"&&<button onClick={()=>execute(task.id)}>Spawn specialist</button>}</div></article>)}</div><div className="task-toolbar"><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="council deliberation question"/><input value={councilRoles} onChange={e=>setCouncilRoles(e.target.value)} placeholder="role IDs, comma separated"/><button disabled={!question} onClick={createDeliberation}>Open deliberation</button></div><div className="task-grid">{deliberations.map(item=><article className="task-card" key={item.id}><h3>{item.question}</h3><small>{item.status} · quorum {item.perspectives.length}/{item.quorum}</small>{item.result&&<p>{item.result.decision} · confidence {item.result.confidence.toFixed(2)} · dissent {item.result.dissentRoleIds.length}</p>}</article>)}</div></div>
}

function ModelsPanel({session,command,reload,showError}:{session:Session;command:(k:string,p:any)=>Promise<any>;reload:()=>Promise<void>;showError:(e:any)=>void}) {
  const [data,setData]=useState<any>({profiles:[],configurations:[],active:[]}),[name,setName]=useState(""),[baseProfileId,setBaseProfileId]=useState("openai"),[model,setModel]=useState(""),[baseUrl,setBaseUrl]=useState(""),[credentialEnv,setCredentialEnv]=useState(""),[oauthSourceId,setOauthSourceId]=useState(""),[audience,setAudience]=useState(""),[configDataPolicy,setConfigDataPolicy]=useState("provider"),[oauthSources,setOauthSources]=useState<any[]>([]),[oauthName,setOauthName]=useState(""),[oauthIssuer,setOauthIssuer]=useState(""),[oauthClientId,setOauthClientId]=useState(""),[oauthScopes,setOauthScopes]=useState("openid profile offline_access"),[oauthResourceOrigin,setOauthResourceOrigin]=useState("");
  const [codex,setCodex]=useState<any>({authenticated:false,pending:false}),[codexFlow,setCodexFlow]=useState<any>(),[codexModel,setCodexModel]=useState(""),[codexModels,setCodexModels]=useState<string[]>([]);
  const load=async()=>{try{const [providers,auth,oauth]=await Promise.all([api<any>("/v1/providers?tenantId=local"),api<any>("/v1/model-auth/codex/status?tenantId=local"),api<any>("/v1/model-oauth-sources?tenantId=local")]);setData(providers);setCodex(auth);setOauthSources(oauth.sources??[]);if(auth.authenticated){const catalog=await api<any>("/v1/model-auth/codex/models?tenantId=local");setCodexModels(catalog.models??[])}else setCodexModels([])}catch(e){showError(e)}};useEffect(()=>{void load()},[]);
  const select=async(route:string)=>{try{await command("model.select",{model:route,fallbackModels:session.modelFallbacks??[]});await reload()}catch(e){showError(e)}};
  const create=async()=>{try{await api("/v1/model-configurations",{method:"POST",body:JSON.stringify({tenantId:"local",name,baseProfileId,model,dataPolicy:configDataPolicy,...(baseUrl?{baseUrl}:{}),...(credentialEnv&&!oauthSourceId?{credentialEnvironmentVariable:credentialEnv}:{}),...(oauthSourceId?{credentialOAuthSourceId:oauthSourceId}:{}),...(audience?{credentialAudienceOrigin:audience}:{})})});setName("");setModel("");setBaseUrl("");setCredentialEnv("");setOauthSourceId("");setAudience("");await load()}catch(e){showError(e)}};
  const toggle=async(item:any)=>{try{await api(`/v1/model-configurations/${item.id}`,{method:"PATCH",body:JSON.stringify({enabled:!item.enabled})});await load()}catch(e){showError(e)}};
  const remove=async(id:string)=>{try{await api(`/v1/model-configurations/${id}`,{method:"DELETE"});await load()}catch(e){showError(e)}};
  const startCodex=async()=>{try{const flow=await api<any>("/v1/model-auth/codex/start",{method:"POST",body:JSON.stringify({tenantId:"local"})});setCodexFlow(flow);window.open(flow.verificationUrl,"_blank","noopener,noreferrer");await load()}catch(e){showError(e)}};
  const pollCodex=async()=>{if(!codexFlow)return;try{const result=await api<any>("/v1/model-auth/codex/poll",{method:"POST",body:JSON.stringify({tenantId:"local",flowId:codexFlow.flowId})});if(result.status==="authenticated"){setCodexFlow(undefined);await load()}}catch(e){showError(e)}};
  const activateCodex=async()=>{if(!codexModel.trim())return;try{const result=await api<any>("/v1/model-auth/codex/activate",{method:"POST",body:JSON.stringify({tenantId:"local",model:codexModel.trim()})});await select(result.route);await load()}catch(e){showError(e)}};
  const logoutCodex=async()=>{try{await api("/v1/model-auth/codex?tenantId=local",{method:"DELETE"});setCodexFlow(undefined);await load()}catch(e){showError(e)}};
  const addOauth=async()=>{try{await api("/v1/model-oauth-sources",{method:"POST",body:JSON.stringify({tenantId:"local",name:oauthName,issuer:oauthIssuer,clientId:oauthClientId,scopes:oauthScopes.split(/[, ]+/).filter(Boolean),resourceOrigins:[oauthResourceOrigin]})});setOauthName("");setOauthIssuer("");setOauthClientId("");setOauthResourceOrigin("");await load()}catch(e){showError(e)}};
  const startOauth=async(id:string)=>{try{const result=await api<any>(`/v1/model-oauth-sources/${id}/start`,{method:"POST",body:JSON.stringify({tenantId:"local",returnTo:"/canvas/"})});window.open(result.authorizationUrl,"_blank","noopener,noreferrer");await load()}catch(e){showError(e)}};
  const logoutOauth=async(id:string)=>{try{await api(`/v1/model-oauth-sources/${id}/logout`,{method:"POST",body:JSON.stringify({tenantId:"local"})});await load()}catch(e){showError(e)}};
  const resetCredential=async(providerId:string,credentialId?:string)=>{try{await api(`/v1/providers/${encodeURIComponent(providerId)}/credentials/reset`,{method:"POST",body:JSON.stringify({...(credentialId?{credentialId}:{})})});await load()}catch(e){showError(e)}};
  return <div className="panel models-panel">
    <div className="model-current"><b>Session route</b><code>{session.modelName??"default"}</code><small>{session.modelFallbacks?.length?`Fallbacks: ${session.modelFallbacks.join(" → ")}`:"No fallback routes"}</small></div>
    <div className="model-grid">{(data.routes??[]).filter((route:any)=>route.detail?.kind==="credential-pool").flatMap((route:any)=>route.detail.entries.map((entry:any)=><article className="model-card custom" key={`${route.id}-${entry.id}`}><h3>{route.id} · {entry.id}</h3><small>{entry.state} · failures {entry.failureCount}{entry.cooldownUntil?` · until ${new Date(entry.cooldownUntil).toLocaleTimeString()}`:""}</small><code>{entry.lastFailureCode??"healthy"}</code><button disabled={entry.state==="available"&&entry.failureCount===0} onClick={()=>resetCredential(route.id,entry.id)}>Reset credential state</button></article>))}</div>
    <article className="model-card custom"><h3>OpenAI Codex subscription</h3><code>{codex.authenticated?`account ${codex.accountProjection??"connected"}`:"not connected"}</code><small>Device OAuth · encrypted server-side · {codex.persistentAcrossRestart?"restart persistent":"ephemeral key"}</small>
      {!codex.authenticated&&!codexFlow&&<button onClick={startCodex}>Start device login</button>}
      {codexFlow&&<div><p>Open <a href={codexFlow.verificationUrl} target="_blank" rel="noreferrer">OpenAI device login</a> and enter:</p><code>{codexFlow.userCode}</code><button onClick={pollCodex}>Check authorization</button></div>}
      {codex.authenticated&&<div><input value={codexModel} onChange={e=>setCodexModel(e.target.value)} placeholder="account-visible Codex model id" list="codex-models"/><datalist id="codex-models">{codexModels.map(item=><option value={item} key={item}/>)}</datalist><small>{codexModels.length} account-visible models discovered</small><button disabled={!codexModel.trim()} onClick={activateCodex}>Activate route</button><button className="danger" onClick={logoutCodex}>Log out</button></div>}
    </article>
    <div className="model-grid">{oauthSources.map((item:any)=><article className="model-card custom" key={item.id}><h3>{item.name}</h3><code>{item.issuer}</code><small>{item.authenticated?`connected · ${item.subjectProjection??"account"}`:item.pending?"authorization pending":"not connected"} · {item.resourceOrigins.join(", ")}</small><div><button disabled={!item.enabled} onClick={()=>startOauth(item.id)}>{item.authenticated?"Reauthorize":"Authorize with PKCE"}</button>{item.authenticated&&<button className="danger" onClick={()=>logoutOauth(item.id)}>Log out</button>}</div></article>)}</div>
    <div className="model-form"><h3>Add OIDC model credential source</h3><input value={oauthName} onChange={e=>setOauthName(e.target.value)} placeholder="source name"/><input value={oauthIssuer} onChange={e=>setOauthIssuer(e.target.value)} placeholder="https://issuer.example"/><input value={oauthClientId} onChange={e=>setOauthClientId(e.target.value)} placeholder="registered OAuth client ID"/><input value={oauthScopes} onChange={e=>setOauthScopes(e.target.value)} placeholder="openid profile offline_access"/><input value={oauthResourceOrigin} onChange={e=>setOauthResourceOrigin(e.target.value)} placeholder="exact model resource origin"/><button disabled={!oauthName||!oauthIssuer||!oauthClientId||!oauthResourceOrigin} onClick={addOauth}>Add OAuth source</button><small>Public/confidential client IDs must be registered by the operator; HAF does not impersonate another product's OAuth client.</small></div>
    <div className="model-grid">{data.profiles.map((item:any)=><article className="model-card" key={item.id}><h3>{item.displayName}</h3><code>{item.id}</code><small>{item.apiMode} · {item.configured?"configured":"credential missing"}</small>{item.defaultModel&&<button disabled={!item.configured} onClick={()=>select(`${item.id}:${item.defaultModel}`)}>Use {item.defaultModel}</button>}</article>)}{data.configurations.map((item:any)=><article className="model-card custom" key={item.id}><h3>{item.name}</h3><code>{item.id}:{item.model}</code><small>{item.baseProfileId} · {item.dataPolicy} · {item.enabled?"enabled":"disabled"} · {item.configured?"configured":"credential missing"}</small><div><button disabled={!item.enabled||!item.configured} onClick={()=>select(`${item.id}:${item.model}`)}>Use</button><button onClick={()=>toggle(item)}>{item.enabled?"Disable":"Enable"}</button><button className="danger" onClick={()=>remove(item.id)}>Delete</button></div></article>)}</div>
    <div className="model-form"><h3>Add server-side model configuration</h3><input value={name} onChange={e=>setName(e.target.value)} placeholder="display name"/><select value={baseProfileId} onChange={e=>setBaseProfileId(e.target.value)}>{data.profiles.map((item:any)=><option value={item.id} key={item.id}>{item.displayName}</option>)}</select><input value={model} onChange={e=>setModel(e.target.value)} placeholder="model id"/><input value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="custom base URL (optional)"/><select value={configDataPolicy} onChange={e=>setConfigDataPolicy(e.target.value)}><option value="provider">Provider data policy</option><option value="aggregator">Aggregator data policy</option><option value="local">Local data policy</option></select><input value={credentialEnv} disabled={Boolean(oauthSourceId)} onChange={e=>setCredentialEnv(e.target.value)} placeholder="credential env variable (optional)"/><select value={oauthSourceId} onChange={e=>setOauthSourceId(e.target.value)}><option value="">No OAuth source</option>{oauthSources.filter((item:any)=>item.authenticated&&item.enabled).map((item:any)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><input value={audience} onChange={e=>setAudience(e.target.value)} placeholder="credential audience origin for custom URL"/><button disabled={!name.trim()||!model.trim()} onClick={create}><Plus size={14}/>Add configuration</button></div>
  </div>
}

function AgentProfilesPanel({reloadGlobal,showError}:{reloadGlobal:()=>Promise<void>;showError:(e:any)=>void}) {
  const [profiles,setProfiles]=useState<any[]>([]),[capabilities,setCapabilities]=useState<any[]>([]),[name,setName]=useState(""),[description,setDescription]=useState(""),[instructions,setInstructions]=useState(""),[modelRoute,setModelRoute]=useState(""),[allowed,setAllowed]=useState("");
  const load=async()=>{try{const [p,c]=await Promise.all([api<any>("/v1/agent-profiles?tenantId=local"),api<any>("/v1/capabilities")]);setProfiles(p.profiles);setCapabilities(c.capabilities)}catch(e){showError(e)}};useEffect(()=>{void load()},[]);
  const create=async()=>{try{await api("/v1/agent-profiles",{method:"POST",body:JSON.stringify({tenantId:"local",name,description,instructions,...(modelRoute?{modelRoute}:{}),...(allowed.trim()?{allowedCapabilityIds:allowed.split(",").map(value=>value.trim()).filter(Boolean)}:{})})});setName("");setDescription("");setInstructions("");setModelRoute("");setAllowed("");await Promise.all([load(),reloadGlobal()])}catch(e){showError(e)}};
  const toggle=async(profile:any)=>{try{await api(`/v1/agent-profiles/${profile.id}`,{method:"PATCH",body:JSON.stringify({enabled:!profile.enabled})});await Promise.all([load(),reloadGlobal()])}catch(e){showError(e)}};
  const remove=async(id:string)=>{try{await api(`/v1/agent-profiles/${id}`,{method:"DELETE"});await Promise.all([load(),reloadGlobal()])}catch(e){showError(e)}};
  return <div className="panel profiles-panel"><div className="profile-grid">{profiles.map(profile=><article className="profile-card" key={profile.id}><h3>{profile.name} <small>v{profile.version}</small></h3><p>{profile.description||"No description"}</p><code>{profile.modelRoute||"default model"}</code><small>{profile.enabled?"enabled":"disabled"} · {profile.allowedCapabilityIds?.length??"all"} capabilities</small><pre>{profile.instructions}</pre><div><button onClick={()=>toggle(profile)}>{profile.enabled?"Disable":"Enable"}</button><button className="danger" onClick={()=>remove(profile.id)}>Delete</button></div></article>)}</div><div className="profile-form"><h3>Create agent profile</h3><input value={name} onChange={e=>setName(e.target.value)} placeholder="profile name"/><input value={description} onChange={e=>setDescription(e.target.value)} placeholder="description"/><input value={modelRoute} onChange={e=>setModelRoute(e.target.value)} placeholder="provider:model (optional)"/><input value={allowed} onChange={e=>setAllowed(e.target.value)} list="capability-hints" placeholder="allowed capability IDs, comma separated; blank = all"/><datalist id="capability-hints">{capabilities.map(item=><option key={item.id} value={item.id}/>)}</datalist><textarea value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="supplemental profile instructions; cannot bypass policy"/><button disabled={!name.trim()||!instructions.trim()} onClick={create}><Plus size={14}/>Create profile</button></div></div>
}

function McpElicitationCard({item,resolved,showError}:{item:any;resolved:()=>Promise<void>;showError:(e:any)=>void}) {
  const properties=Object.entries(item.requestedSchema?.properties??{}) as Array<[string,any]>;const [values,setValues]=useState<Record<string,any>>(()=>Object.fromEntries(properties.filter(([,schema])=>schema.default!==undefined).map(([name,schema])=>[name,schema.default])));
  const submit=async(action:string)=>{try{await api(`/v1/mcp/elicitations/${item.id}/resolve`,{method:"POST",body:JSON.stringify({tenantId:"local",action,...(action==="accept"&&item.mode==="form"?{content:values}:{})})});await resolved()}catch(e){showError(e)}};
  const set=(name:string,value:any)=>setValues(current=>({...current,[name]:value}));
  return <article className="elicitation-card"><header><b>{item.serverName}</b><small>{item.mode} · expires {new Date(item.expiresAt).toLocaleTimeString()}</small></header><p>{item.message}</p>{item.mode==="url"?<a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>:<div className="elicitation-fields">{properties.map(([name,schema])=><label key={name}><span>{schema.title||name}{item.requestedSchema.required.includes(name)?" *":""}<small>{schema.description}</small></span>{schema.enum?<select value={values[name]??""} onChange={e=>set(name,e.target.value)}><option value="">Select…</option>{schema.enum.map((value:any)=><option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>:schema.type==="boolean"?<input type="checkbox" checked={values[name]===true} onChange={e=>set(name,e.target.checked)}/>:<input type={schema.format==="password"?"password":schema.type==="number"||schema.type==="integer"?"number":"text"} value={values[name]??""} onChange={e=>set(name,schema.type==="number"?Number(e.target.value):schema.type==="integer"?parseInt(e.target.value,10):e.target.value)}/>}</label>)}</div>}<div className="elicitation-actions"><button onClick={()=>submit("accept")}>Accept</button><button onClick={()=>submit("decline")}>Decline</button><button className="danger" onClick={()=>submit("cancel")}>Cancel</button></div></article>
}

function McpPanel({showError}:{showError:(e:any)=>void}) {
  const [servers,setServers]=useState<any[]>([]),[schemas,setSchemas]=useState<any[]>([]),[elicitations,setElicitations]=useState<any[]>([]),[name,setName]=useState(""),[url,setUrl]=useState(""),[bearerEnv,setBearerEnv]=useState(""),[oauth,setOauth]=useState(false),[clientIdEnv,setClientIdEnv]=useState(""),[clientSecretEnv,setClientSecretEnv]=useState(""),[scopes,setScopes]=useState(""),[certEnv,setCertEnv]=useState(""),[keyEnv,setKeyEnv]=useState(""),[caEnv,setCaEnv]=useState("");
  const load=async()=>{try{const [live,cache,pending]=await Promise.all([api<any>("/v1/mcp/servers"),api<any>("/v1/mcp/schema-cache"),api<any>("/v1/mcp/elicitations?tenantId=local&status=pending")]);setServers(live.servers);setSchemas(cache.schemas);setElicitations(pending.elicitations)}catch(e){showError(e)}};useEffect(()=>{void load()},[]);
  const connect=async()=>{try{const result=await api<any>("/v1/mcp/servers/http",{method:"POST",body:JSON.stringify({name,tenantId:"local",url,defaultRisk:"network",...(bearerEnv&&!oauth?{bearerTokenEnvironmentVariable:bearerEnv}:{}),...(oauth?{oauth:{...(clientIdEnv?{clientIdEnvironmentVariable:clientIdEnv}:{}),...(clientSecretEnv?{clientSecretEnvironmentVariable:clientSecretEnv}:{}),...(scopes.trim()?{scopes:scopes.split(/[, ]+/).filter(Boolean)}:{})}}:{}),...(certEnv?{tlsCertificatePathEnvironmentVariable:certEnv,tlsPrivateKeyPathEnvironmentVariable:keyEnv,...(caEnv?{tlsCaPathEnvironmentVariable:caEnv}:{})}:{})})});if(result.authorizationRequired&&result.authorizationUrl)window.open(result.authorizationUrl,"_blank","noopener,noreferrer");else{setName("");setUrl("");await load()}}catch(e){showError(e)}};
  const disconnect=async(serverName:string)=>{try{await api(`/v1/mcp/servers/${encodeURIComponent(serverName)}`,{method:"DELETE"});await load()}catch(e){showError(e)}};
  return <div className="panel mcp-panel">{elicitations.length>0&&<section className="elicitation-list"><h3>Human input requested</h3>{elicitations.map(item=><McpElicitationCard key={item.id} item={item} resolved={load} showError={showError}/>)}</section>}<div className="mcp-grid">{servers.map(server=><article className="mcp-card" key={server.name}><h3>{server.name}</h3><code>{server.kind==="stdio"?server.command:server.url}</code><small>{server.capabilityIds.length} tools · circuit {server.circuit}</small><button className="danger" onClick={()=>disconnect(server.name)}>Disconnect</button></article>)}</div><div className="mcp-form"><h3>Connect Streamable HTTP MCP</h3><input value={name} onChange={e=>setName(e.target.value)} placeholder="server name"/><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp"/><label><input type="checkbox" checked={oauth} onChange={e=>setOauth(e.target.checked)}/> OAuth/PKCE</label>{oauth?<><input value={clientIdEnv} onChange={e=>setClientIdEnv(e.target.value)} placeholder="client ID env (optional for dynamic registration)"/><input value={clientSecretEnv} onChange={e=>setClientSecretEnv(e.target.value)} placeholder="client secret env (optional)"/><input value={scopes} onChange={e=>setScopes(e.target.value)} placeholder="scopes, comma separated"/></>:<input value={bearerEnv} onChange={e=>setBearerEnv(e.target.value)} placeholder="bearer token env (optional)"/>}<input value={certEnv} onChange={e=>setCertEnv(e.target.value)} placeholder="mTLS certificate path env (optional)"/><input value={keyEnv} onChange={e=>setKeyEnv(e.target.value)} placeholder="mTLS private-key path env"/><input value={caEnv} onChange={e=>setCaEnv(e.target.value)} placeholder="mTLS CA path env (optional)"/><button disabled={!name.trim()||!url.trim()||(Boolean(certEnv)!==Boolean(keyEnv))} onClick={connect}>{oauth?"Authorize and connect":"Connect"}</button></div><section className="mcp-cache"><h3>Schema cache</h3>{schemas.map(schema=><div key={`${schema.name}-${schema.updatedAt}`}><b>{schema.name}</b><small>{schema.tools.length} tools · {new Date(schema.updatedAt).toLocaleString()}</small></div>)}</section></div>
}

function SecretsPanel({showError}:{showError:(e:any)=>void}) {
  const [sources,setSources]=useState<any[]>([]),[secrets,setSecrets]=useState<any[]>([]),[name,setName]=useState(""),[kind,setKind]=useState("onepassword"),[executable,setExecutable]=useState(""),[digest,setDigest]=useState(""),[envs,setEnvs]=useState(""),[args,setArgs]=useState("{reference}"),[secretName,setSecretName]=useState(""),[reference,setReference]=useState(""),[manualName,setManualName]=useState(""),[manualValue,setManualValue]=useState("");
  const load=async()=>{try{const [sourceData,secretData]=await Promise.all([api<any>("/v1/secret-sources"),api<any>("/v1/secrets?tenantId=local")]);setSources(sourceData.sources);setSecrets(secretData.secrets)}catch(e){showError(e)}};useEffect(()=>{void load()},[]);
  const addSource=async()=>{try{await api("/v1/secret-sources",{method:"POST",body:JSON.stringify({name,kind,executable,executableSha256:digest,...(kind==="command"?{args:args.split(" ").filter(Boolean)}:{}),...(envs.trim()?{environmentVariables:envs.split(/[, ]+/).filter(Boolean)}:{}),items:[{secretName,reference}]})});setName("");setSecretName("");setReference("");await load()}catch(e){showError(e)}};
  const refresh=async(id:string)=>{try{await api(`/v1/secret-sources/${id}/refresh`,{method:"POST",body:JSON.stringify({tenantId:"local"})});await load()}catch(e){showError(e)}};
  const toggle=async(source:any)=>{try{await api(`/v1/secret-sources/${source.id}`,{method:"PATCH",body:JSON.stringify({enabled:!source.enabled})});await load()}catch(e){showError(e)}};
  const remove=async(id:string)=>{try{await api(`/v1/secret-sources/${id}`,{method:"DELETE"});await load()}catch(e){showError(e)}};
  const addManual=async()=>{try{await api("/v1/secrets",{method:"POST",body:JSON.stringify({tenantId:"local",name:manualName,value:manualValue})});setManualName("");setManualValue("");await load()}catch(e){showError(e)}};
  return <div className="panel secrets-panel"><div className="secret-columns"><section><h3>Secret metadata</h3>{secrets.map(secret=><article className="secret-card" key={secret.id}><b>{secret.name}</b><small>v{secret.version} · {new Date(secret.updatedAt).toLocaleString()}</small></article>)}<div className="manual-secret"><input value={manualName} onChange={e=>setManualName(e.target.value)} placeholder="SECRET_NAME"/><input type="password" value={manualValue} onChange={e=>setManualValue(e.target.value)} placeholder="write-only value"/><button disabled={!manualName||!manualValue} onClick={addManual}>Store encrypted secret</button></div></section><section><h3>External secret sources</h3>{sources.map(source=><article className="secret-card" key={source.id}><b>{source.name}</b><small>{source.kind} · {source.enabled?"enabled":"disabled"} · {source.items.length} items</small><code>{source.executable}</code><div><button onClick={()=>refresh(source.id)}>Refresh</button><button onClick={()=>toggle(source)}>{source.enabled?"Disable":"Enable"}</button><button className="danger" onClick={()=>remove(source.id)}>Delete</button></div></article>)}</section></div><div className="secret-source-form"><h3>Add pinned secret source</h3><input value={name} onChange={e=>setName(e.target.value)} placeholder="source name"/><select value={kind} onChange={e=>setKind(e.target.value)}><option value="onepassword">1Password CLI</option><option value="bitwarden">Bitwarden CLI</option><option value="command">Generic command</option></select><input value={executable} onChange={e=>setExecutable(e.target.value)} placeholder="absolute executable path"/><input value={digest} onChange={e=>setDigest(e.target.value)} placeholder="executable SHA-256"/><input value={envs} onChange={e=>setEnvs(e.target.value)} placeholder="credential env names, comma separated"/>{kind==="command"&&<input value={args} onChange={e=>setArgs(e.target.value)} placeholder="arguments with {reference}"/>}<input value={secretName} onChange={e=>setSecretName(e.target.value)} placeholder="IMPORTED_SECRET_NAME"/><input type="password" value={reference} onChange={e=>setReference(e.target.value)} placeholder="source reference (not returned by list API)"/><button disabled={!name||!executable||!digest||!secretName||!reference} onClick={addSource}>Add source</button></div></div>
}

function ChannelsPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [adapters,setAdapters]=useState<string[]>([]),[adapterStatuses,setAdapterStatuses]=useState<any[]>([]),[rules,setRules]=useState<any[]>([]),[profiles,setProfiles]=useState<any[]>([]),[platform,setPlatform]=useState(""),[destination,setDestination]=useState(""),[text,setText]=useState(""),[threadId,setThreadId]=useState(""),[mediaPath,setMediaPath]=useState(""),[ruleName,setRuleName]=useState(""),[rulePlatform,setRulePlatform]=useState(""),[chatType,setChatType]=useState("dm"),[scope,setScope]=useState("user"),[profileId,setProfileId]=useState(""),[chatId,setChatId]=useState(""),[userId,setUserId]=useState("");
  const load=async()=>{try{const [a,r,p]=await Promise.all([api<any>("/v1/channels/adapters"),api<any>("/v1/channel-routing-rules?tenantId=local"),api<any>("/v1/agent-profiles?tenantId=local")]);setAdapters(a.adapters);setAdapterStatuses(a.statuses??[]);setRules(r.rules);setProfiles(p.profiles);if(!platform&&a.adapters.length)setPlatform(a.adapters[0]);if(!rulePlatform&&a.adapters.length)setRulePlatform(a.adapters[0])}catch(e){showError(e)}};useEffect(()=>{void load()},[]);
  const send=async()=>{try{await api(`/v1/sessions/${sessionId}/channels/send`,{method:"POST",body:JSON.stringify({platform,destination,text,...(threadId?{threadId}:{}),...(mediaPath?{mediaPath}:{})})});setText("");setMediaPath("")}catch(e){showError(e)}};
  const addRule=async()=>{try{await api("/v1/channel-routing-rules",{method:"POST",body:JSON.stringify({tenantId:"local",name:ruleName,priority:0,platforms:rulePlatform?[rulePlatform]:[],chatTypes:[chatType],sessionScope:scope,...(chatId?{chatIds:[chatId]}:{}),...(userId?{userIds:[userId]}:{}),...(profileId?{agentProfileId:profileId}:{})})});setRuleName("");setChatId("");setUserId("");await load()}catch(e){showError(e)}};
  const toggle=async(rule:any)=>{try{await api(`/v1/channel-routing-rules/${rule.id}`,{method:"PATCH",body:JSON.stringify({tenantId:"local",enabled:!rule.enabled})});await load()}catch(e){showError(e)}};
  const remove=async(id:string)=>{try{await api(`/v1/channel-routing-rules/${id}?tenantId=local`,{method:"DELETE"});await load()}catch(e){showError(e)}};
  return <div className="panel channels-panel"><div className="channel-columns"><section><h3>Outbound text/media</h3><select value={platform} onChange={e=>setPlatform(e.target.value)}>{adapters.map(value=><option key={value}>{value}</option>)}</select><input value={destination} onChange={e=>setDestination(e.target.value)} placeholder="destination/chat/room"/><input value={threadId} onChange={e=>setThreadId(e.target.value)} placeholder="thread id (optional)"/><input value={mediaPath} onChange={e=>setMediaPath(e.target.value)} placeholder="workspace media path (optional)"/><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="caption or message"/><button disabled={!platform||!destination||!text} onClick={send}>Send through adapter</button><small>Media is loaded server-side after confinement and magic-byte checks.</small></section><section><h3>Inbound profile routing</h3><input value={ruleName} onChange={e=>setRuleName(e.target.value)} placeholder="rule name"/><select value={rulePlatform} onChange={e=>setRulePlatform(e.target.value)}>{adapters.map(value=><option key={value}>{value}</option>)}</select><select value={chatType} onChange={e=>setChatType(e.target.value)}><option value="dm">DM</option><option value="group">Group</option><option value="channel">Channel</option><option value="thread">Thread</option></select><select value={scope} onChange={e=>setScope(e.target.value)}><option value="user">Per user</option><option value="chat">Per chat</option><option value="thread">Per thread</option></select><select value={profileId} onChange={e=>setProfileId(e.target.value)}><option value="">No profile</option>{profiles.map(profile=><option value={profile.id} key={profile.id}>{profile.name}</option>)}</select><input value={chatId} onChange={e=>setChatId(e.target.value)} placeholder="exact chat id (stored hashed)"/><input value={userId} onChange={e=>setUserId(e.target.value)} placeholder="exact user id (stored hashed)"/><button disabled={!ruleName} onClick={addRule}>Add routing rule</button></section></div><div className="routing-rules">{adapterStatuses.filter(item=>item.longLived).map(item=><article key={`status-${item.id}`}><b>{item.id} transport</b><small>{item.status?.state??"unknown"} · generation {item.status?.generation??0} · {item.status?.tls?"TLS":"plaintext"}</small><code>{item.id==="email"?`UID ${item.status?.lastUid??0} · ${item.status?.delivered??0} delivered · ${item.status?.uncertain??0} uncertain`:item.id==="twilio-sms"?`${item.status?.delivered??0} delivered · ${item.status?.uncertain??0} uncertain · ${item.status?.outboundAccepted??0} accepted`:`${item.status?.configuredChannels??0} configured · ${item.status?.joinedChannels??0} joined`}{item.status?.lastErrorCode?` · ${item.status.lastErrorCode}`:""}</code></article>)}{rules.map(rule=><article key={rule.id}><b>{rule.name}</b><small>priority {rule.priority} · {rule.sessionScope} · {rule.enabled?"enabled":"disabled"}</small><code>{rule.platforms.join(", ")||"all platforms"} → {rule.agentProfileId||"default profile"}</code><div><button onClick={()=>toggle(rule)}>{rule.enabled?"Disable":"Enable"}</button><button className="danger" onClick={()=>remove(rule.id)}>Delete</button></div></article>)}</div></div>
}

function LearningPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [candidates,setCandidates]=useState<any[]>([]),[batches,setBatches]=useState<any[]>([]),[reviews,setReviews]=useState<any[]>([]),[instructions,setInstructions]=useState(""),[busy,setBusy]=useState(false);
  const load=async()=>{try{const [candidateData,batchData,reviewData]=await Promise.all([api<any>("/v1/learning/candidates?tenantId=local"),api<any>(`/v1/learning/refinements?tenantId=local&sessionId=${sessionId}`),api<any>(`/v1/learning/refinement-reviews?tenantId=local&sessionId=${sessionId}`)]);setCandidates(candidateData.candidates.filter((item:any)=>item.sessionId===sessionId));setBatches(batchData.batches);setReviews(reviewData.reviews)}catch(e){showError(e)}};useEffect(()=>{void load()},[sessionId]);
  const plan=async()=>{setBusy(true);try{await api("/v1/learning/refinements/plan",{method:"POST",body:JSON.stringify({tenantId:"local",sessionId,...(instructions.trim()?{instructions:instructions.trim()}:{})})});setInstructions("");await load()}catch(e){showError(e)}finally{setBusy(false)}};
  const promote=async(candidate:any)=>{try{if(candidate.status==="scanned")await api(`/v1/learning/candidates/${candidate.id}/evaluation`,{method:"POST",body:JSON.stringify({passed:true,checks:["human-canvas-review"],summary:"Approved after Canvas review"})});await api(`/v1/learning/candidates/${candidate.id}/promote`,{method:"POST"});await load()}catch(e){showError(e)}};
  const rollback=async(id:string)=>{try{await api(`/v1/learning/candidates/${id}/rollback`,{method:"POST"});await load()}catch(e){showError(e)}};
  return <div className="panel learning-panel"><div className="learning-plan"><h3>Model-planned continual-harness review</h3><textarea value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="Optional review focus. Output becomes governed candidates only."/><button disabled={busy} onClick={plan}>{busy?<Loader2 className="spin" size={15}/>:<RefreshCw size={15}/>}Plan review</button><small>Automatic cadence is server-configured; neither manual nor automatic review self-promotes.</small></div><div className="learning-columns"><section><h3>Candidates</h3>{candidates.map(item=><article className="learning-card" key={item.id}><header><b>{item.title}</b><small>{item.kind}/{item.scope} · {item.status}</small></header><p>{item.content}</p><small>{item.expectedOutcome}</small><div>{["scanned","evaluated","approved"].includes(item.status)&&<button onClick={()=>promote(item)}>Evaluate + promote</button>}{item.status==="promoted"&&<button className="danger" onClick={()=>rollback(item.id)}>Rollback</button>}</div></article>)}</section><section><h3>Refinement batches</h3>{batches.map(item=><article className="learning-card" key={item.id}><b>{item.trigger}</b><small>{item.status} · {item.candidateIds.length} edits</small><p>{item.rationale}</p></article>)}</section><section><h3>Reviews</h3>{reviews.slice().reverse().map(item=><article className="learning-card" key={item.id}><b>{item.trigger}</b><small>{item.shouldRefine?"candidate batch proposed":"no edit"}{item.errorCode?` · ${item.errorCode}`:""}</small><p>{item.rationale}</p></article>)}</section></div></div>
}

function AutomationsPanel({sessionId,showError}:{sessionId:string;showError:(e:any)=>void}) {
  const [items,setItems]=useState<any[]>([]),[sources,setSources]=useState<any[]>([]),[responders,setResponders]=useState<any[]>([]),[plans,setPlans]=useState<Record<string,any>>({}),[name,setName]=useState("review"),[prompt,setPrompt]=useState("Review the workspace and report findings."),[sourceName,setSourceName]=useState("automation repository"),[providerId,setProviderId]=useState(""),[repositoryId,setRepositoryId]=useState(""),[manifestPath,setManifestPath]=useState(".haf/automations.json"),[ref,setRef]=useState("main"),[hookSecretEnv,setHookSecretEnv]=useState(""),[responderName,setResponderName]=useState("external responder"),[responderAutomationId,setResponderAutomationId]=useState(""),[responderSecretId,setResponderSecretId]=useState("");
  const load=async()=>{try{const [a,s,r]=await Promise.all([api<any>("/v1/automations?tenantId=local"),api<any>("/v1/automation-git-sources?tenantId=local"),api<any>("/v1/automation-responders?tenantId=local")]);const sessionItems=a.automations.filter((x:any)=>x.sessionId===sessionId);setItems(sessionItems);setSources(s.sources.filter((x:any)=>x.sessionId===sessionId));setResponders(r.responders.filter((x:any)=>sessionItems.some((item:any)=>item.id===x.automationId)));setResponderAutomationId(current=>sessionItems.some((item:any)=>item.id===current)?current:(sessionItems.find((item:any)=>item.trigger.kind==="webhook")?.id??""))}catch(e){showError(e)}};
  useEffect(()=>{void load()},[sessionId]);
  const create=async()=>{try{await api("/v1/automations",{method:"POST",body:JSON.stringify({tenantId:"local",name,sessionId,prompt,trigger:{kind:"manual"}})});await load()}catch(e){showError(e)}};
  const addSource=async()=>{try{await api("/v1/automation-git-sources",{method:"POST",body:JSON.stringify({tenantId:"local",name:sourceName,providerId,repositoryId,manifestPath,ref,sessionId,...(hookSecretEnv?{webhookSecretEnvironmentVariable:hookSecretEnv}:{})})});setProviderId("");setRepositoryId("");await load()}catch(e){showError(e)}};
  const plan=async(source:any)=>{try{const value=await api<any>(`/v1/automation-git-sources/${source.id}/plan`,{method:"POST",body:JSON.stringify({tenantId:"local"})});setPlans(current=>({...current,[source.id]:value}))}catch(e){showError(e)}};
  const apply=async(source:any)=>{const value=plans[source.id];if(!value)return;try{await api(`/v1/automation-git-sources/${source.id}/apply`,{method:"POST",body:JSON.stringify({tenantId:"local",expectedManifestSha256:value.manifestSha256})});setPlans(current=>{const next={...current};delete next[source.id];return next});await load()}catch(e){showError(e)}};
  const toggleSource=async(source:any)=>{try{await api(`/v1/automation-git-sources/${source.id}`,{method:"PATCH",body:JSON.stringify({tenantId:"local",enabled:!source.enabled})});await load()}catch(e){showError(e)}};
  const addResponder=async()=>{try{await api("/v1/automation-responders",{method:"POST",body:JSON.stringify({tenantId:"local",name:responderName,automationId:responderAutomationId,credentialSecretId:responderSecretId})});setResponderSecretId("");await load()}catch(e){showError(e)}};
  const toggleResponder=async(responder:any)=>{try{await api(`/v1/automation-responders/${responder.id}`,{method:"PATCH",body:JSON.stringify({tenantId:"local",enabled:!responder.enabled})});await load()}catch(e){showError(e)}};
  return <div className="panel automations-panel"><div className="automation-form"><input value={name} onChange={e=>setName(e.target.value)}/><textarea value={prompt} onChange={e=>setPrompt(e.target.value)}/><button onClick={create}><Plus size={14}/>Create manual automation</button></div>{items.map(item=><div className="automation" key={item.id}><Workflow size={18}/><div><b>{item.name}</b><small>{item.trigger.kind} · {item.enabled?"enabled":"disabled"}{item.managedBy?` · Git ${item.managedBy.key}`:""}</small></div><button onClick={()=>api(`/v1/automations/${item.id}/dispatch`,{method:"POST"}).catch(showError)}><Play size={14}/>Run</button></div>)}<div className="automation-form"><h3>Hosted Git manifest sync</h3><input value={sourceName} onChange={e=>setSourceName(e.target.value)} placeholder="source name"/><input value={providerId} onChange={e=>setProviderId(e.target.value)} placeholder="hosted provider ID"/><input value={repositoryId} onChange={e=>setRepositoryId(e.target.value)} placeholder="repository ID"/><input value={manifestPath} onChange={e=>setManifestPath(e.target.value)} placeholder="manifest JSON path"/><input value={ref} onChange={e=>setRef(e.target.value)} placeholder="branch/ref"/><input value={hookSecretEnv} onChange={e=>setHookSecretEnv(e.target.value)} placeholder="webhook secret env (optional)"/><button disabled={!sourceName||!providerId||!repositoryId||!manifestPath||!ref} onClick={addSource}><GitBranch size={14}/>Add Git source</button><small>Plan fetches and validates only. Apply requires the exact planned SHA-256; branch movement forces a new plan.</small></div>{sources.map(source=>{const planned=plans[source.id];return <div className="automation" key={source.id}><GitBranch size={18}/><div><b>{source.name}</b><small>{source.status} · {source.ref}:{source.manifestPath} · {source.enabled?"enabled":"disabled"}</small>{planned&&<code>{planned.entries.length} entries · {planned.disableKeys.length} disable · {planned.manifestSha256.slice(0,12)}</code>}</div><button disabled={!source.enabled} onClick={()=>plan(source)}>Plan</button><button disabled={!planned} onClick={()=>apply(source)}>Apply exact hash</button><button onClick={()=>toggleSource(source)}>{source.enabled?"Disable":"Enable"}</button></div>})}<div className="automation-form"><h3>External responder deployment</h3><input value={responderName} onChange={e=>setResponderName(e.target.value)} placeholder="responder name"/><select value={responderAutomationId} onChange={e=>setResponderAutomationId(e.target.value)}><option value="">Select webhook automation</option>{items.filter((item:any)=>item.trigger.kind==="webhook").map((item:any)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><input value={responderSecretId} onChange={e=>setResponderSecretId(e.target.value)} placeholder="Credential Broker secret ID"/><button disabled={!responderName||!responderAutomationId||!responderSecretId} onClick={addResponder}>Register responder</button><small>Responder signs raw JSON with timestamp + nonce. The secret is never returned by status APIs.</small></div>{responders.map((responder:any)=><div className="automation" key={responder.id}><Workflow size={18}/><div><b>{responder.name}</b><small>{responder.health} · {responder.eventType} · {responder.enabled?"enabled":"disabled"}{responder.version?` · v${responder.version}`:""}</small><code>{responder.eventCounts.delivered} delivered · {responder.eventCounts.uncertain} uncertain · {responder.lastHeartbeatAt?new Date(responder.lastHeartbeatAt).toLocaleString():"no heartbeat"}</code></div><button onClick={()=>toggleResponder(responder)}>{responder.enabled?"Disable":"Enable"}</button></div>)}</div>
}
