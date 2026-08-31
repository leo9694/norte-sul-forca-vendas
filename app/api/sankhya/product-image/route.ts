import { requireSession, sankhyaProductImageUrl } from "../../_lib/sankhya";

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const product = Number(new URL(request.url).searchParams.get("product"));
    if (!Number.isInteger(product) || product <= 0) return Response.json({ error: "Produto inválido." }, { status: 400 });
    const image = await fetch(sankhyaProductImageUrl(product), { cache: "no-store" });
    if (!image.ok || !image.body) return new Response(null, { status: image.status || 404 });
    return new Response(image.body, { headers: { "Content-Type": image.headers.get("content-type") || "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
