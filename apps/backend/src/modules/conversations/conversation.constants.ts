/**
 * Conversation ingestion constants (DATABASE_SPEC §3, §5, API_SPEC §11.6).
 */
export const JOB_CONVERSATION_EMBED = 'conversation.embed';
export const EVENT_CONVERSATION_INGESTED = 'conversation.ingested';
export const EVENT_CONVERSATION_EMBEDDED = 'conversation.embedded';

export const CONVERSATION_CHANNELS = ['WHATSAPP', 'EMAIL', 'SLACK'] as const;
export const MESSAGE_SENDERS = ['CUSTOMER', 'AGENT', 'SYSTEM'] as const;

/** Max messages accepted in one ingestion request. */
export const CONVERSATION_MAX_MESSAGES = 500;
export const MESSAGE_BODY_MAX_LENGTH = 8000;
export const CONVERSATION_EXTERNAL_ID_MAX_LENGTH = 255;
export const CONVERSATION_TITLE_MAX_LENGTH = 255;
