---
name: app-analytics
description: When the user wants to set up, interpret, or improve their app analytics and tracking. Also use when the user mentions "analytics", "tracking", "metrics", "KPIs", "App Store Connect analytics", "install tracking", "funnel", "attribution", or "how is my app performing", "PostHog", "event", "olay". For A/B testing, see ab-test-store-listing. For retention metrics, see retention-optimization.
metadata:
  version: 1.0.0
---

# App Analytics

You are an expert in mobile app analytics and measurement strategy. Your goal is to help the user set up meaningful tracking, interpret their data, and make data-driven decisions.

## Initial Assessment

1. Check for `app-marketing-context.md` — read it for context
2. Read `SETUP.md` → Analitik: CashFollow already uses **PostHog + App Store Connect** (don't propose other tools)
3. Ask: **What are your top 3 questions about your app's performance?**
4. Ask: **What decisions do you need data to make?**
5. Ask: **Do you run paid acquisition?** (attribution matters — see the privacy rules below before adding any SDK)

## Analytics Stack

### Essential Tools (CashFollow)

| Tool | Purpose | Status |
|------|---------|--------|
| **App Store Connect** | Store metrics: impressions, page views, downloads, conversion, source; Sales and Trends → Subscriptions (trial, renewal, cancel, revenue) | Used, no setup |
| **PostHog** (US region) | In-app events, funnels, retention, cohorts, feature flags, Revenue analytics | Used. Key in `config.js` `POSTHOG_KEY`, `Yapilandirma.swift` `posthogKey`, `mcp/server.js` `DEFAULTS.POSTHOG_KEY`; empty key = nothing is sent |
| **MetricKit** (`Cokme.swift`) | Crashes and hangs → `app_crashed` event in PostHog | Used. **No Crashlytics / Firebase** |
| Mixpanel, Amplitude, Firebase, RevenueCat, Adjust, AppsFlyer | — | **Not used. Don't add.** PostHog + StoreKit 2 + server notifications cover it; extra SDKs break the "no tracking" App Privacy answer |

The PostHog MCP is connected in this project: query it (`insight`, `query`, `execute-sql`, `feature-flag`, `experiment`, `dashboard`) instead of asking the user to paste numbers. Load the PostHog skills first if available.

### Privacy rules (non-negotiable)

- Events carry **numbers and enums only** — never merchant names, amounts, descriptions, card digits, or message text (`sms_received` sends only `result`/`ai`).
- `$geoip_disable: true` on every event; "Discard client IP data" on in PostHog.
- User can switch it off: Settings → "Kullanım verisi gönder" (web: `para.analitik.kapali`). New events must go through `Analitik.olay` (iOS) / `Analitik.event` (web, `analitik.js`) so the opt-out applies. Never call the PostHog API directly from client code.
- Identity: anonymous id until sign-in, then the account id (`$identify`), so web and iPhone merge into one person.
- App Privacy answers are "no tracking" and must match `ios/CashFollow/PrivacyInfo.xcprivacy` (SETUP.md → App Privacy). Adding an attribution SDK / IDFA / ATT prompt breaks that — don't.
- A new event name or property: add it to `SETUP.md` → Analitik in the same change.

### App Store Connect Analytics

**Key metrics available for free:**

| Metric | What it tells you |
|--------|------------------|
| **Impressions** | How many times your app appeared in search/browse |
| **Product Page Views** | How many users visited your product page |
| **App Units** | First-time downloads |
| **Conversion Rate** | Product Page Views → Downloads |
| **Proceeds** | Revenue after Apple's cut |
| **Sessions** | App opens |
| **Active Devices** | Unique devices using the app |
| **Retention** | Day 1, Day 7, Day 28 retention |
| **Crash Rate** | Crashes per session |

**Source types:**
- App Store Search
- App Store Browse
- Web Referral
- App Referral

## Key Metrics Framework

### Acquisition Metrics

| Metric | Formula | What it means |
|--------|---------|--------------|
| **Impressions** | — | Visibility in App Store |
| **Tap-Through Rate** | Taps / Impressions | Icon + title effectiveness |
| **Conversion Rate** | Downloads / Page Views | Product page effectiveness |
| **CPI** | Ad Spend / Installs | Cost efficiency of paid UA |
| **Organic %** | Organic / Total Installs | Health of organic growth |

### Engagement Metrics

| Metric | Formula | What it means |
|--------|---------|--------------|
| **DAU** | Daily Active Users | Daily engagement |
| **MAU** | Monthly Active Users | Monthly reach |
| **DAU/MAU** | DAU / MAU | Stickiness (>20% is good) |
| **Sessions/User** | Total Sessions / DAU | Engagement depth |
| **Session Length** | Avg time per session | Value delivery |

### Retention Metrics

| Metric | Formula | Benchmark |
|--------|---------|-----------|
| **Day 1** | Users Day 1 / Installs | 25-40% generic; finance apps ~12–34% by source (`TUTUNDURMA.md`) — measure our own baseline |
| **Day 7** | Users Day 7 / Installs | 10-20% |
| **Day 30** | Users Day 30 / Installs | 5-10% |
| **Churn Rate** | Lost Users / Start Users | < 5% monthly (subscriptions) |
| **Week-1 return** | Users with `app_opened` on days 1–7 / new installs | **Primary retention measure** (`SETUP.md` → Karşılama) |

### Revenue Metrics

| Metric | Formula | What it means |
|--------|---------|--------------|
| **ARPU** | Revenue / All Users | Average revenue per user |
| **ARPPU** | Revenue / Paying Users | Paying user value |
| **LTV** | ARPU × Avg Lifetime | Total user value |
| **Trial-to-Paid** | Conversions / Trial Starts | Paywall effectiveness |
| **MRR** | Monthly Recurring Revenue | Subscription health |
| **Churn Revenue** | Lost MRR / Start MRR | Revenue retention |

## Event Tracking Plan

### Existing events (source of truth: `SETUP.md` → Analitik; check it before proposing anything new)

```
# Lifecycle (iOS + web)
app_opened, tab_viewed (tab), signed_in, signed_out, account_created, account_deleted,
started_without_account

# Onboarding funnel (iPhone, new installs only; variant: default)
onboarding_started → onboarding_step_viewed / onboarding_step_completed / onboarding_step_skipped
  (step: intro, card, cutoff, purchase, aha; seconds, method, reason)
onboarding_aha_viewed, onboarding_add_another, onboarding_closed, onboarding_backgrounded,
onboarding_completed (path: offline, account, closed)
onboarding_step_opened / onboarding_hidden (surface: checklist — the Özet getting-started checklist, iPhone + web)
activation_reached (payment plan shown for the first time; via_flow)   ← ACTIVATION EVENT

# Core actions
card_added, purchase_added (source: manual, suggestion, repeat, email, sms, shortcut, quick, web, onboarding),
add_opened, merchant_suggestion_used, quick_line_used, debt_added, payment_recorded
inbox_added, inbox_test_received, inbox_card_assigned, inbox_notifications
sms_received (result, ai), sms_setup_opened, sms_shortcut_added, sms_tried
shortcut_run (intent), statement_tip_opened, statement_prompt_copied, assistant_opened (source), assistant_add, afford_card_suggestion_used

# Habit / return loop
reminders_enabled, reminders_disabled, reminders_offer_dismissed,
notification_setting_changed (kind, enabled, granted), notification_opened (kind),
installment_finished_shown, month_summary_opened / month_summary_shared, insight_headline_opened

# Monetization (iPhone; server events from mcp/abonelik.js)
paywall_shown / paywall_closed (reason, plan), purchase_started, purchase_completed (trial, price, currency),
purchase_cancelled, purchase_pending, purchase_failed, restore (found)
subscription_subscribed, subscription_did_renew, subscription_did_change_renewal_status,
subscription_expired, subscription_refund  (production only carries revenue + currency)
app_store_opened (web lock → App Store)

# Quality / ratings
app_crashed (MetricKit), review_prompted
$feature_flag_called (free_taste flag; onboarding_flow is NOT read — no A/B)
```

Funnels to build in PostHog:
1. Onboarding: `onboarding_started → onboarding_step_completed(step=card) → (step=purchase) → activation_reached → app_opened (days 1–7)`
2. Paywall: `paywall_shown → purchase_started → purchase_completed` (split by `reason`)
3. Auto-capture: `inbox_added → inbox_test_received → purchase_added(source=email)` and the SMS equivalent

### Gaps to remember (not yet tracked — propose, don't assume)

Anything not in the list above (e.g. share of Premium users hitting the free limits, export usage) does not exist yet. Adding one means: iOS `Analitik.olay`, web `Analitik.event`, `SETUP.md` entry, and the privacy rules above.

### Event Naming Conventions

- Use `snake_case`
- Format: `[object]_[action]` (e.g., `purchase_added`, `card_added`); English names, even though the UI is Turkish
- Be specific but not too granular
- Include relevant properties (but not PII)
- Same name on iPhone and web (`platform` property says which); `source`/`kind`/`reason`/`step` are enum strings, not free text

## Dashboard Setup

### Executive Dashboard (check weekly)

```
┌─────────────────────────────────────────────┐
│  Weekly Summary                              │
├──────────────┬──────────────┬───────────────┤
│  Downloads   │  Revenue     │  DAU          │
│  [N] (+X%)   │  [N] (+X%)   │  [N] (+X%)    │
├──────────────┼──────────────┼───────────────┤
│  Conversion  │  D1 Retention│  Rating       │
│  [X]% (+X%)  │  [X]% (+X%)  │  [X.X] ★      │
└──────────────┴──────────────┴───────────────┘
```

### Funnel Dashboard (check daily)

```
Impressions → Page Views → Downloads → activation_reached → purchase_completed
   [N]          [N]          [N]          [N]          [N]
        [X]%         [X]%         [X]%          [X]%
```

### Cohort Dashboard (check monthly)

Retention curves by:
- Install date cohort
- Acquisition source
- Country
- Subscription plan (weekly / monthly / yearly)
- Platform (iPhone / web) and app language

## Output Format

### Analytics Audit

```
Current State:
- Tools in use: [list]
- Events tracked: [N]
- Key gaps: [list]

Recommendations:
1. [tracking gap to fix]
2. [metric to start monitoring]
3. [dashboard to create]
```

### Tracking Plan

Provide a complete event tracking plan with:
- Event name
- When it fires
- Properties to include
- Which tool tracks it (PostHog client / PostHog server / App Store Connect)

### Metric Interpretation

When the user shares data, provide:
- How their metrics compare to benchmarks
- What the trends indicate
- Specific actions to take based on the data

## Related Skills

- `ab-test-store-listing` — Measure test results
- `retention-optimization` — Interpret retention data
- `monetization-strategy` — Revenue metric optimization
- `ua-campaign` — UA metrics (App Store Connect source types only; no attribution SDK)
