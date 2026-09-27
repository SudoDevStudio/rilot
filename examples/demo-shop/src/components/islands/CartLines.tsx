import { useEffect, useState } from 'react';
import { href } from '../../lib/links';
import { productById } from '../../shop/catalog';
import { readState, subscribe } from '../../state/store';

/** The cart contents, which were filled on other pages. */
export default function CartLines() {
  const [cart, setCart] = useState<string[] | null>(null);

  useEffect(() => {
    setCart(readState().cart);
    return subscribe((state) => setCart(state.cart));
  }, []);

  if (cart === null) return <p className="muted">Loading your cart…</p>;

  if (cart.length === 0) {
    return (
      <div className="empty">
        <p>Your cart is empty.</p>
        <a className="primary" href={href('/products')}>
          Find something
        </a>
      </div>
    );
  }

  const total = cart.reduce((sum, id) => sum + (productById(id)?.price ?? 0), 0);

  return (
    <>
      <ul className="cart-list">
        {cart.map((id, index) => {
          const product = productById(id);
          return (
            <li key={`${id}-${index}`}>
              <span aria-hidden="true">{product?.emoji}</span>
              <span>{product?.name}</span>
              <span className="price">${product?.price}</span>
            </li>
          );
        })}
      </ul>
      <div className="cart-total">
        <span>Total</span>
        <strong>${total}</strong>
      </div>
      <a className="primary wide" href={href('/checkout')}>
        Checkout
      </a>
    </>
  );
}
