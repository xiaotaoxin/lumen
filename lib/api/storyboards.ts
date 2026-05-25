import { api } from "./client";

export interface StoryboardFrame {
  id: string;
  storyboardId: string;
  orderIndex: number;
  shotDescription: string;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  dialogue: string;
  speaker: string;
  imagePrompt: string;
  imageUrl?: string;
  videoUrl?: string;
  status: "idle" | "running" | "succeeded" | "failed";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Storyboard {
  id: string;
  userId: string;
  sessionId?: string;
  title: string;
  frameCount?: number;
  frames?: StoryboardFrame[];
  createdAt: string;
  updatedAt: string;
}

export async function list(): Promise<Storyboard[]> {
  return api("/storyboards");
}

export async function get(id: string): Promise<Storyboard> {
  return api(`/storyboards/${id}`);
}

export async function create(data: { title?: string; sessionId?: string }): Promise<Storyboard> {
  return api("/storyboards", { method: "POST", body: JSON.stringify(data) });
}

export async function remove(id: string): Promise<void> {
  await api(`/storyboards/${id}`, { method: "DELETE" });
}

export async function addFrame(boardId: string, data: Partial<StoryboardFrame>): Promise<StoryboardFrame> {
  return api(`/storyboards/${boardId}/frames`, { method: "POST", body: JSON.stringify(data) });
}

export async function updateFrame(boardId: string, frameId: string, data: Partial<StoryboardFrame>): Promise<StoryboardFrame> {
  return api(`/storyboards/${boardId}/frames/${frameId}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteFrame(boardId: string, frameId: string): Promise<void> {
  await api(`/storyboards/${boardId}/frames/${frameId}`, { method: "DELETE" });
}

export async function reorderFrames(boardId: string, ids: string[]): Promise<void> {
  await api(`/storyboards/${boardId}/frames/reorder`, { method: "POST", body: JSON.stringify({ ids }) });
}

export async function generateFrame(boardId: string, frameId: string): Promise<StoryboardFrame> {
  return api(`/storyboards/${boardId}/frames/${frameId}/generate`, { method: "POST" });
}

export async function generateVideo(boardId: string, frameId: string): Promise<StoryboardFrame> {
  return api(`/storyboards/${boardId}/frames/${frameId}/generate-video`, { method: "POST" });
}
