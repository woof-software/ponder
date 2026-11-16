import { custom, HttpRequestError } from "viem";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { context, setupAnvil, setupCommon } from "@/_test/setup.js";
import { simulateBlock } from "@/_test/simulate.js";
import { getChain } from "@/_test/utils.js";
import { createRpc, sanitizeLogTopics } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("createRpc()", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await rpc.request({ method: "eth_blockNumber" });
});

test("createRpc() handles rate limiting", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Too Many Requests" }), {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Content-Type": "application/json" },
    }),
  );

  await rpc.request({ method: "eth_blockNumber" });
});

test("createRpc() raises the rps limit after rate limits", async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });

  let failures = 0;
  const requestsPerSecond = new Map<number, number>();
  const rpc = createRpc({
    common: context.common,
    chain: {
      ...getChain(),
      rpc: custom({
        async request() {
          if (failures > 0) {
            failures--;
            throw new HttpRequestError({ url: "http://rpc", status: 429 });
          }
          const second = Math.floor(Date.now() / 1000);
          requestsPerSecond.set(
            second,
            (requestsPerSecond.get(second) ?? 0) + 1,
          );
          return "0x1";
        },
      }),
    },
  });

  for (let i = 0; i < 3; i++) {
    failures = 8;
    const request = rpc.request({ method: "eth_blockNumber" });
    await vi.advanceTimersByTimeAsync(40_000);
    await request;
  }
  requestsPerSecond.clear();

  for (let i = 0; i < 500; i++) {
    rpc.request({ method: "eth_blockNumber" });
  }
  await vi.advanceTimersByTimeAsync(5_000);

  expect(Math.max(...requestsPerSecond.values())).toBe(5);

  await vi.advanceTimersByTimeAsync(55_000);

  expect(Math.max(...requestsPerSecond.values())).toBeGreaterThan(5);
});

test("createRpc() retry BlockNotFoundError", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await simulateBlock();

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ jsonrpc: "2.0", result: null, id: 1 })),
  );

  const block = await rpc.request(
    { method: "eth_getBlockByNumber", params: ["0x1", true] },
    {
      retryNullBlockRequest: true,
    },
  );

  expect(block).not.toBeNull();
});

test("https://github.com/ponder-sh/ponder/pull/2143", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  let now = Date.now();
  const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  onTestFinished(() => {
    dateSpy.mockRestore();
  });

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 20; j++) {
      await rpc.request({ method: "eth_blockNumber" });
    }
    now += 1000;
  }

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Too Many Requests" }), {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Content-Type": "application/json" },
    }),
  );

  await rpc.request({ method: "eth_blockNumber" });
});

const topic0 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const topic1 =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

test("sanitizeLogTopics removes trailing null values", () => {
  expect(sanitizeLogTopics([topic0, topic1, null, null])).toStrictEqual([
    topic0,
    topic1,
  ]);
});

test("sanitizeLogTopics preserves null wildcards before a topic", () => {
  expect(sanitizeLogTopics([topic0, null, topic1, null])).toStrictEqual([
    topic0,
    null,
    topic1,
  ]);
});

test("sanitizeLogTopics does not mutate the input", () => {
  const topics = [topic0, null, null] as const;

  expect(sanitizeLogTopics(topics)).toStrictEqual([topic0]);
  expect(topics).toStrictEqual([topic0, null, null]);
});

test("sanitizeLogTopics preserves omitted and empty topics", () => {
  expect(sanitizeLogTopics([])).toStrictEqual([]);
  expect(sanitizeLogTopics([null, null])).toStrictEqual([]);
});
