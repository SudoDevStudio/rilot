export type Product = {
  id: string;
  name: string;
  price: number;
  /** One line, used on cards. */
  blurb: string;
  /** A paragraph, used on the product page and as its meta description. */
  description: string;
  category: string;
  keywords: string[];
  emoji: string;
};

export const PRODUCTS: Product[] = [
  {
    id: 'bottle',
    name: 'Insulated Bottle',
    price: 24,
    blurb: 'Keeps coffee hot for 12 hours.',
    description:
      'A 500 ml double-walled steel bottle that keeps coffee hot for twelve hours and water cold for a day. Sample product in the GreenCart demo: opening this page is a real routing decision made by Rilot.',
    category: 'Kitchen',
    keywords: ['insulated bottle', 'reusable bottle', 'demo product'],
    emoji: '🍶'
  },
  {
    id: 'tote',
    name: 'Canvas Tote',
    price: 18,
    blurb: 'Organic cotton, stitched to last.',
    description:
      'Heavy organic cotton, double-stitched handles, big enough for a week of groceries. Sample product in the GreenCart demo: opening this page is a real routing decision made by Rilot.',
    category: 'Everyday',
    keywords: ['canvas tote', 'cotton bag', 'demo product'],
    emoji: '👜'
  },
  {
    id: 'lamp',
    name: 'Desk Lamp',
    price: 59,
    blurb: 'Warm light, 6 W, dimmable.',
    description:
      'Six watts, dimmable to a candle-warm 2200 K, with a weighted base that does not wander. Sample product in the GreenCart demo: opening this page is a real routing decision made by Rilot.',
    category: 'Workspace',
    keywords: ['desk lamp', 'low power lamp', 'demo product'],
    emoji: '💡'
  },
  {
    id: 'beans',
    name: 'Coffee Beans',
    price: 14,
    blurb: 'Single origin, roasted weekly.',
    description:
      'Single-origin beans roasted the week they ship, ground coarse or fine to order. Sample product in the GreenCart demo: opening this page is a real routing decision made by Rilot.',
    category: 'Kitchen',
    keywords: ['coffee beans', 'single origin coffee', 'demo product'],
    emoji: '🫘'
  },
  {
    id: 'notebook',
    name: 'Notebook',
    price: 9,
    blurb: 'Recycled paper, lies flat.',
    description:
      'A hundred and sixty pages of recycled paper in a binding that lies flat on the desk. Sample product in the GreenCart demo: opening this page is a real routing decision made by Rilot.',
    category: 'Workspace',
    keywords: ['recycled notebook', 'lay flat notebook', 'demo product'],
    emoji: '📓'
  },
  {
    id: 'plant',
    name: 'Desk Plant',
    price: 21,
    blurb: 'Hard to kill. We tested.',
    description:
      'A pothos in a glazed pot that survives a fortnight of neglect and a north-facing window. Sample product in the GreenCart demo: opening this page is a real routing decision made by Rilot.',
    category: 'Workspace',
    keywords: ['desk plant', 'low light plant', 'demo product'],
    emoji: '🪴'
  }
];

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id);

export const CATEGORIES = [...new Set(PRODUCTS.map((product) => product.category))];
