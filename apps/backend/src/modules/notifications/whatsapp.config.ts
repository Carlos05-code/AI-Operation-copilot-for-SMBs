/**
 * Twilio WhatsApp configuration for outbound notification delivery
 * (BACKEND_SPEC §12, API_SPEC §11.14).
 *
 * `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_WHATSAPP_FROM` gate
 * configuration; without all three, WhatsApp delivery is inert (fail-soft)
 * so local runs without a Twilio account still boot. `TWILIO_WHATSAPP_FROM`
 * is the sender number only (E.164-ish digits, no `whatsapp:` prefix) —
 * `WhatsAppProvider` adds the prefix Twilio's API requires on both `from`
 * and `to`. Twilio's free WhatsApp Sandbox works here unmodified: its shared
 * sandbox number (e.g. `+14155238886`) is a real, Twilio-issued
 * `TWILIO_WHATSAPP_FROM` value, no paid/approved sender required to
 * exercise this for real.
 */
export interface WhatsAppProviderConfig {
  accountSid: string;
  authToken: string;
  from: string;
}

/** Resolves the Twilio config; `null` when not configured. */
export function whatsappProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): WhatsAppProviderConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}
