import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

const DEFAULT_SESSION_MS = 24 * 60 * 60 * 1000;

interface TokenData {
  userId: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly validTokens = new Map<string, TokenData>();
  private readonly userTimeouts = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  private generateToken(): string {
    return `token_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private getExpiration(userId: string): number {
    return Date.now() + (this.userTimeouts.get(userId) ?? DEFAULT_SESSION_MS);
  }

  private getTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }

  async getUserFromToken(authHeader?: string): Promise<{ user: any }> {
    const token = this.getTokenFromHeader(authHeader);
    if (!token) {
      throw new UnauthorizedException('Token nao fornecido.');
    }

    const tokenData = this.validTokens.get(token);
    if (!tokenData) {
      throw new UnauthorizedException('Token invalido.');
    }

    if (tokenData.expiresAt < Date.now()) {
      this.validTokens.delete(token);
      throw new UnauthorizedException('Token expirado.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: tokenData.userId } });
    if (!user || !user.active) {
      this.validTokens.delete(token);
      throw new UnauthorizedException('Usuario nao encontrado.');
    }

    return { user };
  }

  async issueTokenForUser(user: any): Promise<{ accessToken: string; expiresAt: number }> {
    const token = this.generateToken();
    const expiresAt = this.getExpiration(user.id);
    this.validTokens.set(token, { userId: user.id, expiresAt });
    return { accessToken: token, expiresAt };
  }

  async ensureSuper(authHeader?: string): Promise<{ currentUser?: any }> {
    const authResult = await this.getUserFromToken(authHeader);

    const currentUser = authResult.user;
    const currentRole = currentUser.role as unknown as string;
    if (currentRole !== 'SUPER') {
      throw new ForbiddenException('Acesso negado.');
    }

    return { currentUser };
  }

  async requireCompanyUser(authHeader?: string): Promise<{ currentUser: any; companyId: string }> {
    const authResult = await this.getUserFromToken(authHeader);

    const currentUser = authResult.user;
    if (!currentUser.companyId) {
      throw new UnauthorizedException('Usuario sem empresa associada.');
    }

    return { currentUser, companyId: currentUser.companyId };
  }

  private isRoleAllowed(currentRole: string, allowedRoles: string[]): boolean {
    if (currentRole === 'SUPER' || currentRole === 'ADMIN') {
      return true;
    }
    return allowedRoles.includes(currentRole);
  }

  async requireCompanyUserWithRoles(
    authHeader: string | undefined,
    allowedRoles: string[],
    errorMessage = 'Acesso negado.'
  ): Promise<{ currentUser: any; companyId: string }> {
    const authResult = await this.getUserFromToken(authHeader);
    const currentUser = authResult.user;
    if (!currentUser.companyId) {
      throw new UnauthorizedException('Usuario sem empresa associada.');
    }

    const currentRole = currentUser.role as unknown as string;
    if (!this.isRoleAllowed(currentRole, allowedRoles)) {
      throw new ForbiddenException(errorMessage);
    }

    return { currentUser, companyId: currentUser.companyId };
  }

  async validateToken(token: string) {
    const tokenData = this.validTokens.get(token);
    if (!tokenData) {
      return { valid: false };
    }

    if (tokenData.expiresAt < Date.now()) {
      this.validTokens.delete(token);
      return { valid: false };
    }

    const user = await this.prisma.user.findUnique({ where: { id: tokenData.userId } });
    if (!user || !user.active) {
      this.validTokens.delete(token);
      return { valid: false };
    }

    return {
      valid: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId
      }
    };
  }

  invalidateToken(token: string) {
    this.validTokens.delete(token);
  }

  invalidateTokensForUser(userId: string) {
    this.validTokens.forEach((value, token) => {
      if (value.userId === userId) {
        this.validTokens.delete(token);
      }
    });
  }

  updateUserTimeout(userId: string, minutes: number) {
    const timeoutMs = minutes > 0 ? minutes * 60 * 1000 : DEFAULT_SESSION_MS;
    this.userTimeouts.set(userId, timeoutMs);
    const now = Date.now();
    this.validTokens.forEach((data, tokenKey) => {
      if (data.userId === userId) {
        data.expiresAt = now + timeoutMs;
      }
    });
    return timeoutMs;
  }
}
