from datetime import date, timedelta
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.db import SessionLocal
from app.models import Product
from app.services.operations import build_reorder, evaluate_expiry, evaluate_waste


def test_expiry_never_flags_future_product_as_expired():
    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.expiry_date.is_not(None), Product.expiry_date >= date.today()).first()
        assert product is not None
        alert = evaluate_expiry(db, product)
        assert alert is None or alert.severity != "expired"
    finally:
        db.close()


def test_reorder_formula_is_explainable():
    db = SessionLocal()
    try:
        product = db.query(Product).first()
        recommendation = build_reorder(db, product)
        assert recommendation.recommended_quantity >= 0
        assert "forecast demand" in recommendation.explanation
        assert "safety stock" in recommendation.explanation
    finally:
        db.rollback(); db.close()
