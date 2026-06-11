"""Amodei ORM models — re-exports for convenience and metadata registration.

Importing this package is enough to register every model in ``Base.metadata``,
which is what Alembic's autogenerate uses as the target.
"""
from __future__ import annotations

from app.models.base import (
    AmodeiBase,
    SERVICE_KIND_ENUM,
    ServiceKind,
    TimestampMixin,
    pg_enum,
)
from app.models.cash import (
    DailySummary,
    Expense,
    ExpenseCategory,
    PosSession,
)
from app.models.inventory import (
    COMMON_UNITS,
    Batch,
    Movement,
    MovementSource,
    MovementType,
    Product,
    Supplier,
    SupplierCategory,
    VatRate,
)
from app.models.invoices import (
    Invoice,
    InvoicePayment,
    Payment,
    PaymentMethod,
)
from app.models.inventory_close import EveningClose, EveningCloseItem
from app.models.menu import CombinedDish, CombinedDishComponent
from app.models.reorder import (
    StockAlert,
    StockAlertSource,
    StockAlertStatus,
    StockSignaledStatus,
    SupplierOrder,
    SupplierOrderLine,
    SupplierOrderStatus,
)
from app.models.settings import AppSetting, AppSettingValueType
from app.models.staff_meals import (
    StaffMeal,
    StaffMealItem,
    StaffMealParticipant,
)
from app.models.cash_vault import CashVaultMovement, MovementKind
from app.models.push import PushSubscription
from app.models.users import User, UserRole
from app.models.work_shifts import WorkShift
from app.models.shift_tips import ShiftTip
from app.models.payroll_split import PayrollSplit
from app.models.day_leave import DayLeave, DayLeaveKind

__all__ = [
    # base
    "AmodeiBase",
    "TimestampMixin",
    "ServiceKind",
    "SERVICE_KIND_ENUM",
    "pg_enum",
    # users
    "User",
    "UserRole",
    # inventory
    "COMMON_UNITS",
    "Supplier",
    "Product",
    "Batch",
    "Movement",
    "MovementSource",
    "MovementType",
    "VatRate",
    # menu
    "CombinedDish",
    "CombinedDishComponent",
    # inventory_close
    "EveningClose",
    "EveningCloseItem",
    # staff_meals
    "StaffMeal",
    "StaffMealParticipant",
    "StaffMealItem",
    # reorder
    "StockAlert",
    "StockSignaledStatus",
    "StockAlertStatus",
    "StockAlertSource",
    "SupplierOrder",
    "SupplierOrderStatus",
    "SupplierOrderLine",
    # invoices + payments
    "Invoice",
    "Payment",
    "PaymentMethod",
    "InvoicePayment",
    "SupplierCategory",
    # cash
    "ExpenseCategory",
    "PosSession",
    "Expense",
    "DailySummary",
    # settings
    "AppSetting",
    "AppSettingValueType",
    # work shifts
    "WorkShift",
    # shift tips (mance POS)
    "ShiftTip",
    # push notifications
    "PushSubscription",
    # cash vault
    "CashVaultMovement",
    "MovementKind",
    # payroll splits (Ben/Dan)
    "PayrollSplit",
    # day leaves
    "DayLeave",
    "DayLeaveKind",
]
