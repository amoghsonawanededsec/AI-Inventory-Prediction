import httpx
import sys

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://127.0.0.1:8000"
FRONTEND_URL = "http://localhost:5173"

def test_live():
    client = httpx.Client(timeout=10.0)

    print("1. Checking frontend server...")
    r = client.get(FRONTEND_URL)
    assert r.status_code == 200, f"Frontend failed with {r.status_code}"
    print("   [OK] Frontend is up and returning HTML")

    print("2. Checking backend health...")
    r = client.get(f"{BASE_URL}/health")
    assert r.status_code == 200 and r.json().get("status") == "ok"
    print("   [OK] Backend health is OK")

    print("3. Checking admin login...")
    r = client.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@inventory.example.com", "password": "Admin123!"})
    assert r.status_code == 200, f"Login failed: {r.text}"
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("   [OK] Admin login successful")

    print("4. Checking dashboard KPIs...")
    r = client.get(f"{BASE_URL}/api/dashboard", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["kpis"]["total_products"] >= 30
    print(f"   [OK] Dashboard loaded: {data['kpis']['total_products']} products, revenue: ₹{data['kpis']['revenue']:,}")

    print("5. Checking products catalog...")
    r = client.get(f"{BASE_URL}/api/products?page_size=5", headers=headers)
    assert r.status_code == 200 and len(r.json()["items"]) > 0
    sample_product = r.json()["items"][0]
    print(f"   [OK] Sample product: {sample_product['name']} (Stock: {sample_product['current_stock']})")

    print("6. Checking batch receiving endpoint...")
    batch_payload = {
        "product_id": sample_product["id"],
        "lot_number": "LIVE-VERIFY-001",
        "quantity": 10,
        "received_date": "2026-09-10",
        "expiry_date": "2026-12-31"
    }
    r = client.post(f"{BASE_URL}/api/inventory/batches", headers=headers, json=batch_payload)
    assert r.status_code == 201, f"Batch receive failed: {r.text}"
    print(f"   [OK] Batch received: Lot {r.json()['lot_number']}, New Stock: {r.json()['current_stock']}")

    print("7. Checking batch list...")
    r = client.get(f"{BASE_URL}/api/inventory/batches?product_id={sample_product['id']}", headers=headers)
    assert r.status_code == 200 and len(r.json()) > 0
    print(f"   [OK] Batches tracked: {len(r.json())} batch(es) for product")

    print("8. Checking reorder recommendations...")
    r = client.get(f"{BASE_URL}/api/reorders", headers=headers)
    assert r.status_code == 200
    reorders = r.json()
    print(f"   [OK] Found {len(reorders)} reorder recommendation(s)")

    if reorders:
        rec_id = reorders[0]["id"]
        print("9. Converting reorder recommendation to Purchase Order...")
        r = client.post(f"{BASE_URL}/api/purchase-orders/from-reorders", headers=headers, json={"recommendation_ids": [rec_id]})
        assert r.status_code == 201, f"PO conversion failed: {r.text}"
        po_id = r.json()["created_pos"][0]
        print(f"   [OK] Purchase Order #{po_id} created")

        print("10. Receiving Purchase Order goods...")
        r = client.post(f"{BASE_URL}/api/purchase-orders/{po_id}/receive", headers=headers)
        assert r.status_code == 200 and r.json()["status"] == "received"
        print(f"   [OK] PO #{po_id} received and inventory updated")

    print("11. Checking System Info & Architecture endpoint...")
    r = client.get(f"{BASE_URL}/api/system/info", headers=headers)
    assert r.status_code == 200 and "app_name" in r.json()
    print(f"   [OK] System info: {r.json()['app_name']} | Engine: {r.json()['database_engine']} | Model: {r.json()['llm_model']}")

    print("12. Checking What-If Scenario simulation...")
    r = client.post(f"{BASE_URL}/api/what-if", headers=headers, json={"product_id": sample_product["id"], "demand_change_pct": 20, "price_change_pct": 5, "promotion": True})
    assert r.status_code == 200 and "forecast_demand_during_lead_time" in r.json()
    print(f"   [OK] What-If simulation: Lead demand {r.json()['forecast_demand_during_lead_time']} units, Stockout Risk: {r.json()['stockout_risk']}")

    print("13. Checking AI Assistant /chat endpoint...")
    chat_payload = {"message": "Which products are below their reorder point?"}
    r = client.post(f"{BASE_URL}/api/chat", headers=headers, json=chat_payload)
    assert r.status_code == 200, f"Chat failed: {r.text}"
    chat_resp = r.json()
    print(f"   [OK] AI Assistant responded (Intent: {chat_resp['intent']})")
    print(f"        Response snippet: {chat_resp['response'][:100]}...")

    print("\n>>> ALL LIVE CHECKS PASSED PERFECTLY! <<<")

if __name__ == "__main__":
    try:
        test_live()
    except Exception as e:
        print(f"FAILED: {e}")
        sys.exit(1)
