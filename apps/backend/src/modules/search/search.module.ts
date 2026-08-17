/**
 * SearchModule: OpenSearch full-text indexing + hybrid retrieval.
 *
 * The module is inert without `OPENSEARCH_URL` (fail-soft): the worker skips
 * indexing jobs and hybrid search degrades to vector-only results, so local
 * runs without AI infra still boot and answer queries.
 */
import { Module } from '@nestjs/common';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { HybridSearchService } from './hybrid-search.service';
import { searchConfig } from './search.config';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchWorker } from './search.worker';

@Module({
  imports: [EmbeddingsModule],
  controllers: [SearchController],
  providers: [
    {
      provide: SearchService,
      useFactory: () => {
        const config = searchConfig();
        if (!config) return new SearchService(undefined);
        return new SearchService(
          new OpenSearchClient({
            node: config.url,
            auth: config.username
              ? { username: config.username, password: config.password ?? '' }
              : undefined,
          }),
        );
      },
    },
    HybridSearchService,
    SearchWorker,
  ],
  exports: [SearchService, HybridSearchService],
})
export class SearchModule {}
