-- Adds User.whatsapp: an E.164-ish WhatsApp number for outbound notification
-- delivery (API_SPEC §11.14). No self-service way to set it yet (no
-- user-profile endpoint exists) — seed/DB-set only.
ALTER TABLE "users" ADD COLUMN "whatsapp" TEXT;
