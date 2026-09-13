/**
 * SMTP configuration for outbound notification email (BACKEND_SPEC §12).
 *
 * `SMTP_HOST` + `SMTP_FROM` gate configuration; without both, email delivery
 * is inert (fail-soft) so local runs without an SMTP server still boot.
 */
export interface EmailProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

/** Resolves the SMTP config; `null` when not configured. */
export function emailProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmailProviderConfig | null {
  const host = env.SMTP_HOST;
  const from = env.SMTP_FROM;
  if (!host || !from) return null;
  const port = Number(env.SMTP_PORT ?? 587);
  return {
    host,
    port,
    secure: port === 465,
    user: env.SMTP_USER || undefined,
    password: env.SMTP_PASSWORD || undefined,
    from,
  };
}
