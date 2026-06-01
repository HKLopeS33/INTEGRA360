import { PrismaClient, UserRole, TableStatus } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  { id: 'cat_shawarma', name: 'Shawarmas', sort: 1 },
  { id: 'cat_bebidas', name: 'Bebidas', sort: 2 },
  { id: 'cat_combos', name: 'Combos', sort: 3 },
  { id: 'cat_sobremesas', name: 'Sobremesas', sort: 4 }
];

const products = [
  {
    id: 'prod_shawarma_frango',
    categoryId: 'cat_shawarma',
    name: 'Shawarma de Frango',
    description: 'Frango temperado, salada, batata e molho da casa.',
    price: 28,
    cost: 14,
    internalCode: 'SHA-FRA',
    preparationMinutes: 12
  },
  {
    id: 'prod_shawarma_carne',
    categoryId: 'cat_shawarma',
    name: 'Shawarma de Carne',
    description: 'Carne temperada, salada, batata e molho da casa.',
    price: 32,
    cost: 17,
    internalCode: 'SHA-CAR',
    preparationMinutes: 14
  },
  {
    id: 'prod_shawarma_misto',
    categoryId: 'cat_shawarma',
    name: 'Shawarma Misto',
    description: 'Frango, carne, queijo, salada e molho da casa.',
    price: 35,
    cost: 19,
    internalCode: 'SHA-MIS',
    preparationMinutes: 15
  },
  {
    id: 'prod_refri_lata',
    categoryId: 'cat_bebidas',
    name: 'Refrigerante Lata',
    description: 'Lata 350ml.',
    price: 7,
    cost: 3.5,
    internalCode: 'BEB-REF-LAT',
    preparationMinutes: 1
  },
  {
    id: 'prod_suco_natural',
    categoryId: 'cat_bebidas',
    name: 'Suco Natural',
    description: 'Copo 400ml.',
    price: 12,
    cost: 5,
    internalCode: 'BEB-SUC-NAT',
    preparationMinutes: 5
  },
  {
    id: 'prod_combo_casal',
    categoryId: 'cat_combos',
    name: 'Combo Casal',
    description: '2 shawarmas de frango e 2 refrigerantes lata.',
    price: 65,
    cost: 35,
    internalCode: 'COM-CAS',
    preparationMinutes: 18
  }
];

const main = async () => {
  // create default company for seed data
  const company = await prisma.company.upsert({
    where: { id: 'company_local' },
    update: {
      name: 'Empresa Local',
      cnpj: '00000000000000',
      email: 'local@empresa.local',
      active: true
    },
    create: {
      id: 'company_local',
      name: 'Empresa Local',
      cnpj: '00000000000000',
      email: 'local@empresa.local',
      active: true
    }
  });

  await prisma.user.upsert({
    where: { email: 'admin@sistema.local' },
    update: {
      name: 'Administrador',
      role: UserRole.ADMIN,
      active: true,
      passwordHash: '159753',
      companyId: company.id
    },
    create: {
      id: 'usr_admin',
      name: 'Administrador',
      email: 'admin@sistema.local',
      passwordHash: '159753',
      role: UserRole.ADMIN,
      mustChangePassword: false,
      companyId: company.id
    }
  });

  await prisma.user.updateMany({
    where: {
      companyId: null,
      role: { not: UserRole.SUPER }
    },
    data: {
      companyId: company.id
    }
  });

  await prisma.user.upsert({
    where: { email: 'super@sistema.local' },
    update: {
      name: 'Super Administrador',
      role: UserRole.SUPER,
      active: true,
      mustChangePassword: false
    },
    create: {
      id: 'usr_super',
      name: 'Super Administrador',
      email: 'super@sistema.local',
      passwordHash: 'Herick159@',
      role: UserRole.SUPER,
      mustChangePassword: false
    }
  });

  await prisma.user.upsert({
    where: { email: 'michely@sistema.local' },
    update: {
      name: 'Michely',
      role: UserRole.GARCOM,
      active: true,
      companyId: company.id
    },
    create: {
      id: 'usr_michely',
      name: 'Michely',
      email: 'michely@sistema.local',
      passwordHash: '123456',
      role: UserRole.GARCOM,
      mustChangePassword: false,
      companyId: company.id
    }
  });

  for (const category of categories) {
    await prisma.category.upsert({
      where: { id: category.id },
      update: {
        name: category.name,
        sort: category.sort,
        active: true
      },
      create: {
        ...category,
        companyId: company.id,
        active: true
      }
    });
  }

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: {
        categoryId: product.categoryId,
        companyId: company.id,
        name: product.name,
        description: product.description,
        price: product.price,
        cost: product.cost,
        internalCode: product.internalCode,
        preparationMinutes: product.preparationMinutes,
        available: true,
        active: true
      },
      create: {
        ...product,
        companyId: company.id,
        available: true,
        active: true
      }
    });
  }

  for (let index = 1; index <= 12; index += 1) {
    await prisma.restaurantTable.upsert({
      where: { id: `mesa_${index}` },
      update: {
        name: `Mesa ${index}`,
        capacity: index <= 4 ? 2 : 4,
        status: TableStatus.LIVRE,
        active: true
      },
      create: {
        id: `mesa_${index}`,
        companyId: company.id,
        number: index,
        name: `Mesa ${index}`,
        capacity: index <= 4 ? 2 : 4,
        status: TableStatus.LIVRE,
        active: true
      }
    });
  }

  console.log('Seed inicial aplicado com sucesso.');
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
