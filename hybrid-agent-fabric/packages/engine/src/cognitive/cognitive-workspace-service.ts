import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AsyncMutex } from "../util/async-mutex.js";
import { atomicWrite } from "../util/atomic-file.js";

const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_OBJECTS = 100_000;
const MAX_GOALS = 10_000;
const LOOP_HISTORY = 20;

export type CognitiveObjectKind = "observation" | "problem" | "hypothesis" | "insight" | "risk" | "opportunity" | "decision";
export type CognitiveObjectState = "new" | "active" | "researching" | "waiting" | "blocked" | "archived" | "solved";
export type CognitiveMode = "reactive" | "research" | "development" | "reflection" | "dream" | "emergency";
export type CognitiveHorizon = "reactive" | "tactical" | "strategic";
export type CognitiveGoalClass = "P0" | "P1" | "P2" | "P3" | "P4";

export interface CognitiveGoal {
  id: string;
  tenantId: string;
  title: string;
  objective: string;
  class: CognitiveGoalClass;
  importance: number;
  urgency: number;
  userRelevance: number;
  state: "active" | "paused" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}
export interface CognitiveObject {
  id: string;
  tenantId: string;
  sessionId?: string;
  kind: CognitiveObjectKind;
  title: string;
  content: string;
  sourceType: "user" | "agent" | "event" | "memory" | "system";
  sourceId?: string;
  confidence: number;
  importance: number;
  urgency: number;
  impact: number;
  userRelevance: number;
  priorityScore: number;
  horizon: CognitiveHorizon;
  goalId?: string;
  state: CognitiveObjectState;
  attentionState: "queued" | "focused" | "deferred";
  requestedTokens: number;
  requestedTimeMs: number;
  reservedTokens: number;
  tags: string[];
  relations: string[];
  iterationHashes: string[];
  repeatedIterationCount: number;
  lastIterationAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface CognitiveBudget {
  tenantId: string;
  date: string;
  dailyTokenBudget: number;
  usedTokens: number;
  reservedTokens: number;
  maxFocusedObjects: number;
}
export interface CognitiveModeState {
  tenantId: string;
  mode: CognitiveMode;
  reason: string;
  changedAt: string;
  history: Array<{ from: CognitiveMode; to: CognitiveMode; reason: string; changedAt: string }>;
}
export interface CognitiveArbitration {
  id: string;
  tenantId: string;
  winnerGoalId?: string;
  rankedGoalIds: string[];
  conflictGoalIds: string[];
  reason: string;
  createdAt: string;
}
interface CognitiveState {
  schemaVersion: 1;
  objects: CognitiveObject[];
  goals: CognitiveGoal[];
  budgets: CognitiveBudget[];
  modes: CognitiveModeState[];
  arbitrations: CognitiveArbitration[];
}

const GOAL_WEIGHT: Record<CognitiveGoalClass, number> = { P0: 2, P1: 1.6, P2: 1.25, P3: 1, P4: 0.6 };
const GOAL_ORDER: Record<CognitiveGoalClass, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const MODE_TRANSITIONS: Record<CognitiveMode, CognitiveMode[]> = {
  reactive: ["research", "development", "reflection", "emergency"],
  research: ["reactive", "development", "reflection", "dream", "emergency"],
  development: ["reactive", "research", "reflection", "emergency"],
  reflection: ["reactive", "research", "dream", "emergency"],
  dream: ["reactive", "research", "reflection", "emergency"],
  emergency: ["reactive", "reflection"],
};

/** Durable Global Workspace, attention budget, cognitive modes, loop detection and goal arbitration. */
export class CognitiveWorkspaceService {
  private state: CognitiveState = { schemaVersion: 1, objects: [], goals: [], budgets: [], modes: [], arbitrations: [] };
  private loaded = false;
  private readonly mutex = new AsyncMutex();
  constructor(private readonly rootPath: string, private readonly now: () => number = Date.now) {}

