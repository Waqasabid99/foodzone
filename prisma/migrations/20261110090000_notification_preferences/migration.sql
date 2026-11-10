-- What one person wants to be told about, and how.
--
-- A row per person per category, never per notification type: there are
-- already a dozen types and a screen with thirty switches on it is one nobody
-- reads. New types join an existing category rather than appearing as a new
-- toggle defaulting to on with nothing admitting it.
--
-- Absent means the default, which is why signing up writes nothing here. A
-- missing row is "everything on" for a transactional category, and "off unless
-- the operator says otherwise" for marketing.

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    -- Honoured only for marketing. For anything transactional the in-app row
    -- is the record, and a record cannot be opted out of — only the push that
    -- interrupts somebody about it.
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- One answer per person per category. Two rows would make "do they want this"
-- ambiguous, and the resolver would have to pick a winner.
CREATE UNIQUE INDEX "NotificationPreference_userId_category_key"
    ON "NotificationPreference"("userId", "category");

-- Every send resolves one person's whole set at once.
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
