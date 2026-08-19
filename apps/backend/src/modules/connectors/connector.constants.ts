/**
 * Channel connector constants (ROADMAP Phase 2, API_SPEC §11.9).
 */
export const CONNECTOR_CHANNELS = ['whatsapp', 'email', 'slack'] as const;
export type ConnectorChannel = (typeof CONNECTOR_CHANNELS)[number];

export const CONNECTOR_FROM_MAX_LENGTH = 255;
export const CONNECTOR_SUBJECT_MAX_LENGTH = 255;
export const CONNECTOR_USER_MAX_LENGTH = 255;
export const CONNECTOR_THREAD_MAX_LENGTH = 255;
