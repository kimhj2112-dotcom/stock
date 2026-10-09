import unittest

from analysis import analyze_quotes


class AnalyzeQuotesTests(unittest.TestCase):
    def test_calculates_direction_average_volatility_and_extremes(self):
        result = analyze_quotes(
            [
                {"symbol": "AAA", "changeValue": 2.0},
                {"symbol": "BBB", "changeValue": -1.0},
                {"symbol": "CCC", "changeValue": 0.0},
                {"symbol": "DDD", "changeValue": 99.0, "fallback": True},
            ]
        )

        self.assertEqual(result["count"], 3)
        self.assertEqual(result["advancers"], 1)
        self.assertEqual(result["decliners"], 1)
        self.assertEqual(result["unchanged"], 1)
        self.assertEqual(result["averageChangeValue"], 0.3333)
        self.assertEqual(result["topGainer"]["symbol"], "AAA")
        self.assertEqual(result["topLoser"]["symbol"], "BBB")

    def test_returns_empty_summary_without_valid_quotes(self):
        result = analyze_quotes([{"symbol": "AAA", "changeValue": 0, "fallback": True}])

        self.assertEqual(result["count"], 0)
        self.assertIsNone(result["topGainer"])
        self.assertEqual(result["volatility"], 0.0)


if __name__ == "__main__":
    unittest.main()