/**
 * Centralized backend endpoints. Previously these URLs were hardcoded inline
 * across pages; collecting them here makes the DNS cutover and any environment
 * swap a one-file change. Override at build time with REACT_APP_* env vars.
 */
const ENV = process.env;

export const ENDPOINTS = {
  // Catering API Gateway (products, etc.)
  getProducts:
    ENV.REACT_APP_GET_PRODUCTS_URL ||
    'https://0lab8hw7af.execute-api.us-east-2.amazonaws.com/get-products',

  // Order creation
  createOrder:
    ENV.REACT_APP_CREATE_ORDER_URL ||
    'https://1rfhn6cj58.execute-api.us-east-2.amazonaws.com/default/create-order-dev',

  // Stripe checkout session
  createCheckoutSession:
    ENV.REACT_APP_CHECKOUT_SESSION_URL ||
    'https://53edtj8x78.execute-api.us-east-2.amazonaws.com/payments/create-checkout-session',

  // India 101 portal (What's Cooking posts API).
  // TODO(dns-cutover): switch default to https://india101.com once live.
  portalApi:
    ENV.REACT_APP_PORTAL_API_URL ||
    'https://main.d2vl6i6rbo3rbt.amplifyapp.com',
};

export default ENDPOINTS;
