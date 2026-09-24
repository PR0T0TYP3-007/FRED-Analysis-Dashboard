"""The curated set of FRED series this warehouse tracks.

FRED exposes over 800,000 series. A dashboard that tries to cover all of them
says nothing; this is a deliberately opinionated macro panel -- growth, prices,
labour, rates, credit and markets -- chosen so that every screen answers a
question a macro analyst actually asks.

`unit_kind` and `default_transform` drive formatting and the default chart
transform in the UI, so the frontend never has to hardcode per-series rules.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

# Transform applied by default when a series is charted.
#   level     -- plot the raw value (rates, ratios, diffusion indexes)
#   yoy       -- plot year-over-year % change (price and activity levels)
#   index100  -- rebase to 100 at the start of the visible window
LEVEL, YOY, INDEX100 = "level", "yoy", "index100"

# Formatting family used by the frontend number formatter.
PERCENT, INDEX, USD, COUNT, RATIO = ("percent", "index", "usd", "count", "ratio")

# FRED reports each series in its own magnitude -- GDP in billions of dollars,
# payrolls in thousands of persons. `scale` converts the stored value into base
# units so the formatter can render "$24.3T" and "159.1M" instead of "$24.3K".
BILLIONS, MILLIONS, THOUSANDS, UNITS = 1e9, 1e6, 1e3, 1.0

# Reading order used by every category rail in the UI.
CATEGORY_ORDER: tuple[str, ...] = (
    "growth",
    "inflation",
    "labor",
    "rates",
    "credit",
    "markets",
    "cycle",
)

CATEGORIES: dict[str, dict[str, str]] = {
    "growth": {
        "label": "Growth & Activity",
        "blurb": "Output, production and the demand side of the economy.",
    },
    "inflation": {
        "label": "Inflation & Prices",
        "blurb": "Consumer and producer prices, plus what markets expect next.",
    },
    "labor": {
        "label": "Labor Market",
        "blurb": "Employment, participation, wages and job openings.",
    },
    "rates": {
        "label": "Rates & Curve",
        "blurb": "Policy rate, the Treasury curve and what households borrow at.",
    },
    "credit": {
        "label": "Money & Credit",
        "blurb": "Money supply, consumer credit and delinquency stress.",
    },
    "markets": {
        "label": "Markets",
        "blurb": "Equities, volatility, the dollar and commodities.",
    },
    "cycle": {
        "label": "Cycle Reference",
        "blurb": "Official recession dating and real-time recession rules.",
    },
}


@dataclass(frozen=True, slots=True)
class SeriesSpec:
    series_id: str
    display_name: str
    category: str
    unit_kind: str
    default_transform: str
    priority: int = 100
    higher_is_better: bool | None = None
    scale: float = 1.0

    def as_row(self) -> dict:
        return asdict(self)


CATALOG: tuple[SeriesSpec, ...] = (
    # ---- growth -------------------------------------------------------------
    SeriesSpec("GDPC1", "Real GDP", "growth", USD, YOY, 10, True, BILLIONS),
    SeriesSpec("INDPRO", "Industrial Production", "growth", INDEX, YOY, 20, True),
    SeriesSpec("RSAFS", "Retail Sales", "growth", USD, YOY, 30, True, MILLIONS),
    SeriesSpec("PCEC96", "Real Consumer Spending", "growth", USD, YOY, 40, True, BILLIONS),
    SeriesSpec("HOUST", "Housing Starts", "growth", COUNT, YOY, 50, True, THOUSANDS),
    SeriesSpec("PERMIT", "Building Permits", "growth", COUNT, YOY, 60, True, THOUSANDS),
    SeriesSpec("UMCSENT", "Consumer Sentiment", "growth", INDEX, LEVEL, 70, True),
    SeriesSpec("BUSINV", "Business Inventories", "growth", USD, YOY, 80, None, MILLIONS),
    # ---- inflation ----------------------------------------------------------
    SeriesSpec("CPIAUCSL", "CPI, All Items", "inflation", INDEX, YOY, 10, False),
    SeriesSpec("CPILFESL", "Core CPI", "inflation", INDEX, YOY, 20, False),
    SeriesSpec("PCEPI", "PCE Price Index", "inflation", INDEX, YOY, 30, False),
    SeriesSpec("PCEPILFE", "Core PCE", "inflation", INDEX, YOY, 40, False),
    SeriesSpec("PPIACO", "Producer Prices", "inflation", INDEX, YOY, 50, False),
    SeriesSpec("T5YIE", "5Y Breakeven Inflation", "inflation", PERCENT, LEVEL, 60, None),
    SeriesSpec("T10YIE", "10Y Breakeven Inflation", "inflation", PERCENT, LEVEL, 70, None),
    SeriesSpec("T5YIFR", "5Y5Y Forward Inflation", "inflation", PERCENT, LEVEL, 80, None),
    # ---- labor --------------------------------------------------------------
    SeriesSpec("UNRATE", "Unemployment Rate", "labor", PERCENT, LEVEL, 10, False),
    SeriesSpec("PAYEMS", "Nonfarm Payrolls", "labor", COUNT, YOY, 20, True, THOUSANDS),
    SeriesSpec("ICSA", "Initial Jobless Claims", "labor", COUNT, LEVEL, 30, False, UNITS),
    SeriesSpec("CIVPART", "Labor Force Participation", "labor", PERCENT, LEVEL, 40, True),
    SeriesSpec("U6RATE", "U-6 Underemployment", "labor", PERCENT, LEVEL, 50, False),
    SeriesSpec("JTSJOL", "Job Openings", "labor", COUNT, YOY, 60, True, THOUSANDS),
    SeriesSpec("AHETPI", "Avg Hourly Earnings", "labor", USD, YOY, 70, True),
    SeriesSpec("AWHMAN", "Manufacturing Hours", "labor", RATIO, LEVEL, 80, True),
    # ---- rates --------------------------------------------------------------
    SeriesSpec("FEDFUNDS", "Fed Funds Rate", "rates", PERCENT, LEVEL, 10, None),
    SeriesSpec("DGS3MO", "3-Month Treasury", "rates", PERCENT, LEVEL, 20, None),
    SeriesSpec("DGS2", "2-Year Treasury", "rates", PERCENT, LEVEL, 30, None),
    SeriesSpec("DGS10", "10-Year Treasury", "rates", PERCENT, LEVEL, 40, None),
    SeriesSpec("DGS30", "30-Year Treasury", "rates", PERCENT, LEVEL, 50, None),
    SeriesSpec("T10Y2Y", "10Y minus 2Y Spread", "rates", PERCENT, LEVEL, 60, True),
    SeriesSpec("T10Y3M", "10Y minus 3M Spread", "rates", PERCENT, LEVEL, 70, True),
    SeriesSpec("MORTGAGE30US", "30Y Mortgage Rate", "rates", PERCENT, LEVEL, 80, False),
    SeriesSpec("BAMLH0A0HYM2", "High Yield Spread", "rates", PERCENT, LEVEL, 90, False),
    # ---- credit -------------------------------------------------------------
    SeriesSpec("M2SL", "M2 Money Supply", "credit", USD, YOY, 10, None, BILLIONS),
    SeriesSpec("TOTALSL", "Consumer Credit", "credit", USD, YOY, 20, None, BILLIONS),
    SeriesSpec("DRCCLACBS", "Credit Card Delinquency", "credit", PERCENT, LEVEL, 30, False),
    SeriesSpec("TOTCI", "Commercial & Industrial Loans", "credit", USD, YOY, 40, True, BILLIONS),
    SeriesSpec("DRTSCILM", "Banks Tightening C&I Standards", "credit", PERCENT, LEVEL, 50, False),
    # ---- markets ------------------------------------------------------------
    SeriesSpec("SP500", "S&P 500", "markets", INDEX, LEVEL, 10, True),
    SeriesSpec("VIXCLS", "VIX Volatility", "markets", INDEX, LEVEL, 20, False),
    SeriesSpec("DTWEXBGS", "Trade-Weighted Dollar", "markets", INDEX, LEVEL, 30, None),
    SeriesSpec("DCOILWTICO", "WTI Crude Oil", "markets", USD, LEVEL, 40, None),
    SeriesSpec("GVZCLS", "Gold Volatility", "markets", INDEX, LEVEL, 50, None),
    # ---- cycle --------------------------------------------------------------
    SeriesSpec("USREC", "NBER Recession Indicator", "cycle", RATIO, LEVEL, 10, None),
    SeriesSpec("SAHMREALTIME", "Sahm Rule (official)", "cycle", PERCENT, LEVEL, 20, False),
)

CATALOG_BY_ID: dict[str, SeriesSpec] = {s.series_id: s for s in CATALOG}

# Series that headline the overview screen, in the order they appear there.
HEADLINE_SERIES: tuple[str, ...] = (
    "UNRATE",
    "CPIAUCSL",
    "GDPC1",
    "FEDFUNDS",
)

# Secondary tiles under the headline row.
PULSE_SERIES: tuple[str, ...] = (
    "PAYEMS",
    "CPILFESL",
    "T10Y2Y",
    "SP500",
    "ICSA",
    "MORTGAGE30US",
)

# Series included in the correlation matrix and lead/lag study. Restricted to
# monthly-or-better series with long histories so the windows are comparable.
CORRELATION_SERIES: tuple[str, ...] = (
    "UNRATE",
    "PAYEMS",
    "INDPRO",
    "RSAFS",
    "HOUST",
    "PERMIT",
    "CPIAUCSL",
    "CPILFESL",
    "PCEPI",
    "PPIACO",
    "FEDFUNDS",
    "DGS10",
    "T10Y2Y",
    "M2SL",
    "SP500",
    "VIXCLS",
    "UMCSENT",
    "ICSA",
    "DCOILWTICO",
    "MORTGAGE30US",
)

# Target variables for the lead/lag study -- "what moves before this does?"
LEAD_LAG_TARGETS: tuple[str, ...] = ("UNRATE", "CPIAUCSL", "INDPRO")

# Series we produce a forward projection for. Deliberately short: a forecast is
# only worth showing where a simple model has a defensible backtest.
FORECAST_SERIES: tuple[str, ...] = (
    "UNRATE",
    "CPIAUCSL",
    "PAYEMS",
    "INDPRO",
    "HOUST",
    "RSAFS",
)


def category_rank(category: str) -> int:
    try:
        return CATEGORY_ORDER.index(category)
    except ValueError:
        return len(CATEGORY_ORDER)


def active_series_ids() -> list[str]:
    return [s.series_id for s in CATALOG]
