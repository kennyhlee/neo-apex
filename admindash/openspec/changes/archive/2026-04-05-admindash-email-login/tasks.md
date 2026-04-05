## 1. Types and API Client

- [ ] 1.1 Update `TestUser` interface in `types/models.ts` — remove `username` and `password` fields, add shape matching login API response user object (`user_id`, `name`, `email`, `tenant_id`, `tenant_name`, `role`)
- [ ] 1.2 Add `login(email: string, password: string)` function to `api/client.ts` — `POST /api/login` with `{email, password}`, returns `{token, user}`
- [ ] 1.3 Update all existing API functions in `api/client.ts` to include `Authorization: Bearer {token}` header (read token from localStorage key `admindash_token`)

## 2. Auth Context

- [ ] 2.1 Refactor `AuthContext.tsx` — remove `test_user.json` fetch, initialize from localStorage (`admindash_token` + `admindash_user`), set `ready` after check
- [ ] 2.2 Change `login()` to async — call the new API `login()` function, store token in `localStorage('admindash_token')` and user in `localStorage('admindash_user')`, return success/failure
- [ ] 2.3 Update `logout()` — clear `admindash_token` and `admindash_user` from localStorage instead of sessionStorage

## 3. Login Page UI

- [ ] 3.1 Update `LoginPage.tsx` — change username field to email field (`type="email"`, `name="email"`), update form submission to call async `login(email, password)`
- [ ] 3.2 Add error handling for network/server errors — display appropriate error messages for API failures vs invalid credentials

## 4. Translations

- [ ] 4.1 Update `translations.ts` — replace `login.username` / `login.usernamePlaceholder` keys with `login.email` / `login.emailPlaceholder` in both `en-US` and `zh-CN` locales

## 5. Cleanup

- [ ] 5.1 Remove `test_user.json` from auth flow — update or add a comment in the file noting it's for dev reference only, not used by the app
- [ ] 5.2 Verify build passes — run `npm run build` to confirm no TypeScript errors
