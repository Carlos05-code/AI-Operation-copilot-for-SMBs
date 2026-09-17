/**
 * SearchModule: OpenSearch full-text indexing (HTTP half) + hybrid retrieval.
 *
 * The indexing worker lives in `search-worker.module.ts` — this module stays
 * HTTP-only so the worker process never instantiates `SearchController`. The
 * module is inert without `OPENSEARCH_URL` (fail-soft): hybrid search
 * degrades to vector-only results, so local runs without AI infra still boot
 * and answer queries.
 */
import { Module } from '@nestjs/common';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { GraphModule } from '../graph/graph.module';
import { HybridSearchService } from './hybrid-search.service';
import { createSearchService } from './search.config';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [EmbeddingsModule, GraphModule],
  controllers: [SearchController],
  providers: [{ provide: SearchService, useFactory: createSearchService }, HybridSearchService],
  exports: [SearchService, HybridSearchService],
})
export class SearchModule {}
