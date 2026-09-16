import axios, { AxiosInstance, AxiosResponse } from "axios";
import crypto from "node:crypto";
import { Result } from "@vencav/result";
import type { CreateOrderOptions, CreateOrderRequest, ShoptetApiResponse, ShoptetOrder } from "./types";

export interface ShoptetCredentials {
  readonly oauthAccessToken: string;
  readonly apiUrl: string;
  readonly webhookSecret: string;
}

export interface ShoptetClientOptions {
  /** Maximum items per batch request. Shoptet API hard limit is 300. Default: 300. */
  readonly maxBatchSize?: number;
  /** Request timeout in milliseconds. Default: 30000. */
  readonly timeoutMs?: number;
}

export type BatchUpdateResult = {
  readonly success: number;
  readonly failed: number;
  readonly errors: ReadonlyArray<{ readonly code: string; readonly error: string }>;
};

export type ShoptetClient = ReturnType<typeof createShoptetClient>;

const SHOPTET_API_BATCH_LIMIT = 300;
const SHOPTET_API_TIMEOUT_MS = 30_000;

const SUPPRESS_FLAGS = [
  "suppressDocumentGeneration",
  "suppressEmailSending",
  "suppressProductChecking",
  "suppressStockMovements",
  "suppressHistoricalMandatoryFields",
  "suppressHistoricalPaymentChecking",
  "suppressHistoricalShippingChecking",
] as const satisfies ReadonlyArray<keyof CreateOrderOptions>;

// ── Validation helpers ──────────────────────────────────────

const requireNonEmpty = (ctx: string, value: string, name: string): void => {
  if (!value) throw new Error(`${ctx}: ${name} must not be empty`);
};

const resolvePositiveInt = (ctx: string, value: number | undefined, fallback: number, name: string): number => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${ctx}: ${name} must be a positive integer`);
  }
  return resolved;
};

const validateHttpsUrl = (ctx: string, raw: string, fieldName = "url"): void => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${ctx}: ${fieldName} is not a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${ctx}: ${fieldName} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${ctx}: ${fieldName} must not contain credentials`);
};

// ── Core API helper ─────────────────────────────────────────

const apiCall = async <T>(promise: Promise<AxiosResponse<T>>): Promise<Result<T>> => {
  try {
    return Result.ok((await promise).data);
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const apiErrors = error.response?.data?.errors;
      if (Array.isArray(apiErrors) && apiErrors.length > 0) {
        const msg = joinMessages(apiErrors);
        return Result.error(new Error(`Shoptet API error (${error.response?.status}): ${msg}`));
      }
      return Result.error(new Error(error.message || "Unknown error"));
    }
    return Result.error(error instanceof Error ? error : new Error(String(error)));
  }
};

// ── Shared helpers ──────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const joinMessages = (errors: ReadonlyArray<unknown>): string =>
  errors
    .map((e) => (isRecord(e) && typeof e.message === "string" && e.message ? e.message : "Unknown error"))
    .join(", ");

/** Builds the batch summary; per-item errors reported by the API never exceed the number of items sent. */
const summarizeBatch = (
  itemCount: number,
  errors: Array<{ code: string; error: string }>
): BatchUpdateResult => {
  const failed = Math.min(errors.length, itemCount);
  return { success: itemCount - failed, failed, errors };
};

const parseResponseErrors = (
  raw: Array<{ instance?: string; message?: string }> | null | undefined
): Array<{ code: string; error: string }> =>
  (raw ?? []).map((e) => ({ code: e.instance ?? "unknown", error: e.message ?? "Unknown error" }));

const buildSuppressParams = (options: CreateOrderOptions): URLSearchParams => {
  const params = new URLSearchParams();
  for (const flag of SUPPRESS_FLAGS) {
    if (options[flag]) params.set(flag, "true");
  }
  return params;
};

const scrubSensitiveHeaders = (headers: unknown): void => {
  if (!headers || typeof headers !== "object") return;

  const axiosHeaders = headers as { delete?: (name: string) => void };
  if (typeof axiosHeaders.delete === "function") {
    axiosHeaders.delete("Shoptet-Private-API-Token");
    return;
  }

  const headerEntries = Object.keys(headers as Record<string, unknown>);
  for (const key of headerEntries) {
    if (key.toLowerCase() === "shoptet-private-api-token") {
      delete (headers as Record<string, unknown>)[key];
    }
  }
};

