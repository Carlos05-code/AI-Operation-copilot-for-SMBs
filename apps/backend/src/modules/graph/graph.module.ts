/**
 * GraphModule: knowledge-graph indexing + retrieval (ADR-0005).
 *
 * The module is inert without `NEO4J_URI` (fail-soft): the worker skips
 * indexing jobs and hybrid search skips the graph stage, so local runs
 * without infra still boot and answer queries.
 */
import { Module } from '@nestjs/common';
import neo4j from 'neo4j-driver';
import { graphConfig } from './graph.config';
import { GraphService } from './graph.service';
import { GraphWorker } from './graph.worker';

@Module({
  providers: [
    {
      provide: GraphService,
      useFactory: () => {
        const config = graphConfig();
        if (!config) return new GraphService(undefined, undefined);
        const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password), {
          disableLosslessIntegers: true,
        });
        return new GraphService(driver, config.database);
      },
    },
    GraphWorker,
  ],
  exports: [GraphService],
})
export class GraphModule {}
