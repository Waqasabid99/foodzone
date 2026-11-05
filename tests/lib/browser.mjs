import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A headless browser, driven straight over the DevTools protocol.
 *
 * No test framework, because the questions are narrow: does the page scroll
 * sideways at phone width, did it render anything, and did it throw. All
 * three are things a screenshot will not tell you and nobody notices on a
 * desk monitor.
 *
 * Shared rather than copied into each section's mobile run. A second copy of
 * this would drift, and then two sections would be measuring different
 * things while both reporting "passed".
 */

const PORT = 9333;

/** A minimal CDP client over the built-in WebSocket. */
export function cdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const logs = [];
  let id = 0;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      logs.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
    if (message.method === "Runtime.exceptionThrown") {
      logs.push(message.params.exceptionDetails?.exception?.description ?? "exception");
    }
  });

  const send = async (method, params = {}) => {
    await ready;
    const messageId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
  };

  return { send, logs, close: () => socket.close(), ready };
}

/**
 * Chrome at a phone's viewport, already carrying the session cookies.
 *
 * Returns the client and a `close` that tears down both the socket and the
 * profile directory. Chrome is still flushing its profile when it is
 * signalled, so removal is retried and a failure to tidy is not a failure of
 * the run.
 */
export async function openPhone({ cookies = [], width = 390, height = 844, domain = "localhost" } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "fz-mobile-"));
  const chrome = spawn(
    "google-chrome",
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    } catch {
      targets = null;
    }
  }
  if (!targets?.length) throw new Error("chrome never came up");

  const client = cdp(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await client.ready;
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });

  for (const cookie of cookies) {
    await client.send("Network.setCookie", { name: cookie.name, value: cookie.value, domain, path: "/" });
  }

  return {
    client,
    width,
    async close() {
      client.close();
      chrome.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
    },
  };
}

/** Session cookies from a login response, in the shape `openPhone` wants. */
export function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((line) => {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    return { name: pair.slice(0, index), value: pair.slice(index + 1) };
  });
}

/**
 * Visits each page and asks the three questions.
 *
 * The overflow check names the element that is poking out, because "this page
 * scrolls sideways" is a bug report nobody can act on and "this table is
 * 40px too wide" is a fix.
 */
export async function checkPages({ phone, base, screens, check, settle = 1400 }) {
  const { client, width } = phone;

  for (const path of screens) {
    client.logs.length = 0;
    await client.send("Page.navigate", { url: `${base}${path}` });
    await new Promise((resolve) => setTimeout(resolve, settle));

    const { result } = await client.send("Runtime.evaluate", {
      expression: `
        (() => {
          const doc = document.scrollingElement;
          const overflow = doc.scrollWidth - window.innerWidth;
          let culprit = null;
          if (overflow > 1) {
            for (const node of document.querySelectorAll("body *")) {
              const box = node.getBoundingClientRect();
              if (box.right > window.innerWidth + 1 && box.width > 0) {
                culprit = node.tagName.toLowerCase() + "." + String(node.className).split(" ").slice(0, 3).join(".");
                break;
              }
            }
          }
          return JSON.stringify({ overflow, culprit, body: document.body.innerText.length });
        })()
      `,
      returnByValue: true,
    });

    const info = JSON.parse(result.value);
    check(`${path} has no sideways scroll at ${width}px`, info.overflow <= 1, info);
    check(`${path} rendered content`, info.body > 200, { length: info.body });
    const errors = client.logs.filter((line) => !/favicon|404 \(Not Found\)/i.test(line));
    check(`${path} threw nothing`, errors.length === 0, errors.slice(0, 2));
  }
}
