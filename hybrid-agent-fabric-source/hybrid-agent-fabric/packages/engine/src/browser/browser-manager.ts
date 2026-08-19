import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { assertSafeUrl } from "../capabilities/web.js";

export interface BrowserManagerOptions {
  cdpEndpoint?: string;
  executablePath?: string;
  headless?: boolean;
  navigationTimeoutMs?: number;
  allowPrivateCdpEndpoint?: boolean;
}

interface ElementRef {
  selector: string;
  index: number;
  tag: string;
  role?: string;
  name?: string;
}

interface SessionBrowser {
  context: BrowserContext;
  page: Page;
  refs: Map<string, ElementRef>;
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  elements: Array<{ ref: string; tag: string; role?: string; name?: string; type?: string; href?: string }>;
}

export class BrowserManager {
  private browser: Browser | undefined;
  private readonly sessions = new Map<string, SessionBrowser>();

  constructor(private readonly options: BrowserManagerOptions) {}

  get configured(): boolean {
    return Boolean(this.options.cdpEndpoint || this.options.executablePath);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.options.cdpEndpoint) {
      const endpoint = this.options.allowPrivateCdpEndpoint
        ? new URL(this.options.cdpEndpoint)
        : await assertSafeUrl(this.options.cdpEndpoint);
      if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:" && endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
        throw new Error("CDP endpoint must use HTTP(S) or WS(S).");
      }
      this.browser = await chromium.connectOverCDP(endpoint.toString(), { timeout: 15_000 });
    } else if (this.options.executablePath) {
      this.browser = await chromium.launch({
        executablePath: this.options.executablePath,
        headless: this.options.headless ?? true,
        args: ["--disable-dev-shm-usage", "--no-first-run", "--disable-background-networking"],
      });
    } else throw new Error("Browser automation is not configured. Set HAF_BROWSER_CDP_ENDPOINT or HAF_BROWSER_EXECUTABLE_PATH.");
    return this.browser;
  }

  private async session(sessionId: string): Promise<SessionBrowser> {
    const existing = this.sessions.get(sessionId);
    if (existing && !existing.page.isClosed()) return existing;
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1000 },
    });
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        await route.continue();
        return;
      }
      try {
        await assertSafeUrl(url);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(this.options.navigationTimeoutMs ?? 30_000);
    const state: SessionBrowser = { context, page, refs: new Map() };
    this.sessions.set(sessionId, state);
    return state;
  }

  async navigate(sessionId: string, rawUrl: string): Promise<BrowserSnapshot> {
    const url = await assertSafeUrl(rawUrl);
    const state = await this.session(sessionId);
    await state.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    // Revalidate the final redirect URL against private-network targets.
    await assertSafeUrl(state.page.url());
    return await this.snapshot(sessionId);
  }

  async snapshot(sessionId: string, maxTextChars = 50_000, maxElements = 200): Promise<BrowserSnapshot> {
    const state = await this.session(sessionId);
    const bodyText = await state.page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
    state.refs.clear();
    const selector = "a,button,input,textarea,select,[role='button'],[role='link'],[contenteditable='true']";
    const locator = state.page.locator(selector);
    const count = Math.min(await locator.count(), maxElements);
    const elements: BrowserSnapshot["elements"] = [];
    for (let index = 0; index < count; index++) {
      const item = locator.nth(index);
      if (!(await item.isVisible().catch(() => false))) continue;
      const data = await item.evaluate((element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || undefined,
        name: element.getAttribute("aria-label") || element.getAttribute("name") || (element.textContent || "").trim().slice(0, 200) || undefined,
        type: element.getAttribute("type") || undefined,
        href: element.getAttribute("href") || undefined,
      }));
      const ref = `e${elements.length}`;
      state.refs.set(ref, { selector, index, tag: data.tag, ...(data.role ? { role: data.role } : {}), ...(data.name ? { name: data.name } : {}) });
      elements.push({
        ref,
        tag: data.tag,
        ...(data.role ? { role: data.role } : {}),
        ...(data.name ? { name: data.name } : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.href ? { href: data.href } : {}),
      });
    }
    return {
      url: state.page.url(),
      title: await state.page.title(),
      text: bodyText.slice(0, maxTextChars),
      truncated: bodyText.length > maxTextChars,
      elements,
    };
  }

  private async locatorFor(sessionId: string, ref: string) {
    const state = await this.session(sessionId);
    const target = state.refs.get(ref);
    if (!target) throw new Error(`Unknown or stale browser element ref ${ref}; take a fresh snapshot.`);
    return state.page.locator(target.selector).nth(target.index);
  }

  async click(sessionId: string, ref: string): Promise<BrowserSnapshot> {
    const locator = await this.locatorFor(sessionId, ref);
    await locator.click();
    return await this.snapshot(sessionId);
  }

  async type(sessionId: string, ref: string, text: string, submit = false): Promise<BrowserSnapshot> {
    const locator = await this.locatorFor(sessionId, ref);
    await locator.fill(text);
    if (submit) await locator.press("Enter");
    return await this.snapshot(sessionId);
  }

  async press(sessionId: string, key: string): Promise<BrowserSnapshot> {
    const state = await this.session(sessionId);
    await state.page.keyboard.press(key);
    return await this.snapshot(sessionId);
  }

  async clickAt(sessionId: string, x: number, y: number, button: "left" | "right" | "middle" = "left"): Promise<BrowserSnapshot> {
    const state = await this.session(sessionId);
    await state.page.mouse.click(x, y, { button });
    return await this.snapshot(sessionId);
  }

  async typeText(sessionId: string, text: string, delayMs = 0): Promise<BrowserSnapshot> {
    const state = await this.session(sessionId);
    await state.page.keyboard.type(text, { delay: delayMs });
    return await this.snapshot(sessionId);
  }

  async scroll(sessionId: string, deltaX: number, deltaY: number): Promise<BrowserSnapshot> {
    const state = await this.session(sessionId);
    await state.page.mouse.wheel(deltaX, deltaY);
    return await this.snapshot(sessionId);
  }

  async screenshot(sessionId: string, workspacePath: string, requestedPath: string): Promise<{ path: string; bytes: number }> {
    const root = resolve(workspacePath);
    const target = resolve(root, requestedPath);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error("Screenshot path escapes the workspace.");
    await mkdir(dirname(target), { recursive: true });
    const state = await this.session(sessionId);
    const bytes = await state.page.screenshot({ path: target, fullPage: true, type: "png" });
    return { path: requestedPath, bytes: bytes.length };
  }

  async closeSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    await state.context.close();
    this.sessions.delete(sessionId);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id)));
    await this.browser?.close();
    this.browser = undefined;
  }
}
