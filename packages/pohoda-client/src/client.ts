import axios, { type AxiosInstance } from "axios";
import { XMLParser } from "fast-xml-parser";
import http from "node:http";
import https from "node:https";
import { Result } from "@vencav/result";
import type {
  PohodaClientConfig,
  PohodaPublicConfig,
  PohodaResponse,
  PohodaResponseError,
  PohodaStockExportItem,
  PohodaStockResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_STOCK_EXPORT_TIMEOUT_MS = 45_000;

const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 60_000 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 60_000 });

export type PohodaClient = ReturnType<typeof createPohodaClient>;

// ── Validation helpers ──────────────────────────────────────

const requireNonEmpty = (ctx: string, value: string, fieldName: string): void => {
  if (!value) {
    throw new Error(`${ctx}: ${fieldName} must not be empty`);
  }
};

const resolvePositiveInt = (ctx: string, value: number | undefined, fallback: number, fieldName: string): number => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${ctx}: ${fieldName} must be a positive integer`);
  }
  return resolved;
};

const validateEndpointUrl = (ctx: string, raw: string): void => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${ctx}: endpoint is not a valid URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${ctx}: endpoint must use HTTP or HTTPS`);
  }

  if (url.username || url.password) {
    throw new Error(`${ctx}: endpoint must not contain credentials`);
  }
};

// ── Generic helpers ─────────────────────────────────────────

const withOptional = <T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined,
): T & Partial<Record<K, V>> => {
  if (value === undefined) {
    return target;
  }

  return {
    ...target,
    [key]: value,
  };
};

const toPublicConfig = (config: PohodaClientConfig): PohodaPublicConfig =>
  withOptional(
    withOptional(
      withOptional(
        { endpoint: config.endpoint, username: config.username, serverName: config.serverName },
        "ico",
        config.ico,
      ),
      "timeoutMs",
      config.timeoutMs,
    ),
    "stockExportTimeoutMs",
    config.stockExportTimeoutMs,
  );

// ── XML tree helpers ────────────────────────────────────────
// The parser is configured with `removeNSPrefix: true`, so element names never
// carry a namespace prefix (`rsp:`, `stk:`, `typ:` ...). Attributes are exposed
// with the `@_` prefix; text content of leaf elements is a plain string.

type XmlNode = Record<string, unknown>;

const isXmlNode = (value: unknown): value is XmlNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const createParser = (): XMLParser =>
  new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseTagValue: false,
  });

const parseXml = (parser: XMLParser, xmlData: string): XmlNode => {
  const parsed: unknown = parser.parse(xmlData);
  return isXmlNode(parsed) ? parsed : {};
};

/** Child element as an object node; `undefined` for missing, empty, or text-only children. */
const getNode = (node: XmlNode, key: string): XmlNode | undefined => {
  const value = node[key];
  return isXmlNode(value) ? value : undefined;
};

/** Repeated child element as an array of object nodes (a single child is wrapped). */
const getNodes = (node: XmlNode, key: string): XmlNode[] => {
  const value = node[key];
  if (value == null) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).filter(isXmlNode);
};

const toOptionalString = (value: unknown): string | undefined => {
  if (value == null || value === "") {
    return undefined;
  }
  if (isPrimitive(value)) {
    return String(value);
  }
  if (isXmlNode(value) && isPrimitive(value["#text"])) {
    return String(value["#text"]);
  }
  return undefined;
};

