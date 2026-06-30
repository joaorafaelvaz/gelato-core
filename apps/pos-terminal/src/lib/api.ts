import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

let tokenHandler: (() => string | null) | null = null;

export function setTokenHandler(fn: () => string | null) {
  tokenHandler = fn;
}

api.interceptors.request.use((config) => {
  const token = tokenHandler?.();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export type LoginInput = {
  email: string;
  password: string;
  tenantSlug: string;
};

export type LoginResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    tenantId: string;
    tenantSlug: string;
    betriebsstaetteIds: string[];
    roles: string[];
    permissions: string[];
  };
};

export async function login(input: LoginInput): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', input);
  return data;
}

// ============ Products ============

export type Product = {
  id: string;
  name: string;
  type: string;
  basePrice: string | null;
  mwstImHaus: string;
  mwstAusserHaus: string;
  gtin: string | null;
  isActive: boolean;
  variants?: ProductVariant[];
  modifiers?: ProductModifier[];
};

export type ProductVariant = {
  id: string;
  name: string;
  priceDelta: string | null;
  isActive: boolean;
};

export type ProductModifier = {
  id: string;
  name: string;
  priceDelta: string | null;
  groupKey: string | null;
  isActive: boolean;
};

export async function fetchProducts(token: string): Promise<Product[]> {
  const { data } = await api.get<Product[]>('/products', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

// ============ Shifts ============

export type Shift = {
  id: string;
  kasseId: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
};

export async function openShift(kasseId: string, openingFloat: number, token: string): Promise<Shift> {
  const { data } = await api.post<Shift>(
    '/pos/shifts',
    { kasseId, openingFloat },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return data;
}

export async function closeShift(shiftId: string, closingCount: number, token: string): Promise<Shift> {
  const { data } = await api.post<Shift>(
    `/pos/shifts/${shiftId}/close`,
    { closingCount },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return data;
}

export async function fetchShifts(kasseId: string, token: string): Promise<Shift[]> {
  const { data } = await api.get<Shift[]>(`/pos/shifts/kasse/${kasseId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

// ============ Orders ============

export type CartItem = {
  productId: string;
  variantId?: string;
  qty: number;
  modifiers?: { modifierId: string; priceDelta: string }[];
};

export type CreateOrderInput = {
  kasseId: string;
  shiftId: string;
  mode: 'IM_HAUS' | 'AUSSER_HAUS';
  items: CartItem[];
  payments?: { method: string; amount: string }[];
};

export type Order = {
  id: string;
  status: string;
  totalNet: string | number;
  totalMwst: string | number;
  totalGross: string | number;
  items: any[];
  payments: any[];
  receipt?: { id: string; qrPayload: string | null; tseSignature: any } | null;
};

export async function createOrder(input: CreateOrderInput, token: string): Promise<Order> {
  const { data } = await api.post<Order>('/pos/orders', input, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

export async function finalizeOrder(orderId: string, token: string): Promise<Order> {
  const { data } = await api.post<Order>(
    `/pos/orders/${orderId}/finalize`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return data;
}

export async function voidOrder(orderId: string, reason: string, token: string): Promise<Order> {
  const { data } = await api.post<Order>(
    `/pos/orders/${orderId}/void`,
    { reason },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return data;
}