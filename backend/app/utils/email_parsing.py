ALLOWED_CATEGORIES = {"personal", "realestate", "traverse", "edgehill"}


def parse_sub_address_variable(to_header: str) -> str:
    """Extract the sub-address token from `jamestinsley+<variable>@gmail.com`."""
    clean_header = to_header.lower().strip()
    if "+" not in clean_header or "@" not in clean_header:
        raise ValueError("Invalid email format: Missing sub-address token delimiter.")

    try:
        parts = clean_header.split("+")[1]
        variable = parts.split("@")[0]
    except IndexError:
        raise ValueError("Malformed sub-address format string structure.")

    if variable not in ALLOWED_CATEGORIES:
        raise ValueError(f"Unauthorized variable token category rejected: {variable}")

    return variable
