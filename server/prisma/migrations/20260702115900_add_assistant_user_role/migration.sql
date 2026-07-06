-- Add ASSISTANT before users_role_staff_member_check uses it.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ASSISTANT';
