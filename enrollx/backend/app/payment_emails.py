"""Payment email templates. Emails are English-only in v1 (spec §3: platform
sender with the tenant's display name; per-tenant branding is Phase 2)."""


def _fmt(amount_cents: int, currency: str) -> str:
    return f"{amount_cents / 100:,.2f} {currency.upper()}"


def payment_receipt_html(
    tenant_name: str, kind: str, amount_cents: int, currency: str, application_id: str
) -> str:
    label = {
        "full": "payment in full",
        "deposit": "deposit",
        "balance": "balance payment",
    }.get(kind, "payment")
    return (
        f"<p>Thank you — we received your {label} of "
        f"<strong>{_fmt(amount_cents, currency)}</strong> for application "
        f"{application_id} at {tenant_name}.</p>"
        "<p>You can check your application status any time from your "
        "registration link.</p>"
    )


def balance_reminder_html(
    tenant_name: str, balance_cents: int, currency: str, due_date: str, hub_url: str
) -> str:
    return (
        f"<p>Your deposit for {tenant_name} is confirmed. The remaining balance of "
        f"<strong>{_fmt(balance_cents, currency)}</strong> is due by "
        f"<strong>{due_date}</strong>.</p>"
        f'<p><a href="{hub_url}">Pay the balance or view your application</a>.</p>'
    )
