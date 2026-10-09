from math import fsum, isfinite, sqrt


def analyze_quotes(items: list[dict]) -> dict:
    valid_items = []
    for item in items:
        if item.get("fallback"):
            continue
        value = item.get("changeValue")
        if isinstance(value, (int, float)) and isfinite(value):
            valid_items.append({**item, "changeValue": float(value)})

    if not valid_items:
        return {
            "count": 0,
            "advancers": 0,
            "decliners": 0,
            "unchanged": 0,
            "averageChangeValue": 0.0,
            "volatility": 0.0,
            "topGainer": None,
            "topLoser": None,
        }

    changes = [item["changeValue"] for item in valid_items]
    average = fsum(changes) / len(changes)
    variance = fsum((value - average) ** 2 for value in changes) / len(changes)
    top_gainer = max(valid_items, key=lambda item: item["changeValue"])
    top_loser = min(valid_items, key=lambda item: item["changeValue"])

    return {
        "count": len(valid_items),
        "advancers": sum(value > 0 for value in changes),
        "decliners": sum(value < 0 for value in changes),
        "unchanged": sum(value == 0 for value in changes),
        "averageChangeValue": round(average, 4),
        "volatility": round(sqrt(variance), 4),
        "topGainer": {
            "symbol": top_gainer["symbol"],
            "changeValue": top_gainer["changeValue"],
        },
        "topLoser": {
            "symbol": top_loser["symbol"],
            "changeValue": top_loser["changeValue"],
        },
    }