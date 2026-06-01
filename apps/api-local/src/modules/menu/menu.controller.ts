import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';

interface CreateProductBody {
  categoryId?: string;
  name: string;
  description?: string;
  price: number;
  preparationMinutes?: number;
}

interface CreateCategoryBody {
  name: string;
  sort?: number;
}

@Controller('menu')
export class MenuController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  @Get('categories')
  async listCategories(@Headers('authorization') authHeader?: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['GARCOM', 'CAIXA', 'GERENTE', 'ESTOQUE', 'FINANCEIRO', 'COZINHA']);

    const categories = await this.prisma.category.findMany({
      where: { active: true, companyId: auth.companyId },
      orderBy: { sort: 'asc' }
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      active: category.active
    }));
  }

  @Get('products')
  async listProducts(@Headers('authorization') authHeader?: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['GARCOM', 'CAIXA', 'GERENTE', 'ESTOQUE', 'FINANCEIRO', 'COZINHA']);

    const products = await this.prisma.product.findMany({
      where: { active: true, companyId: auth.companyId },
      orderBy: { name: 'asc' }
    });

    return products.map((product) => ({
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      description: product.description ?? '',
      price: Number(product.price),
      preparationMinutes: product.preparationMinutes,
      available: product.available
    }));
  }

  @Post('categories')
  async createCategory(@Headers('authorization') authHeader: string | undefined, @Body() body: CreateCategoryBody) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['ADMIN', 'GERENTE', 'ESTOQUE']);
    if ('error' in auth) return auth;

    if (!body || !body.name || !body.name.trim()) {
      return { error: 'Nome da categoria e necessario.' };
    }

    const existingCategory = await this.prisma.category.findFirst({
      where: {
        companyId: auth.companyId,
        name: body.name.trim()
      }
    });

    if (existingCategory) {
      return { error: 'Categoria ja existe.' };
    }

    const category = await this.prisma.category.create({
      data: {
        companyId: auth.companyId,
        name: body.name.trim(),
        sort: body.sort ?? 0,
        active: true
      }
    });

    return {
      id: category.id,
      name: category.name,
      active: category.active
    };
  }

  @Post('products')
  async createProduct(@Headers('authorization') authHeader: string | undefined, @Body() body: CreateProductBody) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['ADMIN', 'GERENTE', 'ESTOQUE']);
    if ('error' in auth) return auth;

    const fallbackCategory = await this.prisma.category.findFirst({
      where: { active: true, companyId: auth.companyId },
      orderBy: { sort: 'asc' }
    });

    let category = body.categoryId
      ? await this.prisma.category.findUnique({ where: { id: body.categoryId } })
      : fallbackCategory;

    if (!category) {
      category = await this.prisma.category.create({
        data: {
          companyId: auth.companyId,
          name: 'Sem categoria',
          sort: 0,
          active: true
        }
      });
    }

    if (category.companyId !== auth.companyId) {
      return { error: 'Categoria nao encontrada.' };
    }

    const product = await this.prisma.product.create({
      data: {
        companyId: category.companyId,
        categoryId: category.id,
        name: body.name.trim(),
        description: body.description?.trim() || 'Sem descricao.',
        price: Number(body.price),
        cost: 0,
        internalCode: `PROD-${Date.now()}`,
        preparationMinutes: Number(body.preparationMinutes ?? 0),
        available: true,
        active: true
      }
    });

    return {
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      description: product.description ?? '',
      price: Number(product.price),
      preparationMinutes: product.preparationMinutes,
      available: product.available
    };
  }
}
