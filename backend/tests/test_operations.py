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


def test_batch_receiving_and_po_workflows():
    from app.models import InventoryBatch, PurchaseOrder, ReorderRecommendation, User
    from app.routers.api import convert_reorders_to_pos, receive_batches, receive_po
    from app.schemas import BatchInput, ConvertReordersInput

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(role="admin").first()
        product = db.query(Product).first()
        initial_stock = product.current_stock

        # Test batch receiving
        lot_no = f"TEST-LOT-{date.today().isoformat()}"
        batch_input = BatchInput(
            product_id=product.id,
            lot_number=lot_no,
            quantity=15,
            received_date=date.today(),
            expiry_date=date.today() + timedelta(days=60)
        )
        res = receive_batches(batch_input, db=db, user=user)
        assert res["quantity"] == 15
        assert res["current_stock"] == initial_stock + 15
        assert db.query(InventoryBatch).filter_by(lot_number=lot_no).first() is not None

        # Test reorder conversion to PO
        rec = db.query(ReorderRecommendation).filter_by(status="draft").first()
        if not rec:
            rec = ReorderRecommendation(
                product_id=product.id,
                forecast_demand=10,
                recommended_quantity=20,
                explanation="Test recommendation",
                status="draft"
            )
            db.add(rec)
            db.commit()

        convert_res = convert_reorders_to_pos(ConvertReordersInput(recommendation_ids=[rec.id]), db=db, user=user)
        assert len(convert_res["created_pos"]) > 0
        po_id = convert_res["created_pos"][0]
        po = db.get(PurchaseOrder, po_id)
        assert po is not None

        # Test receiving PO
        stock_before_po = product.current_stock
        receive_res = receive_po(po_id, db=db, user=user)
        assert receive_res["status"] == "received"
        assert len(receive_res["items_received"]) > 0
    finally:
        db.rollback()
        db.close()