// ── Pure API functions ──────────────────────────────────────

const checkWebhookSignature = (secret: string, payload: string, signature: string): boolean => {
  const expected = crypto.createHmac("sha1", secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Uint8Array.from(Buffer.from(signature, "hex")),
      Uint8Array.from(Buffer.from(expected, "hex"))
    );
  } catch {
    return false;
  }
};

const fetchOrder = async (client: AxiosInstance, orderCode: string): Promise<Result<ShoptetOrder>> => {
  const result = await apiCall(
    client.get<ShoptetApiResponse<{ order: ShoptetOrder }>>(`/api/orders/${encodeURIComponent(orderCode)}`)
  );
  if (Result.isError(result)) return result;
  if (result.data.errors?.length) {
    const msg = joinMessages(result.data.errors);
    return Result.error(new Error(`Shoptet API error: ${msg}`));
  }
  const order = result.data.data?.order;
  if (!order) {
    return Result.error(new Error("Shoptet API returned no order data"));
  }
  return Result.ok(order);
};

const fetchStockId = async (client: AxiosInstance): Promise<Result<number>> => {
  const result = await apiCall(
    client.get<{ data: { stocks: Array<{ id: number; title: string }> } }>("/api/stocks")
  );
  if (Result.isError(result)) return result;
  const stocks = result.data.data?.stocks;
  if (!stocks || stocks.length === 0) {
    return Result.error(new Error("No stocks (warehouses) found in Shoptet"));
  }
  return Result.ok(stocks[0].id);
};

const fetchPricelistId = async (client: AxiosInstance): Promise<Result<number>> => {
  const result = await apiCall(
    client.get<{
      data: {
        priceLists?: Array<{ id: number; name: string }>;
        pricelists?: Array<{ id: number; name: string }>;
      };
    }>("/api/pricelists")
  );
  if (Result.isError(result)) return result;
  const pricelists = result.data.data?.priceLists ?? result.data.data?.pricelists;
  if (!pricelists || pricelists.length === 0) {
    return Result.error(new Error("No pricelists found in Shoptet"));
  }
  return Result.ok(pricelists[0].id);
};

const updateStock = async (
  client: AxiosInstance,
  getStockId: () => Promise<Result<number>>,
  maxBatchSize: number,
  items: Array<{ productCode: string; quantity: number }>
): Promise<Result<BatchUpdateResult>> => {
  if (items.length === 0) return Result.ok({ success: 0, failed: 0, errors: [] });
  if (items.length > maxBatchSize) {
    return Result.error(new Error(`batchUpdateStock: too many items (${items.length} > ${maxBatchSize})`));
  }

  const invalidQuantity = items.find((item) => !Number.isFinite(item.quantity));
  if (invalidQuantity) {
    return Result.error(
      new Error(`batchUpdateStock: invalid quantity for "${invalidQuantity.productCode}" (${invalidQuantity.quantity})`)
    );
  }

  const stockIdResult = await getStockId();
  if (Result.isError(stockIdResult)) {
    return Result.ok({
      success: 0,
      failed: items.length,
      errors: items.map((item) => ({ code: item.productCode, error: stockIdResult.error.message })),
    });
  }

  const result = await apiCall(
    client.patch<{ errors?: Array<{ instance?: string; message?: string }> }>(
      `/api/stocks/${stockIdResult.data}/movements`,
      { data: items.map((item) => ({ productCode: item.productCode, quantity: item.quantity })) }
    )
  );

  if (Result.isError(result)) {
    return Result.ok({
      success: 0,
      failed: items.length,
      errors: items.map((item) => ({ code: item.productCode, error: result.error.message })),
    });
  }

  return Result.ok(summarizeBatch(items.length, parseResponseErrors(result.data.errors)));
};

