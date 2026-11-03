# Service 4: User Engagement & Operational Performance Analytics

## Overview
This service monitors, computes, and reports end-to-end user engagement, helper cascade acceptance rates, work order fulfillment rates, customer satisfaction (CSAT), and audit-ready data exports.

## Core Card KPIs
1. **Total Volume**: Total work orders logged across all ExtraHand service categories.
2. **Acceptance Rate**: Helper cascade acceptance rate (percentage of dispatches accepted).
3. **Completion Rate**: Verified fulfilled rate (percentage of bookings successfully completed).
4. **Audit Ready**: Instant CSV export streams for executive compliance and financial audit review.

## Endpoints
- `GET /api/engagement/kpis` - Headline KPIs matching the Reports & Analytics card
- `GET /api/engagement/overview` - Multi-dimensional operational breakdown
- `GET /api/engagement/export?type=bookings|calls|feedback|helpers` - Downloadable CSV exports
- `GET /api/reports/summary` - Backward compatible summary endpoint
- `GET /api/reports/export` - Backward compatible export endpoint

