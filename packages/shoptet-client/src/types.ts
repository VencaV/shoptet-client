export interface ShoptetWebhookPayload {
  readonly event: ShoptetEventType;
  readonly eventCreated: string;
  readonly eventInstance: string; // Order code for order events, product GUID for product events
  readonly eshopId: number;
  readonly data?: ShoptetWebhookData;
}

export interface ShoptetWebhookData {
  readonly code?: string;
  readonly orderCode?: string;
  readonly id?: string | number;
  readonly [key: string]: unknown;
}

export type ShoptetEventType =
  | "order:create"
  | "order:update"
  | "order:delete"
  | "stock:update"
  | "product:create"
  | "product:update";

export interface ShoptetOrder {
  readonly code: string;
  readonly guid: string;
  readonly creationTime: string;
  readonly changeTime: string;
  readonly status: ShoptetOrderStatus;
  readonly paid: boolean;
  readonly currency: string;
  readonly price: ShoptetPrice;
  readonly customer: ShoptetCustomer;
  readonly billingAddress: ShoptetAddress;
  readonly deliveryAddress?: ShoptetAddress;
  readonly shippingMethod: ShoptetShippingMethod;
  readonly paymentMethod: ShoptetPaymentMethod;
  readonly items: ReadonlyArray<ShoptetOrderItem>;
  readonly notes?: string;
  readonly adminNotes?: string;
}

export interface ShoptetOrderStatus {
  readonly id: number;
  readonly name: string;
}

export interface ShoptetPrice {
  readonly withVat: number;
  readonly withoutVat: number;
  readonly vat: number;
  readonly toPay: number;
  readonly currencyCode: string;
  readonly exchangeRate: number;
}

export interface ShoptetCustomer {
  readonly guid?: string;
  readonly email: string;
  readonly phone?: string;
  readonly remark?: string;
}

export interface ShoptetAddress {
  readonly company?: string;
  readonly fullName: string;
  readonly street: string;
  readonly houseNumber?: string;
  readonly city: string;
  readonly district?: string;
  readonly zip: string;
  readonly countryCode: string;
  readonly regionName?: string;
  readonly additional?: string;
  readonly companyId?: string;
  readonly vatId?: string;
}

export interface ShoptetShippingMethod {
  readonly guid: string;
  readonly name: string;
}

export interface ShoptetPaymentMethod {
  readonly guid: string;
  readonly name: string;
}

export type ItemType = "product" | "shipping" | "billing" | "discount" | "gift";

export interface ShoptetOrderItem {
  readonly productGuid?: string;
  readonly code: string;
  readonly ean?: string;
  readonly name: string;
  readonly variantName?: string;
  readonly amount: number;
  readonly amountUnit: string;
  readonly weight?: number;
  readonly remark?: string;
  readonly itemPrice: ShoptetItemPrice;
  readonly itemType: ItemType;
}

export interface ShoptetItemPrice {
  readonly withVat: number;
  readonly withoutVat: number;
  readonly vat: number;
  readonly vatRate: number;
}

export interface ShoptetStockItem {
  readonly guid: string;
  readonly code: string;
  readonly ean?: string;
  readonly stock: number;
  readonly minStockSupply?: number;
}

// --- Order creation types (POST /api/orders) ---

export type CreateOrderItemType =
  | "product"
  | "shipping"
  | "billing"
  | "discount-coupon"
  | "volume-discount"
  | "gift"
  | "gift-certificate"
  | "generic-item"
  | "service"
  | "deposit";

export interface CreateOrderItem {
  readonly itemType: CreateOrderItemType;
  readonly productGuid?: string;
  /** Product/variant code – max 64 chars */
  readonly code?: string;
  /** Item name – max 250 chars */
  readonly name?: string;
  readonly variantName?: string;
  readonly brand?: string;
  readonly supplierName?: string;
  readonly remark?: string;
  readonly warrantyDescription?: string;
  readonly additionalField?: string;
  /** Quantity, e.g. "1.000" */
  readonly amount?: string;
  /** Unit, e.g. "ks" – max 16 chars */
  readonly amountUnit?: string;
  readonly weight?: string;
  readonly priceRatio?: string;
  /** VAT rate, e.g. "21.00" */
  readonly vatRate?: string;
  /** Total item price with VAT */
  readonly itemPriceWithVat?: string;
  /** Total item price without VAT */
  readonly itemPriceWithoutVat?: string;
  /** Unit price with VAT */
  readonly unitPriceWithVat?: string;
  /** Unit price without VAT */
  readonly unitPriceWithoutVat?: string;
  readonly buyPriceWithVat?: string;
  readonly buyPriceWithoutVat?: string;
  readonly buyPriceVatRate?: string;
  readonly statusId?: number;
  readonly amountCompleted?: string;
  readonly recyclingFeeId?: number;
  readonly consumptionTaxId?: number;
}

export interface CreateOrderAddress {
  readonly company?: string;
  readonly fullName?: string;
  readonly street?: string;
  readonly streetWithNr?: string;
  readonly houseNumber?: string;
  readonly city?: string;
  readonly district?: string;
  readonly additional?: string;
  readonly zip?: string;
  readonly countryCode?: string;
  readonly regionName?: string;
  readonly regionShortcut?: string;
  readonly companyId?: string;
  readonly vatId?: string;
  readonly taxId?: string;
}

export interface CreateOrderCurrency {
  readonly code: string;
  readonly exchangeRate?: string;
}

export interface CreateOrderRequest {
  /** ISO 8601 datetime */
  readonly creationTime?: string;
  /** Order code – max 10 chars, must be unique */
  readonly code?: string;
  readonly language?: string;
  /** External system identifier – max 255 chars, required & unique */
  readonly externalCode: string;
  readonly cashDeskOrder?: boolean;
  readonly statusId?: number;
  readonly sourceId?: number | null;
  readonly salesChannelGuid?: string | null;
  /** Customer email – max 100 chars */
  readonly email?: string;
  /** Phone – max 32 chars */
  readonly phone?: string | null;
  readonly birthDate?: string | null;
  readonly vatPayer?: boolean;
  readonly paymentMethodGuid?: string | null;
  readonly shippingGuid?: string | null;
  readonly shippingDetails?: Record<string, unknown> | null;
  readonly paid?: boolean | null;
  readonly billingMethodCode?: number;
  readonly clientIPAddress?: string | null;
  readonly customerGuid?: string | null;
  readonly billingAddress?: CreateOrderAddress;
  readonly addressesEqual?: boolean | null;
  readonly deliveryAddress?: CreateOrderAddress | null;
  readonly notes?: Record<string, unknown> | null;
  readonly stockId?: number;
  readonly currency: CreateOrderCurrency;
  readonly vatMode?: "Normal" | "One Stop Shop" | "Reverse charge" | "Outside the EU";
  readonly items: ReadonlyArray<CreateOrderItem>;
}

export interface CreateOrderOptions {
  readonly suppressDocumentGeneration?: boolean;
  readonly suppressEmailSending?: boolean;
  readonly suppressProductChecking?: boolean;
  readonly suppressStockMovements?: boolean;
  readonly suppressHistoricalMandatoryFields?: boolean;
  readonly suppressHistoricalPaymentChecking?: boolean;
  readonly suppressHistoricalShippingChecking?: boolean;
}

export interface ShoptetApiResponse<T> {
  readonly data: T;
  readonly errors: ReadonlyArray<ShoptetError> | null;
}

export interface ShoptetError {
  readonly errorCode: string;
  readonly instance: string;
  readonly message: string;
}