const toOptionalNumber = (value: unknown): number | undefined => {
  const text = toOptionalString(value);
  if (text === undefined) {
    return undefined;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Reads `name` either as an attribute (`@_name`) or as a child element. */
const attrOrChild = (node: XmlNode, name: string): string | undefined =>
  toOptionalString(node[`@_${name}`]) ?? toOptionalString(node[name]);

const parseBool = (value: unknown): boolean => {
  const text = toOptionalString(value);
  return text === "true" || text === "1";
};

const parsePrice = (priceNode: unknown): number | undefined => {
  const raw = isXmlNode(priceNode) ? priceNode.price : priceNode;
  return toOptionalNumber(raw);
};

// ── HTTP ────────────────────────────────────────────────────

const buildAuthHeader = (config: PohodaClientConfig): string => {
  return Buffer.from(`${config.username}:${config.password}`).toString("base64");
};

const createHttpClient = (config: PohodaClientConfig, timeoutMs: number): AxiosInstance => {
  return axios.create({
    baseURL: config.endpoint,
    timeout: timeoutMs,
    httpAgent,
    httpsAgent,
    headers: {
      "Content-Type": "application/xml",
      "STW-Authorization": `Basic ${buildAuthHeader(config)}`,
      "STW-mServer-Name": config.serverName,
    },
  });
};

const toResultError = (prefix: string, error: unknown): Result<never> => {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data;
    const suffix = typeof body === "string" && body ? ` - ${body}` : "";
    return Result.error(new Error(`${prefix}: ${error.message}${suffix}`));
  }

  return Result.error(error instanceof Error ? error : new Error(String(error)));
};

// ── Response parsing ────────────────────────────────────────

const findFirstIdNumberPair = (node: unknown): { id?: unknown; number?: unknown } | undefined => {
  if (Array.isArray(node)) {
    for (const item of node) {
      const result = findFirstIdNumberPair(item);
      if (result) {
        return result;
      }
    }
    return undefined;
  }

  if (!isXmlNode(node)) {
    return undefined;
  }

  const { id, number } = node;
  if (id != null || number != null) {
    return { id, number };
  }

  for (const value of Object.values(node)) {
    const result = findFirstIdNumberPair(value);
    if (result) {
      return result;
    }
  }

  return undefined;
};

const extractSuccessDetails = (itemResponse: XmlNode): { id?: number; number?: string } => {
  const produced = getNode(itemResponse, "producedDetails");
  if (produced) {
    const producedId = toOptionalNumber(produced.id);
    const producedNumber = toOptionalString(produced.number);
    if (producedId !== undefined || producedNumber !== undefined) {
      return withOptional(withOptional({}, "id", producedId), "number", producedNumber);
    }
  }

  const discovered = findFirstIdNumberPair(itemResponse);
  return withOptional(
    withOptional({}, "id", toOptionalNumber(discovered?.id)),
    "number",
    toOptionalString(discovered?.number),
  );
};

const parseResponse = (parser: XMLParser, xmlData: string): PohodaResponse => {
  const responsePack = getNode(parseXml(parser, xmlData), "responsePack");
  if (!responsePack) {
    return {
      success: false,
      state: "error",
      message: "Invalid response format - missing responsePack",
    };
  }

  const responsePackItems = getNodes(responsePack, "responsePackItem");
  if (responsePackItems.length === 0) {
    return {
      success: false,
      state: "error",
      message: "Invalid response format - missing responsePackItem",
    };
  }

  const packState = attrOrChild(responsePack, "state");
  const packNote = attrOrChild(responsePack, "note");

  const errors: PohodaResponseError[] = [];
  let successId: number | undefined;
  let successNumber: string | undefined;

  for (const item of responsePackItems) {
    const itemResponse = getNode(item, "importResponse") ?? getNode(item, "exportResponse");

    if (itemResponse) {
      getNodes(itemResponse, "detail").forEach((detail, detailIndex) => {
        if (attrOrChild(detail, "state") !== "error") {
          return;
        }
        const detailMessage = attrOrChild(detail, "note") ?? "Unknown error";
        errors.push(
          withOptional(
            { message: `detail#${detailIndex + 1}: ${detailMessage}` },
            "code",
            attrOrChild(detail, "code"),
          ),
        );
      });

      if (attrOrChild(itemResponse, "state") === "ok") {
        const successDetails = extractSuccessDetails(itemResponse);
        if (successDetails.id !== undefined) {
          successId = successDetails.id;
        }
        if (successDetails.number !== undefined) {
          successNumber = successDetails.number;
        }
      }

      continue;
    }

    if (attrOrChild(item, "state") === "error") {
      errors.push({
        message: attrOrChild(item, "note") ?? "Pohoda returned item error without details",
      });
    }
  }

  if (errors.length > 0 || packState === "error") {
    if (packState === "error" && packNote) {
      errors.unshift({ message: packNote });
    }

    return {
      success: false,
      state: "error",
      message: errors.map((error) => error.message).join(" | "),
      errors,
    };
  }

  if (successId !== undefined || successNumber !== undefined) {
    return withOptional(
      withOptional(
        {
          success: true,
          state: "ok" as const,
        },
        "id",
        successId,
      ),
      "number",
      successNumber,
    );
  }

  if (packState === "ok") {
    return {
      success: true,
      state: "ok",
    };
  }

  return {
    success: false,
    state: "error",
    message: `Unknown response format (responsePack keys: ${Object.keys(responsePack).join(", ")})`,
  };
};

const parseStockItem = (stockItem: XmlNode): PohodaStockExportItem => {
  const header = getNode(stockItem, "stockHeader") ?? {};
  return withOptional(
    withOptional(
      withOptional(
        {
          stockId: toOptionalNumber(header.id) ?? 0,
          code: toOptionalString(header.code) ?? "",
          name: toOptionalString(header.name) ?? "",
          count: toOptionalNumber(header.count) ?? 0,
          internet: parseBool(header.isInternet),
        },
        "unit",
        toOptionalString(header.unit),
      ),
      "ean",
      toOptionalString(header.EAN),
    ),
    "sellingPrice",
    parsePrice(header.sellingPrice),
  );
};

const parseStockResponse = (parser: XMLParser, xmlData: string): PohodaStockResponse => {
  const responsePack = getNode(parseXml(parser, xmlData), "responsePack");
  if (!responsePack) {
    return { success: false, items: [] };
  }

  const packItems = getNodes(responsePack, "responsePackItem");
  if (packItems.length === 0) {
    return { success: false, items: [] };
  }

  const items: PohodaStockExportItem[] = [];

  for (const packItem of packItems) {
    if (attrOrChild(packItem, "state") === "error") {
      continue;
    }

    const listStock = getNode(packItem, "listStock");
    if (!listStock) {
      continue;
    }

    for (const stockItem of getNodes(listStock, "stock")) {
      items.push(parseStockItem(stockItem));
    }
  }

  return { success: true, items };
};

// ── Factory ─────────────────────────────────────────────────

export const createPohodaClient = (config: PohodaClientConfig) => {
  validateEndpointUrl("PohodaClient", config.endpoint);
  requireNonEmpty("PohodaClient", config.username, "username");
  requireNonEmpty("PohodaClient", config.password, "password");
  requireNonEmpty("PohodaClient", config.serverName, "serverName");

  const timeoutMs = resolvePositiveInt("PohodaClient", config.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  const stockExportTimeoutMs = resolvePositiveInt(
    "PohodaClient",
    config.stockExportTimeoutMs,
    DEFAULT_STOCK_EXPORT_TIMEOUT_MS,
    "stockExportTimeoutMs",
  );
  const parser = createParser();
  const client = createHttpClient(config, timeoutMs);
  const publicConfig = Object.freeze(toPublicConfig(config));

  return {
    /** Client configuration without the password. Safe to log. */
    getConfig: (): PohodaPublicConfig => publicConfig,

    sendXml: async (xml: string): Promise<Result<PohodaResponse>> => {
      try {
        const response = await client.post<string>("/xml", xml);
        return Result.ok(parseResponse(parser, response.data));
      } catch (error: unknown) {
        return toResultError("Pohoda request failed", error);
      }
    },

    sendStockExportXml: async (xml: string): Promise<Result<PohodaStockResponse>> => {
      try {
        const response = await client.post<string>("/xml", xml, {
          timeout: stockExportTimeoutMs,
        });
        return Result.ok(parseStockResponse(parser, response.data));
      } catch (error: unknown) {
        return toResultError("Pohoda stock export failed", error);
      }
    },
  };
};
