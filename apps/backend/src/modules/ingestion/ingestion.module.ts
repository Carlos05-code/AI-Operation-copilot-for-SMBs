/**
 * IngestionModule: document ingestion pipeline (ROADMAP Phase 2).
 *
 * Exposes `IngestionService` to other modules; the storage/outbox/queue
 * services come from their global modules and are optional at boot.
 */
import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { TextExtractionService } from './extraction.service';

@Module({
  controllers: [IngestionController],
  providers: [IngestionService, TextExtractionService],
  exports: [IngestionService],
})
export class IngestionModule {}
