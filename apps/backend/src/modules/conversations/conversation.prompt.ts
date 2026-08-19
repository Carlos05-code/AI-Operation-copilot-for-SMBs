/**
 * Conversation summarization prompts (AI_ARCHITECTURE §6.1 `summarize.conversation`).
 *
 * The model gets a windowed transcript (oldest messages dropped when the
 * conversation exceeds the context budget — a handoff summary cares about the
 * tail) and must answer with a strict JSON object, never free text, so the
 * worker can persist it deterministically.
 */
import type { Message, MessageSender } from '@prisma/client';
import { CONVERSATION_SUMMARY_KEY_POINTS_MAX } from './conversation.constants';

export const SUMMARIZE_SYSTEM_PROMPT = `You are a customer-support analyst. Summarize the customer
conversation transcript below for a teammate taking over the thread. The summary must be factual,
concise, and written from the customer's perspective. Respond ONLY with a JSON object of exactly
this shape (no markdown, no commentary):

{
  "summary": "2-4 sentence plain-text handoff summary",
  "keyPoints": ["up to ${CONVERSATION_SUMMARY_KEY_POINTS_MAX} short bullet strings"]
}`;

export interface SummaryInput {
  channel: string;
  title?: string | null;
  messages: Array<Pick<Message, 'sender' | 'body' | 'sentAt'>>;
  /** True when the transcript was truncated to the tail to fit the budget. */
  truncated: boolean;
}

const SENDER_LABELS: Record<MessageSender, string> = {
  CUSTOMER: 'Customer',
  AGENT: 'Agent',
  SYSTEM: 'System',
};

export function buildSummarizeUserPrompt(input: SummaryInput): string {
  const transcript = input.messages
    .map(
      (message) =>
        `${message.sentAt.toISOString()} [${SENDER_LABELS[message.sender]}] ${message.body}`,
    )
    .join('\n');
  const head = [
    `Channel: ${input.channel}`,
    input.title ? `Title: ${input.title}` : null,
    input.truncated
      ? 'Note: the conversation was long; older messages were omitted, only the most recent portion is shown.'
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  return `${head}\n\n---\n${transcript}`;
}