  async createGoal(input: { tenantId: string; title: string; objective: string; class: CognitiveGoalClass; importance: number; urgency: number; userRelevance: number }): Promise<CognitiveGoal> {
    return await this.mutex.runExclusive(async () => {
      await this.load(); if (this.state.goals.length >= MAX_GOALS) throw new Error("Cognitive goal limit reached.");
      const now = new Date(this.now()).toISOString(); const goal: CognitiveGoal = { id: randomUUID(), tenantId: input.tenantId, title: bounded(input.title, 300, "Cognitive goal title"), objective: bounded(input.objective, 10_000, "Cognitive goal objective"), class: input.class, importance: unit(input.importance, "Goal importance"), urgency: unit(input.urgency, "Goal urgency"), userRelevance: unit(input.userRelevance, "Goal user relevance"), state: "active", createdAt: now, updatedAt: now };
      this.state.goals.push(goal); await this.save(); return structuredClone(goal);
    });
  }
  async setGoalState(tenantId: string, id: string, state: CognitiveGoal["state"]): Promise<CognitiveGoal> { return await this.mutex.runExclusive(async () => { const goal = await this.goal(tenantId, id); goal.state = state; goal.updatedAt = new Date(this.now()).toISOString(); if (state !== "active") for (const object of this.state.objects.filter((item) => item.goalId === goal.id && item.attentionState === "focused")) await this.releaseReservation(object, "deferred", 0); await this.save(); return structuredClone(goal); }); }
  async goals(tenantId: string): Promise<CognitiveGoal[]> { await this.load(); return this.state.goals.filter((item) => item.tenantId === tenantId).map((item) => structuredClone(item)); }

  async createObject(input: { tenantId: string; sessionId?: string; kind: CognitiveObjectKind; title: string; content: string; sourceType: CognitiveObject["sourceType"]; sourceId?: string; confidence: number; importance: number; urgency: number; impact: number; userRelevance: number; horizon: CognitiveHorizon; goalId?: string; requestedTokens?: number; requestedTimeMs?: number; tags?: string[]; relations?: string[] }): Promise<CognitiveObject> {
    return await this.mutex.runExclusive(async () => {
      await this.load(); if (this.state.objects.length >= MAX_OBJECTS) throw new Error("Cognitive object limit reached.");
      let goal: CognitiveGoal | undefined; if (input.goalId) { goal = await this.goal(input.tenantId, input.goalId); if (goal.state !== "active") throw new Error("Cognitive object goal is not active."); }
      const confidence = unit(input.confidence, "Confidence"), importance = unit(input.importance, "Importance"), urgency = unit(input.urgency, "Urgency"), impact = unit(input.impact, "Impact"), relevance = unit(input.userRelevance, "User relevance");
      const now = new Date(this.now()).toISOString(); const value: CognitiveObject = { id: randomUUID(), tenantId: input.tenantId, ...(input.sessionId ? { sessionId: input.sessionId } : {}), kind: input.kind, title: bounded(input.title, 500, "Cognitive object title"), content: bounded(input.content, 100_000, "Cognitive object content"), sourceType: input.sourceType, ...(input.sourceId ? { sourceId: bounded(input.sourceId, 500, "Cognitive source ID") } : {}), confidence, importance, urgency, impact, userRelevance: relevance, priorityScore: calculatePriority(importance, urgency, impact, confidence, relevance, goal?.class ?? "P3"), horizon: input.horizon, ...(goal ? { goalId: goal.id } : {}), state: "new", attentionState: "queued", requestedTokens: integer(input.requestedTokens ?? 10_000, 100, 10_000_000, "Requested cognitive tokens"), requestedTimeMs: integer(input.requestedTimeMs ?? 60_000, 1000, 24 * 60 * 60_000, "Requested cognitive time"), reservedTokens: 0, tags: labels(input.tags ?? []), relations: [...new Set(input.relations ?? [])].slice(0, 200), iterationHashes: [], repeatedIterationCount: 0, createdAt: now, updatedAt: now };
      this.state.objects.push(value); await this.save(); return structuredClone(value);
    });
  }
  async objects(tenantId: string, attentionState?: CognitiveObject["attentionState"]): Promise<CognitiveObject[]> { await this.load(); return this.state.objects.filter((item) => item.tenantId === tenantId && (!attentionState || item.attentionState === attentionState)).sort((a,b)=>b.priorityScore-a.priorityScore).map((item)=>structuredClone(item)); }
  async setObjectState(tenantId: string, id: string, state: CognitiveObjectState): Promise<CognitiveObject> { return await this.mutex.runExclusive(async () => { const object = await this.object(tenantId,id); object.state=state; if (["blocked","archived","solved"].includes(state) && object.attentionState==="focused") await this.releaseReservation(object, state === "blocked" ? "deferred" : "queued", 0); object.updatedAt=new Date(this.now()).toISOString(); await this.save(); return structuredClone(object); }); }

