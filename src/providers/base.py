"""Base classes and shared helpers for LLM quota providers."""

import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional


@dataclass
class QuotaMetrics:
    """Normalized quota metrics shared across all providers.

    Every provider converts its provider-specific API response into this
    structure so the web server / CLI can present uniform output.
    """

    quota_percentage: float
    next_reset_ms: Optional[int] = None

    def to_dict(self, now_ts: Optional[float] = None) -> dict:
        """Render metrics as the JSON payload served to clients."""
        payload: dict = {"quotaPercentage": self.quota_percentage}
        if self.next_reset_ms is not None:
            payload.update(format_reset_info(self.next_reset_ms, now_ts))
        return payload


def format_reset_info(next_reset_ms: int, now_ts: Optional[float] = None) -> dict:
    """Convert an epoch-ms reset timestamp into nextReset / remainingTime."""
    if now_ts is None:
        now_ts = time.time()
    # Shift to KST (UTC+9) and format as ISO8601 with +09:00
    kst_dt = datetime.fromtimestamp(next_reset_ms / 1000) + timedelta(hours=9)
    next_reset_str = kst_dt.strftime("%Y-%m-%dT%H:%M:%S+09:00")
    diff_sec = max(0, (next_reset_ms / 1000) - now_ts)
    hours = int(diff_sec // 3600)
    minutes = int((diff_sec % 3600) // 60)
    remaining_str = f"{hours:02d}:{minutes:02d}"
    return {"nextReset": next_reset_str, "remainingTime": remaining_str}


class QuotaProvider(ABC):
    """Abstract base class for an LLM quota provider.

    To support a new provider:
      1. Subclass this, set ``name`` (URL slug), ``display_name`` and
         ``env_key`` (environment variable holding the API key).
      2. Implement :meth:`fetch`, which queries the provider API and returns
         normalized :class:`QuotaMetrics`. Raise ``Exception`` with a
         human-readable message on failure.
      3. Register the instance in ``providers/__init__.py``.
    """

    name: str = "base"
    display_name: str = "Base"
    env_key: str = ""

    @abstractmethod
    def fetch(self, api_key: str) -> QuotaMetrics:
        """Query the provider and return normalized quota metrics."""
        raise NotImplementedError

    def is_configured(self) -> bool:
        """Return True when this provider's API key is set in the environment."""
        return bool(os.environ.get(self.env_key))
