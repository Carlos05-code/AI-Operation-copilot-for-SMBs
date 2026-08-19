/**
 * KnowledgeModule: knowledge-base surface (ROADMAP Phase 2).
 *
 * Read-only, org-scoped browsing of the knowledge registry. Fails with a
 * contract error when the database is not configured; never blocks boot.
 */
import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
