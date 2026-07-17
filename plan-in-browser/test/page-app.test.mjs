import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { PlanningSessionClient } from "../dist/session.js";

async function createPageHarness() {
  const root = await mkdtemp(join(tmpdir(), "planning-page-"));
  const client = new PlanningSessionClient({ root, openBrowser: () => {} });
  const started = await client.start("Page delivery");
  return {
    url: started.url,
    async cleanUp() {
      await client.close(started.sessionId).catch(() => {});
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("the planning page rejects inline JavaScript", { timeout: 10_000 }, async () => {
  const harness = await createPageHarness();
  try {
    const page = await fetch(harness.url);
    const scriptPolicy = page.headers.get("content-security-policy")?.match(/script-src[^;]*/)?.[0];

    assert.deepEqual({ status: page.status, scriptPolicy }, {
      status: 200,
      scriptPolicy: "script-src 'self'",
    });
  } finally {
    await harness.cleanUp();
  }
});

test("the planning page serves its required browser assets", { timeout: 10_000 }, async () => {
  const harness = await createPageHarness();
  try {
    const origin = new URL(harness.url).origin;
    const assets = await Promise.all(
      ["/assets/highlight.min.js", "/assets/app.js", "/assets/highlight-github.min.css"].map(
        async (path) => {
          const response = await fetch(`${origin}${path}`);
          return { path, status: response.status, contentType: response.headers.get("content-type") };
        },
      ),
    );

    assert.deepEqual(assets, [
      { path: "/assets/highlight.min.js", status: 200, contentType: "text/javascript; charset=utf-8" },
      { path: "/assets/app.js", status: 200, contentType: "text/javascript; charset=utf-8" },
      { path: "/assets/highlight-github.min.css", status: 200, contentType: "text/css; charset=utf-8" },
    ]);
  } finally {
    await harness.cleanUp();
  }
});
