"""add business workspaces and tenant keys

Revision ID: 0002_business_tenancy
Revises: 0001_initial
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "0002_business_tenancy"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

SCOPED_TABLES = (
    "users", "categories", "suppliers", "products", "inventory_batches", "inventory_transactions", "sales",
    "forecasts", "waste_predictions", "expiry_alerts", "reorder_recommendations", "purchase_orders",
    "purchase_order_items", "knowledge_documents", "knowledge_chunks", "chatbot_conversations",
    "chatbot_messages", "model_runs", "audit_logs",
)


def _columns(bind, table):
    return {column["name"] for column in inspect(bind).get_columns(table)}


def _ensure_composite_unique(bind, table, old_columns, new_columns, new_name):
    inspector = inspect(bind)
    constraints = inspector.get_unique_constraints(table)
    old = [row for row in constraints if row.get("column_names") == old_columns]
    current = any(row.get("column_names") == new_columns for row in constraints)
    indexes = [row for row in inspector.get_indexes(table) if row.get("unique")]
    old_indexes = [row for row in indexes if row.get("column_names") == old_columns]
    if not old and not old_indexes and current:
        return
    convention = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
    with op.batch_alter_table(table, recreate="always", naming_convention=convention) as batch:
        for row in old:
            name = row.get("name") or f"uq_{table}_{old_columns[0]}"
            batch.drop_constraint(name, type_="unique")
        for row in old_indexes:
            batch.drop_index(row["name"])
        if not current:
            batch.create_unique_constraint(new_name, new_columns)
        for row in old_indexes:
            batch.create_index(row["name"], old_columns, unique=False)


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "businesses" not in tables:
        op.create_table(
            "businesses",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("owner_email", sa.String(length=255), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("owner_email", name="uq_businesses_owner_email"),
        )

    tables = set(inspect(bind).get_table_names())
    for table in SCOPED_TABLES:
        if table not in tables:
            continue
        if "business_id" not in _columns(bind, table):
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table(table, recreate="always") as batch:
                    batch.add_column(sa.Column("business_id", sa.Integer(), nullable=True))
                    batch.create_foreign_key(f"fk_{table}_business_id_businesses", "businesses", ["business_id"], ["id"])
            else:
                op.add_column(table, sa.Column("business_id", sa.Integer(), nullable=True))
                op.create_foreign_key(f"fk_{table}_business_id_businesses", table, "businesses", ["business_id"], ["id"])
        index_name = f"ix_{table}_business_id"
        if not any(row["name"] == index_name for row in inspect(bind).get_indexes(table)):
            op.create_index(index_name, table, ["business_id"])

    for table, old_columns, new_columns, name in (
        ("categories", ["name"], ["business_id", "name"], "uq_category_business_name"),
        ("suppliers", ["name"], ["business_id", "name"], "uq_supplier_business_name"),
        ("products", ["sku"], ["business_id", "sku"], "uq_product_business_sku"),
    ):
        if table in tables:
            _ensure_composite_unique(bind, table, old_columns, new_columns, name)

    # Keep pre-tenancy records together in an administrator-visible legacy workspace.
    if not bind.execute(text("SELECT count(*) FROM businesses")).scalar():
        has_legacy_data = False
        for table in SCOPED_TABLES:
            if table == "users" or table not in set(inspect(bind).get_table_names()):
                continue
            if bind.execute(text(f'SELECT count(*) FROM "{table}"')).scalar():
                has_legacy_data = True
                break
        if not has_legacy_data and "users" in set(inspect(bind).get_table_names()):
            has_legacy_data = bool(bind.execute(text("SELECT count(*) FROM users WHERE role != 'admin'")).scalar())
        if has_legacy_data:
            result = bind.execute(text(
                "INSERT INTO businesses (name, owner_email, is_active, created_at) "
                "VALUES ('Legacy Workspace', 'legacy-owner@stockwise.invalid', 1, CURRENT_TIMESTAMP)"
            ))
            business_id = result.lastrowid
            for table in SCOPED_TABLES:
                if table not in set(inspect(bind).get_table_names()):
                    continue
                if table == "users":
                    bind.execute(text("UPDATE users SET business_id = :business_id WHERE role != 'admin' AND business_id IS NULL"), {"business_id": business_id})
                elif table == "audit_logs":
                    continue
                else:
                    bind.execute(text(f'UPDATE "{table}" SET business_id = :business_id WHERE business_id IS NULL'), {"business_id": business_id})


def downgrade() -> None:
    raise RuntimeError("Business tenancy migration cannot be downgraded without risking cross-business data mixing")
