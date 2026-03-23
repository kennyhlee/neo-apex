# Spec: Session Persistence

## Purpose

Session management ensuring JWT tokens persist across browser refreshes and users can explicitly log out.

## Requirements

### Requirement: Token Storage in localStorage

JWT token persists across browser refresh using localStorage.

#### Scenario: Token survives refresh

- **WHEN** a user is authenticated and refreshes the browser
- **THEN** the app reads the token from localStorage
- **AND** validates it by calling `GET /api/me` with the Authorization header
- **AND** the user remains logged in without re-entering credentials

#### Scenario: Expired or invalid token on refresh

- **WHEN** the app reads a token from localStorage
- **AND** `GET /api/me` returns 401
- **THEN** the token is cleared from localStorage
- **AND** the user is redirected to the login page

### Requirement: Logout

Users can end their session via a logout button.

#### Scenario: User clicks logout

- **WHEN** a logged-in user clicks the logout button in the app header
- **THEN** the JWT token is removed from localStorage
- **AND** the user is redirected to the login page
- **AND** all in-memory user state is cleared
