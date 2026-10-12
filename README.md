# Auth System Monorepo

This monorepo consolidates authentication-related backend services using Git subtrees to preserve full Git history.

## Structure

- `services/login-page-back/`: Contains the backend code for the login page functionality.
- `services/personal-email-signup-backend/`: Contains the backend code for personal email signup functionality.

Each service directory maintains its own independent Git history, allowing for easy tracking of changes and potential future splitting if needed.

## Contributing

1. Work within the respective `services/` subdirectory for your changes.
2. Use `git subtree pull` to update from upstream during the transition period.
3. Commit changes at the monorepo level.

## Services

### Login Page Backend
Located in `services/login-page-back/`. Handles user authentication for the login page.

### Personal Email Signup Backend
Located in `services/personal-email-signup-backend/`. Manages the signup process for personal email accounts.