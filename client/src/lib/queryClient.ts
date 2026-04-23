import { QueryClient, QueryFunction } from "@tanstack/react-query";

export type PaywallDetails = {
  code: "upgrade_required";
  feature?: string;
  quota?: string;
  currentPlan: "free" | "pro" | "business";
  requiredPlan: "free" | "pro" | "business";
  current?: number;
  limit?: number;
  message: string;
};

export class PaywallApiError extends Error {
  status = 402;
  details: PaywallDetails;
  constructor(details: PaywallDetails) {
    super(details.message);
    this.name = "PaywallApiError";
    this.details = details;
  }
}

export const PAYWALL_EVENT = "paywall:required";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 402) {
      let details: PaywallDetails | null = null;
      try {
        details = (await res.clone().json()) as PaywallDetails;
      } catch {
        details = null;
      }
      if (details && details.code === "upgrade_required") {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent<PaywallDetails>(PAYWALL_EVENT, { detail: details }));
        }
        throw new PaywallApiError(details);
      }
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
