"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  InfluencerDetailDto,
  InfluencerDto,
  ProductSpecDto,
  ProjectDto,
  ProjectSummaryDto,
  SourceDto,
  StoryboardDto,
} from "@reel/shared";
import { api } from "./api";

export const keys = {
  influencers: ["influencers"] as const,
  influencer: (id: string) => ["influencers", id] as const,
  sources: ["sources"] as const,
  settings: ["settings"] as const,
  usage: ["usage"] as const,
};

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
