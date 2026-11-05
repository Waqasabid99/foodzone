-- An administrator can issue a temporary password. The account is then held to
-- changing it: a password a second person has seen must not keep working.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
