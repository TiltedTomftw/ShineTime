const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OcrRequest = {
  imageBase64?: string;
  mimeType?: string;
  dataUrl?: string;
};

const sanitizeInput = (input: string) =>
  (input || "")
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/javascript:/gi, "")
    .trim()
    .slice(0, 200);

const stripCodeFences = (text: string) => {
  const trimmed = (text || "").trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z0-9]*\n?/, "").replace(/```$/, "").trim();
};

const extractJsonFromText = (text: string) => {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return text.slice(first, last + 1);
};

const safeParseJson = (text: string) => {
  const cleaned = stripCodeFences(text || "");
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      const extracted = extractJsonFromText(cleaned);
      return extracted ? JSON.parse(extracted) : null;
    } catch {
      return null;
    }
  }
};

const parseDataUrl = (dataUrl?: string) => {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl || "");
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      return json(500, { error: "OCR function is not configured" });
    }

    const authHeader = req.headers.get("Authorization") || "";
    // Auth is enforced by Supabase Edge Function JWT verification.
    // No additional in-function auth check required.

    const body = (await req.json()) as OcrRequest;
    const image = body?.dataUrl
      ? parseDataUrl(body.dataUrl)
      : body?.imageBase64 && body?.mimeType
      ? { base64: body.imageBase64, mimeType: body.mimeType }
      : null;

    if (!image?.base64 || !image?.mimeType) {
      return json(400, { error: "Image data is required" });
    }

    // Cap payload size so a caller cannot exhaust memory or burn Gemini quota
    // with an oversized image. ~8MB of base64 ≈ ~6MB decoded.
    const MAX_BASE64_LENGTH = 8 * 1024 * 1024;
    if (image.base64.length > MAX_BASE64_LENGTH) {
      return json(413, { error: "Image too large; please retake at lower resolution" });
    }

    if (!/^image\//.test(image.mimeType)) {
      return json(400, { error: "Unsupported image type" });
    }

    const prompt =
      "You are extracting vehicle details from a keytag or window sticker. " +
      "Return JSON only with keys: stockNumber, year, make, model, color, vin. " +
      "VIN is a 17-character alphanumeric code if shown; use an empty string if it is not present. " +
      "Use empty strings for any missing field. Do not include extra keys or commentary.";

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: image.mimeType,
                    data: image.base64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            // gemini-2.5-flash is a thinking model; disable reasoning (this is a
            // simple extraction) so output tokens aren't spent before the JSON,
            // and keep headroom so the answer isn't truncated (MAX_TOKENS).
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!geminiResp.ok) {
      const details = (await geminiResp.text()).slice(0, 800);
      return json(502, { error: "OCR request failed", details });
    }

    const geminiData = await geminiResp.json();
    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: { text?: string }) => p.text || "").join("\n").trim();
    const parsed = safeParseJson(text);

    if (!parsed) {
      const finishReason = geminiData?.candidates?.[0]?.finishReason || "unknown";
      return json(422, {
        error: "Could not parse OCR response",
        details: `finishReason: ${finishReason}`,
      });
    }

    return json(200, {
      stockNumber: sanitizeInput(parsed.stockNumber || ""),
      year: sanitizeInput(parsed.year || ""),
      make: sanitizeInput(parsed.make || ""),
      model: sanitizeInput(parsed.model || ""),
      color: sanitizeInput(parsed.color || ""),
      vin: sanitizeInput(parsed.vin || ""),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json(500, { error: message });
  }
});
