import { Order, OrderItem, Payment, Receipt } from '@prisma/client';

export interface OrderWithDetails extends Order {
  items: OrderItem[];
  payments: Payment[];
  receipt: Receipt | null;
}
