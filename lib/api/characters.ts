import { api } from "./client";

export interface CharacterAsset {
  id: string;
  subjectId: string;
  kind: "full_body" | "three_views" | "headshot";
  imageUrl?: string;
  promptUsed?: string;
  status: "idle" | "running" | "succeeded" | "failed";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listAssets(subjectId: string): Promise<CharacterAsset[]> {
  return api<CharacterAsset[]>(`/characters/${subjectId}/assets`);
}

export async function generateAssets(
  subjectId: string,
  kinds: Array<"full_body" | "three_views" | "headshot">,
): Promise<{ assets: CharacterAsset[] }> {
  return api(`/characters/${subjectId}/generate`, {
    method: "POST",
    body: JSON.stringify({ kinds }),
  });
}

export async function deleteAsset(subjectId: string, assetId: string): Promise<void> {
  await api(`/characters/${subjectId}/assets/${assetId}`, { method: "DELETE" });
}
