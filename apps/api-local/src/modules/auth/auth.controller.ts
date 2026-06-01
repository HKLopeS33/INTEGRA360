import { Body, Controller, Get, Post, Headers, Param, Query } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../database/prisma.service.js';

interface LoginBody {
  email: string;
  password: string;
}

interface ValidateTokenBody {
  token: string;
}

interface SetTimeoutBody {
  email: string;
  minutes: number;
}

interface ChangePasswordBody {
  newPassword: string;
  confirmPassword: string;
}

interface CreateCompanyUserBody {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  active?: boolean;
  companyId?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  @Post('login')
  async login(@Body() body: LoginBody) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });

    if (!user) {
      return { error: 'Usuario ou senha incorretos.' };
    }

    if (!user.active) {
      return { error: 'Usuario inativo.' };
    }

    // If the user belongs to a company, ensure the company is active and subscription is valid
    if (user.companyId) {
      try {
        const company = await this.prisma.company.findUnique({ where: { id: user.companyId }, include: { subscription: true } });
        if (!company || !company.active) {
          return { error: 'Empresa inativa.' };
        }
        const sub = company.subscription;
        if (sub && (sub.status === 'SUSPENSO' || sub.status === 'EXPIRADO')) {
          return { error: 'Assinatura inativa.' };
        }
      } catch (e) {
        // ignore DB errors here but fail safe
        return { error: 'Erro ao validar empresa.' };
      }
    }

    // Simple password check (in production, use bcrypt)
    // Restrict master password 'admin' to SUPER role only to avoid bypassing suspensions.
    const isValidPassword = body.password === user.passwordHash || (body.password === 'admin' && (user.role as unknown as string) === 'SUPER');

    if (!isValidPassword) {
      return { error: 'Usuario ou senha incorretos.' };
    }

    const tokenResult = await this.authService.issueTokenForUser(user);

    // update last login
    try {
      await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      if (user.companyId) {
        await this.prisma.subscription.updateMany({ where: { companyId: user.companyId }, data: { lastLoginAt: new Date() } });
      }
    } catch (e) {
      // ignore
    }

    const company = user.companyId
      ? await this.prisma.company.findUnique({ where: { id: user.companyId } })
      : null;

    return {
      accessToken: tokenResult.accessToken,
      requirePasswordChange: !!(user as any).mustChangePassword,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId ?? null
      },
      company: company
        ? {
            id: company.id,
            name: company.name,
            email: company.email,
            cnpj: company.cnpj,
            phone: company.phone,
            address: company.address,
            city: company.city,
            state: company.state,
            country: company.country,
            active: company.active
          }
        : null
    };
  }

  private async ensureSuper(authHeader?: string) {
    return this.authService.ensureSuper(authHeader);
  }

  @Post('super/create-company')
  async createCompany(@Headers('authorization') authHeader: string | undefined, @Body() body: any) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;

    if (!body || !body.name || !body.cnpj || !body.email || !body.adminName || !body.adminEmail || !body.adminPassword) {
      return { error: 'Dados incompletos.' };
    }

    // create company
    const company = await this.prisma.company.create({
      data: {
        name: body.name,
        cnpj: body.cnpj,
        email: body.email,
        phone: body.phone ?? null,
        address: body.address ?? null
      }
    });

    // create subscription
    const now = new Date();
    const months = Number(body.months ?? 1);
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + months);

    await this.prisma.subscription.create({
      data: {
        companyId: company.id,
        status: 'ATIVO',
        monthlyFee: body.monthlyFee ?? 0,
        expiresAt,
        lastRenewed: now
      }
    });

    // create default tables for the new company
    const requestedTableCount = Number(body.tableCount ?? 10);
    const tableCount = Number.isInteger(requestedTableCount) && requestedTableCount > 0 ? requestedTableCount : 10;
    await this.prisma.restaurantTable.createMany({
      data: Array.from({ length: tableCount }, (_, index) => ({
        companyId: company.id,
        number: index + 1,
        name: `Mesa ${index + 1}`,
        capacity: 4
      }))
    });

    // create a default category for the new company so they can add products immediately
    await this.prisma.category.create({
      data: {
        companyId: company.id,
        name: 'Sem categoria',
        sort: 0,
        active: true
      }
    });

    // create admin user for company
    const user = await this.prisma.user.create({
      data: {
        name: body.adminName,
        email: body.adminEmail,
        passwordHash: body.adminPassword,
        role: 'ADMIN',
        companyId: company.id
      }
    });

    return { success: true, company, admin: { id: user.id, email: user.email } };
  }

  @Post('users')
  async createCompanyUser(@Headers('authorization') authHeader: string | undefined, @Body() body: CreateCompanyUserBody) {
    const authResult = await this.authService.getUserFromToken(authHeader);
    if ('error' in authResult) return authResult;

    const currentUser = authResult.user;
    const isSuper = currentUser.role === 'SUPER';

    if (!body || !body.name || !body.email || !body.password) {
      return { error: 'Dados incompletos.' };
    }

    let companyId: string | undefined = currentUser.companyId;
    if (isSuper) {
      companyId = body.companyId;
      if (!companyId) {
        return { error: 'companyId é necessário para criar usuário como SUPER.' };
      }
    }

    if (!companyId) {
      return { error: 'Usuario sem empresa associada.' };
    }

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return { error: 'Empresa não encontrada.' };
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (existingUser) {
      return { error: 'Usuario ja existe.' };
    }

    const validRoles = ['ADMIN', 'GERENTE', 'CAIXA', 'GARCOM', 'COZINHA', 'ESTOQUE', 'FINANCEIRO'];
    const role = body.role && validRoles.includes(body.role) ? body.role : 'CAIXA';

    const user = await this.prisma.user.create({
      data: {
        name: body.name.trim(),
        email: body.email.trim(),
        passwordHash: body.password,
        role: role as UserRole,
        active: body.active ?? true,
        companyId
      }
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      companyId: user.companyId
    };
  }

  @Get('super/companies')
  async listCompanies(@Headers('authorization') authHeader: string | undefined) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;

    const companies = await this.prisma.company.findMany({ include: { subscription: true, payments: true } });
    const now = new Date().getTime();
    return companies.map((c) => {
      const expiresAt = c.subscription?.expiresAt ? new Date(c.subscription.expiresAt).getTime() : null;
      const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : null;
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        cnpj: c.cnpj,
        active: c.active,
        monthlyFee: c.subscription?.monthlyFee ?? 0,
        subscriptionStatus: c.subscription?.status ?? null,
        expiresAt: c.subscription?.expiresAt ?? null,
        remainingMs,
        lastRenewed: c.subscription?.lastRenewed ?? null,
        payments: (c.payments || []).map((p) => ({ id: p.id, amount: p.amount, status: p.status, dueDate: p.dueDate }))
      };
    });
  }

  @Post('super/company/:id/suspend')
  async suspendCompany(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;
    if (!id) return { error: 'company id necessário.' };
    try {
      await this.prisma.company.update({ where: { id }, data: { active: false } });
      // Invalidate tokens for all users of this company
      const users = await this.prisma.user.findMany({ where: { companyId: id } });
      const userIds = new Set(users.map((u) => u.id));
      for (const userId of userIds) {
        this.authService.invalidateTokensForUser(userId);
      }
      return { success: true };
    } catch (e) {
      return { error: 'Falha ao suspender.' };
    }
  }

  @Post('super/company/:id/reactivate')
  async reactivateCompany(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;
    if (!id) return { error: 'company id necessário.' };
    try {
      await this.prisma.company.update({ where: { id }, data: { active: true } });
      return { success: true };
    } catch (e) {
      return { error: 'Falha ao reativar.' };
    }
  }

  @Post('super/user/:id/suspend')
  async suspendUser(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;
    if (!id) return { error: 'user id necessário.' };
    try {
      await this.prisma.user.update({ where: { id }, data: { active: false } });
      this.authService.invalidateTokensForUser(id);
      return { success: true };
    } catch (e) {
      return { error: 'Falha ao suspender usuario.' };
    }
  }

  @Post('super/user/:id/reactivate')
  async reactivateUser(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;
    if (!id) return { error: 'user id necessário.' };
    try {
      await this.prisma.user.update({ where: { id }, data: { active: true } });
      return { success: true };
    } catch (e) {
      return { error: 'Falha ao reativar usuario.' };
    }
  }

  @Post('super/user/:id/delete')
  async deleteUser(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;
    if (!id) return { error: 'user id necessário.' };

    try {
      const user = await this.prisma.user.findUnique({ where: { id } });
      if (!user) return { error: 'Usuario nao encontrado.' };
      if (user.role === 'SUPER') {
        return { error: 'Nao é permitido deletar super usuario.' };
      }

      // remove audit logs
      await this.prisma.auditLog.deleteMany({ where: { userId: id } });

      // remove order items and orders
      const orders = await this.prisma.order.findMany({ where: { userId: id }, select: { id: true } });
      const orderIds = orders.map((order) => order.id);
      if (orderIds.length > 0) {
        await this.prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
        await this.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      }

      // remove cash register payments and cash registers opened/closed by user
      const cashRegisters = await this.prisma.cashRegister.findMany({ where: { OR: [{ openedById: id }, { closedById: id }] }, select: { id: true } });
      const cashRegisterIds = cashRegisters.map((cash) => cash.id);
      if (cashRegisterIds.length > 0) {
        await this.prisma.payment.deleteMany({ where: { cashRegisterId: { in: cashRegisterIds } } });
        await this.prisma.cashRegister.deleteMany({ where: { id: { in: cashRegisterIds } } });
      }

      // remove tabs opened by user and all related orders/payments
      const tabs = await this.prisma.tab.findMany({ where: { openedById: id }, select: { id: true } });
      const tabIds = tabs.map((tab) => tab.id);
      if (tabIds.length > 0) {
        const tabOrders = await this.prisma.order.findMany({ where: { tabId: { in: tabIds } }, select: { id: true } });
        const tabOrderIds = tabOrders.map((order) => order.id);
        const allTabOrderIds = Array.from(new Set([...orderIds, ...tabOrderIds]));
        if (allTabOrderIds.length > 0) {
          await this.prisma.orderItem.deleteMany({ where: { orderId: { in: allTabOrderIds } } });
          await this.prisma.order.deleteMany({ where: { id: { in: allTabOrderIds } } });
        }

        await this.prisma.payment.deleteMany({ where: { tabId: { in: tabIds } } });
        await this.prisma.tab.deleteMany({ where: { id: { in: tabIds } } });
      }

      // update subordinate relations if present
      await this.prisma.user.updateMany({ where: { managerId: id }, data: { managerId: null } });

      await this.prisma.user.delete({ where: { id } });
      this.authService.invalidateTokensForUser(id);
      return { success: true };
    } catch (e) {
      return { error: 'Falha ao deletar usuario.' };
    }
  }

  @Post('super/user/:id/update')
  async updateUser(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: any
  ) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;
    if (!id) return { error: 'user id necessário.' };

    try {
      const data: any = {};
      if (body.name != null) data.name = body.name;
      if (body.email != null) data.email = body.email;
      if (body.password != null) data.passwordHash = body.password;
      if (body.active != null) data.active = body.active;
      if (Object.keys(data).length === 0) return { error: 'Nenhum dado para atualizar.' };

      const updated = await this.prisma.user.update({ where: { id }, data });

      // If user was deactivated, invalidate tokens
      if (data.active === false) {
        this.authService.invalidateTokensForUser(id);
      }

      return { success: true, user: { id: updated.id, name: updated.name, email: updated.email, active: updated.active } };
    } catch (e) {
      return { error: 'Falha ao atualizar usuario.' };
    }
  }

  @Post('super/company/:id/renew')
  async renewSubscription(@Headers('authorization') authHeader: string | undefined, @Param('id') companyId: string, @Body() body: any) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;
    if (!companyId) return { error: 'companyId necessário.' };

    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (!sub) return { error: 'Assinatura nao encontrada.' };

    const now = new Date();
    const base = sub.expiresAt && new Date(sub.expiresAt) > now ? new Date(sub.expiresAt) : now;
    const months = Number(body.months ?? 0);
    const days = Number(body.days ?? 0);
    const hours = Number(body.hours ?? 0);

    const newDate = new Date(base);
    if (months) newDate.setMonth(newDate.getMonth() + months);
    if (days) newDate.setDate(newDate.getDate() + days);
    if (hours) newDate.setHours(newDate.getHours() + hours);

    await this.prisma.subscription.update({ where: { id: sub.id }, data: { expiresAt: newDate, status: 'ATIVO', lastRenewed: now } });
    await this.prisma.paymentRecord.create({ data: { companyId, amount: body.amount ?? 0, status: body.status ?? 'PAGO', dueDate: now, paidAt: body.status === 'PAGO' ? now : null, renewalDate: now } });

    return { success: true, expiresAt: newDate.toISOString() };
  }

  @Post('super/company/:id/update')
  async updateCompany(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') companyId: string,
    @Body() body: any
  ) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;
    if (!companyId) return { error: 'companyId necessário.' };

    try {
      const updated = await this.prisma.company.update({ where: { id: companyId }, data: {
        name: body.name ?? undefined,
        email: body.email ?? undefined,
        phone: body.phone ?? undefined,
        address: body.address ?? undefined
      } });

      if (body.monthlyFee != null) {
        await this.prisma.subscription.updateMany({ where: { companyId }, data: { monthlyFee: body.monthlyFee } });
      }

      return { success: true, company: updated };
    } catch (e) {
      return { error: 'Falha ao atualizar empresa.' };
    }
  }

  @Post('super/payment/:id/pay')
  async markPaymentPaid(@Headers('authorization') authHeader: string | undefined, @Param('id') paymentId: string) {
    const ok = await this.ensureSuper(authHeader);
    if ('error' in ok) return ok;
    if (!paymentId) return { error: 'payment id necessário.' };

    try {
      const payment = await this.prisma.paymentRecord.findUnique({ where: { id: paymentId } });
      if (!payment) return { error: 'Pagamento não encontrado.' };
      await this.prisma.paymentRecord.update({ where: { id: paymentId }, data: { status: 'PAGO', paidAt: new Date() } });
      return { success: true };
    } catch (e) {
      return { error: 'Falha ao marcar pagamento como pago.' };
    }
  }

  @Post('change-password')
  async changePassword(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: ChangePasswordBody
  ) {
    const authResult = await this.authService.getUserFromToken(authHeader);
    if ('error' in authResult) return authResult;

    const currentUser = authResult.user;

    if (!body.newPassword || !body.confirmPassword) {
      return { error: 'Dados incompletos.' };
    }

    if (body.newPassword !== body.confirmPassword) {
      return { error: 'Confirmação de senha não corresponde.' };
    }

    await this.prisma.user.update({
      where: { id: currentUser.id },
      data: { passwordHash: body.newPassword, mustChangePassword: false }
    });

    return { success: true };
  }

  @Get('users')
  async listUsers(
    @Headers('authorization') authHeader: string | undefined,
    @Query('companyId') companyId?: string
  ) {
    const authResult = await this.authService.getUserFromToken(authHeader);
    if ('error' in authResult) return authResult;

    const currentUser = authResult.user;
    const isSuper = currentUser.role === 'SUPER';

    const whereClause: any = {};
    if (!isSuper) {
      if (!currentUser.companyId) {
        return { error: 'Usuario sem empresa associada.' };
      }
      whereClause.companyId = currentUser.companyId;
    } else if (companyId) {
      whereClause.companyId = companyId;
    }

    const users = await this.prisma.user.findMany({ where: whereClause });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      companyId: u.companyId,
      passwordHash: u.passwordHash,
      mustChangePassword: (u as any).mustChangePassword
    }));
  }

  @Post('validate-token')
  async validateToken(@Body() body: ValidateTokenBody) {
    return this.authService.validateToken(body.token);
  }

  @Get('me')
  async me(@Headers('authorization') authHeader?: string) {
    const authResult = await this.authService.getUserFromToken(authHeader);
    if ('error' in authResult) return authResult;

    const user = authResult.user;
    const company = user.companyId
      ? await this.prisma.company.findUnique({ where: { id: user.companyId } })
      : null;

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId ?? null
      },
      company: company
        ? {
            id: company.id,
            name: company.name,
            email: company.email,
            cnpj: company.cnpj,
            phone: company.phone,
            address: company.address,
            city: company.city,
            state: company.state,
            country: company.country,
            active: company.active
          }
        : null
    };
  }

  @Get('company')
  async getCompany(@Headers('authorization') authHeader?: string) {
    const authResult = await this.authService.requireCompanyUser(authHeader);
    if ('error' in authResult) return authResult;

    const company = await this.prisma.company.findUnique({ where: { id: authResult.companyId } });
    if (!company) {
      return { error: 'Empresa nao encontrada.' };
    }

    return {
      company: {
        id: company.id,
        name: company.name,
        pixKey: company.pixKey ?? null,
        email: company.email,
        cnpj: company.cnpj,
        phone: company.phone,
        address: company.address,
        city: company.city,
        state: company.state,
        country: company.country,
        active: company.active
      }
    };
  }

  @Post('company/update')
  async updateCompanyProfile(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: any
  ) {
    const authResult = await this.authService.requireCompanyUser(authHeader);
    if ('error' in authResult) return authResult;

    try {
      const updated = await this.prisma.company.update({
        where: { id: authResult.companyId },
        data: {
          name: body.name ?? undefined,
          pixKey: body.pixKey ?? undefined,
          cnpj: body.cnpj ?? undefined,
          email: body.email ?? undefined,
          phone: body.phone ?? undefined,
          address: body.address ?? undefined,
          city: body.city ?? undefined,
          state: body.state ?? undefined,
          country: body.country ?? undefined
        }
      });

      return {
        success: true,
        company: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          cnpj: updated.cnpj,
          phone: updated.phone,
          address: updated.address,
          city: updated.city,
          state: updated.state,
          country: updated.country,
          active: updated.active
        }
      };
    } catch (e) {
      return { error: 'Falha ao atualizar empresa.' };
    }
  }

  @Post('logout')
  async logout(@Headers('authorization') authHeader?: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: true };
    }

    const token = authHeader.substring(7);
    this.authService.invalidateToken(token);

    return { success: true };
  }

  @Post('super/set-timeout')
  async setUserTimeout(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: SetTimeoutBody
  ) {
    const ok = await this.authService.ensureSuper(authHeader);
    if ('error' in ok) return ok;

    const targetUser = await this.prisma.user.findUnique({
      where: { email: body.email }
    });

    if (!targetUser) {
      return { error: 'Usuario alvo nao encontrado.' };
    }

    const minutes = Math.max(0, body.minutes);
    const timeoutMs = this.authService.updateUserTimeout(targetUser.id, minutes);

    return {
      success: true,
      target: {
        id: targetUser.id,
        email: targetUser.email,
        role: targetUser.role
      },
      timeoutMinutes: minutes
    };
  }
}
