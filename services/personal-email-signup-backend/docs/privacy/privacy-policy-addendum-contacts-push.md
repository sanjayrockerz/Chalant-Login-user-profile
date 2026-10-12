# Privacy Policy Addendum: Contacts Import & Push Notifications

**Status:** Draft for legal review  
**Prepared by:** Privacy & Compliance Engineering  
**Last updated:** 2025-10-18

---

## 1. Scope & Summary

This addendum supplements Sections 2 (Information We Collect), 3 (How We Use Information), and 6 (Your Choices & Controls) of the main Privacy Policy. It describes two upcoming data processing activities:

1. **Contacts Import** – optional phone contact uploads for friend discovery.  
2. **Push Notification Tokens** – device identifiers required to deliver in-app notifications.

These updates ensure transparency, articulate lawful bases under GDPR and CCPA, and introduce user self-service controls before features enter production.

---

## 2. Contacts Import

| Topic | Policy Language |
| --- | --- |
| **Collection** | *"If you choose to upload your phone contacts, we collect the phone numbers contained in your address book solely to help you find friends already on our platform."* |
| **Processing Purpose** | *"Uploaded phone numbers are immediately normalized to E.164 international format and hashed using the SHA-256 cryptographic function. We compare the resulting hashes against our existing user database to generate friend suggestions and highlight mutual connections."* |
| **Data Minimization & Security** | *"We store only hashed phone numbers—never the raw phone numbers themselves. Hashes operate as pseudonymous identifiers that cannot be reversed without extraordinary effort (e.g., large-scale rainbow table attacks). Raw inputs are discarded in volatile memory after hashing. Hashes are encrypted in transit and protected with role-based access controls."* |
| **Retention** | *"Hashed phone numbers are automatically deleted 30 days after upload. You can delete them earlier at any time from Settings → Privacy → Delete Contacts. We chose a 30-day retention window to balance the discovery utility (users returning to check new matches) with the GDPR data minimization principle."* |
| **User Controls** | *"You may disable contact-based suggestions for your account by turning off ‘Allow Contact Discovery’ in Settings → Privacy. When disabled, your own phone number hash will not appear in friend suggestions generated from other users' uploads."* |
| **Sharing & Transfers** | *"Hashed contact data is used exclusively within our systems and is not shared with third parties. Any international transfers rely on Standard Contractual Clauses where required."* |

### Additional Disclosures

- **Legal Basis (GDPR):** Consent (Article 6(1)(a)). Users explicitly trigger uploads.  
- **Opt-Out of Appearing:** Emphasize the global toggle controlling discoverability.  
- **Backup Retention:** Disaster recovery snapshots retain hashed contacts for up to 30 additional days, after which they are purged. Access is restricted to SRE personnel responding to incidents.

---

## 3. Push Notification Tokens

| Topic | Policy Language |
| --- | --- |
| **Collection** | *"When you enable notifications, we store a push token provided by your device’s operating system (Firebase Cloud Messaging for Android, Apple Push Notification service for iOS) so we can deliver notifications you request."* |
| **Processing Purpose** | *"Push tokens allow us to send you account alerts, security notifications, messages, service updates, and other events you opt into. To deliver a notification, we send the token to Google (FCM) or Apple (APNs), who route it to your device."* |
| **Retention** | *"We retain push tokens until you log out, uninstall the app, disable notifications, or your account remains inactive for 30 consecutive days. We automatically delete inactive tokens to honor the GDPR storage limitation principle."* |
| **User Controls** | *"You can disable notifications in your device settings at any time (iOS Settings → App → Notifications, Android Settings → Apps → Notifications). Logging out removes your token from our servers immediately."* |
| **Data Sharing** | *"Because push delivery relies on platform providers, we share your token with Google (for FCM) or Apple (for APNs). Tokens are non-sensitive identifiers and do not include personal content."* |
| **Security** | *"Push tokens are transmitted and stored over TLS-encrypted channels. We redact raw tokens from application logs and restrict access to operational personnel with a need to know."* |

### Additional Disclosures

- **Legal Basis (GDPR):** Legitimate Interest (Article 6(1)(f)) to provide core notification functionality, balanced against user ability to opt out.  
- **Do Not Track Advertising:** Clarify that tokens are used strictly for service notifications, not marketing without additional consent.  
- **Data Portability:** Users can export their registered device tokens through the self-service data export endpoint.

---

## 4. User Rights & Controls (Unified Section)

Update Privacy Policy Section 6 to reflect:

- **Access & Portability:** Users can visit **Settings → Privacy → Download My Data** (or call `GET /users/me/data`) to obtain hashed contacts and active push tokens.  
- **Deletion:** Provide clear instructions for deleting uploaded contacts and push tokens, including server-side deletion via `DELETE /contacts` and `DELETE /push-tokens/unregister`.  
- **Rectification:** Push tokens are refreshed automatically; users can re-register by reinstalling or re-enabling notifications.  
- **Restriction:** Toggle **Allow Contact Discovery** to prevent inclusion in other users’ suggestions.  
- **Objection:** Offer contact method for DPO review if users contest legitimate interest processing (push tokens).

---

## 5. Transparency & Notice

- Add a prominent banner or in-app modal when these features launch, linking to updated policy changes.  
- Provide plain-language summaries in FAQ and help center (see companion user-facing copy document).  
- For EU and UK users, surface just-in-time notices tied to the consent action (contacts upload).  
- For California residents, add a *Notice at Collection* snippet referencing these data categories.

---

## 6. Next Steps

1. **Legal Review:** Submit this draft to Legal/Privacy Counsel for redlines.  
2. **Product Integration:** Coordinate with UX to embed the language references (tooltips, toggles).  
3. **Policy Publication:** Upon approval, merge language into master Privacy Policy and schedule user notifications (minimum 30-day notice in applicable jurisdictions).  
4. **Audit Trail:** Archive signed approval and change log in the compliance repository (see legal signoff template).

---

*This document is a draft addendum and does not supersede existing policy until formally approved and published.*
