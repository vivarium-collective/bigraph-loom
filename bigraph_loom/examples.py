"""Example bigraph states for testing."""

EXAMPLE_CELL: dict = {
    "cell": {
        "cytoplasm": {
            "metabolites": 12.5,
            "proteins": 89.0,
            "metabolism": {
                "_type": "process",
                "address": "local:Metabolism",
                "config": {"k_cat": 0.05, "km": 1.2},
                "inputs": {
                    "substrates": ["metabolites"],
                    "enzymes": ["proteins"],
                },
                "outputs": {
                    "products": ["metabolites"],
                    "biomass": ["..", "mass"],
                },
            },
        },
        "membrane": {
            "surface_area": 4.5,
            "transporters": 200,
            "transport": {
                "_type": "process",
                "address": "local:Transport",
                "config": {"permeability": 0.3},
                "inputs": {
                    "external": ["..", "..", "environment", "nutrients"],
                    "channel_count": ["transporters"],
                },
                "outputs": {
                    "internal": ["..", "cytoplasm", "metabolites"],
                },
            },
        },
        "mass": 1.0,
        "growth": {
            "_type": "process",
            "address": "local:Growth",
            "config": {"growth_rate": 0.02},
            "inputs": {
                "mass": ["mass"],
            },
            "outputs": {
                "mass": ["mass"],
            },
        },
    },
    "environment": {
        "nutrients": 100.0,
        "temperature": 37.0,
        "volume": 1e-12,
    },
}

EXAMPLE_SIMPLE: dict = {
    "A": 1.0,
    "B": 0.0,
    "reaction": {
        "_type": "process",
        "address": "local:Reaction",
        "config": {"rate": 0.1},
        "inputs": {"substrate": ["A"]},
        "outputs": {"product": ["B"]},
    },
}
