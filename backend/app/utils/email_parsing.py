ALLOWED_CATEGORIES = {"personal", "realestate", "traverse", "edgehill", "trust", "nopa"}

UNCATEGORIZED = "uncategorized"


def parse_sub_address_variable(to_header: str) -> str:
    """Extract the sub-address token from `jamestinsley.receipts+<variable>@gmail.com`.

    Returns the variable if it is in ALLOWED_CATEGORIES, or 'uncategorized' if the
    sub-address is structurally valid but not recognised.  Raises ValueError only for
    completely malformed addresses (missing + or @).
    """
    clean_header = to_header.lower().strip()
    if "+" not in clean_header or "@" not in clean_header:
        raise ValueError("Invalid email format: Missing sub-address token delimiter.")

    try:
        parts = clean_header.split("+")[1]
        variable = parts.split("@")[0]
    except IndexError:
        raise ValueError("Malformed sub-address format string structure.")

    if variable not in ALLOWED_CATEGORIES:
        return UNCATEGORIZED

    return variable
