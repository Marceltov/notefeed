import { metricsRoute } from "@/backend";

export const dynamic = "force-dynamic";

// Scraped by Prometheus; see backend/http/metrics.ts. Reserved as a feed name (backend/feeds.ts).
export const GET = (req: Request) => metricsRoute(req);
