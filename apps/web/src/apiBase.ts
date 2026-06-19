const DEFAULT_API_BASE = "/api";

export function getHttpApiBase(): string {
  const configured = import.meta.env.VITE_CODERELAY_API_BASE;
  return (configured || DEFAULT_API_BASE).replace(/\/$/, "");
}
