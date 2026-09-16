import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import axios from "axios";
import crypto from "crypto";
import * as shoptetClient from "./index";
import { createShoptetClient, Result } from "./index";
import type { ShoptetClient, ShoptetCredentials } from "./index";

// ── Mock axios ───────────────────────────────────────────────

vi.mock("axios", () => ({ default: { create: vi.fn(), isAxiosError: vi.fn() } }));
const mockedAxios = axios as any;

const fakeAxiosInstance = {
  post: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  defaults: { headers: { common: {} } },
  interceptors: {
    response: { use: vi.fn() },
  },
};

const credentials: ShoptetCredentials = {
  oauthAccessToken: "test-token-123",
  apiUrl: "https://api.myshop.shoptet.com",
  webhookSecret: "my-webhook-secret",
};

function makeClient() {
  return createShoptetClient(credentials);
}

// ── Tests ────────────────────────────────────────────────────

describe("ShoptetClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.create.mockReturnValue(fakeAxiosInstance as any);
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is any =>
        !!(error && typeof error === "object" && (error as any).isAxiosError === true)
    );
  });

  describe("constructor", () => {
    it("exposes the documented public entrypoint", () => {
      expect(typeof shoptetClient.createShoptetClient).toBe("function");
      expect(shoptetClient.Result).toBe(Result);
    });

    it("creates axios instance with correct base URL and token", () => {
      makeClient();

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "https://api.myshop.shoptet.com",
          headers: expect.objectContaining({
            "Shoptet-Private-API-Token": "test-token-123",
            "Content-Type": "application/vnd.shoptet.v1.0+json",
          }),
        })
      );
    });

    it("throws when apiUrl does not use HTTPS", () => {
      expect(() => createShoptetClient({ ...credentials, apiUrl: "http://api.myshop.shoptet.com" }))
        .toThrow("apiUrl must use HTTPS");
    });

    it("throws when apiUrl is not a valid URL", () => {
      expect(() => createShoptetClient({ ...credentials, apiUrl: "not-a-url" }))
        .toThrow("not a valid URL");
    });

    it("throws when apiUrl contains embedded credentials", () => {
      expect(() => createShoptetClient({ ...credentials, apiUrl: "https://user:pass@api.myshop.shoptet.com" }))
        .toThrow("must not contain credentials");
    });

    it("accepts valid HTTPS URL", () => {
      expect(() => makeClient()).not.toThrow();
    });

    it("throws when oauthAccessToken is empty", () => {
      expect(() => createShoptetClient({ ...credentials, oauthAccessToken: "" }))
        .toThrow("oauthAccessToken must not be empty");
    });

    it("throws when webhookSecret is empty", () => {
      expect(() => createShoptetClient({ ...credentials, webhookSecret: "" }))
        .toThrow("webhookSecret must not be empty");
    });

    it("throws when maxBatchSize is zero", () => {
      expect(() => createShoptetClient(credentials, { maxBatchSize: 0 }))
        .toThrow("maxBatchSize must be a positive integer");
    });

    it("throws when maxBatchSize is negative", () => {
      expect(() => createShoptetClient(credentials, { maxBatchSize: -1 }))
        .toThrow("maxBatchSize must be a positive integer");
    });

    it("throws when maxBatchSize is not an integer", () => {
      expect(() => createShoptetClient(credentials, { maxBatchSize: 1.5 }))
        .toThrow("maxBatchSize must be a positive integer");
    });

    it("registers response interceptor that scrubs the API token from errors", () => {
      makeClient();

      expect(fakeAxiosInstance.interceptors.response.use).toHaveBeenCalledWith(
        undefined,
        expect.any(Function)
      );

      const [, errorHandler] = (fakeAxiosInstance.interceptors.response.use as unknown as Mock).mock.calls[0] as [unknown, (e: unknown) => Promise<unknown>];
      const headers = {
        "Shoptet-Private-API-Token": "secret" as string | undefined,
        "Content-Type": "application/json",
        delete(key: string) { delete (this as Record<string, unknown>)[key]; },
      };
      const fakeError = { isAxiosError: true, config: { headers } };

      errorHandler(fakeError).catch(() => {});

      expect(fakeError.config.headers["Shoptet-Private-API-Token"]).toBeUndefined();
      expect(fakeError.config.headers["Content-Type"]).toBe("application/json");
    });

    it("scrubs lowercase token headers from plain-object error configs", () => {
      makeClient();

      const [, errorHandler] = (fakeAxiosInstance.interceptors.response.use as unknown as Mock).mock.calls[0] as [unknown, (e: unknown) => Promise<unknown>];
      const fakeError = {
        isAxiosError: true,
        config: {
          headers: {
            "shoptet-private-api-token": "secret",
            "content-type": "application/json",
          },
        },
      };

      errorHandler(fakeError).catch(() => {});

      expect(fakeError.config.headers["shoptet-private-api-token"]).toBeUndefined();
      expect(fakeError.config.headers["content-type"]).toBe("application/json");
    });

    it("keeps rejecting axios errors even when headers are missing", async () => {
      makeClient();

      const [, errorHandler] = (fakeAxiosInstance.interceptors.response.use as unknown as Mock).mock.calls[0] as [unknown, (e: unknown) => Promise<unknown>];
      const fakeError = {
        isAxiosError: true,
        config: {},
      };

      await expect(errorHandler(fakeError)).rejects.toBe(fakeError);
    });
  });

  // ── validateWebhookSignature ───────────────────────────────

  describe("validateWebhookSignature()", () => {
    it("returns true for valid signature", () => {
      const client = makeClient();
      const payload = '{"event":"order:create","eventInstance":"OBJ-001"}';

      const expectedSig = crypto
        .createHmac("sha1", "my-webhook-secret")
        .update(payload)
        .digest("hex");

      expect(client.validateWebhookSignature(payload, expectedSig)).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const client = makeClient();
      const payload = '{"event":"order:create"}';

      expect(client.validateWebhookSignature(payload, "invalid-signature-hex")).toBe(false);
    });

    it("returns false when signature length differs", () => {
      const client = makeClient();
      const payload = "test";

      expect(client.validateWebhookSignature(payload, "short")).toBe(false);
    });

    it("wraps non-Error thrown values in Error", async () => {
      fakeAxiosInstance.get.mockRejectedValueOnce("raw string thrown");

      const client = makeClient();
      const result = await client.getOrder("OBJ-001");

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("raw string thrown");
    });

    it("is resistant to different payloads with same length", () => {
      const client = makeClient();
      const payload1 = '{"a":"1"}';
      const payload2 = '{"b":"2"}';

      const sig1 = crypto
        .createHmac("sha1", "my-webhook-secret")
        .update(payload1)
        .digest("hex");

      expect(client.validateWebhookSignature(payload2, sig1)).toBe(false);
    });
  });

  // ── getOrder ───────────────────────────────────────────────

  describe("getOrder()", () => {
    it("fetches order by code", async () => {
      const mockOrder = { code: "OBJ-001", guid: "guid-1" };
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: { order: mockOrder }, errors: null },
      });

      const client = makeClient();
      const result = await client.getOrder("OBJ-001");

      expect(fakeAxiosInstance.get).toHaveBeenCalledWith("/api/orders/OBJ-001");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data).toEqual(mockOrder);
    });

    it("returns error Result on API errors in response body", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: {
          data: null,
          errors: [{ errorCode: "404", instance: "", message: "Order not found" }],
        },
      });

      const client = makeClient();
      const result = await client.getOrder("NONEXISTENT");

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("Order not found");
    });

    it("tolerates malformed error entries in HTTP error responses", async () => {
      fakeAxiosInstance.get.mockRejectedValueOnce({
        isAxiosError: true,
        message: "Request failed with status code 400",
        response: { status: 400, data: { errors: [null, { message: 42 }, { message: "Bad code" }] } },
      });

      const client = makeClient();
      const result = await client.getOrder("OBJ-001");

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toBe("Shoptet API error (400): Unknown error, Unknown error, Bad code");
    });

    it("returns error Result on HTTP failure", async () => {
      fakeAxiosInstance.get.mockRejectedValueOnce(new Error("network error"));

      const client = makeClient();
      const result = await client.getOrder("OBJ-001");

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("network error");
    });

    it("returns error Result when response is missing order data", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: {}, errors: null },
      });

      const client = makeClient();
      const result = await client.getOrder("OBJ-001");

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("no order data");
    });
  });

  // ── getDefaultStockId ──────────────────────────────────────

  describe("getDefaultStockId()", () => {
    it("fetches and returns first stock ID", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: { stocks: [{ id: 42, title: "Hlavní sklad" }] } },
      });

      const client = makeClient();
      const result = await client.getDefaultStockId();

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data).toBe(42);
      expect(fakeAxiosInstance.get).toHaveBeenCalledWith("/api/stocks");
    });

    it("caches stock ID across calls", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: { stocks: [{ id: 42, title: "Sklad" }] } },
      });

      const client = makeClient();
      await client.getDefaultStockId();
      const result2 = await client.getDefaultStockId();

      expect(Result.isOk(result2)).toBe(true);
      if (!Result.isOk(result2)) throw new Error("unexpected");
      expect(result2.data).toBe(42);
      // Should only call API once
      expect(fakeAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it("returns error Result when no stocks found", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: { stocks: [] } },
      });

      const client = makeClient();
      const result = await client.getDefaultStockId();

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("No stocks");
    });

    it("returns error Result when stocks is null", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: { stocks: null } },
      });

      const client = makeClient();
      const result = await client.getDefaultStockId();

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("No stocks");
    });
  });

  // ── batchUpdateStock ───────────────────────────────────────

  describe("batchUpdateStock()", () => {
    beforeEach(() => {
      // Pre-cache stock ID so it doesn't call get
      fakeAxiosInstance.get.mockResolvedValue({
        data: { data: { stocks: [{ id: 1, title: "S" }] } },
      });
    });

    it("returns ok with zero counts for empty array", async () => {
      const client = makeClient();
      const result = await client.batchUpdateStock([]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data).toEqual({ success: 0, failed: 0, errors: [] });
    });

    it("returns error when items exceed maxBatchSize", async () => {
      const client = createShoptetClient(credentials, { maxBatchSize: 2 });
      const items = [
        { productCode: "A", quantity: 1 },
        { productCode: "B", quantity: 1 },
        { productCode: "C", quantity: 1 },
      ];

      const result = await client.batchUpdateStock(items);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("3 > 2");
    });

    it("returns error when quantity is not finite", async () => {
      const client = makeClient();

      const result = await client.batchUpdateStock([
        { productCode: "A", quantity: Number.NaN },
      ]);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("invalid quantity");
    });

    it("sends PATCH with product codes and quantities", async () => {
      fakeAxiosInstance.patch.mockResolvedValueOnce({
        data: { errors: null },
      });

      const client = makeClient();
      // Warm the cache
      await client.getDefaultStockId();

      const result = await client.batchUpdateStock([
        { productCode: "A", quantity: 10 },
        { productCode: "B", quantity: 20 },
      ]);

      expect(fakeAxiosInstance.patch).toHaveBeenCalledWith(
        "/api/stocks/1/movements",
        {
          data: [
            { productCode: "A", quantity: 10 },
            { productCode: "B", quantity: 20 },
          ],
        }
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(2);
      expect(result.data.failed).toBe(0);
    });

    it("reports per-item errors from response", async () => {
      fakeAxiosInstance.patch.mockResolvedValueOnce({
        data: {
          errors: [
            { instance: "A", message: "Product not found" },
          ],
        },
      });

      const client = makeClient();
      await client.getDefaultStockId();

      const result = await client.batchUpdateStock([
        { productCode: "A", quantity: 10 },
        { productCode: "B", quantity: 20 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(1);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].code).toBe("A");
    });

    it("never reports more failures than items sent", async () => {
      fakeAxiosInstance.patch.mockResolvedValueOnce({
        data: {
          errors: [
            { instance: "A", message: "Product not found" },
            { instance: "A", message: "Duplicate movement" },
          ],
        },
      });

      const client = makeClient();
      await client.getDefaultStockId();

      const result = await client.batchUpdateStock([{ productCode: "A", quantity: 10 }]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(0);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors).toHaveLength(2);
    });

    it("handles full failure on network error", async () => {
      fakeAxiosInstance.patch.mockRejectedValueOnce(new Error("Network error"));

      const client = makeClient();
      await client.getDefaultStockId();

      const result = await client.batchUpdateStock([
        { productCode: "A", quantity: 10 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(0);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].error).toContain("Network error");
    });

    it("falls back to 'Unknown error' in catch when error has no message", async () => {
      fakeAxiosInstance.patch.mockRejectedValueOnce({ isAxiosError: true, message: "", response: undefined });

      const client = makeClient();
      await client.getDefaultStockId();

      const result = await client.batchUpdateStock([
        { productCode: "A", quantity: 10 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(0);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].error).toBe("Unknown error");
    });

    it("extracts error message from response data when available", async () => {
      const error = {
        isAxiosError: true,
        message: "Request failed",
        response: {
          status: 429,
          data: {
            errors: [{ message: "Rate limit exceeded" }],
          },
        },
      };
      fakeAxiosInstance.patch.mockRejectedValueOnce(error);

      const client = makeClient();
      await client.getDefaultStockId();

      const result = await client.batchUpdateStock([
        { productCode: "A", quantity: 10 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.errors[0].error).toContain("Rate limit exceeded");
    });

    it("falls back to 'unknown' when error instance is missing", async () => {
      fakeAxiosInstance.patch.mockResolvedValueOnce({
        data: {
          errors: [{ message: "Some error" }],
        },
      });

      const client = makeClient();
      await client.getDefaultStockId();

      const result = await client.batchUpdateStock([
        { productCode: "A", quantity: 10 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].code).toBe("unknown");
      expect(result.data.errors[0].error).toBe("Some error");
    });

    it("falls back to 'Unknown error' when error message is missing", async () => {
      fakeAxiosInstance.patch.mockResolvedValueOnce({
        data: {
          errors: [{ instance: "PROD-X" }],
        },
      });

      const client = makeClient();
      await client.getDefaultStockId();

      const result = await client.batchUpdateStock([
        { productCode: "A", quantity: 10 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].code).toBe("PROD-X");
      expect(result.data.errors[0].error).toBe("Unknown error");
    });
  });

  // ── getDefaultPricelistId ──────────────────────────────────

  describe("getDefaultPricelistId()", () => {
    it("fetches and returns first pricelist ID", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: { priceLists: [{ id: 7, name: "Základní" }] } },
      });

      const client = makeClient();
      const result = await client.getDefaultPricelistId();

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data).toBe(7);
    });

    it("supports alternative 'pricelists' key", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: { pricelists: [{ id: 8, name: "Alt" }] } },
      });

      const client = makeClient();
      const result = await client.getDefaultPricelistId();

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data).toBe(8);
    });

    it("caches pricelist ID", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: { priceLists: [{ id: 7, name: "Z" }] } },
      });

      const client = makeClient();
      await client.getDefaultPricelistId();
      const result2 = await client.getDefaultPricelistId();

      expect(Result.isOk(result2)).toBe(true);
      if (!Result.isOk(result2)) throw new Error("unexpected");
      expect(result2.data).toBe(7);
      expect(fakeAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it("returns error Result when no pricelists found", async () => {
      fakeAxiosInstance.get.mockResolvedValueOnce({
        data: { data: { priceLists: [] } },
      });

      const client = makeClient();
      const result = await client.getDefaultPricelistId();

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("No pricelists");
    });
  });

  // ── batchUpdatePrices ──────────────────────────────────────

  describe("batchUpdatePrices()", () => {
    beforeEach(() => {
      fakeAxiosInstance.get.mockResolvedValue({
        data: { data: { priceLists: [{ id: 5, name: "P" }] } },
      });
    });

    it("returns ok with zero counts for empty array", async () => {
      const client = makeClient();
      const result = await client.batchUpdatePrices([]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data).toEqual({ success: 0, failed: 0, errors: [] });
    });

    it("returns error for negative price", async () => {
      const client = makeClient();
      const result = await client.batchUpdatePrices([{ code: "A", price: -1 }]);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("invalid price");
    });

    it("returns error for NaN price", async () => {
      const client = makeClient();
      const result = await client.batchUpdatePrices([{ code: "A", price: NaN }]);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("invalid price");
    });

    it("returns error when items exceed maxBatchSize", async () => {
      const client = createShoptetClient(credentials, { maxBatchSize: 1 });
      const items = [
        { code: "A", price: 100 },
        { code: "B", price: 200 },
      ];

      const result = await client.batchUpdatePrices(items);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("2 > 1");
    });

    it("sends PATCH with correct price format", async () => {
      fakeAxiosInstance.patch.mockResolvedValueOnce({
        data: { errors: null },
      });

      const client = makeClient();
      await client.getDefaultPricelistId();

      const result = await client.batchUpdatePrices([
        { code: "PROD-1", price: 199.9 },
      ]);

      expect(fakeAxiosInstance.patch).toHaveBeenCalledWith(
        "/api/pricelists/5",
        {
          data: [
            {
              code: "PROD-1",
              includingVat: true,
              price: { price: "199.90" },
            },
          ],
        }
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(1);
      expect(result.data.failed).toBe(0);
    });

    it("reports per-item errors", async () => {
      fakeAxiosInstance.patch.mockResolvedValueOnce({
        data: {
          errors: [{ instance: "X", message: "Invalid code" }],
        },
      });

      const client = makeClient();
      await client.getDefaultPricelistId();

      const result = await client.batchUpdatePrices([
        { code: "X", price: 100 },
        { code: "Y", price: 200 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(1);
      expect(result.data.failed).toBe(1);
    });

    it("handles full failure on error", async () => {
      fakeAxiosInstance.patch.mockRejectedValueOnce(new Error("timeout"));

      const client = makeClient();
      await client.getDefaultPricelistId();

      const result = await client.batchUpdatePrices([
        { code: "A", price: 100 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(0);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].error).toBe("timeout");
    });

    it("falls back to 'Unknown error' in catch when error has no message", async () => {
      fakeAxiosInstance.patch.mockRejectedValueOnce({ isAxiosError: true, message: "", response: undefined });

      const client = makeClient();
      await client.getDefaultPricelistId();

      const result = await client.batchUpdatePrices([
        { code: "A", price: 100 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(0);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].error).toBe("Unknown error");
    });

    it("uses error.message when response errors are missing", async () => {
      const err = { isAxiosError: true, message: "Connection refused", response: { data: {} } };
      fakeAxiosInstance.patch.mockRejectedValueOnce(err);

      const client = makeClient();
      await client.getDefaultPricelistId();

      const result = await client.batchUpdatePrices([
        { code: "B", price: 50 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(0);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].error).toBe("Connection refused");
    });

    it("falls back to 'unknown' when price error instance is missing", async () => {
      fakeAxiosInstance.patch.mockResolvedValueOnce({
        data: {
          errors: [{ message: "Price error" }],
        },
      });

      const client = makeClient();
      await client.getDefaultPricelistId();

      const result = await client.batchUpdatePrices([
        { code: "A", price: 100 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].code).toBe("unknown");
      expect(result.data.errors[0].error).toBe("Price error");
    });

    it("falls back to 'Unknown error' when price error message is missing", async () => {
      fakeAxiosInstance.patch.mockResolvedValueOnce({
        data: {
          errors: [{ instance: "PROD-Y" }],
        },
      });

      const client = makeClient();
      await client.getDefaultPricelistId();

      const result = await client.batchUpdatePrices([
        { code: "A", price: 100 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0].code).toBe("PROD-Y");
      expect(result.data.errors[0].error).toBe("Unknown error");
    });

    it("returns all items as failed when pricelist ID fetch fails", async () => {
      fakeAxiosInstance.get.mockRejectedValueOnce(new Error("No pricelists"));

      const client = makeClient();
      const result = await client.batchUpdatePrices([
        { code: "A", price: 100 },
        { code: "B", price: 200 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(0);
      expect(result.data.failed).toBe(2);
      expect(result.data.errors[0].code).toBe("A");
      expect(result.data.errors[1].code).toBe("B");
    });
  });

  // ── createOrder ────────────────────────────────────────────

  describe("createOrder()", () => {
    it("creates order and returns it", async () => {
      const mockOrder = { code: "OBJ-001", guid: "guid-1" };
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: { data: { order: mockOrder }, errors: null },
      });

      const client = makeClient();
      const result = await client.createOrder({ externalCode: "EXT-001" } as any);

      expect(fakeAxiosInstance.post).toHaveBeenCalledWith(
        "/api/orders",
        { data: { externalCode: "EXT-001" } }
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data).toEqual(mockOrder);
    });

    it("appends suppress flags as query params", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: { data: { order: {} }, errors: null },
      });

      const client = makeClient();
      await client.createOrder({} as any, {
        suppressEmailSending: true,
        suppressDocumentGeneration: true,
      });

      const [url] = (fakeAxiosInstance.post as unknown as Mock).mock.calls[0] as [string, unknown];
      expect(url).toContain("suppressEmailSending=true");
      expect(url).toContain("suppressDocumentGeneration=true");
    });

    it("omits query string when no flags are set", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: { data: { order: {} }, errors: null },
      });

      const client = makeClient();
      await client.createOrder({} as any, {});

      const [url] = (fakeAxiosInstance.post as unknown as Mock).mock.calls[0] as [string, unknown];
      expect(url).toBe("/api/orders");
    });

    it("returns error Result on API-level errors in response", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: { data: null, errors: [{ message: "Invalid order data" }] },
      });

      const client = makeClient();
      const result = await client.createOrder({} as any);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("Invalid order data");
    });

    it("returns error Result on network failure", async () => {
      fakeAxiosInstance.post.mockRejectedValueOnce(new Error("timeout"));

      const client = makeClient();
      const result = await client.createOrder({} as any);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("timeout");
    });

    it("returns error Result when created order is missing in response", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: { data: {}, errors: null },
      });

      const client = makeClient();
      const result = await client.createOrder({} as any);

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("no order data");
    });
  });

  // ── batchUpdateStock — stockId fetch fails ─────────────────

  describe("batchUpdateStock() — stockId fetch fails", () => {
    it("returns all items as failed when stock ID fetch fails", async () => {
      fakeAxiosInstance.get.mockRejectedValueOnce(new Error("stocks unavailable"));

      const client = makeClient();
      const result = await client.batchUpdateStock([
        { productCode: "A", quantity: 1 },
        { productCode: "B", quantity: 2 },
      ]);

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(0);
      expect(result.data.failed).toBe(2);
      expect(result.data.errors[0].code).toBe("A");
      expect(result.data.errors[1].code).toBe("B");
    });
  });
});
