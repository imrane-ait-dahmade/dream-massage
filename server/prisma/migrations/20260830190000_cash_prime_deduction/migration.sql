-- Additive: prime deductions in cash ledger (net till balance after staff commission).
ALTER TYPE "CashMovementType" ADD VALUE IF NOT EXISTS 'PRIME_DEDUCTION';
