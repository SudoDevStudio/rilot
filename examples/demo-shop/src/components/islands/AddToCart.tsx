import { useState } from 'react';
import { ADD_TO_CART } from '../../shop/requests';
import { addToCart, request } from '../../state/store';

/**
 * Adding to the cart is its own request (`POST /cart/items`), not a page
 * navigation — so the panel shows it being routed without the page reloading.
 */
export default function AddToCart({ id, name, wide }: { id: string; name: string; wide?: boolean }) {
  const [added, setAdded] = useState(false);

  const add = () => {
    addToCart(id);
    request(ADD_TO_CART);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
  };

  return (
    // The visible label stays short; screen readers get the product name.
    <button
      className={wide ? 'primary wide' : 'secondary'}
      type="button"
      onClick={add}
      aria-label={`Add ${name} to cart`}
    >
      {added ? 'Added ✓' : 'Add to cart'}
    </button>
  );
}
