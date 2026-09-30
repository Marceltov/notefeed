import { handlePost } from "@/lib/post";

// Reached through proxy.ts, which rewrites POST /<feed> here.
export async function POST(req: Request, { params }: { params: Promise<{ feed: string }> }) {
  return handlePost(req, (await params).feed);
}
