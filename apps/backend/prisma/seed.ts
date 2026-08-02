/**
 * Development seed data (idempotent — safe to re-run).
 * Creates a demo organization with an owner, products, a customer, an order,
 * an invoice, and sample tasks. DATABASE_SPEC §3 foundation entities.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: 'acme-demo' },
    update: {},
    create: {
      name: 'Acme Demo Co.',
      slug: 'acme-demo',
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: 'owner@acme-demo.local' },
    update: {},
    create: {
      email: 'owner@acme-demo.local',
      firstName: 'Ada',
      lastName: 'Owner',
    },
  });

  await prisma.member.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: owner.id } },
    update: { role: 'OWNER' },
    create: { organizationId: org.id, userId: owner.id, role: 'OWNER' },
  });

  const products = [
    { name: 'Espresso Beans 1kg', sku: 'COF-001', price: 18.5, cost: 9.2, reorderPoint: 20 },
    { name: 'Brewing Scale', sku: 'EQU-002', price: 45.0, cost: 24.0, reorderPoint: 5 },
    { name: 'Ceramic Mug 350ml', sku: 'MUG-003', price: 12.0, cost: 4.1, reorderPoint: 40 },
  ];
  const createdProducts = [];
  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: p.sku } },
      update: {},
      create: { organizationId: org.id, ...p },
    });
    createdProducts.push(product);
  }

  const customer = await prisma.customer.upsert({
    where: { id: '00000000-0000-0000-0000-00000000c001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-00000000c001',
      organizationId: org.id,
      name: 'Lighthouse Café',
      phone: '+1-555-0100',
      whatsapp: '+1-555-0100',
    },
  });

  await prisma.salesOrder.upsert({
    where: { id: '00000000-0000-0000-0000-00000000s001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-00000000s001',
      organizationId: org.id,
      customerId: customer.id,
      status: 'CONFIRMED',
      total: 63.5,
      lineItems: {
        create: [
          {
            productId: createdProducts[0].id,
            quantity: 1,
            unitPrice: 18.5,
            lineTotal: 18.5,
          },
          {
            productId: createdProducts[1].id,
            quantity: 1,
            unitPrice: 45.0,
            lineTotal: 45.0,
          },
        ],
      },
    },
  });

  await prisma.invoice.upsert({
    where: {
      organizationId_invoiceNumber: { organizationId: org.id, invoiceNumber: 'INV-2026-0001' },
    },
    update: {},
    create: {
      organizationId: org.id,
      customerId: customer.id,
      invoiceNumber: 'INV-2026-0001',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'SENT',
      subtotal: 63.5,
      taxTotal: 0,
      total: 63.5,
      items: {
        create: [
          {
            productId: createdProducts[0].id,
            description: 'Espresso Beans 1kg',
            quantity: 1,
            unitPrice: 18.5,
            taxRate: 0,
            lineTotal: 18.5,
          },
          {
            productId: createdProducts[1].id,
            description: 'Brewing Scale',
            quantity: 1,
            unitPrice: 45.0,
            taxRate: 0,
            lineTotal: 45.0,
          },
        ],
      },
    },
  });

  const tasks = [
    { title: 'Restock espresso beans', priority: 'HIGH' as const, status: 'TODO' as const },
    { title: 'Follow up on INV-2026-0001', priority: 'MEDIUM' as const, status: 'TODO' as const },
  ];
  for (const t of tasks) {
    await prisma.task.create({
      data: { organizationId: org.id, assigneeId: owner.id, ...t },
    });
  }

  console.log(
    `Seeded org "${org.slug}" (${org.id}), user ${owner.email}, ${createdProducts.length} products.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
