/**
 * EmbeddingsModule: chunking + embeddings + Qdrant vector store + worker.
 *
 * The module is inert without `EMBEDDINGS_API_URL` / `QDRANT_URL` (fail-soft):
 * the worker skips jobs when either is unconfigured, so local runs without
 * AI infra still boot and ingest normally.
 */
import { Module } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { DEFAULT_EMBEDDING_DIMENSION } from './embeddings.constants';
import { embeddingProviderConfig, qdrantConfig } from './embeddings.config';
import { EmbeddingProvider } from './embedding.provider';
import { EmbeddingsWorker } from './embeddings.worker';
import { VectorStoreService } from './vector-store.service';

@Module({
  providers: [
    {
      provide: EmbeddingProvider,
      useFactory: () => new EmbeddingProvider(embeddingProviderConfig() ?? undefined),
    },
    {
      provide: VectorStoreService,
      useFactory: () => {
        const config = qdrantConfig();
        const dimension = embeddingProviderConfig()?.dimension ?? DEFAULT_EMBEDDING_DIMENSION;
        return config
          ? new VectorStoreService(new QdrantClient(config), dimension)
          : new VectorStoreService(undefined, dimension);
      },
    },
    EmbeddingsWorker,
  ],
  exports: [EmbeddingProvider, VectorStoreService],
})
export class EmbeddingsModule {}