  async configureBudget(tenantId: string, dailyTokenBudget: number, maxFocusedObjects: number): Promise<CognitiveBudget> { return await this.mutex.runExclusive(async () => { await this.load(); let budget=this.state.budgets.find((item)=>item.tenantId===tenantId); if(!budget){budget={tenantId,date:day(this.now()),dailyTokenBudget:0,usedTokens:0,reservedTokens:0,maxFocusedObjects:1};this.state.budgets.push(budget);} this.rollBudget(budget); budget.dailyTokenBudget=integer(dailyTokenBudget,1000,100_000_000,"Cognitive daily token budget"); budget.maxFocusedObjects=integer(maxFocusedObjects,1,100,"Focused object limit"); await this.save(); return structuredClone(budget); }); }
  async budget(tenantId: string): Promise<CognitiveBudget> { await this.load(); let b=this.state.budgets.find((item)=>item.tenantId===tenantId); if(!b) return await this.configureBudget(tenantId,500_000,8); if(this.rollBudget(b)) await this.save(); return structuredClone(b); }

  async allocateAttention(tenantId: string): Promise<{ focused: CognitiveObject[]; deferred: string[]; budget: CognitiveBudget }> {
    return await this.mutex.runExclusive(async () => {
      await this.load(); const budget=await this.mutableBudget(tenantId); const activeGoals=new Map(this.state.goals.filter(g=>g.tenantId===tenantId&&g.state==="active").map(g=>[g.id,g]));
      const focused=this.state.objects.filter(o=>o.tenantId===tenantId&&o.attentionState==="focused"); let slots=Math.max(0,budget.maxFocusedObjects-focused.length); const candidates=this.state.objects.filter(o=>o.tenantId===tenantId&&["new","active","researching","waiting"].includes(o.state)&&o.attentionState!=="focused"&&(!o.goalId||activeGoals.has(o.goalId))).sort((a,b)=>{const ga=a.goalId?activeGoals.get(a.goalId)?.class:"P3",gb=b.goalId?activeGoals.get(b.goalId)?.class:"P3";return GOAL_ORDER[ga??"P3"]-GOAL_ORDER[gb??"P3"]||b.priorityScore-a.priorityScore||a.createdAt.localeCompare(b.createdAt);});
      const allocated:CognitiveObject[]=[]; const deferred:string[]=[];
      for(const object of candidates){if(slots<=0||budget.usedTokens+budget.reservedTokens+object.requestedTokens>budget.dailyTokenBudget){object.attentionState="deferred";deferred.push(object.id);continue;} object.attentionState="focused";object.state=object.state==="new"?"active":object.state;object.reservedTokens=object.requestedTokens;object.updatedAt=new Date(this.now()).toISOString();budget.reservedTokens+=object.requestedTokens;slots--;allocated.push(structuredClone(object));}
      await this.save(); return {focused:allocated,deferred,budget:structuredClone(budget)};
    });
  }
  async completeFocus(tenantId:string,id:string,outcome:"active"|"solved"|"blocked",actualTokens:number):Promise<CognitiveObject>{return await this.mutex.runExclusive(async()=>{const object=await this.object(tenantId,id);if(object.attentionState!=="focused")throw new Error("Cognitive object is not focused.");const actual=integer(actualTokens,0,object.requestedTokens*2,"Actual cognitive tokens");await this.releaseReservation(object,outcome==="blocked"?"deferred":"queued",actual);object.state=outcome;object.updatedAt=new Date(this.now()).toISOString();await this.save();return structuredClone(object);});}

