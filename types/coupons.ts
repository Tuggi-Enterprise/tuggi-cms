import type { CouponGrantKind } from '@/lib/coupons/grant';

export type { CouponGrantKind };

export type CouponEligibility = 'any' | 'new_subscribers_only';

export interface CouponOwnerSummary {
  id: string;
  name: string;
  client_type?: string | null;
  avatar_url?: string | null;
}

export interface Coupon {
  id: string;
  code: string;
  owner_client_id: string | null;
  /** BR-MONETIZACAO-047. `until` fills `duration_days`, `minutes` fills `grant_minutes`. */
  grant_kind: CouponGrantKind;
  grant_minutes: number | null;
  duration_days: number | null;
  eligibility: CouponEligibility;
  stack_with_active: boolean;
  max_redemptions: number | null;
  max_redemptions_per_user: number;
  redeemed_count: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for list view convenience. */
  owner?: CouponOwnerSummary | null;
}

export interface CouponCreateInput {
  code: string;
  owner_client_id: string | null;
  grant_kind: CouponGrantKind;
  grant_minutes: number | null;
  duration_days: number | null;
  eligibility: CouponEligibility;
  stack_with_active: boolean;
  max_redemptions: number | null;
  max_redemptions_per_user: number;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
}

export interface CouponsPaginated {
  success: true;
  coupons: Coupon[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
