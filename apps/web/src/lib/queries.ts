"use client";

import { useQuery } from "@tanstack/react-query";
import type { InfluencerDetailDto, InfluencerDto, SourceDto } from "@reel/shared";
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
