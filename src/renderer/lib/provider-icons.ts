import type { ProviderId } from "../../../shared/provider-catalog";

export function getProviderLogoPath(providerId: ProviderId): string {
  const base = import.meta.env.BASE_URL;
  const normalizedBase = !base || base === "/" ? "./" : base;
  return `${normalizedBase}provider-logos/${providerId}.svg`;
}
