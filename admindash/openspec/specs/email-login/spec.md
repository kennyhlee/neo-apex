# Capability: Email Login

## Purpose

Email-based authentication for AdminDash, replacing username-based login with email/password credentials authenticated against the API server, with JWT token management and localStorage persistence.

## Requirements

### Requirement: Login form uses email field
The login form SHALL use an email input field instead of a username field. The field SHALL have `type="email"` for browser-native validation and autocomplete support.

#### Scenario: User sees email field on login page
- **WHEN** user navigates to the login page
- **THEN** the form displays an "Email" label with an email input field and a "Password" label with a password input field

#### Scenario: Email field validates format
- **WHEN** user enters a value that is not a valid email format
- **AND** submits the form
- **THEN** the browser's native email validation prevents submission

### Requirement: Login authenticates via API
The login form SHALL submit credentials to `POST /api/login` with body `{email, password}`. On success (200), the response SHALL contain `{token, user}` where `token` is a JWT string and `user` is the authenticated user object.

#### Scenario: Successful login
- **WHEN** user enters a valid email and password
- **AND** submits the login form
- **THEN** the system sends `POST /api/login` with `{email, password}`
- **AND** on 200 response, stores the JWT token and user data
- **AND** navigates to `/home`

#### Scenario: Invalid credentials
- **WHEN** user enters an email or password that does not match any registry record
- **AND** submits the login form
- **THEN** the system displays an error message (e.g., "Invalid email or password")
- **AND** remains on the login page

#### Scenario: Network or server error
- **WHEN** the login API call fails due to network error or non-200 response
- **THEN** the system displays a generic error message (e.g., "Login failed. Please try again.")
- **AND** remains on the login page

### Requirement: JWT token stored in localStorage
The system SHALL store the JWT token in `localStorage` with the key `admindash_token`. The user object SHALL be stored in `localStorage` with the key `admindash_user`.

#### Scenario: Token persists across page refresh
- **WHEN** user is logged in
- **AND** refreshes the page
- **THEN** the system reads the token and user from localStorage
- **AND** the user remains authenticated

#### Scenario: Token persists across tabs
- **WHEN** user is logged in in one tab
- **AND** opens the app in a new tab
- **THEN** the new tab reads the token from localStorage
- **AND** the user is authenticated without re-entering credentials

### Requirement: Authenticated API requests include token
All API requests to the Admindash API server SHALL include the JWT token in the `Authorization` header as `Bearer {token}`.

#### Scenario: API request with valid token
- **WHEN** an authenticated user triggers an API request
- **THEN** the request includes `Authorization: Bearer {token}` header

#### Scenario: API request after token cleared
- **WHEN** no token exists in localStorage
- **AND** a protected API request is attempted
- **THEN** the system redirects to the login page

### Requirement: Logout clears token and user
The logout action SHALL remove the JWT token and user data from localStorage and redirect to the login page.

#### Scenario: User logs out
- **WHEN** user clicks the logout button
- **THEN** the system removes `admindash_token` and `admindash_user` from localStorage
- **AND** clears the auth state
- **AND** navigates to `/login`

### Requirement: AuthContext initializes from localStorage
On app startup, AuthContext SHALL check localStorage for an existing token and user. If both exist, the user is considered authenticated. The `ready` flag SHALL be set to `true` once this check completes.

#### Scenario: App loads with existing token
- **WHEN** the app starts
- **AND** `admindash_token` and `admindash_user` exist in localStorage
- **THEN** AuthContext sets the user as authenticated
- **AND** sets `ready` to `true`

#### Scenario: App loads without token
- **WHEN** the app starts
- **AND** no token exists in localStorage
- **THEN** AuthContext sets user as `null`
- **AND** sets `ready` to `true`

### Requirement: i18n labels reflect email login
All login-related translation keys SHALL use "Email" terminology instead of "Username".

#### Scenario: English translations
- **WHEN** locale is `en-US`
- **THEN** `login.username` key is replaced with `login.email` showing "Email"
- **AND** `login.usernamePlaceholder` is replaced with `login.emailPlaceholder` showing "Enter email"

#### Scenario: Chinese translations
- **WHEN** locale is `zh-CN`
- **THEN** `login.email` shows "邮箱"
- **AND** `login.emailPlaceholder` shows "请输入邮箱"
