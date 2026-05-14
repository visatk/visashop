import { useEffect, useState } from 'react';

const KEY = 'visashop:cart:v1';

export interface CartItem {
  slug: string;
  name: string;
  unitPriceCents: number;
  image: string | null;
  type: string;
  quantity: number;
}

let listeners: Array<(items: CartItem[]) => void> = [];

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CartItem[];
  } catch {
    return [];
  }
}

function save(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  for (const fn of listeners) fn(items);
}

export const cart = {
  get(): CartItem[] {
    return load();
  },
  add(item: CartItem) {
    const items = load();
    const existing = items.find((i) => i.slug === item.slug);
    if (existing) existing.quantity = Math.min(20, existing.quantity + (item.quantity ?? 1));
    else items.push({ ...item, quantity: Math.max(1, item.quantity || 1) });
    save(items);
  },
  setQuantity(slug: string, q: number) {
    const items = load().map((i) => (i.slug === slug ? { ...i, quantity: Math.max(1, Math.min(20, q)) } : i));
    save(items);
  },
  remove(slug: string) {
    save(load().filter((i) => i.slug !== slug));
  },
  clear() {
    save([]);
  },
};

export function useCart(): { items: CartItem[]; count: number; subtotalCents: number } {
  const [items, setItems] = useState<CartItem[]>(() => (typeof window !== 'undefined' ? load() : []));
  useEffect(() => {
    listeners.push(setItems);
    return () => {
      listeners = listeners.filter((l) => l !== setItems);
    };
  }, []);
  const count = items.reduce((acc, i) => acc + i.quantity, 0);
  const subtotalCents = items.reduce((acc, i) => acc + i.unitPriceCents * i.quantity, 0);
  return { items, count, subtotalCents };
}
