-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "currentNode" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3);