  async recordIteration(tenantId:string,id:string,result:string):Promise<{object:CognitiveObject;loopDetected:boolean;repeatCount:number}>{return await this.mutex.runExclusive(async()=>{const object=await this.object(tenantId,id);const hash=createHash("sha256").update(result).digest("hex");const previous=object.iterationHashes.at(-1);object.repeatedIterationCount=previous===hash?object.repeatedIterationCount+1:1;object.iterationHashes.push(hash);if(object.iterationHashes.length>LOOP_HISTORY)object.iterationHashes.splice(0,object.iterationHashes.length-LOOP_HISTORY);object.lastIterationAt=new Date(this.now()).toISOString();const loop=object.repeatedIterationCount>=3;if(loop){object.state="blocked";if(object.attentionState==="focused")await this.releaseReservation(object,"deferred",0);}object.updatedAt=new Date(this.now()).toISOString();await this.save();return{object:structuredClone(object),loopDetected:loop,repeatCount:object.repeatedIterationCount};});}

  async mode(tenantId:string):Promise<CognitiveModeState>{await this.load();let mode=this.state.modes.find(m=>m.tenantId===tenantId);if(!mode){mode={tenantId,mode:"reactive",reason:"default",changedAt:new Date(this.now()).toISOString(),history:[]};this.state.modes.push(mode);await this.save();}return structuredClone(mode);}
  async transitionMode(tenantId:string,to:CognitiveMode,reason:string):Promise<CognitiveModeState>{return await this.mutex.runExclusive(async()=>{await this.load();let mode=this.state.modes.find(m=>m.tenantId===tenantId);if(!mode){mode={tenantId,mode:"reactive",reason:"default",changedAt:new Date(this.now()).toISOString(),history:[]};this.state.modes.push(mode);}if(mode.mode!==to&&!MODE_TRANSITIONS[mode.mode].includes(to))throw new Error(`Cognitive mode transition ${mode.mode} -> ${to} is forbidden.`);if(mode.mode!==to){const changedAt=new Date(this.now()).toISOString();mode.history.push({from:mode.mode,to,reason:bounded(reason,1000,"Mode transition reason"),changedAt});if(mode.history.length>1000)mode.history.splice(0,mode.history.length-1000);mode.mode=to;mode.reason=reason;mode.changedAt=changedAt;}await this.save();return structuredClone(mode);});}

  async arbitrateGoals(tenantId:string):Promise<CognitiveArbitration>{return await this.mutex.runExclusive(async()=>{await this.load();const goals=this.state.goals.filter(g=>g.tenantId===tenantId&&g.state==="active").sort((a,b)=>GOAL_ORDER[a.class]-GOAL_ORDER[b.class]||goalScore(b)-goalScore(a)||a.createdAt.localeCompare(b.createdAt));const winner=goals[0];const conflicts=winner?goals.filter(g=>g.id!==winner.id&&GOAL_ORDER[g.class]===GOAL_ORDER[winner.class]&&Math.abs(goalScore(g)-goalScore(winner))<.1).map(g=>g.id):[];const result:CognitiveArbitration={id:randomUUID(),tenantId,...(winner?{winnerGoalId:winner.id}:{}),rankedGoalIds:goals.map(g=>g.id),conflictGoalIds:conflicts,reason:winner?`Selected ${winner.class} goal by constitutional class then importance/urgency/user relevance.`:"No active goals.",createdAt:new Date(this.now()).toISOString()};this.state.arbitrations.push(result);if(this.state.arbitrations.length>10_000)this.state.arbitrations.splice(0,this.state.arbitrations.length-10_000);await this.save();return structuredClone(result);});}
  async arbitrations(tenantId:string):Promise<CognitiveArbitration[]>{await this.load();return this.state.arbitrations.filter(a=>a.tenantId===tenantId).map(a=>structuredClone(a));}

