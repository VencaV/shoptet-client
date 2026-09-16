export type PohodaClientConfig = Readonly<{
  endpoint: string;
  username: string;
  password: string;
  serverName: string;
  ico?: string;
  timeoutMs?: number;
  stockExportTimeoutMs?: number;
}>;

/** Client configuration as returned by `getConfig()` — never includes the password. */
export type PohodaPublicConfig = Omit<PohodaClientConfig, "password">;

export type PohodaResponseError = Readonly<{
  code?: string;
  message: string;
}>;

export type PohodaResponse = Readonly<
  | {
      success: true;
      state: "ok";
      id?: number;
      number?: string;
    }
  | {
      success: false;
      state: "error";
      message: string;
      errors?: ReadonlyArray<PohodaResponseError>;
    }
>;

export type PohodaStockExportItem = Readonly<{
  stockId: number;
  code: string;
  name: string;
  count: number;
  unit?: string;
  ean?: string;
  internet: boolean;
  sellingPrice?: number;
}>;

export type PohodaStockResponse = Readonly<{
  success: boolean;
  items: ReadonlyArray<PohodaStockExportItem>;
}>;