/**
 * ConnectorsModule: channel adapter layer (ROADMAP Phase 2, API_SPEC §11.9).
 *
 * Translates WhatsApp / email / Slack native payloads into the canonical
 * conversation pipeline. Depends on ConversationsModule for ingestion and on
 * the database for channel-identity customer resolution/provisioning. All
 * services are optional at boot: without a database the endpoints fail with
 * a contract error, never crash.
 */
import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversation.module';
import { ConnectorController } from './connector.controller';
import { ConnectorService } from './connector.service';

@Module({
  imports: [ConversationsModule],
  controllers: [ConnectorController],
  providers: [ConnectorService],
  exports: [ConnectorService],
})
export class ConnectorsModule {}
