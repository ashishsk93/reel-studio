"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  AssistantMessageDto,
  CreatorTaskDto,
  ImagesStepDto,
  InfluencerDetailDto,
  SettingKey,
  SettingValue,
  VideoStepDto,
  ComposeStepDto,
  RenderDto,
  InfluencerDto,
  ProductSpecDto,
  ProjectDto,
  ProjectSummaryDto,
  SourceDto,
  StoryboardDto,
  UsageSummaryDto,
} from "@reel/shared";
import { SETTINGS } from "@reel/shared";
import { api } from "./api";

export const keys = {
  influencers: ["influencers"] as const,
  influencer: (id: string) => ["influencers", id] as const,
  sources: ["sources"] as const,
  settings: ["settings"] as const,
  usage: ["usage"] as const,
};

export function useUsage(params: { from?: string; projectId?: string }) {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return useQuery({
    queryKey: [...keys.usage, params],
    queryFn: () => api.get<UsageSummaryDto>(`/usage${qs ? `?${qs}` : ""}`),
    refetchInterval: 30_000,
  });
}

export function useInfluencers() {
  return useQuery({ queryKey: keys.influencers, queryFn: () => api.get<InfluencerDto[]>("/influencers") });
}

export function useInfluencer(id: string) {
  return useQuery({ queryKey: keys.influencer(id), queryFn: () => api.get<InfluencerDetailDto>(`/influencers/${id}`) });
}

export function useSources() {
  return useQuery({ queryKey: keys.sources, queryFn: () => api.get<SourceDto[]>("/sources") });
}

export const projectKeys = {
  all: ["projects"] as const,
  one: (id: string) => ["projects", id] as const,
  spec: (id: string) => ["projects", id, "spec"] as const,
  storyboard: (id: string) => ["projects", id, "storyboard"] as const,
  images: (id: string) => ["projects", id, "images"] as const,
  video: (id: string) => ["projects", id, "video"] as const,
  compose: (id: string) => ["projects", id, "compose"] as const,
  renders: (id: string) => ["projects", id, "renders"] as const,
};

/** Under the influencer's key, so every influencer invalidation refreshes the plan too. */
export const creatorKeys = {
  tasks: (influencerId: string) => ["influencers", influencerId, "creator"] as const,
};

export const assistantKeys = {
  messages: (assetId: string) => ["assets", assetId, "assistant"] as const,
};

export function useProjects() {
  return useQuery({ queryKey: projectKeys.all, queryFn: () => api.get<ProjectSummaryDto[]>("/projects") });
}

export function useProject(id: string) {
  return useQuery({ queryKey: projectKeys.one(id), queryFn: () => api.get<ProjectDto>(`/projects/${id}`) });
}

export function useSpec(id: string) {
  return useQuery({
    queryKey: projectKeys.spec(id),
    queryFn: async () => (await api.get<{ spec: ProductSpecDto | null }>(`/projects/${id}/spec`)).spec,
  });
}

export function useStoryboard(id: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.storyboard(id),
    queryFn: () => api.get<StoryboardDto>(`/projects/${id}/storyboard`),
    enabled,
  });
}

export function useImagesStep(id: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.images(id),
    queryFn: () => api.get<ImagesStepDto>(`/projects/${id}/images`),
    enabled,
  });
}

export function useCreatorTasks(influencerId: string) {
  return useQuery({
    queryKey: creatorKeys.tasks(influencerId),
    queryFn: () => api.get<CreatorTaskDto[]>(`/influencers/${influencerId}/creator/tasks`),
  });
}

export function useAssistantMessages(assetId: string, enabled = true) {
  return useQuery({
    queryKey: assistantKeys.messages(assetId),
    queryFn: () => api.get<AssistantMessageDto[]>(`/assets/${assetId}/assistant`),
    enabled,
  });
}

/** One setting's value (shares the settings page's query). */
export function useSetting<K extends SettingKey>(key: K) {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => api.get<Array<{ key: SettingKey; value: unknown }>>("/settings"),
    select: (rows) => (rows.find((r) => r.key === key)?.value ?? SETTINGS[key].default) as SettingValue<K>,
  });
}

export function useVideoStep(id: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.video(id),
    queryFn: () => api.get<VideoStepDto>(`/projects/${id}/video`),
    enabled,
  });
}

export function useComposeStep(id: string) {
  return useQuery({ queryKey: projectKeys.compose(id), queryFn: () => api.get<ComposeStepDto>(`/projects/${id}/compose`) });
}

export function useRenders(id: string) {
  return useQuery({ queryKey: projectKeys.renders(id), queryFn: () => api.get<RenderDto[]>(`/projects/${id}/renders`) });
}
