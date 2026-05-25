import { api } from "./client";

export async function polishPrompt(
  prompt: string,
  kind: "image" | "video" = "image",
): Promise<{ polished: string }> {
  return api("/llm/polish", {
    method: "POST",
    body: JSON.stringify({ prompt, kind }),
  });
}
