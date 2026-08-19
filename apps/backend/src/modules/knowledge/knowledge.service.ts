/**
 * KnowledgeService: knowledge-base surface (ROADMAP Phase 2).
 *
 * Reads are ALWAYS org-scoped: every query filters by `organizationId` from
 * the verified token, so a member can never list or fetch another org's
 * knowledge entries (entity-level access control, API_SPEC §6). Foreign or
 * absent entries surface as 404 — existence is never leaked across tenants.
 *
 * The registry holds only documents that reached INDEXED (see ingestion).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';

export interface KnowledgeEntry {
  id: string;
  organizationId: string;
  documentId: string;
  title: string;
  objectKey: string;
  createdAt: Date;
  updatedAt: Date;
  document: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    status: string;
  };
}

export interface KnowledgePage {
  items: KnowledgeEntry[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const ENTRY_SELECT = {
  id: true,
  organizationId: true,
  documentId: true,
  title: true,
  objectKey: true,
  createdAt: true,
  updatedAt: true,
  document: {
    select: {
      fileName: true,
      contentType: true,
      sizeBytes: true,
      status: true,
    },
  },
} as const;

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Lists the org's knowledge entries, newest first (offset pagination). */
  async list(organizationId: string, page = 1, limit = 20): Promise<KnowledgePage> {
    const prisma = this.requirePrisma();
    const [items, total] = await Promise.all([
      prisma.knowledgeDocument.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: ENTRY_SELECT,
      }),
      prisma.knowledgeDocument.count({ where: { organizationId } }),
    ]);
    return {
      items,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Fetches one org-scoped knowledge entry (404 when absent/foreign). */
  async get(organizationId: string, id: string): Promise<KnowledgeEntry> {
    const prisma = this.requirePrisma();
    const entry = await prisma.knowledgeDocument.findFirst({
      where: { id, organizationId },
      select: ENTRY_SELECT,
    });
    if (!entry) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Knowledge entry not found',
      });
    }
    return entry;
  }

  private requirePrisma(): PrismaService {
    if (!this.prisma) {
      throw new ApiError({
        code: HttpErrorCode.INTERNAL_ERROR,
        status: 503,
        message: 'Database is not configured',
      });
    }
    return this.prisma;
  }
}
