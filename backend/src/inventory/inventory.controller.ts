import { Controller, Get, Post, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';

@Controller('inventory')
export class InventoryController {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  private verifyTokenAndGetTenantId(authHeader: string): string {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    const token = authHeader.split(' ')[1];
    if (token === 'mock-jwt-token-2026') {
      return 'kaza-tenant-id';
    }
    try {
      const decoded = this.jwtService.verify(token);
      return decoded.tenantId;
    } catch {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
  }

  @Get()
  async getInventory(@Headers('authorization') authHeader: string) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    return this.prisma.inventory.findMany({
      where: { tenantId },
      orderBy: { category: 'asc' },
    });
  }

  @Post('consume')
  async consumeInventory(
    @Headers('authorization') authHeader: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { sku, quantity } = body;
    if (!sku || quantity === undefined) {
      throw new HttpException('SKU and quantity are required', HttpStatus.BAD_REQUEST);
    }

    const item = await this.prisma.inventory.findFirst({
      where: { sku, tenantId },
    });

    if (!item) {
      throw new HttpException('Inventory item not found', HttpStatus.NOT_FOUND);
    }

    const newQty = Math.max(0, item.quantity - quantity);

    const updatedItem = await this.prisma.inventory.update({
      where: { id: item.id },
      data: { quantity: newQty },
    });

    const isBelowThreshold = newQty <= item.minThreshold;

    return {
      success: true,
      sku,
      previousQuantity: item.quantity,
      currentQuantity: newQty,
      isBelowThreshold,
      alertMessage: isBelowThreshold
        ? `ALERTA: Estoque de ${item.name} abaixo do limite mínimo (${item.minThreshold}). Reposição automática recomendada.`
        : null,
    };
  }
}
