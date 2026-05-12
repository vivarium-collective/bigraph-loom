/**
 * Default sms-api base URL.
 * Override at build time via VITE_SMS_API_BASE_URL env var,
 * or at runtime via the SimulationPanel UI (persisted to localStorage).
 */
export const DEFAULT_SMS_API_BASE_URL: string =
  import.meta.env.VITE_SMS_API_BASE_URL ?? "https://sms.cam.uchc.edu";

/**
 * Get the current sms-api base URL, preferring a runtime override.
 */
export function getSmsApiBaseUrl(): string {
  return localStorage.getItem("smsApiBaseUrl") ?? DEFAULT_SMS_API_BASE_URL;
}
