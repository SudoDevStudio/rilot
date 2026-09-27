import { useEffect, useState } from 'react';
import { readState, subscribe } from '../../state/store';

/** The number on the Cart link. Reads the cart the other pages wrote. */
export default function CartBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(readState().cart.length);
    return subscribe((state) => setCount(state.cart.length));
  }, []);

  if (count === 0) return null;
  return (
    <span className="cart-count" aria-label={`${count} item${count === 1 ? '' : 's'} in cart`}>
      {count}
    </span>
  );
}
