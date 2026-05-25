import { api } from "./client";
import { KEYS, storage } from "../storage";
import type { AdminMetrics, RegistrationApplication, User } from "../types";
import { findModel, MODELS } from "../catalog";

export async function listApplications(): Promise<RegistrationApplication[]> {
  try {
    return await api<RegistrationApplication[]>("/admin/applications");
  } catch {
    return storage.get<RegistrationApplication[]>(KEYS.applications, []);
  }
}

export async function approveApplication(id: string, reviewer: string): Promise<User> {
  const data = await api<{ user: User }>(`/admin/applications/${id}/approve`, { method: "POST" });
  return data.user;
}

export async function rejectApplication(id: string, reviewer: string, reason: string): Promise<void> {
  await api(`/admin/applications/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function listUsers(): Promise<User[]> {
  try {
    return await api<User[]>("/admin/users");
  } catch {
    return storage.get<User[]>(KEYS.users, []);
  }
}

export async function updateUserStatus(id: string, status: User["status"]): Promise<void> {
  await api(`/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function updateUserRole(id: string, role: User["role"]): Promise<void> {
  await api(`/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function metrics(): Promise<AdminMetrics> {
  return api<AdminMetrics>("/admin/metrics");
}

export function getModelName(modelId: string): string {
  return findModel(modelId)?.name ?? modelId;
}
