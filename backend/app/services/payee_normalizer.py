"""
Payee normalization service.

Rules are evaluated in priority order (lowest number = highest priority).
Each rule can use:
  - pattern: a regex (matched against raw payee, case-insensitive)
  - canonical: the canonical display name to use

Built-in rules cover common vendors. Owner can add custom rules via the API.
"""
from __future__ import annotations
import re
from typing import Optional

# Built-in rules: (priority, pattern, canonical)
BUILTIN_RULES: list[tuple[int, str, str]] = [
    (10, r"AMZN|AMAZON|AMZ\b", "Amazon"),
    (10, r"UBER\s*(EATS|TRIP|.*)?", "Uber"),
    (10, r"LYFT", "Lyft"),
    (10, r"DOORDASH|DD\s*DASH", "DoorDash"),
    (10, r"GRUBHUB", "Grubhub"),
    (10, r"INSTACART", "Instacart"),
    (10, r"APPLE\.COM/BILL|APPLE\s+STORE|ITUNES", "Apple"),
    (10, r"GOOGLE\s*\*?(\w+)?", "Google"),
    (10, r"NETFLIX", "Netflix"),
    (10, r"SPOTIFY", "Spotify"),
    (10, r"HULU", "Hulu"),
    (10, r"DISNEY\s*\+|DISNEYPLUS", "Disney+"),
    (10, r"SLACK\s*(TECHNOLOGIES)?", "Slack"),
    (10, r"NOTION", "Notion"),
    (10, r"DROPBOX", "Dropbox"),
    (10, r"ZOOM\s*(US|VIDEO)?", "Zoom"),
    (10, r"GITHUB", "GitHub"),
    (10, r"OPENAI|CHATGPT", "OpenAI"),
    (10, r"ANTHROPIC", "Anthropic"),
    (10, r"HEROKU", "Heroku"),
    (10, r"DIGITALOCEAN", "DigitalOcean"),
    (10, r"AWS|AMAZON\s+WEB\s+SERVICES", "AWS"),
    (10, r"MICROSOFT|MSFT|XBOX", "Microsoft"),
    (10, r"LINKEDIN", "LinkedIn"),
    (10, r"TWITTER|X\.COM", "X (Twitter)"),
    (10, r"PAYPAL", "PayPal"),
    (10, r"SQUARE\s*(INC|\*)", "Square"),
    (10, r"STRIPE", "Stripe"),
    (10, r"SHOPIFY", "Shopify"),
    (10, r"QUICKBOOKS|INTUIT", "Intuit / QuickBooks"),
    (10, r"TURBOTAX", "TurboTax"),
    (10, r"COSTCO", "Costco"),
    (10, r"TARGET\b", "Target"),
    (10, r"WALMART|WAL-MART", "Walmart"),
    (10, r"WHOLE\s*FOODS", "Whole Foods"),
    (10, r"TRADER\s*JOE", "Trader Joe's"),
    (10, r"CHEVRON", "Chevron"),
    (10, r"SHELL\b", "Shell"),
    (10, r"ARCO\b", "ARCO"),
    (10, r"FEDEX", "FedEx"),
    (10, r"UPS\b", "UPS"),
    (10, r"USPS|US\s+POSTAL", "USPS"),
    (10, r"SOUTHWEST\s*(AIRLINES)?", "Southwest Airlines"),
    (10, r"DELTA\s*(AIRLINES|AIR)?", "Delta Airlines"),
    (10, r"AMERICAN\s+AIRLINES|AA\.COM", "American Airlines"),
    (10, r"UNITED\s+(AIRLINES|AIR)?", "United Airlines"),
    (10, r"ALASKA\s+AIRLINES", "Alaska Airlines"),
    (10, r"AIRBNB", "Airbnb"),
    (10, r"EXPEDIA", "Expedia"),
    (10, r"MARRIOTT", "Marriott"),
    (10, r"HILTON", "Hilton"),
    (10, r"HYATT", "Hyatt"),
    (10, r"STARBUCKS", "Starbucks"),
    (10, r"CHIPOTLE", "Chipotle"),
    (10, r"MCDONALD|MCK\b", "McDonald's"),
    (10, r"SUBWAY\b", "Subway"),
]


def normalize_payee(
    raw_payee: str,
    custom_rules: Optional[list[tuple[int, str, str]]] = None,
) -> Optional[str]:
    """
    Return a canonical payee name if a rule matches, else None.
    custom_rules: list of (priority, pattern, canonical) from the DB,
                  lower priority number = higher precedence.
    """
    all_rules = sorted(
        (custom_rules or []) + BUILTIN_RULES,
        key=lambda r: r[0],
    )
    upper = raw_payee.upper()
    for _, pattern, canonical in all_rules:
        if re.search(pattern, upper, re.IGNORECASE):
            return canonical
    return None
