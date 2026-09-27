// A second place to watch the browser do the validating: the rules are all
// HTML attributes, and a valid submit becomes one more routed request.
import { useState } from 'react';
import { SUBSCRIBE } from '../../shop/requests';
import { request } from '../../state/store';

export default function NewsletterForm() {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="signup-done" role="status">
        Thanks — that <code>POST /newsletter/subscribe</code> was routed too. Check the panel.
      </p>
    );
  }

  return (
    <form
      className="signup"
      onSubmit={(event) => {
        event.preventDefault();
        request(SUBSCRIBE);
        setDone(true);
      }}
    >
      <label>
        <span>Grid-friendly deals, once a month</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          title="A complete email address, like you@example.com"
        />
      </label>
      <button className="secondary" type="submit">
        Subscribe
      </button>
    </form>
  );
}
