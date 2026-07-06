/** Types for dream-massage-seed-data.json */

export type SeedDataFile = {
  source: {
    dump_file: string;
    generated_at_utc: string;
    note?: string;
  };
  seedData: {
    appSettings: SeedAppSetting[];
    chairs: SeedChair[];
    chairDetectionConfigs: SeedChairDetectionConfig[];
    pricingPlans: SeedPricingPlan[];
    pricingRules: SeedPricingRule[];
    commissionRules: SeedCommissionRule[];
    shiftTypes: SeedShiftType[];
    shiftTargetBonusRules: SeedShiftTargetBonusRule[];
    staffMembers: SeedStaffMember[];
    staffSchedules: SeedStaffSchedule[];
    usersSanitized: SeedUserSanitized[];
  };
};

export type SeedAppSetting = {
  id: string;
  key: string;
  value: string;
  type: string;
  description: string | null;
};

export type SeedChair = {
  id: string;
  name: string;
  display_name: string | null;
  shelly_device_id: string;
  shelly_channel: number;
  is_enabled: boolean;
};

export type SeedChairDetectionConfig = {
  id: string;
  chair_id: string;
  start_threshold_watts: string;
  stop_threshold_watts: string;
  start_confirm_seconds: number;
  stop_confirm_seconds: number;
  activation_delay_seconds: number;
  baseline_power_watts: string | null;
  is_active: boolean;
  version: number;
};

export type SeedPricingPlan = {
  id: string;
  name: string;
  duration_seconds: number;
  price_amount: string;
  currency: string;
  is_active: boolean;
  sort_order: number;
};

export type SeedPricingRule = {
  id: string;
  rounding_mode: string;
  grace_seconds: number;
  minimum_billable_seconds: number;
  minimum_plan_id: string | null;
  overtime_policy: string;
  extra_minute_price: string | null;
  is_active: boolean;
};

export type SeedCommissionRule = {
  id: string;
  pricing_plan_id: string;
  type: string;
  value: string;
  is_active: boolean;
};

export type SeedShiftType = {
  id: string;
  name: string;
  label: string | null;
  start_time: string;
  end_time: string;
  is_active: boolean;
  sort_order: number;
};

export type SeedShiftTargetBonusRule = {
  id: string;
  shift_type_id: string;
  target_amount: string;
  bonus_amount: string;
  is_active: boolean;
};

export type SeedStaffMember = {
  id: string;
  name: string;
  phone: string | null;
  is_active: boolean;
  notes: string | null;
};

export type SeedStaffSchedule = {
  id: string;
  staff_member_id: string;
  shift_type_id: string | null;
  day_of_week: number;
  is_off: boolean;
  is_active: boolean;
};

export type SeedUserSanitized = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  staff_member_id: string | null;
};

export type PlanningSlot = {
  staffMemberId: string;
  dayOfWeek: number;
  shiftTypeId: string | null;
  isOff: boolean;
};
