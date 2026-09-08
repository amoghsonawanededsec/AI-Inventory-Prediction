from pathlib import Path
import sys

from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.main import app

client = TestClient(app)


def login() -> dict[str, str]:
    response = client.post("/api/auth/login", json={"email": "admin@inventory.example.com", "password": "Admin123!"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_health_and_authentication():
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/api/products").status_code == 401
    headers = login()
    assert client.get("/api/auth/me", headers=headers).json()["role"] == "admin"


def test_dashboard_and_live_chat_tools():
    headers = login()
    dashboard = client.get("/api/dashboard", headers=headers)
    assert dashboard.status_code == 200
    assert dashboard.json()["kpis"]["total_products"] >= 30
    chat = client.post("/api/chat", headers=headers, json={"message": "Which products are below their reorder point?"})
    assert chat.status_code == 200
    assert chat.json()["intent"] == "low_stock"
    assert chat.json()["tool_data"]["products"]


def test_forecast_and_reorder_explanation():
    headers = login()
    product = client.get("/api/products?page_size=1", headers=headers).json()["items"][0]
    forecasts = client.get(f"/api/forecasts?product_id={product['id']}&horizon_days=7", headers=headers)
    assert forecasts.status_code == 200
    assert len(forecasts.json()) == 7
    reply = client.post("/api/chat", headers=headers, json={"message": f"How much {product['name']} should I order next week?"})
    assert reply.status_code == 200
    assert reply.json()["intent"] == "reorder"
    assert "safety stock" in reply.json()["response"]
