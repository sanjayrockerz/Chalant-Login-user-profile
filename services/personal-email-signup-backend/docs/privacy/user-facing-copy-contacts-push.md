# User-Facing Copy — Contacts Import & Push Notifications

**Audience:** Product, Design, Localization, Support  
**Status:** Draft pending legal + UX review  
**Date:** 2025-10-18

---

## 1. In-App Messaging

### 1.1 Contacts Upload Consent Modal

- **Title:** *Find friends faster*
- **Body:**
  > "Upload your phone contacts so we can show you friends who are already here. We hash your contacts, never store raw phone numbers, and automatically delete them after 30 days."
- **Primary Button:** *Upload contacts*
- **Secondary Button:** *No thanks*
- **Footer Link:** *Learn more about privacy* → `/privacy#contacts` (updated section).

### 1.2 Upload Button Tooltip

> "We hash your contacts and match them with our users. Your contacts are automatically deleted after 30 days."

### 1.3 Success Toast (optional)

> "Contacts uploaded! We’ll suggest friends if we find matches."

### 1.4 Settings → Privacy Page

| Control | Label | Description |
| --- | --- | --- |
| Toggle | **Allow Contact Discovery** | "Let friends find you when they upload their contacts." *(Default: On)* |
| Button | **Delete Uploaded Contacts** | "Remove the contacts you uploaded. We’ll stop suggesting friends based on them." |
| Link | **How are my contacts used?** | Opens Help Center article. |

### 1.5 Notifications Permission Prompt (App-Level Screen prior to OS Dialog)

> "Enable notifications to stay on top of messages and account updates. You can turn these off anytime in your device settings."

### 1.6 Notification Settings Screen

| Section | Copy |
| --- | --- |
| Description | "We store a device token from Apple or Google to deliver notifications. Tokens are deleted when you log out or disable notifications." |
| Toggle | **Account & Security Alerts** – "Critical updates about your account." |
| Toggle | **Messages & Activity** – "New messages, friend requests, and comments." |
| Footer | "Disable notifications from your device settings or log out to remove your device token." |

---

## 2. Help Center Articles

1. **How are my contacts used?**  
   - Explain hashing, 30-day retention, ability to delete anytime.  
   - Highlight opt-out of appearing in others’ suggestions.
2. **How do I delete my contacts?**  
   - Step-by-step instructions (Settings → Privacy → Delete Contacts).  
   - Mention deletion timeline (immediate from primary DB, 30-day backup window).
3. **Why am I seeing friend suggestions?**  
   - Explain contact discovery and mutual matches.  
   - Include link to settings for opting out.  
4. **How do I opt out of notifications?**  
   - OS-specific instructions for iOS and Android.  
   - Mention logout removes device token.
5. **What happens if I re-enable notifications?**  
   - Token re-registered, previous preferences restored.  
   - Provide contact for support if issues persist.

Each article should include: last updated date, platform-specific screenshots, and contact path to Support.

---

## 3. Customer Support Macros

- **Macro:** `contacts.delete.confirm` → "We’ve processed your request to delete uploaded contacts. You can upload them again anytime from Settings → Privacy."
- **Macro:** `notifications.optout.instructions` → Short instructions referencing device settings.
- **Macro:** `contacts.optout.discovery` → Steps to toggle off Allow Contact Discovery.

---

## 4. Localization Notes

- Avoid idioms; ensure hashing explanation translates clearly.  
- Keep retention statements precise: use "30 days" rather than "one month."  
- Provide placeholders for links so regional sites can update to localized privacy policy URL.

---

## 5. Review Checklist

- [ ] Legal approves final copy.  
- [ ] UX verifies layout within design system.  
- [ ] Localization team receives strings in Figma/Transifex.  
- [ ] Support updates macros and help center within Zendesk Guide.