  private async releaseReservation(object:CognitiveObject,attention:CognitiveObject["attentionState"],actual:number):Promise<void>{const budget=await this.mutableBudget(object.tenantId);budget.reservedTokens=Math.max(0,budget.reservedTokens-object.reservedTokens);budget.usedTokens=Math.min(budget.dailyTokenBudget,budget.usedTokens+actual);object.reservedTokens=0;object.attentionState=attention;}
  private async goal(tenantId:string,id:string):Promise<CognitiveGoal>{await this.load();const g=this.state.goals.find(x=>x.tenantId===tenantId&&x.id===id);if(!g)throw new Error("Cognitive goal not found in tenant.");return g;}
  private async object(tenantId:string,id:string):Promise<CognitiveObject>{await this.load();const o=this.state.objects.find(x=>x.tenantId===tenantId&&x.id===id);if(!o)throw new Error("Cognitive object not found in tenant.");return o;}
  private async mutableBudget(tenantId:string):Promise<CognitiveBudget>{await this.load();let b=this.state.budgets.find(x=>x.tenantId===tenantId);if(!b){b={tenantId,date:day(this.now()),dailyTokenBudget:500_000,usedTokens:0,reservedTokens:0,maxFocusedObjects:8};this.state.budgets.push(b);}this.rollBudget(b);return b;}
  private rollBudget(b:CognitiveBudget):boolean{const current=day(this.now());if(b.date!==current){b.date=current;b.usedTokens=0;b.reservedTokens=0;for(const o of this.state.objects.filter(x=>x.tenantId===b.tenantId&&x.attentionState==="focused")){o.attentionState="queued";o.reservedTokens=0;}return true;}return false;}
  private get path():string{return join(this.rootPath,"cognitive","workspace.json");}
  private async load():Promise<void>{if(this.loaded)return;try{const raw=await readFile(this.path,"utf8");if(Buffer.byteLength(raw)>MAX_STATE_BYTES)throw new Error("Cognitive workspace exceeds its safety bound.");const parsed=JSON.parse(raw) as CognitiveState;if(parsed.schemaVersion!==1||!Array.isArray(parsed.objects)||!Array.isArray(parsed.goals)||!Array.isArray(parsed.budgets)||!Array.isArray(parsed.modes)||!Array.isArray(parsed.arbitrations))throw new Error("Cognitive workspace is malformed.");this.state=parsed;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}this.loaded=true;}
  private async save():Promise<void>{const encoded=`${JSON.stringify(this.state,null,2)}\n`;if(Buffer.byteLength(encoded)>MAX_STATE_BYTES)throw new Error("Cognitive workspace exceeds its safety bound.");await atomicWrite(this.path,encoded);}
}

function calculatePriority(i:number,u:number,impact:number,c:number,r:number,g:CognitiveGoalClass):number{return Number((i*u*impact*c*r*GOAL_WEIGHT[g]).toFixed(8));}
function goalScore(g:CognitiveGoal):number{return g.importance*g.urgency*g.userRelevance;}
function unit(value:number,label:string):number{if(!Number.isFinite(value)||value<0||value>1)throw new Error(`${label} must be between 0 and 1.`);return Number(value.toFixed(6));}
function integer(value:number,min:number,max:number,label:string):number{if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${label} is invalid.`);return value;}
function bounded(value:string,max:number,label:string):string{const text=value.trim();if(!text||text.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw new Error(`${label} is invalid.`);return text;}
function labels(values:string[]):string[]{const out=[...new Set(values.map(v=>v.trim().toLowerCase()))];if(out.length>100||out.some(v=>!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(v)))throw new Error("Cognitive labels are invalid.");return out;}
function day(now:number):string{return new Date(now).toISOString().slice(0,10);}
