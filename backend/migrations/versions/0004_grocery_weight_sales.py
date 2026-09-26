"""add grocery-only gram inventory and selling defaults

Revision ID: 0004_grocery_weight_sales
Revises: 0003_checkout
Create Date: 2026-09-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_grocery_weight_sales"
down_revision = "0003_checkout"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("categories", sa.Column("is_grocery", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("categories", sa.Column("default_weight_unit", sa.String(length=2), nullable=False, server_default="kg"))
    op.add_column("categories", sa.Column("default_weight_g", sa.Integer(), nullable=False, server_default="1000"))
    op.add_column("categories", sa.Column("weight_increment_g", sa.Integer(), nullable=False, server_default="500"))
    op.add_column("categories", sa.Column("minimum_weight_g", sa.Integer(), nullable=False, server_default="100"))
    op.add_column("categories", sa.Column("maximum_weight_g", sa.Integer(), nullable=False, server_default="100000"))

    op.add_column("products", sa.Column("is_weight_based", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("products", sa.Column("weight_unit", sa.String(length=2), nullable=True))
    op.add_column("products", sa.Column("default_weight_g", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("weight_increment_g", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("minimum_weight_g", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("maximum_weight_g", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("weight_stock_g", sa.Integer(), nullable=True))
    op.add_column("inventory_transactions", sa.Column("weight_delta_g", sa.Integer(), nullable=True))
    op.add_column("checkout_items", sa.Column("selected_weight_g", sa.Integer(), nullable=True))
    op.add_column("checkout_items", sa.Column("weight_unit", sa.String(length=2), nullable=True))

    # Mark the already-created Groceries workspace's categories as grocery-only;
    # medical and general retail workspaces retain the default false value.
    op.execute(sa.text("""
        UPDATE categories SET is_grocery = 1
        WHERE business_id IN (SELECT id FROM businesses WHERE lower(name) LIKE '%grocer%')
    """))


def downgrade() -> None:
    op.drop_column("checkout_items", "weight_unit")
    op.drop_column("checkout_items", "selected_weight_g")
    op.drop_column("inventory_transactions", "weight_delta_g")
    op.drop_column("products", "weight_stock_g")
    op.drop_column("products", "maximum_weight_g")
    op.drop_column("products", "minimum_weight_g")
    op.drop_column("products", "weight_increment_g")
    op.drop_column("products", "default_weight_g")
    op.drop_column("products", "weight_unit")
    op.drop_column("products", "is_weight_based")
    op.drop_column("categories", "maximum_weight_g")
    op.drop_column("categories", "minimum_weight_g")
    op.drop_column("categories", "weight_increment_g")
    op.drop_column("categories", "default_weight_g")
    op.drop_column("categories", "default_weight_unit")
    op.drop_column("categories", "is_grocery")
