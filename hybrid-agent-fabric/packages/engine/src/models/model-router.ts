import type { JsonValue, ModelProvider, ModelRequest, ModelStreamEvent } from "../types.js";
import { classifyModelFailure } from "./model-provider-error.js";

interface ProviderWithStatus extends ModelProvider {
  status?: () => JsonValue;
  reset?: (credentialId?: string) => Promise<JsonValue>;
}

export interface ModelRouteStatus {
  id: string;
  detail?: JsonValue;
}

function splitModelRoute(route: string | undefined): { providerId?: string; model?: string } {
  if (!route?.includes(":")) return route ? { model: route } : {};
  const separator = route.indexOf(":");
  return { providerId: route.slice(0, separator), model: route.slice(separator + 1) };
}

export class ModelRouter implements ModelProvider {
  readonly id = "router";
  private readonly providers = new Map<string, ModelProvider>();
  private defaultProviderId?: string;

  register(provider: ModelProvider, makeDefault = false): void {
    if (this.providers.has(provider.id)) throw new Error(`Model provider ${provider.id} is already registered.`);
    this.providers.set(provider.id, provider);
    if (makeDefault || !this.defaultProviderId) this.defaultProviderId = provider.id;
  }

  unregister(providerId: string): boolean {
    if (providerId === this.defaultProviderId) throw new Error("The default model provider cannot be unregistered while the engine is running.");
    return this.providers.delete(providerId);
  }

  list(): string[] {
    return [...this.providers.keys()];
  }

  status(): ModelRouteStatus[] {
    return [...this.providers.values()].map((provider) => {
      const detail = (provider as ProviderWithStatus).status?.();
      return { id: provider.id, ...(detail !== undefined ? { detail } : {}) };
    });
  }

  async resetCredentialPool(providerId: string, credentialId?: string): Promise<JsonValue> {
    const provider = this.providers.get(providerId) as ProviderWithStatus | undefined;
    if (!provider) throw new Error(`Model provider ${providerId} is not registered.`);
    if (!provider.reset) throw new Error(`Model provider ${providerId} does not expose a credential pool.`);
    return await provider.reset(credentialId);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const routes = [request.model, ...(request.fallbackModels ?? [])]
      .filter((route): route is string => Boolean(route?.trim()));
    if (routes.length === 0) routes.push("");

    const seen = new Set<string>();
    const candidates = routes.filter((route) => {
      if (seen.has(route)) return false;
      seen.add(route);
      return true;
    });
    let lastFailure: Error | undefined;

    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const route = candidates[attempt]!;
      const parsed = splitModelRoute(route);
      const providerId = parsed.providerId ?? this.defaultProviderId ?? route;
      const provider = this.providers.get(providerId);
      if (!provider) {
        lastFailure = new Error(`No model provider configured for ${providerId || "default"}.`);
        if (attempt + 1 < candidates.length) continue;
        throw lastFailure;
      }

      const selectedRoute = parsed.providerId ? route : parsed.model ? `${provider.id}:${parsed.model}` : provider.id;
      yield {
        type: "route_selected",
        provider: provider.id,
        model: parsed.model ?? "default",
        attempt,
        fallback: attempt > 0,
      };
      let producedProviderOutput = false;
      try {
        for await (const event of provider.stream({ ...request, model: selectedRoute, fallbackModels: [] })) {
          producedProviderOutput = true;
          yield event;
        }
        return;
      } catch (error) {
        const failure = classifyModelFailure(provider.id, error);
        lastFailure = failure;
        if (producedProviderOutput || failure.code === "cancelled") throw failure;
        yield {
          type: "route_failed",
          provider: provider.id,
          model: parsed.model ?? "default",
          attempt,
          code: failure.code,
          retryable: failure.retryable,
        };
        if (attempt + 1 >= candidates.length) throw failure;
      }
    }
    throw lastFailure ?? new Error("No model route was available.");
  }
}
