import { Controller, Post, Body, Get, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

@Controller('auth')
export class AuthController {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  @Post('register')
  async register(@Body() body: any) {
    const { companyName, email, password, name } = body;
    if (!companyName || !email || !password || !name) {
      throw new HttpException('Missing fields', HttpStatus.BAD_REQUEST);
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new HttpException('Email already registered', HttpStatus.CONFLICT);
    }

    const tenant = await this.prisma.tenant.create({
      data: { name: companyName },
    });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    });

    // Seed basic inventory items for new tenant
    await this.prisma.inventory.createMany({
      data: [
        { tenantId: tenant.id, name: 'MDF Branco TX 18mm', category: 'MDF', sku: 'MDF-BR-18', quantity: 45, minThreshold: 10, unit: 'chapa' },
        { tenantId: tenant.id, name: 'MDF Louro Freijó 15mm', category: 'MDF', sku: 'MDF-LF-15', quantity: 20, minThreshold: 5, unit: 'chapa' },
        { tenantId: tenant.id, name: 'Dobradiça amortecedor 35mm', category: 'HARDWARE', sku: 'DOB-AM-35', quantity: 300, minThreshold: 50, unit: 'un' },
        { tenantId: tenant.id, name: 'Corrediça Telescópica 45cm', category: 'HARDWARE', sku: 'COR-TE-45', quantity: 120, minThreshold: 20, unit: 'un' },
        { tenantId: tenant.id, name: 'Cola de contato 1L', category: 'ACCESSORY', sku: 'COL-CO-1L', quantity: 15, minThreshold: 3, unit: 'un' },
      ],
    });

    const token = this.jwtService.sign({ userId: user.id, tenantId: tenant.id, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant } };
  }

  @Post('login')
  async login(@Body() body: any) {
    const { email, password } = body;
    if (!email || !password) {
      throw new HttpException('Missing fields', HttpStatus.BAD_REQUEST);
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    if (!user) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    const token = this.jwtService.sign({ userId: user.id, tenantId: user.tenantId, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant: user.tenant } };
  }

  @Get('me')
  async me(@Headers('authorization') authHeader: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpException('No token provided', HttpStatus.UNAUTHORIZED);
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = this.jwtService.verify(token);
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { tenant: true },
      });
      if (!user) throw new Error();
      return { id: user.id, email: user.email, name: user.name, role: user.role, tenant: user.tenant };
    } catch {
      throw new HttpException('Invalid or expired token', HttpStatus.UNAUTHORIZED);
    }
  }
}
