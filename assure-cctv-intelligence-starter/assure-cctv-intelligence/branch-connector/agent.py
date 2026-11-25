"""
Assure branch connector placeholder.
This deliberately does not connect to a camera or transmit video yet.
"""

import platform
import socket
from datetime import datetime, timezone

def status():
    return {
        "agent": "assure-branch-connector",
        "version": "0.1.0-placeholder",
        "host": socket.gethostname(),
        "platform": platform.platform(),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "camera_integration": "not_configured",
    }

if __name__ == "__main__":
    print(status())
