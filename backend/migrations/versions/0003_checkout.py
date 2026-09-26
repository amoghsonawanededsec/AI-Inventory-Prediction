"""add checkout invoices and line items

Revision ID: 0003_checkout
Revises: 0002_business_tenancy
Create Date: 2026-09-25
"""
from alembic import op
from app.db import Base
from app.models import CheckoutItem, CheckoutTransaction  # noqa: F401

revision = "0003_checkout"
down_revision = "0002_business_tenancy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), tables=[CheckoutTransaction.__table__, CheckoutItem.__table__])


def downgrade() -> None:
    raise RuntimeError("Checkout history cannot be removed without deleting completed invoices")
