import crypto from "crypto";
import { TIER_PRICING, type PlanTier } from "../limits";

const STRIPE_BASE = "https://api.stripe.com/v1";

function getKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

export function isStripeEnabled(): boolean {
  return !!getKey();
}

export function getPublishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY || null;
}

function form(body: Record<string, any>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item) {
          parts.push(form(item, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      parts.push(form(v as Record<string, any>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

async function stripeFetch<T = any>(path: string, method: "GET" | "POST" | "DELETE", body?: Record<string, any>): Promise<T> {
  const key = getKey();
  if (!key) throw new Error("Stripe is not configured (missing STRIPE_SECRET_KEY).");
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (body) init.body = form(body);
  const resp = await fetch(`${STRIPE_BASE}${path}`, init);
  const json: any = await resp.json();
  if (!resp.ok) {
    throw new Error(`Stripe ${path} failed: ${json?.error?.message || resp.statusText}`);
  }
  return json as T;
}

function getPriceId(plan: PlanTier, billingPeriod: "monthly" | "annual"): string | null {
  if (plan === "pro") {
    return billingPeriod === "annual" ? (process.env.STRIPE_PRO_PRICE_ID_ANNUAL || null) : (process.env.STRIPE_PRO_PRICE_ID_MONTHLY || null);
  }
  if (plan === "business") {
    return billingPeriod === "annual" ? (process.env.STRIPE_BUSINESS_PRICE_ID_ANNUAL || null) : (process.env.STRIPE_BUSINESS_PRICE_ID_MONTHLY || null);
  }
  return null;
}

export async function ensureCustomer(userId: string, email: string, currentCustomerId: string | null): Promise<string> {
  if (currentCustomerId) return currentCustomerId;
  const customer = await stripeFetch<{ id: string }>("/customers", "POST", {
    email,
    metadata: { userId },
  });
  return customer.id;
}

export async function createCheckoutSession(opts: {
  userId: string;
  email: string;
  customerId: string | null;
  plan: PlanTier;
  billingPeriod: "monthly" | "annual";
  origin: string;
}): Promise<{ url: string; customerId: string }> {
  const priceId = getPriceId(opts.plan, opts.billingPeriod);
  if (!priceId) throw new Error(`Stripe price not configured for ${opts.plan} ${opts.billingPeriod}`);
  const customerId = await ensureCustomer(opts.userId, opts.email, opts.customerId);
  const body: any = {
    mode: "subscription",
    customer: customerId,
    success_url: `${opts.origin}/billing?success=1&plan=${opts.plan}`,
    cancel_url: `${opts.origin}/billing?canceled=1`,
    allow_promotion_codes: true,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { userId: opts.userId, plan: opts.plan, billingPeriod: opts.billingPeriod } },
    metadata: { userId: opts.userId, plan: opts.plan, billingPeriod: opts.billingPeriod },
  };
  const session = await stripeFetch<{ id: string; url: string }>("/checkout/sessions", "POST", body);
  return { url: session.url, customerId };
}

export async function createPortalSession(opts: { customerId: string; origin: string }): Promise<{ url: string }> {
  return stripeFetch<{ url: string }>("/billing_portal/sessions", "POST", {
    customer: opts.customerId,
    return_url: `${opts.origin}/billing`,
  });
}

export async function getSubscription(subscriptionId: string): Promise<any> {
  return stripeFetch(`/subscriptions/${subscriptionId}`, "GET");
}

/**
 * Verify Stripe webhook signature. Header format: `t=...,v1=hex,...`
 */
export function verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const payload = `${t}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
  } catch {
    return false;
  }
}

export function planFromPriceId(priceId: string | undefined | null): { plan: PlanTier; billingPeriod: "monthly" | "annual" } | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRO_PRICE_ID_MONTHLY) return { plan: "pro", billingPeriod: "monthly" };
  if (priceId === process.env.STRIPE_PRO_PRICE_ID_ANNUAL) return { plan: "pro", billingPeriod: "annual" };
  if (priceId === process.env.STRIPE_BUSINESS_PRICE_ID_MONTHLY) return { plan: "business", billingPeriod: "monthly" };
  if (priceId === process.env.STRIPE_BUSINESS_PRICE_ID_ANNUAL) return { plan: "business", billingPeriod: "annual" };
  return null;
}

export function getPriceUsd(plan: PlanTier, billingPeriod: "monthly" | "annual"): number {
  return billingPeriod === "annual" ? TIER_PRICING[plan].annualUsd : TIER_PRICING[plan].monthlyUsd;
}
