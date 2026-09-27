// Checkout, validated by the browser.
//
// There is no validation logic in this file on purpose: every rule is an HTML
// attribute (`required`, `type`, `pattern`, `minlength`, `maxlength`), so the
// browser blocks an invalid submit before React ever sees it and writes the
// message itself. The only JavaScript here is what happens *after* a valid
// submit: route `POST /checkout/pay` and empty the cart.
import { useEffect, useState } from 'react';
import { href } from '../../lib/links';
import { productById } from '../../shop/catalog';
import { PAY } from '../../shop/requests';
import { clearCart, readState, request, subscribe } from '../../state/store';

export default function CheckoutForm() {
  const [cart, setCart] = useState<string[] | null>(null);
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    setCart(readState().cart);
    return subscribe((state) => setCart(state.cart));
  }, []);

  const total = (cart ?? []).reduce((sum, id) => sum + (productById(id)?.price ?? 0), 0);

  const pay = (event: React.FormEvent<HTMLFormElement>) => {
    // The browser has already refused every invalid state by this point.
    event.preventDefault();
    request(PAY);
    clearCart();
    setPlaced(true);
  };

  if (placed) {
    return (
      <div className="empty">
        <p className="product-art" aria-hidden="true">
          ✅
        </p>
        <h2>Order placed</h2>
        <p className="muted">
          The payment request went to the closest healthy backend — see the panel on the right, where the carbon step was
          skipped entirely.
        </p>
        <a className="primary" href={href('/')}>
          Keep shopping
        </a>
      </div>
    );
  }

  if (cart !== null && cart.length === 0) {
    return (
      <div className="empty">
        <p>There is nothing to pay for yet.</p>
        <a className="primary" href={href('/products')}>
          Find something
        </a>
      </div>
    );
  }

  return (
    <form className="checkout-form" onSubmit={pay} noValidate={false}>
      <fieldset>
        <legend>Contact</legend>

        <label>
          <span>Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            title="A complete email address, like you@example.com"
          />
          <small className="hint">We send the receipt here.</small>
        </label>

        <label>
          <span>Full name</span>
          <input
            type="text"
            name="name"
            required
            minLength={2}
            maxLength={60}
            autoComplete="name"
            placeholder="Alex Green"
            title="At least two characters"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Delivery</legend>

        <div className="row">
          <label>
            <span>Postcode</span>
            <input
              type="text"
              name="postcode"
              required
              maxLength={12}
              pattern="[A-Za-z0-9 \-]{3,12}"
              autoComplete="postal-code"
              placeholder="10001"
              title="Three to twelve letters, digits, spaces or hyphens"
            />
          </label>

          <label>
            <span>Country</span>
            <select name="country" required defaultValue="" autoComplete="country">
              <option value="" disabled>
                Choose a country
              </option>
              <option value="IE">Ireland</option>
              <option value="GB">United Kingdom</option>
              <option value="SG">Singapore</option>
              <option value="US">United States</option>
            </select>
          </label>
        </div>

        <div className="choice-group" role="radiogroup" aria-label="Delivery speed">
          <label className="choice">
            <input type="radio" name="delivery" value="standard" required defaultChecked />
            <span>
              <strong>Standard</strong>
              <small>3–5 days, free over $40</small>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="delivery" value="grouped" required />
            <span>
              <strong>Grouped</strong>
              <small>One van, one street, one week</small>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Payment</legend>
        <p className="hint">Nothing is sent anywhere. Use any digits that fit the pattern.</p>

        <label>
          <span>Card number</span>
          <input
            type="text"
            name="card"
            required
            inputMode="numeric"
            autoComplete="cc-number"
            maxLength={19}
            pattern="[0-9]{4} ?[0-9]{4} ?[0-9]{4} ?[0-9]{4}"
            placeholder="4242 4242 4242 4242"
            title="Sixteen digits, spaces allowed"
          />
        </label>

        <div className="row">
          <label>
            <span>Expiry</span>
            <input
              type="text"
              name="expiry"
              required
              inputMode="numeric"
              autoComplete="cc-exp"
              maxLength={7}
              pattern="(0[1-9]|1[0-2]) ?/ ?[0-9]{2}"
              placeholder="04 / 29"
              title="Month and year, like 04 / 29"
            />
          </label>

          <label>
            <span>CVC</span>
            <input
              type="text"
              name="cvc"
              required
              inputMode="numeric"
              autoComplete="cc-csc"
              maxLength={4}
              pattern="[0-9]{3,4}"
              placeholder="123"
              title="Three or four digits"
            />
          </label>
        </div>
      </fieldset>

      <label className="consent">
        <input type="checkbox" name="terms" required title="Please confirm to continue" />
        <span>I understand this is a demo and no order will be placed.</span>
      </label>

      <button className="primary wide" type="submit">
        Pay ${total}
      </button>
      <p className="hint centered">
        Paying is latency-sensitive, so the <code>/checkout/*</code> rule sends it to the closest healthy backend and never
        waits on carbon data.
      </p>
    </form>
  );
}