const updatePrices = async (
  client: AxiosInstance,
  getPricelistId: () => Promise<Result<number>>,
  maxBatchSize: number,
  items: Array<{ code: string; price: number }>
): Promise<Result<BatchUpdateResult>> => {
  if (items.length === 0) return Result.ok({ success: 0, failed: 0, errors: [] });
  if (items.length > maxBatchSize) {
    return Result.error(new Error(`batchUpdatePrices: too many items (${items.length} > ${maxBatchSize})`));
  }

  const invalidPrice = items.find((item) => !Number.isFinite(item.price) || item.price < 0);
  if (invalidPrice) {
    return Result.error(
      new Error(`batchUpdatePrices: invalid price for "${invalidPrice.code}" (${invalidPrice.price})`)
    );
  }

  const pricelistIdResult = await getPricelistId();
  if (Result.isError(pricelistIdResult)) {
    return Result.ok({
      success: 0,
      failed: items.length,
      errors: items.map((item) => ({ code: item.code, error: pricelistIdResult.error.message })),
    });
  }

  const result = await apiCall(
    client.patch<{ errors?: Array<{ instance?: string; message?: string }> }>(
      `/api/pricelists/${pricelistIdResult.data}`,
      {
        data: items.map((item) => ({
          code: item.code,
          includingVat: true,
          price: { price: item.price.toFixed(2) },
        })),
      }
    )
  );

  if (Result.isError(result)) {
    return Result.ok({
      success: 0,
      failed: items.length,
      errors: items.map((item) => ({ code: item.code, error: result.error.message })),
    });
  }

  return Result.ok(summarizeBatch(items.length, parseResponseErrors(result.data.errors)));
};

const postOrder = async (
  client: AxiosInstance,
  order: CreateOrderRequest,
  orderOptions: CreateOrderOptions
): Promise<Result<ShoptetOrder>> => {
  const qs = buildSuppressParams(orderOptions).toString();
  const url = `/api/orders${qs ? `?${qs}` : ""}`;

  const result = await apiCall(
    client.post<ShoptetApiResponse<{ order: ShoptetOrder }>>(url, { data: order })
  );
  if (Result.isError(result)) return result;
  if (result.data.errors?.length) {
    const msg = joinMessages(result.data.errors);
    return Result.error(new Error(`Shoptet API errors: ${msg}`));
  }
  const createdOrder = result.data.data?.order;
  if (!createdOrder) {
    return Result.error(new Error("Shoptet API returned no order data"));
  }
  return Result.ok(createdOrder);
};

// ── Caching resolvers ───────────────────────────────────────

const createIdResolver = (fetch: () => Promise<Result<number>>) => {
  let cached: number | null = null;
  return async (): Promise<Result<number>> => {
    if (cached !== null) return Result.ok(cached);
    const result = await fetch();
    if (Result.isOk(result)) cached = result.data;
    return result;
  };
};

// ── Factory ─────────────────────────────────────────────────

export const createShoptetClient = (
  credentials: ShoptetCredentials,
  options: ShoptetClientOptions = {}
) => {
  validateHttpsUrl("ShoptetClient", credentials.apiUrl, "apiUrl");
  requireNonEmpty("ShoptetClient", credentials.oauthAccessToken, "oauthAccessToken");
  requireNonEmpty("ShoptetClient", credentials.webhookSecret, "webhookSecret");

  const maxBatchSize = resolvePositiveInt("ShoptetClient", options.maxBatchSize, SHOPTET_API_BATCH_LIMIT, "maxBatchSize");
  const timeoutMs = resolvePositiveInt("ShoptetClient", options.timeoutMs, SHOPTET_API_TIMEOUT_MS, "timeoutMs");

  const client = axios.create({
    baseURL: credentials.apiUrl,
    timeout: timeoutMs,
    headers: {
      "Content-Type": "application/vnd.shoptet.v1.0+json",
      "Shoptet-Private-API-Token": credentials.oauthAccessToken,
    },
  });

  client.interceptors.response.use(undefined, (error: unknown) => {
    if (axios.isAxiosError(error)) {
      scrubSensitiveHeaders(error.config?.headers);
    }
    return Promise.reject(error);
  });

  const getDefaultStockId = createIdResolver(() => fetchStockId(client));
  const getDefaultPricelistId = createIdResolver(() => fetchPricelistId(client));

  return {
    validateWebhookSignature: (payload: string, signature: string) =>
      checkWebhookSignature(credentials.webhookSecret, payload, signature),
    getOrder: (orderCode: string) =>
      fetchOrder(client, orderCode),
    getDefaultStockId,
    batchUpdateStock: (items: Array<{ productCode: string; quantity: number }>) =>
      updateStock(client, getDefaultStockId, maxBatchSize, items),
    getDefaultPricelistId,
    batchUpdatePrices: (items: Array<{ code: string; price: number }>) =>
      updatePrices(client, getDefaultPricelistId, maxBatchSize, items),
    createOrder: (order: CreateOrderRequest, orderOptions: CreateOrderOptions = {}) =>
      postOrder(client, order, orderOptions),
  };
};
