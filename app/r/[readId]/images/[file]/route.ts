import { imageRoute } from "@/backend";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: RouteContext<"/r/[readId]/images/[file]">) {
  const { readId, file } = await params;
  return imageRoute(readId, file);
}
