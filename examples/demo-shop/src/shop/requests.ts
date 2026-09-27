// One place that says what request each part of the shop makes.
//
// The pages use it for the props they hand to the layout, the islands use it
// for the requests they fire, and the tests use it to pin the routing story —
// so the three can never drift apart.
import type { ShopRequest } from '../rilot/request';

export const PAGE_REQUESTS = {
  home: { method: 'GET', path: '/', label: 'Open the storefront', kilobytes: 42 },
  products: { method: 'GET', path: '/products', label: 'Browse the catalog', kilobytes: 68 },
  cart: { method: 'GET', path: '/cart', label: 'Open the cart', kilobytes: 22 },
  checkout: { method: 'GET', path: '/checkout', label: 'Open the checkout', kilobytes: 30 },
  impact: { method: 'GET', path: '/green/impact', label: 'Open the impact page', kilobytes: 96 },
  reports: { method: 'GET', path: '/reports/monthly', label: 'Run the monthly report', kilobytes: 240 },
  notFound: { method: 'GET', path: '/404', label: 'Open a page that does not exist', kilobytes: 8 }
} as const satisfies Record<string, ShopRequest>;

/** A product page: one URL, one routing decision, per product. */
export function productRequest(id: string): ShopRequest {
  return { method: 'GET', path: `/products/${id}`, label: 'View a product', kilobytes: 55 };
}

/** Requests that are actions rather than page loads. */
export const ADD_TO_CART: ShopRequest = {
  method: 'POST',
  path: '/cart/items',
  label: 'Add an item to the cart',
  kilobytes: 4
};

export const PAY: ShopRequest = {
  method: 'POST',
  path: '/checkout/pay',
  label: 'Pay for the order',
  kilobytes: 12
};

export const SUBSCRIBE: ShopRequest = {
  method: 'POST',
  path: '/newsletter/subscribe',
  label: 'Subscribe to the newsletter',
  kilobytes: 3
};
