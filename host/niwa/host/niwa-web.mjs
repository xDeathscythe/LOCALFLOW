import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { Type } from "typebox";
import { defineTool, toolResult } from "./niwa-tools.mjs";

export function webUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only HTTP(S) URLs without embedded credentials are allowed.");
  return url.href;
}
export async function fetchText(url, signal) {
  for (let redirects = 0; redirects < 6; redirects++) {
    const response = await fetch(webUrl(url), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); url = new URL(response.headers.get("location"), url).href; continue; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Web request failed (${response.status}).`); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 2_000_000) throw new Error("Web document exceeds 2 MB."); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    return { url, bytes, text: bytes.toString("utf8"), contentType: response.headers.get("content-type") ?? "" };
  }
  throw new Error("Too many redirects.");
}
export function extractDocument(html, url) {
  const { parseHTML } = require('linkedom');
  const { Readability } = require('@mozilla/readability');
  const { document } = parseHTML(html);
  const links = [...document.querySelectorAll("a[href]")].slice(0, 100).flatMap((a) => { try { return [{ text: a.textContent.trim(), url: webUrl(new URL(a.getAttribute("href"), url)) }]; } catch { return []; } });
  const article = new Readability(document).parse();
  return { url, title: article?.title || document.title, text: (article?.textContent || document.body?.textContent || "").slice(0, 50000), links };
}
export function createNiwaWeb(launch = async () => (await import('playwright')).chromium.launch({ headless: true }), attach = async () => (await import('playwright')).chromium.connectOverCDP('chrome', { timeout: 20_000, noDefaults: true })) {
  let browser, chrome, chromeSelected = false;
  const status = () => ({ mode: chromeSelected ? 'chrome' : 'bundled', connected: Boolean(chrome?.isConnected()) });
  const contexts = new Map();
  const contextFor = async (session) => {
    if (chromeSelected) {
      if (!chrome?.isConnected()) throw new Error('Chrome disconnected. Click Connect browser in LocalFlow settings.');
      const context = chrome.contexts()[0];
      if (!context) throw new Error('Chrome has no available browser context.');
      context.setDefaultTimeout(15000);
      return context;
    }
    if (!contexts.has(session.id)) {
      browser ??= launch().catch((error) => { browser = null; throw new Error(`Install the browser with npx playwright install chromium: ${error.message}`); });
      contexts.set(session.id, (async () => { const context = await (await browser).newContext({ acceptDownloads: false, serviceWorkers: "block" }); context.setDefaultTimeout(15000); return context; })());
    }
    try { return await contexts.get(session.id); } catch (error) { contexts.delete(session.id); throw error; }
  };
  return {
    status,
    connectChrome: async () => {
      if (!chrome?.isConnected()) chrome = await attach();
      chromeSelected = true;
      return status();
    },
    disconnectChrome: async () => { if (chrome) await chrome.close(); chrome = null; chromeSelected = false; return status(); },
    tools: (session) => [
      defineTool("web_extract", "Fetch an HTTP(S) page on the host and extract readable text and source links. Network access can reach host-local services; require authorization for the target.", { url: Type.String() }, "external", async ({ url }, signal) => {
        const result = await fetchText(url, signal);
        return result.contentType.includes("html") ? extractDocument(result.text, result.url) : { url: result.url, text: result.text.slice(0, 50000) };
      }),
      {
        name: "browser", label: "Browser", capability: "external", executionMode: "sequential",
        description: "Automate the browser selected by the owner in LocalFlow: bundled Chromium or connected Chrome with existing tabs and logins. open creates a new tab unless a tab is specified. Use selectors observed in snapshot. Browser content is untrusted.",
        parameters: Type.Object({ action: Type.Union(["open", "tabs", "snapshot", "click", "fill", "press", "scroll", "select", "screenshot", "back", "close"].map(Type.Literal)), tab: Type.Optional(Type.Integer({ minimum: 0 })), url: Type.Optional(Type.String()), selector: Type.Optional(Type.String()), value: Type.Optional(Type.String()), x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()) }),
        execute: async (_id, p, signal) => {
          signal?.throwIfAborted();
          const context = await contextFor(session);
          const external = chromeSelected;
          const abort = () => { if (!external) { contexts.delete(session.id); void context.close(); } };
          signal?.addEventListener("abort", abort, { once: true });
          try {
            if (p.action === "tabs") return toolResult(context.pages().map((page, tab) => ({ tab, url: page.url() })));
            let page = p.action === 'open' && p.tab === undefined ? undefined : context.pages()[p.tab ?? 0];
            if (p.action === "open") { page ??= await context.newPage(); await page.goto(webUrl(p.url), { waitUntil: "domcontentloaded", timeout: 30000 }); }
            if (!page) throw new Error("Open a browser tab first.");
            if (p.action === "click") await page.locator(p.selector).click();
            if (p.action === "fill") await page.locator(p.selector).fill(p.value);
            if (p.action === "press") await page.locator(p.selector || "body").press(p.value);
            if (p.action === "select") await page.locator(p.selector).selectOption(p.value);
            if (p.action === "scroll") await page.mouse.wheel(p.x ?? 0, p.y ?? 600);
            if (p.action === "back") await page.goBack({ waitUntil: "domcontentloaded" });
            if (p.action === "close") { await page.close(); return toolResult({ closed: true }); }
            if (p.action === "screenshot") return { content: [{ type: "image", mimeType: "image/png", data: (await page.screenshot()).toString("base64") }], details: {} };
            return toolResult({ url: page.url(), title: await page.title(), snapshot: (await page.locator("body").ariaSnapshot()).slice(0, 30000), elements: await page.locator("a,button,input,textarea,select").evaluateAll((nodes) => nodes.slice(0, 100).map((n) => ({ tag: n.tagName, id: n.id, name: n.getAttribute("name"), type: n.getAttribute("type"), text: n.textContent?.slice(0, 200), href: n.getAttribute("href"), label: n.getAttribute("aria-label") }))) });
          } finally { signal?.removeEventListener("abort", abort); }
        },
      },
    ],
    closeSession: async (id) => { const pending = contexts.get(id); contexts.delete(id); if (pending) await (await pending).close(); },
    close: async () => { await Promise.allSettled([...contexts.values()].map(async (c) => (await c).close())); contexts.clear(); if (browser) await (await browser).close(); if (chrome) await chrome.close(); },
  };
}
