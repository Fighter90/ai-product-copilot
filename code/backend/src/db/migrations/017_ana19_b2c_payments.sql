-- ANA-19: «заявка ≠ оплата» — Metrika goals only see orders, so paid B2C tickets are entered per
-- day by an admin/analyst (manual) or imported from a payment-provider CSV. One row per ISO day.
-- «Оплачено» = b2c_payments.tickets + B2B deals in stage «paid».
CREATE TABLE b2c_payments (
  date TEXT PRIMARY KEY,
  tickets INTEGER NOT NULL CHECK (tickets >= 0),
  amount_rub REAL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv')),
  note TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
