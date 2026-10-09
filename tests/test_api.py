import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app import app


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_route(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_quotes_return_python_analysis(self):
        items = [
            {"symbol": "AAA", "changeValue": 2.0, "fallback": False},
            {"symbol": "BBB", "changeValue": -1.0, "fallback": False},
        ]
        with patch("app.load_quotes", new=AsyncMock(return_value=items)):
            response = self.client.get("/api/quotes?symbols=AAA,BBB")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["analysis"]["advancers"], 1)
        self.assertEqual(response.json()["analysis"]["topGainer"]["symbol"], "AAA")

    def test_signup_rejects_invalid_phone_before_firebase(self):
        response = self.client.post(
            "/api/auth/signup",
            json={"name": "Test User", "email": "test@example.com", "password": "password123", "phone": "abc"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("전화번호", response.json()["message"])

    @patch("app.firebase_credentials_configured", return_value=True)
    @patch("app.get_firebase_app", return_value=object())
    @patch("app.auth.create_user", return_value=SimpleNamespace(uid="test-user"))
    @patch("app.db.reference")
    def test_signup_saves_profile_without_password(self, reference, create_user, get_app, configured):
        profile_ref = MagicMock()
        reference.return_value = profile_ref

        response = self.client.post(
            "/api/auth/signup",
            json={
                "name": "Test User",
                "email": "test@example.com",
                "password": "must-not-be-stored",
                "phone": "010-1234-5678",
            },
        )

        self.assertEqual(response.status_code, 201)
        reference.assert_called_once_with("users/test-user", app=get_app.return_value)
        profile = profile_ref.set.call_args.args[0]
        self.assertEqual(profile["name"], "Test User")
        self.assertEqual(profile["email"], "test@example.com")
        self.assertEqual(profile["phoneNumber"], "+821012345678")
        self.assertNotIn("password", profile)

    @patch("app.firebase_credentials_configured", return_value=True)
    @patch("app.get_firebase_app")
    @patch("app.db.reference")
    def test_comment_writes_firebase_server_timestamp(self, reference, get_app, configured):
        comment_ref = MagicMock()
        reference.return_value.push.return_value = comment_ref

        response = self.client.post(
            "/api/comments",
            json={"ticker": "MSFT", "name": "Tester", "comment": "Python API test"},
        )

        self.assertEqual(response.status_code, 201)
        reference.assert_called_once_with("comments/MSFT", app=get_app.return_value)
        comment_ref.set.assert_called_once_with(
            {"ticker": "MSFT", "name": "Tester", "comment": "Python API test", "createdAt": {".sv": "timestamp"}}
        )


if __name__ == "__main__":
    unittest.main()