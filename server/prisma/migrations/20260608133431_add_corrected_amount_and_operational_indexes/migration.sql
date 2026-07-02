-- AlterTable
ALTER TABLE "chair_sessions" ADD COLUMN     "corrected_amount" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "chair_detection_configs_chair_id_is_active_idx" ON "chair_detection_configs"("chair_id", "is_active");

-- CreateIndex
CREATE INDEX "chair_detection_configs_chair_id_idx" ON "chair_detection_configs"("chair_id");

-- CreateIndex
CREATE INDEX "pricing_plans_is_active_idx" ON "pricing_plans"("is_active");

-- CreateIndex
CREATE INDEX "pricing_rules_is_active_idx" ON "pricing_rules"("is_active");
