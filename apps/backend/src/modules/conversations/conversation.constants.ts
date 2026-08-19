/**
 * Conversation ingestion constants (DATABASE_SPEC §3, §5, API_SPEC §11.6).
 */
export const JOB_CONVERSATION_EMBED = 'conversation.embed';
export const EVENT_CONVERSATION_INGESTED = 'conversation.ingested';
export const EVENT_CONVERSATION_EMBEDDED = 'conversation.embedded';

export const JOB_CONVERSATION_SUMMARIZE = 'conversation.summarize';
export const EVENT_CONVERSATION_SUMMARIZED = 'conversation.summarized';
export const SUMMARY_PROMPT_VERSION = 'summarize.conversation.v1';

export const CONVERSATION_CHANNELS = ['WHATSAPP', 'EMAIL', 'SLACK'] as const;
export const MESSAGE_SENDERS = ['CUSTOMER', 'AGENT', 'SYSTEM'] as const;

/** Max messages accepted in one ingestion request. */
export const CONVERSATION_MAX_MESSAGES = 500;
export const MESSAGE_BODY_MAX_LENGTH = 8000;
export const CONVERSATION_EXTERNAL_ID_MAX_LENGTH = 255;
export const CONVERSATION_TITLE_MAX_LENGTH = 255;

/**
 * Transcript window the summarizer feeds the LLM: when the conversation
 * exceeds this budget the OLDEST messages are dropped (the tail is what
 * matters for a handoff summary).
 */
export const CONVERSATION_SUMMARY_CONTEXT_CHARS = 20000;
export const CONVERSATION_SUMMARY_MAX_TOKENS = 500;
export const CONVERSATION_SUMMARY_KEY_POINTS_MAX = 6;
