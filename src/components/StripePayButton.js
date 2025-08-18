// src/components/StripePayButton.js
import { loadStripe } from "@stripe/stripe-js";

function getPublishableKey() {
  // Works in both CRA and Vite
  const vite = typeof import.meta !== "undefined" && import.meta.env;
  return (
    (vite && vite.VITE_STRIPE_PUBLISHABLE_KEY) ||
    process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY ||
    ""
  );
}

const pk = getPublishableKey();
if (!pk) {
  // Helpful console message if the key isn't found
  // eslint-disable-next-line no-console
  console.error(
    "Stripe publishable key missing. Set VITE_STRIPE_PUBLISHABLE_KEY (Vite) or REACT_APP_STRIPE_PUBLISHABLE_KEY (CRA)."
  );
}

const stripePromise = loadStripe(pk);

/**
 * Props:
 * - buildPayload(): { orderId, lineItems[], currency, customerEmail, successUrl, cancelUrl }
 * - createSessionUrl: string (your API endpoint to create a Checkout Session)
 * - disabled?: boolean
 * - label?: string
 */
export default function StripePayButton({
  buildPayload,
  createSessionUrl,
  disabled,
  label = "Confirm & Pay",
}) {
  const onClick = async () => {
    const stripe = await stripePromise;
    if (!stripe) {
      alert("Stripe not initialized: missing publishable key.");
      return;
    }

    const payload = await buildPayload();

    const res = await fetch(createSessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to create checkout session");
    }
    const data = await res.json();

    if (data.url) {
      window.location = data.url;
    } else {
      await stripe.redirectToCheckout({ sessionId: data.id });
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={!!disabled}
      className={`mt-4 w-full px-6 py-2 rounded ${
        !disabled ? "bg-[#F58735] hover:bg-orange-600" : "bg-gray-600 cursor-not-allowed"
      }`}
    >
      {label}
    </button>
  );
}
