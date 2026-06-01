import { Module } from '@nestjs/common';
import { RootController } from './root/root.controller.js';
import { HealthController } from './health/health.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { TablesController } from './tables/tables.controller.js';
import { TablesService } from './tables/tables.service.js';
import { MenuController } from './menu/menu.controller.js';
import { OrdersController } from './orders/orders.controller.js';
import { KitchenController } from './kitchen/kitchen.controller.js';
import { CashRegisterController } from './cash-register/cash-register.controller.js';
import { TabsController } from './tabs/tabs.controller.js';
import { ReportsController } from './reports/reports.controller.js';
import { SuperReportsService } from './reports/super-reports.service.js';
import { PrismaService } from './database/prisma.service.js';

@Module({
  controllers: [
    RootController,
    HealthController,
    AuthController,
    TablesController,
    MenuController,
    OrdersController,
    KitchenController,
    CashRegisterController,
    TabsController,
    ReportsController
  ],
  providers: [PrismaService, AuthService, TablesService, SuperReportsService]
})
export class AppModule {}
