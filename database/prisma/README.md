# Prisma boundary

This C004 baseline selects PostgreSQL and Prisma but intentionally defines no
application/domain models. Domain schema and migrations begin with C005.

The schema is validated and Prisma Client is generated with:

```text
pnpm db:generate
pnpm db:validate
```
