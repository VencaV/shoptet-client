import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import axios from "axios";
import * as pohodaClient from "./index";
import { createPohodaClient, Result } from "./index";
import type { PohodaClient, PohodaClientConfig } from "./index";

vi.mock("axios", () => ({ default: { create: vi.fn(), isAxiosError: vi.fn() } }));
const mockedAxios = axios as any;

const fakeAxiosInstance = {
  post: vi.fn(),
  get: vi.fn(),
  defaults: { headers: { common: {} } },
};

const config: PohodaClientConfig = {
  endpoint: "http://pohoda.local:8080",
  username: "admin",
  password: "secret",
  serverName: "TestServer",
  ico: "12345678",
};

function makeClient(): PohodaClient {
  return createPohodaClient(config);
}

function wrapResponsePack(content: string, state = "ok"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<responsePack state="${state}">
  ${content}
</responsePack>`;
}

describe("PohodaClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.create.mockReturnValue(fakeAxiosInstance as any);
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is any => !!(error && typeof error === "object" && (error as any).isAxiosError === true),
    );
  });

  describe("constructor", () => {
    it("exposes the documented public entrypoint", () => {
      expect(typeof pohodaClient.createPohodaClient).toBe("function");
      expect(pohodaClient.Result).toBe(Result);
    });

    it("creates axios instance with correct config", () => {
      makeClient();

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "http://pohoda.local:8080",
          headers: expect.objectContaining({
            "Content-Type": "application/xml",
            "STW-mServer-Name": "TestServer",
          }),
        }),
      );
    });

    it("sets STW-Authorization header with Base64 credentials", () => {
      makeClient();

      const expectedAuth = Buffer.from("admin:secret").toString("base64");
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            "STW-Authorization": `Basic ${expectedAuth}`,
          }),
        }),
      );
    });

    it("returns the config without the password", () => {
      const client = makeClient();
      const publicConfig = client.getConfig();

      expect(publicConfig).toEqual({
        endpoint: "http://pohoda.local:8080",
        username: "admin",
        serverName: "TestServer",
        ico: "12345678",
      });
      expect("password" in publicConfig).toBe(false);
      expect(Object.isFrozen(publicConfig)).toBe(true);
    });

    it("throws when endpoint is not a valid URL", () => {
      expect(() => createPohodaClient({ ...config, endpoint: "not-a-url" })).toThrow("endpoint is not a valid URL");
    });

    it("throws when endpoint contains embedded credentials", () => {
      expect(() => createPohodaClient({ ...config, endpoint: "http://user:pass@pohoda.local:8080" })).toThrow(
        "endpoint must not contain credentials",
      );
    });

    it("throws when endpoint uses unsupported protocol", () => {
      expect(() => createPohodaClient({ ...config, endpoint: "ftp://pohoda.local" })).toThrow(
        "endpoint must use HTTP or HTTPS",
      );
    });
  });

  describe("sendXml()", () => {
    it("returns success with id and number on ok response", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: wrapResponsePack(`
          <responsePackItem state="ok">
            <importResponse state="ok">
              <producedDetails>
                <id>42</id>
                <number>OBJ-001</number>
              </producedDetails>
            </importResponse>
          </responsePackItem>
        `),
      });

      const client = makeClient();
      const result = await client.sendXml("<test/>");

      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(true);
      if (!result.data.success) throw new Error("unexpected");
      expect(result.data.id).toBe(42);
      expect(result.data.number).toBe("OBJ-001");
    });

    it("returns error when responsePack is missing", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({ data: "<?xml version=\"1.0\"?><something/>" });

      const result = await makeClient().sendXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(false);
      if (result.data.success) throw new Error("unexpected");
      expect(result.data.message).toContain("missing responsePack");
    });

    it("returns error on detail-level errors", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: wrapResponsePack(`
          <responsePackItem state="ok">
            <importResponse state="error">
              <detail state="error" note="Duplicate order"/>
            </importResponse>
          </responsePackItem>
        `),
      });

      const result = await makeClient().sendXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(false);
      if (result.data.success) throw new Error("unexpected");
      expect(result.data.message).toContain("Duplicate order");
    });

    it("discovers id and number from nested arrays", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: wrapResponsePack(`
          <responsePackItem state="ok">
            <importResponse state="ok">
              <items>
                <item><id>77</id><number>ARR-77</number></item>
              </items>
            </importResponse>
          </responsePackItem>
        `),
      });

      const result = await makeClient().sendXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(true);
      if (!result.data.success) throw new Error("unexpected");
      expect(result.data.id).toBe(77);
      expect(result.data.number).toBe("ARR-77");
    });

    it("returns Result.error on axios network error", async () => {
      const axiosError = Object.assign(new Error("ETIMEDOUT"), {
        isAxiosError: true,
        response: undefined,
      });
      fakeAxiosInstance.post.mockRejectedValueOnce(axiosError);

      const result = await makeClient().sendXml("<test/>");
      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toBe("Pohoda request failed: ETIMEDOUT");
    });

    it("appends a textual response body to axios errors", async () => {
      const axiosError = Object.assign(new Error("Request failed with status code 500"), {
        isAxiosError: true,
        response: { data: "mServer busy" },
      });
      fakeAxiosInstance.post.mockRejectedValueOnce(axiosError);

      const result = await makeClient().sendXml("<test/>");
      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toBe("Pohoda request failed: Request failed with status code 500 - mServer busy");
    });

    it("returns Result.error when the response is not valid XML", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({ data: "<responsePack><unclosed></responsePack>" });

      const result = await makeClient().sendXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(false);
    });

    it("prefixes pack-level note when responsePack state is error", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: `<?xml version="1.0"?>
<responsePack state="error" note="Login failed">
  <responsePackItem state="error" note="Item failed"/>
</responsePack>`,
      });

      const result = await makeClient().sendXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(false);
      if (result.data.success) throw new Error("unexpected");
      expect(result.data.message).toBe("Login failed | Item failed");
      expect(result.data.errors).toEqual([{ message: "Login failed" }, { message: "Item failed" }]);
    });

    it("includes detail error codes", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: wrapResponsePack(`
          <responsePackItem state="ok">
            <importResponse state="error">
              <detail state="error" code="E42" note="Bad item"/>
            </importResponse>
          </responsePackItem>
        `),
      });

      const result = await makeClient().sendXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      if (result.data.success) throw new Error("unexpected");
      expect(result.data.errors).toEqual([{ code: "E42", message: "detail#1: Bad item" }]);
    });

    it("returns plain ok when the pack succeeds without details", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: wrapResponsePack(`<responsePackItem state="ok"><importResponse state="ok"/></responsePackItem>`),
      });

      const result = await makeClient().sendXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data).toEqual({ success: true, state: "ok" });
    });
  });

  describe("sendStockExportXml()", () => {
    it("returns stock items from valid response", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: `<?xml version="1.0"?>
<responsePack state="ok">
  <responsePackItem state="ok">
    <listStock>
      <stock>
        <stockHeader>
          <id>1</id>
          <code>PROD-001</code>
          <name>Widget</name>
          <count>50</count>
          <unit>ks</unit>
          <EAN>8590000001</EAN>
          <isInternet>true</isInternet>
          <sellingPrice><price>199.90</price></sellingPrice>
        </stockHeader>
      </stock>
    </listStock>
  </responsePackItem>
</responsePack>`,
      });

      const result = await makeClient().sendStockExportXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.items[0]).toEqual({
        stockId: 1,
        code: "PROD-001",
        name: "Widget",
        count: 50,
        unit: "ks",
        ean: "8590000001",
        internet: true,
        sellingPrice: 199.9,
      });
    });

    it("returns empty items when responsePack is missing", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({ data: "<?xml version=\"1.0\"?><empty/>" });

      const result = await makeClient().sendStockExportXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.success).toBe(false);
      expect(result.data.items).toEqual([]);
    });

    it("parses stk namespace-prefixed stock responses", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: `<?xml version="1.0"?>
<responsePack state="ok">
  <responsePackItem state="ok">
    <listStock>
      <stk:stock>
        <stk:stockHeader>
          <stk:id>7</stk:id>
          <stk:code>NS-001</stk:code>
          <stk:name>Namespaced</stk:name>
          <stk:count>33</stk:count>
          <stk:unit>ks</stk:unit>
          <stk:EAN>1234567890</stk:EAN>
          <stk:isInternet>true</stk:isInternet>
          <stk:sellingPrice><typ:price>99.90</typ:price></stk:sellingPrice>
        </stk:stockHeader>
      </stk:stock>
    </listStock>
  </responsePackItem>
</responsePack>`,
      });

      const result = await makeClient().sendStockExportXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.items[0]).toEqual({
        stockId: 7,
        code: "NS-001",
        name: "Namespaced",
        count: 33,
        unit: "ks",
        ean: "1234567890",
        internet: true,
        sellingPrice: 99.9,
      });
    });

    it("skips error pack items and tolerates malformed header values", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({
        data: `<?xml version="1.0"?>
<responsePack state="ok">
  <responsePackItem state="error" note="failed"/>
  <responsePackItem state="ok">
    <listStock>
      <stock>
        <stockHeader>
          <id>abc</id>
          <code>PROD-002</code>
          <name>Gadget</name>
          <count>not-a-number</count>
          <isInternet>0</isInternet>
          <sellingPrice><price>n/a</price></sellingPrice>
        </stockHeader>
      </stock>
    </listStock>
  </responsePackItem>
</responsePack>`,
      });

      const result = await makeClient().sendStockExportXml("<test/>");
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) throw new Error("unexpected");
      expect(result.data.items).toEqual([
        { stockId: 0, code: "PROD-002", name: "Gadget", count: 0, internet: false },
      ]);
    });

    it("returns Result.error on axios network error", async () => {
      const axiosError = Object.assign(new Error("ECONNREFUSED"), {
        isAxiosError: true,
        response: undefined,
      });
      fakeAxiosInstance.post.mockRejectedValueOnce(axiosError);

      const result = await makeClient().sendStockExportXml("<test/>");
      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("unexpected");
      expect(result.error.message).toContain("Pohoda stock export failed: ECONNREFUSED");
    });
  });

  describe("timeout overrides", () => {
    it("uses stockExportTimeoutMs for stock export requests", async () => {
      fakeAxiosInstance.post.mockResolvedValueOnce({ data: "<responsePack state=\"ok\"><responsePackItem state=\"ok\"><listStock/></responsePackItem></responsePack>" });

      const client = createPohodaClient({ ...config, stockExportTimeoutMs: 12345 });
      await client.sendStockExportXml("<test/>");

      expect(fakeAxiosInstance.post).toHaveBeenCalledWith("/xml", "<test/>", { timeout: 12345 });
    });
  });
});