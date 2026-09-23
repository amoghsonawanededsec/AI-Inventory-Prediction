"""Deterministic development data. Run with: python -m app.seed"""
from datetime import date, timedelta
from decimal import Decimal
import random
from .db import Base, SessionLocal, engine
from .models import Business, Category, KnowledgeChunk, KnowledgeDocument, Product, Role, Sale, Supplier, User
from .security import hash_password
from .services.forecasting import forecast_product
from .services.operations import refresh_operational_insights

CATEGORIES = ["Dairy", "Grains", "Beverages", "Produce", "Bakery", "Snacks"]
SUPPLIERS = [
    ("FreshFields Distributors", 2, .96), ("Northstar Foods", 4, .91), ("Daily Dairy Co.", 1, .98), ("Harvest Lane", 3, .92),
    ("Peak Beverage Supply", 5, .89), ("Golden Grain Mills", 4, .95), ("City Bakery Supply", 2, .94), ("Coastal Produce", 3, .90),
]
PRODUCTS = [
    ("Whole Milk", "Dairy", 62, 75, 50, 250, 28), ("Greek Yogurt", "Dairy", 110, 40, 30, 150, 16), ("Cheddar Cheese", "Dairy", 320, 28, 20, 120, 21),
    ("Butter", "Dairy", 250, 35, 25, 120, 30), ("Basmati Rice", "Grains", 85, 220, 80, 600, None), ("Whole Wheat Flour", "Grains", 55, 190, 70, 500, None),
    ("Rolled Oats", "Grains", 95, 65, 35, 220, None), ("Brown Rice", "Grains", 92, 80, 40, 260, None), ("Cola 500ml", "Beverages", 45, 125, 55, 400, 90),
    ("Orange Juice", "Beverages", 120, 45, 35, 180, 24), ("Sparkling Water", "Beverages", 35, 155, 60, 450, 180), ("Green Tea", "Beverages", 80, 78, 35, 250, 365),
    ("Apples", "Produce", 140, 30, 35, 120, 12), ("Bananas", "Produce", 55, 18, 40, 160, 6), ("Tomatoes", "Produce", 75, 24, 38, 150, 8),
    ("Potatoes", "Produce", 45, 95, 45, 300, 35), ("Spinach", "Produce", 50, 12, 32, 100, 5), ("Carrots", "Produce", 60, 72, 35, 220, 25),
    ("Sourdough Loaf", "Bakery", 95, 16, 28, 120, 4), ("Wholegrain Bread", "Bakery", 70, 22, 32, 140, 5), ("Croissants", "Bakery", 65, 18, 25, 100, 3),
    ("Muffins", "Bakery", 55, 28, 24, 100, 6), ("Potato Chips", "Snacks", 40, 160, 60, 500, 240), ("Trail Mix", "Snacks", 130, 64, 30, 200, 180),
    ("Dark Chocolate", "Snacks", 100, 70, 28, 220, 300), ("Granola Bars", "Snacks", 75, 86, 40, 280, 180), ("Salted Nuts", "Snacks", 175, 46, 24, 150, 150),
    ("Eggs 12 pack", "Dairy", 130, 20, 45, 180, 18), ("Paneer", "Dairy", 190, 18, 28, 110, 10), ("Lemon Soda", "Beverages", 42, 94, 45, 300, 120),
]
POLICIES = {
    "Inventory Policy": "Inventory policy: record every receipt, sale, waste, transfer, and stock adjustment. Investigate counts at or below the reorder point before approving a purchase order.",
    "Reorder Policy": "Reorder policy: recommended order equals forecast demand during supplier lead time plus safety stock minus current stock, never less than zero. Managers must approve recommendations before an order is created.",
    "Safety Stock Guide": "Safety stock is the reserve inventory held to absorb demand variability and supplier delay. It is not a sales forecast and should be reviewed when demand patterns or lead times change.",
    "Expiry and Waste Policy": "Expiry and waste policy: never label stock expired before its expiry date. Prioritize within-one-day goods, then discount, promote, transfer, or donate eligible goods to prevent waste.",
    "Supplier Policy": "Supplier policy: use observed lead time and reliability when selecting a supplier. Purchase orders move from draft to approved, ordered, received, or cancelled with an audit trail.",
    "Chatbot Help": "Chatbot help: current quantities, forecasts, expiry, waste risk, reorders, and sales answers are retrieved from live application tools. Policy answers cite this knowledge base; insufficient data is reported clearly.",
}


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Product).count():
            print("Database already seeded; no changes made.")
            return
        randomizer = random.Random(20260907)
        business = Business(name="Stockwise Demo Business", owner_email="manager@inventory.example.com")
        db.add(business)
        db.flush()
        db.info["business_id"] = business.id
        for role in ["admin", "business_owner", "manager", "staff"]:
            db.add(Role(name=role, description=f"{role.title()} application role"))
        db.add_all([
            User(email="admin@inventory.example.com", full_name="Avery Admin", password_hash=hash_password("Admin123!"), role="admin"),
            User(email="manager@inventory.example.com", full_name="Morgan Manager", password_hash=hash_password("Manager123!"), role="business_owner", business_id=business.id),
            User(email="staff@inventory.example.com", full_name="Sam Staff", password_hash=hash_password("Staff123!"), role="staff", business_id=business.id),
        ])
        categories = {name: Category(name=name) for name in CATEGORIES}
        db.add_all(categories.values())
        suppliers = []
        for i, (name, lead, reliability) in enumerate(SUPPLIERS):
            supplier = Supplier(name=name, email=f"orders{i+1}@supplier.local", phone=f"+91-90000-{1000+i}", lead_time_days=lead, minimum_order_quantity=10, reliability_score=reliability)
            db.add(supplier)
            suppliers.append(supplier)
        db.flush()
        today = date.today()
        product_rows = []
        for index, (name, category, price, stock, reorder, maximum, shelf_life) in enumerate(PRODUCTS, start=1):
            product = Product(
                sku=f"INV-{index:03d}", name=name, category_id=categories[category].id, unit="pack", price=Decimal(str(price)), supplier_id=suppliers[(index - 1) % len(suppliers)].id,
                manufacturing_date=today - timedelta(days=7), expiry_date=(today + timedelta(days=(index % 13) - 3) if shelf_life and shelf_life < 40 else (today + timedelta(days=shelf_life) if shelf_life else None)),
                current_stock=stock, minimum_stock=max(1, reorder - 10), maximum_stock=maximum, reorder_point=reorder, safety_stock=max(8, reorder // 3), lead_time_days=suppliers[(index - 1) % len(suppliers)].lead_time_days,
            )
            db.add(product)
            product_rows.append(product)
        db.flush()
        # Exactly reproducible daily history across 12 months; small trend, weekday, season and promotion effects.
        history_start = today - timedelta(days=364)
        sales: list[Sale] = []
        for product_index, product in enumerate(product_rows):
            base = 2 + (product_index % 9)
            for day_offset in range(365):
                sale_date = history_start + timedelta(days=day_offset)
                promo = sale_date.day in (5, 20) and product_index % 3 == 0
                holiday = sale_date.month == 12 and sale_date.day in (24, 25, 31)
                season = 1.2 if sale_date.month in (11, 12) and product.category_id in (3, 6) else 1.0
                weekend = 1.12 if sale_date.weekday() >= 5 else .94
                trend = 1 + day_offset / 3650
                quantity = max(1, int(round((base + randomizer.uniform(-1.4, 1.4) + (2 if promo else 0) + (1 if holiday else 0)) * weekend * season * trend)))
                unit_price = float(product.price)
                discount = .1 if promo else 0
                sales.append(Sale(date=sale_date, product_id=product.id, quantity_sold=quantity, unit_price=unit_price, discount=discount, promotion=promo, holiday=holiday, channel="online" if product_index % 4 == 0 else "store", location="Central Store", revenue=round(quantity * unit_price * (1-discount), 2)))
        db.add_all(sales)
        for title, body in POLICIES.items():
            document = KnowledgeDocument(title=title, body=body)
            db.add(document)
            db.flush()
            db.add(KnowledgeChunk(document_id=document.id, content=body, metadata_json={"section": title}))
        db.commit()
        for product in product_rows:
            forecast_product(db, product, 30)
        refresh_operational_insights(db)
        print(f"Seeded {len(product_rows)} products and {len(sales)} sales rows.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
