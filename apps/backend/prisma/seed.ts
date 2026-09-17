/**
 * Development seed data (idempotent — safe to re-run).
 * Creates a demo organization with an owner, products with receiving
 * movements, a customer, an order, an invoice, a recurring-invoice
 * schedule, and sample tasks. DATABASE_SPEC §3 foundation entities.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: 'acme-demo' },
    update: {},
    create: {
      // Pinned to match the `org_id` attribute baked into every demo user in
      // infrastructure/kubernetes/base/keycloak/realm.json — without this, a fresh
      // database's auto-generated id would never match the org_id claim Keycloak
      // issues, and every authenticated request would fail TenancyGuard's membership
      // lookup for every demo user.
      id: '8841a049-893c-4c2b-b342-456c7074b25d',
      name: 'Acme Demo Co.',
      slug: 'acme-demo',
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: 'owner@acme-demo.local' },
    update: {},
    create: {
      // Pinned to match this same user's `id` in realm.json — TenancyGuard keys membership
      // off the JWT `sub` claim, which is this exact id once Keycloak imports the user with it.
      id: '00000000-0000-0000-0000-000000000001',
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

  // manager@/viewer@ aren't referenced elsewhere below (only `owner` is), but both need a
  // matching Postgres user + membership too — tests/load/lib/config.ts's k6 scripts log in as
  // all three demo users, rotating across roles by design.
  const otherDemoUsers = [
    {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'manager@acme-demo.local',
      firstName: 'Beatrice',
      lastName: 'Manager',
      role: 'MANAGER' as const,
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      email: 'viewer@acme-demo.local',
      firstName: 'Chidi',
      lastName: 'Viewer',
      role: 'VIEWER' as const,
    },
  ];
  for (const { id, email, firstName, lastName, role } of otherDemoUsers) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { id, email, firstName, lastName },
    });
    await prisma.member.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { role },
      create: { organizationId: org.id, userId: user.id, role },
    });
  }

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

  // Receiving movements: beans and mugs land above their reorder point, the
  // scale lands below — a ready-made example of the reorder-alert flag.
  const receipts = [
    { id: '00000000-0000-0000-0000-00000000i001', product: createdProducts[0], quantity: 30 },
    { id: '00000000-0000-0000-0000-00000000i002', product: createdProducts[1], quantity: 2 },
    { id: '00000000-0000-0000-0000-00000000i003', product: createdProducts[2], quantity: 50 },
  ];
  for (const r of receipts) {
    await prisma.inventoryMovement.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        productId: r.product.id,
        type: 'IN',
        quantity: r.quantity,
        note: 'Initial stock receipt',
      },
    });
  }
  await prisma.product.update({
    where: { id: createdProducts[1].id },
    data: { belowReorderPoint: true },
  });

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

  await prisma.recurringInvoice.upsert({
    where: { id: '00000000-0000-0000-0000-00000000f001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-00000000f001',
      organizationId: org.id,
      customerId: customer.id,
      cadence: 'MONTHLY',
      interval: 1,
      netTermsDays: 30,
      issueOnCreate: true,
      note: 'Monthly wholesale coffee subscription',
      lineItems: [
        {
          productId: createdProducts[0].id,
          description: 'Espresso Beans 1kg',
          quantity: 10,
          unitPrice: 18.5,
          taxRate: 0,
        },
        {
          productId: createdProducts[2].id,
          description: 'Ceramic Mug 350ml',
          quantity: 6,
          unitPrice: 12.0,
          taxRate: 0,
        },
      ],
      nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
