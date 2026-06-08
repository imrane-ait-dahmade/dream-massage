import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async findByEmail(email) {
    return this.prisma.user.findUnique({ where: { email }, include: { role: true } });
  }

  async findById(id) {
    return this.prisma.user.findUnique({ where: { id }, include: { role: true } });
  }

  async create({ name, email, password, roleId }) {
    const exists = await this.findByEmail(email);
    if (exists) throw new ConflictException('Email déjà utilisé');

    const hashed = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: { name, email, password: hashed, roleId },
      include: { role: true },
    });
  }
}

UsersService.prototype.constructor = UsersService;
